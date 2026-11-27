import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../dist/app.js';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../dist/database.js';
import { createInvite } from '../dist/auth.js';
import { signIn } from './fake-google.mjs';

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
async function signup(app, path, email) {
  const db = openDatabase(path);
  const inviteCode = createInvite(db);
  db.close();
  return signIn(app, email, inviteCode);
}
const upload = (app, cookie, body, filename, type = 'application/pdf') => app.inject({ method: 'PUT', url: '/documents/resume', headers: { cookie, 'content-type': type, 'x-filename': encodeURIComponent(filename) }, payload: body });

test('이력서 등록·교체·실패 시 기존 유지·삭제와 사용자별 비공개 파일', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-docs-'));
  const path = join(dir, 'db.sqlite');
  const files = join(dir, 'files');
  const app = createApp(path);
  try {
    const a = await signup(app, path, 'a@example.com');
    const b = await signup(app, path, 'b@example.com');
    assert.equal((await app.inject({ url: '/documents/resume', headers: { cookie: a } })).statusCode, 404);
    const first = await upload(app, a, fixture('resume-text.pdf'), '이력서.pdf');
    assert.equal(first.statusCode, 200, first.body);
    assert.match(first.json().text, /프론트엔드 개발자 경력 3년/);
    const userA = (await app.inject({ url: '/auth/me', headers: { cookie: a } })).json().id;
    const [stored] = readdirSync(join(files, userA));
    assert.equal(statSync(join(files, userA, stored)).mode & 0o777, 0o600);
    assert.equal(statSync(join(files, userA)).mode & 0o777, 0o700);

    // 실패한 교체는 기존 문서를 유지한다.
    for (const [body, name, code] of [[fixture('resume-encrypted.pdf'), 'x.pdf', 'encrypted'], [fixture('resume-scanned.pdf'), 'x.pdf', 'scanned_or_empty'], [Buffer.from('MZ'), 'x.exe', 'unsupported_type']]) {
      const res = await upload(app, a, body, name, 'application/octet-stream');
      assert.equal(res.statusCode, 422);
      assert.equal(res.json().code, code);
    }
    assert.equal((await app.inject({ url: '/documents/resume', headers: { cookie: a } })).json().id, first.json().id);
    assert.equal((await upload(app, a, Buffer.from('x'), 'x.pdf', 'image/png')).statusCode, 415);

    // 일부 쪽이 이미지인 PDF는 등록하되 글자 없는 쪽을 저장해 다시 조회해도 알린다.
    assert.deepEqual((await upload(app, a, fixture('resume-partial.pdf'), 'partial.pdf')).json().emptyPages, [2]);
    assert.deepEqual((await app.inject({ url: '/documents/resume', headers: { cookie: a } })).json().emptyPages, [2]);

    const md = await upload(app, a, Buffer.from('# 가상 지원자\n\n서비스 기획 2년, Figma·Jira 사용 경험', 'utf8'), 'resume.md', 'text/markdown');
    assert.equal(md.statusCode, 200);
    // 교체해도 이전 버전 원본은 남는다(첫 PDF·일부 이미지 PDF·MD).
    assert.equal(readdirSync(join(files, userA)).length, 3);
    assert.equal((await app.inject({ url: '/documents/resume', headers: { cookie: b } })).statusCode, 404);

    // 서류 삭제는 모든 버전과 원본을 지운다.
    assert.equal((await app.inject({ method: 'DELETE', url: '/documents/resume', headers: { cookie: a } })).statusCode, 204);
    assert.deepEqual(readdirSync(join(files, userA)), []);
    assert.deepEqual((await app.inject({ url: '/documents/resume/versions', headers: { cookie: a } })).json(), []);
    await upload(app, a, fixture('resume-text.pdf'), 'a.pdf');
    assert.equal((await app.inject({ method: 'DELETE', url: '/account', headers: { cookie: a } })).statusCode, 204);
    assert.equal(existsSync(join(files, userA)), false);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('프로필은 검증한 값만 저장하고 사용자별로 분리된다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-profile-'));
  const path = join(dir, 'db.sqlite');
  const app = createApp(path);
  try {
    const a = await signup(app, path, 'a@example.com');
    const b = await signup(app, path, 'b@example.com');
    const profile = { jobFamilies: ['프론트엔드', '앱 개발'], experiences: [{ jobFamily: '프론트엔드', years: 3 }], regions: ['서울'], remoteOk: true, employmentTypes: ['정규직'], skills: ['React', 'TypeScript'], summary: '' };
    assert.equal((await app.inject({ method: 'PUT', url: '/profile', headers: { cookie: a }, payload: { ...profile, jobFamilies: ['마케팅'] } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PUT', url: '/profile', headers: { cookie: a }, payload: { ...profile, jobFamilies: [] } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PUT', url: '/profile', headers: { cookie: a }, payload: profile })).statusCode, 200);
    // 이전 저장 형식(요구 경력 상한 없음)은 제한 없음(null)으로 읽힌다.
    assert.deepEqual((await app.inject({ url: '/profile', headers: { cookie: a } })).json().profile, { ...profile, careerMax: null, salaryMin: null, excludeCompanies: [], favoriteCompanies: [], preferredSkills: [], avoidSkills: [], companyTypes: [] });
    assert.equal((await app.inject({ url: '/profile', headers: { cookie: b } })).statusCode, 404);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('포트폴리오·경력기술서는 이력서와 따로 저장되고, 변환된 MD는 본인만 고칠 수 있다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-docs-'));
  const path = join(dir, 'db.sqlite');
  const app = createApp(path);
  try {
    const a = await signup(app, path, 'a@example.com');
    const b = await signup(app, path, 'b@example.com');
    const put = (cookie, kind, text, name = 'doc.md') => app.inject({ method: 'PUT', url: `/documents/${kind}`, headers: { cookie, 'content-type': 'text/markdown', 'x-filename': encodeURIComponent(name) }, payload: Buffer.from(text) });
    assert.equal((await put(a, 'resume', '# 이력서\n프론트엔드 개발자 3년, React 실무와 디자인 시스템 운영')).statusCode, 200);
    assert.equal((await put(a, 'career', '# 경력기술서\n결제 화면 리뉴얼 프로젝트를 리딩하고 전환율을 개선함')).statusCode, 200);
    assert.equal((await put(a, 'cover', '# 자기소개서\n지원 동기를 적은 문서입니다')).statusCode, 404);
    assert.equal((await app.inject({ url: '/documents/career', headers: { cookie: a } })).json().kind, 'career');
    assert.match((await app.inject({ url: '/documents/resume', headers: { cookie: a } })).json().text, /React 실무/);
    // 경력기술서를 지워도 이력서는 남는다.
    assert.equal((await app.inject({ method: 'DELETE', url: '/documents/career', headers: { cookie: a } })).statusCode, 204);
    assert.equal((await app.inject({ url: '/documents/resume', headers: { cookie: a } })).statusCode, 200);
    // MD 수정: 본인 서류만 바뀌고 수정 표시가 남는다. 빈 본문은 거부.
    const edit = (cookie, text) => app.inject({ method: 'PUT', url: '/documents/resume/text', headers: { cookie }, payload: { text } });
    assert.equal((await edit(b, '남의 이력서 덮어쓰기')).statusCode, 404);
    assert.equal((await edit(a, '   ')).statusCode, 400);
    const edited = (await edit(a, '# 이력서\n프론트엔드 3년, React·TypeScript 실무')).json();
    assert.equal(edited.edited, true);
    assert.match(edited.text, /TypeScript/);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('서류 버전: 교체 기록 유지·활성 선택·비활성 삭제·최대 10개·사용자 분리', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-versions-'));
  const path = join(dir, 'db.sqlite');
  const files = join(dir, 'files');
  const app = createApp(path);
  try {
    const a = await signup(app, path, 'a@example.com');
    const b = await signup(app, path, 'b@example.com');
    const put = n => app.inject({ method: 'PUT', url: '/documents/resume', headers: { cookie: a, 'content-type': 'text/markdown', 'x-filename': encodeURIComponent(`v${n}.md`) }, payload: Buffer.from(`# 이력서 ${n}\n프론트엔드 개발자 경력 ${n}년, React 실무 경험`) });
    const list = (cookie = a) => app.inject({ url: '/documents/resume/versions', headers: { cookie } });
    const userA = (await app.inject({ url: '/auth/me', headers: { cookie: a } })).json().id;

    const v1 = (await put(1)).json();
    const v2 = (await put(2)).json();
    let versions = (await list()).json();
    assert.deepEqual(versions.map(v => [v.id, v.active]), [[v2.id, true], [v1.id, false]]);
    assert.equal((await app.inject({ url: '/documents/resume', headers: { cookie: a } })).json().id, v2.id);

    // 다른 사용자는 목록·활성 선택·삭제를 할 수 없다.
    assert.deepEqual((await list(b)).json(), []);
    assert.equal((await app.inject({ method: 'PUT', url: `/documents/resume/versions/${v1.id}/active`, headers: { cookie: b } })).statusCode, 404);
    assert.equal((await app.inject({ method: 'DELETE', url: `/documents/resume/versions/${v1.id}`, headers: { cookie: b } })).statusCode, 404);
    assert.equal((await app.inject({ method: 'PUT', url: `/documents/career/versions/${v1.id}/active`, headers: { cookie: a } })).statusCode, 404);
    assert.equal((await app.inject({ method: 'DELETE', url: '/documents/resume/versions/not-a-uuid', headers: { cookie: a } })).statusCode, 404);

    // 이전 버전을 활성으로 고르면 조회·수정 대상이 바뀐다.
    const activated = await app.inject({ method: 'PUT', url: `/documents/resume/versions/${v1.id}/active`, headers: { cookie: a } });
    assert.equal(activated.statusCode, 200);
    assert.match(activated.json().text, /경력 1년/);
    assert.equal((await app.inject({ url: '/documents/resume', headers: { cookie: a } })).json().id, v1.id);

    // 활성 버전은 지울 수 없고, 비활성 버전은 원본과 함께 지운다.
    assert.equal((await app.inject({ method: 'DELETE', url: `/documents/resume/versions/${v1.id}`, headers: { cookie: a } })).statusCode, 409);
    assert.equal((await app.inject({ method: 'DELETE', url: `/documents/resume/versions/${v2.id}`, headers: { cookie: a } })).statusCode, 204);
    assert.deepEqual((await list()).json().map(v => v.id), [v1.id]);
    assert.deepEqual(readdirSync(join(files, userA)), [`${v1.id}.md`]);
    assert.equal((await app.inject({ method: 'DELETE', url: `/documents/resume/versions/${v2.id}`, headers: { cookie: a } })).statusCode, 404);

    // 11번 더 올리면 오래된 비활성 버전부터 지워 10개만 남긴다.
    for (let n = 3; n <= 13; n++) assert.equal((await put(n)).statusCode, 200);
    versions = (await list()).json();
    assert.equal(versions.length, 10);
    assert.equal(versions.filter(v => v.active).length, 1);
    assert.equal(versions[0].filename, 'v13.md');
    assert.ok(!versions.some(v => v.id === v1.id));
    assert.equal(readdirSync(join(files, userA)).length, 10);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('DB 버전 19는 기존 서류를 활성 버전으로 남긴다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-v19-'));
  try {
    const path = join(dir, 'db.sqlite');
    openDatabase(path).close();
    // 버전 18 상태(사용자·kind당 한 개)를 재현한다.
    const raw = new DatabaseSync(path);
    raw.exec(`DROP TABLE documents;
      CREATE TABLE documents (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, filename TEXT NOT NULL, size INTEGER NOT NULL, storage_key TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (user_id, kind)) STRICT;
      ALTER TABLE documents ADD COLUMN empty_pages TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE documents ADD COLUMN ocr_pages TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE documents ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;
      PRAGMA user_version = 18;`);
    raw.exec("INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'a@example.com', '', '2026-01-01')");
    raw.exec("INSERT INTO documents (id, user_id, kind, filename, size, storage_key, text, created_at, edited) VALUES ('d1', 'u1', 'resume', 'a.md', 1, 'u1/d1.md', '본문', '2026-01-01', 1)");
    raw.close();
    const db = openDatabase(path);
    try {
      assert.deepEqual({ ...db.prepare('SELECT id, active, edited FROM documents').get() }, { id: 'd1', active: 1, edited: 1 });
      // 활성 버전은 사용자·kind당 하나뿐이다.
      assert.throws(() => db.exec("INSERT INTO documents (id, user_id, kind, filename, size, storage_key, text, created_at) VALUES ('d2', 'u1', 'resume', 'b.md', 1, 'u1/d2.md', '본문', '2026-01-02')"), /UNIQUE/);
      db.exec("INSERT INTO documents (id, user_id, kind, filename, size, storage_key, text, created_at, active) VALUES ('d2', 'u1', 'resume', 'b.md', 1, 'u1/d2.md', '본문', '2026-01-02', 0)");
      db.exec("DELETE FROM users WHERE id = 'u1'");
      assert.equal(db.prepare('SELECT count(*) AS n FROM documents').get().n, 0);
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('프로필 초안은 요청을 떠나도 서버가 만들어 두고, 버리거나 이력서를 지우면 사라지며 다른 사용자에게 보이지 않는다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-draft-'));
  const path = join(dir, 'db.sqlite');
  const app = createApp(path);
  process.env.NEXTSTEP_AI_FAKE = '1';
  const draft = cookie => app.inject({ url: '/profile/draft', headers: { cookie } }).then(r => r.json().job);
  const settled = async cookie => { for (let i = 0; i < 50; i++) { const job = await draft(cookie); if (job && job.finishedAt) return job; await new Promise(r => setTimeout(r, 20)); } throw new Error('초안이 끝나지 않음'); };
  try {
    const a = await signup(app, path, 'a@example.com');
    const b = await signup(app, path, 'b@example.com');
    assert.equal((await app.inject({ method: 'POST', url: '/profile/suggest', headers: { cookie: a } })).statusCode, 409);
    assert.equal(await draft(a), null);
    await upload(app, a, fixture('resume-text.pdf'), 'a.pdf');
    const started = await app.inject({ method: 'POST', url: '/profile/suggest', headers: { cookie: a } });
    assert.equal(started.statusCode, 202);
    const done = await settled(a);
    assert.equal(done.status, '성공');
    assert.equal(done.kind, 'suggest');
    assert.ok(Array.isArray(done.result.profile.jobFamilies));
    assert.equal(done.id, started.json().id);
    assert.equal(await draft(b), null);
    // 버리면 사라진다.
    assert.equal((await app.inject({ method: 'DELETE', url: '/profile/draft', headers: { cookie: a } })).statusCode, 204);
    assert.equal(await draft(a), null);
    // 프로필(필터)만 저장해서는 받지 않은 초안이 사라지지 않는다. 이력서를 지우면 초안도 지운다.
    await app.inject({ method: 'POST', url: '/profile/suggest', headers: { cookie: a } });
    const next = await settled(a);
    assert.equal((await app.inject({ method: 'PUT', url: '/profile', headers: { cookie: a }, payload: { ...next.result.profile } })).statusCode, 200);
    assert.equal((await draft(a)).id, next.id);
    assert.equal((await app.inject({ method: 'DELETE', url: '/documents/resume', headers: { cookie: a } })).statusCode, 204);
    assert.equal(await draft(a), null);
  } finally { delete process.env.NEXTSTEP_AI_FAKE; await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
