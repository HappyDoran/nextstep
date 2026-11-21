import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../dist/app.js';
import { openDatabase } from '../dist/database.js';
import { createInvite } from '../dist/auth.js';
import { signIn } from './fake-google.mjs';

function invite(path) {
  const db = openDatabase(path);
  try { return createInvite(db); } finally { db.close(); }
}
async function signup(app, path, email) {
  return signIn(app, email, invite(path));
}
const b64 = value => Buffer.from(value).toString('base64url');
const rejected = async (promise, reason) => assert.equal((await promise).headers.location ?? '', `/?login_error=${reason}`);

test('두 계정의 지원 건은 서로 조회·삭제할 수 없고 재시작 후에도 유지된다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-auth-'));
  const path = join(dir, 'db.sqlite');
  try {
    let app = createApp(path);
    let idA;
    try {
      const a = await signup(app, path, 'a@example.com');
      const b = await signup(app, path, 'b@example.com');
      const created = await app.inject({ method: 'POST', url: '/applications', headers: { cookie: a }, payload: { company: '가상회사', roleTitle: '프론트엔드' } });
      assert.equal(created.statusCode, 201);
      idA = created.json().id;
      assert.equal(created.json().status, '미지원');
      assert.deepEqual((await app.inject({ url: '/applications', headers: { cookie: b } })).json(), []);
      assert.equal((await app.inject({ url: `/applications/${idA}`, headers: { cookie: b } })).statusCode, 404);
      assert.equal((await app.inject({ method: 'DELETE', url: `/applications/${idA}`, headers: { cookie: b } })).statusCode, 404);
      // 본문으로 다른 사용자 ID를 보내도 받아들이지 않는다.
      assert.equal((await app.inject({ method: 'POST', url: '/applications', headers: { cookie: b }, payload: { company: 'x', roleTitle: 'y', userId: 'someone' } })).statusCode, 400);
      assert.equal((await app.inject({ url: '/applications' })).statusCode, 401);
      assert.equal((await app.inject({ url: '/applications', headers: { cookie: 'ns_session=forged' } })).statusCode, 401);
      assert.equal((await app.inject({ url: '/applications', headers: { cookie: 'ns_session=%E0%A4%A' } })).statusCode, 401);
    } finally { await app.close(); }

    app = createApp(path);
    try {
      // 가입한 뒤에는 초대 코드 없이 같은 구글 계정으로 로그인한다.
      const a = await signIn(app, 'A@example.com');
      assert.deepEqual((await app.inject({ url: '/applications', headers: { cookie: a } })).json().map(x => x.id), [idA]);
      assert.equal((await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie: a } })).statusCode, 204);
      assert.equal((await app.inject({ url: '/auth/me', headers: { cookie: a } })).statusCode, 401);
    } finally { await app.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('초대 코드는 한 번만, 만료 전에만 쓰고 초대 없는 구글 계정·확인 안 된 이메일·중복 이메일을 거부한다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-invite-'));
  const path = join(dir, 'db.sqlite');
  const app = createApp(path);
  try {
    const code = invite(path);
    await signIn(app, 'a@example.com', code);
    await assert.rejects(signIn(app, 'b@example.com', code), e => e.response.headers.location === '/?login_error=invite');
    await assert.rejects(signIn(app, 'nobody@example.com'), e => e.response.headers.location === '/?login_error=invite');
    await assert.rejects(signIn(app, 'unverified@example.com', invite(path)), e => e.response.headers.location === '/?login_error=failed');
    const fresh = invite(path);
    // 다른 구글 계정이 이미 쓰는 이메일은 새로 만들지 않고, 실패한 가입은 초대 코드를 소모하지 않는다.
    const db = new DatabaseSync(path);
    db.prepare("UPDATE users SET google_sub = 'someone-else'").run();
    await assert.rejects(signIn(app, 'A@EXAMPLE.com', fresh), e => e.response.headers.location === '/?login_error=invite');
    await signIn(app, 'c@example.com', fresh);
    const expired = invite(path);
    db.prepare("UPDATE invites SET expires_at = '2000-01-01T00:00:00.000Z' WHERE used_at IS NULL").run();
    db.close();
    await assert.rejects(signIn(app, 'd@example.com', expired), e => e.response.headers.location === '/?login_error=invite');
    // 이메일·비밀번호 로그인은 없다.
    assert.equal((await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'a@example.com', password: 'correct horse battery' } })).statusCode, 404);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('구글 로그인은 state가 맞아야 하고, 기존 비밀번호 계정은 같은 이메일의 첫 로그인에서 연결된다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-google-'));
  const path = join(dir, 'db.sqlite');
  let app = createApp(path);
  try {
    await signIn(app, 'warmup@example.com', invite(path));
    const start = await app.inject({ url: '/auth/google/start' });
    const location = new URL(start.headers.location);
    assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(location.searchParams.get('redirect_uri'), 'http://127.0.0.1:3100/api/auth/google/callback');
    const cookie = String(start.headers['set-cookie']).split(';')[0];
    await rejected(app.inject({ url: `/auth/google/callback?code=${b64('warmup@example.com')}&state=wrong`, headers: { cookie } }), 'failed');
    await rejected(app.inject({ url: `/auth/google/callback?code=${b64('warmup@example.com')}&state=${location.searchParams.get('state')}` }), 'failed');
    await app.close();
    // 비밀번호 시절(DB 버전 16) 계정: 버전 17 이행이 비밀번호 해시를 지우고, 구글 로그인이 같은 계정에 연결한다.
    const raw = new DatabaseSync(path);
    raw.exec("INSERT INTO users (id, email, password_hash, created_at) VALUES ('old', 'old@example.com', 'scrypt$x', '2026-01-01'); PRAGMA user_version = 16; DROP INDEX users_google_sub; DROP TABLE login_codes; ALTER TABLE users DROP COLUMN google_sub;");
    raw.close();
    app = createApp(path);
    const a = await signIn(app, 'OLD@example.com');
    assert.equal((await app.inject({ url: '/auth/me', headers: { cookie: a } })).json().id, 'old');
    const check = new DatabaseSync(path);
    assert.deepEqual({ ...check.prepare("SELECT password_hash, google_sub FROM users WHERE id = 'old'").get() }, { password_hash: '', google_sub: 'sub-old@example.com' });
    check.close();
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('데스크톱 로그인 코드는 앱 주소로 넘어가 한 번만, 2분 안에만 세션으로 바뀐다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-desktop-'));
  const path = join(dir, 'db.sqlite');
  const app = createApp(path);
  try {
    await signIn(app, 'a@example.com', invite(path));
    const desktopCode = async () => {
      const start = await app.inject({ url: '/auth/google/start?client=desktop' });
      const state = new URL(start.headers.location).searchParams.get('state');
      const callback = await app.inject({ url: `/auth/google/callback?code=${b64('a@example.com')}&state=${state}`, headers: { cookie: String(start.headers['set-cookie']).split(';')[0] } });
      assert.equal([callback.headers['set-cookie']].flat().some(v => String(v).startsWith('ns_session=') && !String(v).startsWith('ns_session=;')), false);
      const url = new URL(callback.headers.location);
      assert.equal(url.protocol, 'nextstep:');
      return url.searchParams.get('code');
    };
    const exchange = code => app.inject({ method: 'POST', url: '/auth/desktop/exchange', payload: { code } });
    const code = await desktopCode();
    const first = await exchange(code);
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().email, 'a@example.com');
    const cookie = String(first.headers['set-cookie']).split(';')[0];
    assert.equal((await app.inject({ url: '/auth/me', headers: { cookie } })).statusCode, 200);
    assert.equal((await exchange(code)).statusCode, 401);
    const late = await desktopCode();
    const db = new DatabaseSync(path);
    db.prepare("UPDATE login_codes SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    db.close();
    assert.equal((await exchange(late)).statusCode, 401);
    assert.equal((await exchange('short')).statusCode, 400);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('만료 세션은 거부한다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-session-'));
  const path = join(dir, 'db.sqlite');
  const app = createApp(path);
  try {
    const a = await signup(app, path, 'a@example.com');
    const db = new DatabaseSync(path);
    db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    db.close();
    assert.equal((await app.inject({ url: '/auth/me', headers: { cookie: a } })).statusCode, 401);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('계정 삭제는 세션·지원 건을 지우고 다른 계정에 영향이 없으며 삭제 후 자료가 되살아나지 않는다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-delete-'));
  const path = join(dir, 'db.sqlite');
  const app = createApp(path);
  try {
    const a = await signup(app, path, 'a@example.com');
    const b = await signup(app, path, 'b@example.com');
    const payload = { company: '가상회사', roleTitle: '디자이너', postingUrl: 'https://example.com/1' };
    await app.inject({ method: 'POST', url: '/applications', headers: { cookie: a }, payload });
    await app.inject({ method: 'POST', url: '/applications', headers: { cookie: b }, payload });
    const userA = (await app.inject({ url: '/auth/me', headers: { cookie: a } })).json().id;
    assert.equal((await app.inject({ method: 'DELETE', url: '/account', headers: { cookie: a } })).statusCode, 204);
    assert.equal((await app.inject({ url: '/applications', headers: { cookie: a } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/applications', headers: { cookie: a }, payload })).statusCode, 401);
    assert.equal((await app.inject({ url: '/applications', headers: { cookie: b } })).json().length, 1);
    const db = new DatabaseSync(path);
    db.exec('PRAGMA foreign_keys = ON');
    assert.equal(db.prepare('SELECT count(*) AS n FROM applications WHERE user_id = ?').get(userA).n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id = ?').get(userA).n, 0);
    // 삭제 전에 시작된 작업이 늦게 쓰더라도 외래키가 거부한다.
    assert.throws(() => db.prepare("INSERT INTO applications (id, user_id, company, role_title, status, created_at, updated_at) VALUES ('late', ?, 'x', 'y', '미지원', 't', 't')").run(userA), /FOREIGN KEY/);
    db.close();
    assert.equal((await app.inject({ method: 'POST', url: '/applications', headers: { cookie: b }, payload: { ...payload, postingUrl: 'http://example.com' } })).statusCode, 400);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('지원 건 직접 수정은 본인 것만, 상태·열람 변경 이력을 남기고 지원하기 클릭과 무관하다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-patch-'));
  const path = join(dir, 'db.sqlite');
  const app = createApp(path);
  try {
    const a = await signup(app, path, 'a@example.com');
    const b = await signup(app, path, 'b@example.com');
    const created = (await app.inject({ method: 'POST', url: '/applications', headers: { cookie: a }, payload: { company: '가상회사', roleTitle: 'iOS', postingUrl: 'https://example.com/1' } })).json();
    assert.equal(created.readStatus, '정보 없음');
    const patch = (cookie, payload) => app.inject({ method: 'PATCH', url: `/applications/${created.id}`, headers: { cookie }, payload });
    assert.equal((await patch(b, { status: '합격' })).statusCode, 404);
    assert.equal((await patch(a, {})).statusCode, 400);
    assert.equal((await patch(a, { status: '마감' })).statusCode, 400);
    assert.equal((await patch(a, { status: '지원 완료' })).json().status, '지원 완료');
    assert.equal((await patch(a, { readStatus: '열람', roleTitle: 'iOS 개발자' })).json().roleTitle, 'iOS 개발자');
    assert.equal((await patch(a, { status: '지원 완료', postingUrl: null })).json().postingUrl, null);
    const detail = (await app.inject({ url: `/applications/${created.id}`, headers: { cookie: a } })).json();
    assert.deepEqual(detail.events.map(e => [e.field, e.from, e.to]), [['readStatus', '정보 없음', '열람'], ['status', '미지원', '지원 완료']]);
    assert.equal((await app.inject({ url: `/applications/${created.id}`, headers: { cookie: b } })).statusCode, 404);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('자동 ON/OFF는 사용자별로 저장된다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-auto-'));
  const path = join(dir, 'db.sqlite');
  const app = createApp(path);
  try {
    const a = await signup(app, path, 'a@example.com');
    const b = await signup(app, path, 'b@example.com');
    assert.deepEqual((await app.inject({ url: '/settings/automation', headers: { cookie: a } })).json().enabled, false);
    assert.equal((await app.inject({ method: 'PUT', url: '/settings/automation', headers: { cookie: a }, payload: { enabled: 'yes' } })).statusCode, 400);
    await app.inject({ method: 'PUT', url: '/settings/automation', headers: { cookie: a }, payload: { enabled: true } });
    assert.deepEqual((await app.inject({ url: '/settings/automation', headers: { cookie: a } })).json().enabled, true);
    assert.deepEqual((await app.inject({ url: '/settings/automation', headers: { cookie: b } })).json().enabled, false);
    assert.equal((await app.inject({ url: '/settings/automation' })).statusCode, 401);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
