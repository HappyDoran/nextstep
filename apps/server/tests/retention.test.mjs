import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../dist/app.js';
import { openDatabase } from '../dist/database.js';
import { createInvite } from '../dist/auth.js';
import { runNext } from '../dist/recommend/jobs.js';
import { createHandler } from '../dist/recommend/pipeline.js';
import { purgeExpired } from '../dist/retention.js';

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-p107-'));
  const path = join(dir, 'db.sqlite');
  const app = createApp(path, { mailSource: async () => [] });
  const signup = async email => {
    const db = openDatabase(path); const inviteCode = createInvite(db); db.close();
    const cookie = (await app.inject({ method: 'POST', url: '/auth/signup', payload: { inviteCode, email, password: 'correct horse battery' } })).headers['set-cookie'].split(';')[0];
    await app.inject({ method: 'PUT', url: '/documents/resume', headers: { cookie, 'content-type': 'application/pdf', 'x-filename': 'r.pdf' }, payload: readFileSync(new URL('./fixtures/resume-text.pdf', import.meta.url)) });
    await app.inject({ method: 'PUT', url: '/profile', headers: { cookie }, payload: { jobFamilies: ['프론트엔드'], experiences: [], regions: ['서울'], remoteOk: true, employmentTypes: ['정규직'], skills: [], summary: '' } });
    return cookie;
  };
  return { dir, path, app, signup, done: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('추천 작업 도중 계정을 삭제해도 개인 자료가 되살아나지 않고 작업자는 계속 동작한다', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    await s.app.inject({ method: 'POST', url: '/postings/refresh', headers: { cookie: a } });
    const posting = { source: 'jobkorea', sourceId: '1', url: 'https://example.com/1', title: 't', company: 'c', deadline: null, alwaysHire: true, location: null, remote: null, careers: [], companyType: null, employeeCount: null, externalApplyUrl: null, body: '본문', bodyFailure: null };
    const deps = {
      collect: { jobkorea: async () => ({ postings: [posting], failures: [] }), saramin: async () => ({ postings: [], failures: [] }), wanted: async () => ({ postings: [], failures: [] }), jumpit: async () => ({ postings: [], failures: [] }), jasoseol: async () => ({ postings: [], failures: [] }) },
      fetchOne: {},
      extract: async () => ({ jobFamilies: ['프론트엔드'], required: [], preferred: [], remote: '미기재', portfolioRequired: false }),
      // 판정 중에 사용자가 계정을 삭제한다.
      candidate: async () => { await s.app.inject({ method: 'DELETE', url: '/account', headers: { cookie: a } }); return { careers: [], skills: [], experiences: [], roles: [], education: '미기재' }; },
    };
    const db = openDatabase(s.path);
    try {
      assert.equal(await runNext(db, createHandler(db, deps)), true);
      assert.equal(db.prepare('SELECT count(*) n FROM recommendations').get().n, 0);
      assert.equal(db.prepare('SELECT count(*) n FROM jobs').get().n, 0);
      assert.equal(db.prepare('SELECT count(*) n FROM users').get().n, 0);
      // 작업자는 다음 작업을 계속 처리할 수 있다.
      assert.equal(await runNext(db, createHandler(db, deps)), false);
    } finally { db.close(); }
  } finally { await s.done(); }
});

test('보관 기한: 30일 지난 끝난 작업·처리한 확인 요청·만료 세션·미사용 초대만 지운다', async () => {
  const s = await setup();
  try {
    await s.signup('a@example.com');
    const db = new DatabaseSync(s.path);
    db.exec('PRAGMA foreign_keys = ON');
    const user = db.prepare('SELECT id FROM users').get().id;
    const old = '2026-01-01T00:00:00.000Z';
    db.prepare("INSERT INTO jobs (id, user_id, kind, status, created_at, finished_at) VALUES ('old', ?, 'refresh', '성공', ?, ?), ('queued', ?, 'mail', '대기', ?, NULL)").run(user, old, old, user, old);
    db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('expired', ?, ?, ?)").run(user, old, old);
    db.close();
    const raw = openDatabase(s.path);
    try {
      const result = purgeExpired(raw, new Date('2026-11-07T00:00:00Z'));
      assert.equal(result.jobs, 1);
      assert.equal(result.sessions, 1);
      assert.deepEqual(raw.prepare('SELECT id FROM jobs').all().map(r => r.id), ['queued']);
      assert.equal(raw.prepare('SELECT count(*) n FROM sessions').get().n, 1);
    } finally { raw.close(); }
  } finally { await s.done(); }
});
