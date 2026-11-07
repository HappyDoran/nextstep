import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../dist/app.js';
import { openDatabase } from '../dist/database.js';
import { createInvite } from '../dist/auth.js';

function invite(path) {
  const db = openDatabase(path);
  try { return createInvite(db); } finally { db.close(); }
}
const cookieOf = res => res.headers['set-cookie'].split(';')[0];
async function signup(app, path, email) {
  const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { inviteCode: invite(path), email, password: 'correct horse battery' } });
  assert.equal(res.statusCode, 201, res.body);
  return cookieOf(res);
}

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
      const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'A@example.com', password: 'correct horse battery' } });
      assert.equal(login.statusCode, 200);
      const a = cookieOf(login);
      assert.deepEqual((await app.inject({ url: '/applications', headers: { cookie: a } })).json().map(x => x.id), [idA]);
      assert.equal((await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie: a } })).statusCode, 204);
      assert.equal((await app.inject({ url: '/auth/me', headers: { cookie: a } })).statusCode, 401);
    } finally { await app.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('초대 코드는 한 번만, 만료 전에만 쓰고 중복 이메일을 거부한다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-invite-'));
  const path = join(dir, 'db.sqlite');
  const app = createApp(path);
  try {
    const code = invite(path);
    const body = email => ({ inviteCode: code, email, password: 'correct horse battery' });
    assert.equal((await app.inject({ method: 'POST', url: '/auth/signup', payload: body('a@example.com') })).statusCode, 201);
    assert.equal((await app.inject({ method: 'POST', url: '/auth/signup', payload: body('b@example.com') })).statusCode, 403);
    const fresh = invite(path);
    assert.equal((await app.inject({ method: 'POST', url: '/auth/signup', payload: { ...body('A@EXAMPLE.com'), inviteCode: fresh } })).statusCode, 409);
    // 중복 이메일로 실패한 가입은 초대 코드를 소모하지 않는다.
    assert.equal((await app.inject({ method: 'POST', url: '/auth/signup', payload: { ...body('c@example.com'), inviteCode: fresh } })).statusCode, 201);
    const expired = invite(path);
    const db = new DatabaseSync(path);
    db.prepare("UPDATE invites SET expires_at = '2000-01-01T00:00:00.000Z' WHERE used_at IS NULL").run();
    db.close();
    assert.equal((await app.inject({ method: 'POST', url: '/auth/signup', payload: { ...body('d@example.com'), inviteCode: expired } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/auth/signup', payload: { ...body('e@example.com'), inviteCode: invite(path), password: 'short' } })).statusCode, 400);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('만료 세션·반복 로그인 실패를 막는다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-session-'));
  const path = join(dir, 'db.sqlite');
  const app = createApp(path);
  try {
    const a = await signup(app, path, 'a@example.com');
    const db = new DatabaseSync(path);
    db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    db.close();
    assert.equal((await app.inject({ url: '/auth/me', headers: { cookie: a } })).statusCode, 401);
    const wrong = { method: 'POST', url: '/auth/login', payload: { email: 'a@example.com', password: 'wrong password!' } };
    for (let i = 0; i < 5; i++) assert.equal((await app.inject(wrong)).statusCode, 401);
    assert.equal((await app.inject({ ...wrong, payload: { email: 'a@example.com', password: 'correct horse battery' } })).statusCode, 429);
    assert.equal((await app.inject({ ...wrong, payload: { email: 'nobody@example.com', password: 'whatever12345' } })).statusCode, 401);
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
