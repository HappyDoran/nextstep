import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../dist/app.js';
import { openDatabase } from '../dist/database.js';
import { createInvite } from '../dist/auth.js';

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
async function signup(app, path, email) {
  const db = openDatabase(path);
  const inviteCode = createInvite(db);
  db.close();
  const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { inviteCode, email, password: 'correct horse battery' } });
  return res.headers['set-cookie'].split(';')[0];
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

    const md = await upload(app, a, Buffer.from('# 가상 지원자\n\n서비스 기획 2년, Figma·Jira 사용 경험', 'utf8'), 'resume.md', 'text/markdown');
    assert.equal(md.statusCode, 200);
    assert.deepEqual(readdirSync(join(files, userA)), [`${md.json().id}.md`]);
    assert.equal((await app.inject({ url: '/documents/resume', headers: { cookie: b } })).statusCode, 404);

    assert.equal((await app.inject({ method: 'DELETE', url: '/documents/resume', headers: { cookie: a } })).statusCode, 204);
    assert.deepEqual(readdirSync(join(files, userA)), []);
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
    assert.equal((await app.inject({ method: 'PUT', url: '/profile', headers: { cookie: a }, payload: { ...profile, jobFamilies: ['백엔드'] } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PUT', url: '/profile', headers: { cookie: a }, payload: { ...profile, jobFamilies: [] } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PUT', url: '/profile', headers: { cookie: a }, payload: profile })).statusCode, 200);
    // 이전 저장 형식(요구 경력 상한 없음)은 제한 없음(null)으로 읽힌다.
    assert.deepEqual((await app.inject({ url: '/profile', headers: { cookie: a } })).json().profile, { ...profile, careerMax: null });
    assert.equal((await app.inject({ url: '/profile', headers: { cookie: b } })).statusCode, 404);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
