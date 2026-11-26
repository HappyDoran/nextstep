import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../dist/app.js';
import { openDatabase } from '../dist/database.js';
import { createInvite } from '../dist/auth.js';
import { signIn } from './fake-google.mjs';
import { runNext } from '../dist/recommend/jobs.js';
import { createHandler } from '../dist/recommend/pipeline.js';
import { sweep } from '../dist/ai/remote.js';

// 내 AI 연결: 실행기(가짜)가 일을 받아 결과를 올리는 흐름과 폴백·격리만 확인한다(실제 Codex 호출 아님).
const posting = (source, sourceId, title) => ({ source, sourceId, url: `https://example.com/${source}/${sourceId}`, title, company: '가상회사', deadline: '2099-01-01T00:00:00+09:00', alwaysHire: false, location: '서울', remote: false, careers: [], companyType: null, employeeCount: null, externalApplyUrl: null, body: '필수: Swift 3년', bodyFailure: null });
const requirements = family => ({ jobFamilies: [family], required: [{ text: 'Swift 실무 3년', type: 'skill', keys: ['Swift'], years: 3, practical: true }], preferred: [], remote: '없음', portfolioRequired: false, employmentTypes: ['정규직'] });
const candidate = { careers: [{ company: 'A사', family: '앱 개발', start: '2022-01', end: '현재', stack: ['Swift'] }], skills: ['Swift'], experiences: [], roles: [], education: '대졸' };
function deps(calls, waitMs) {
  const empty = async () => ({ postings: [], failures: [] });
  return {
    collect: { saramin: async () => ({ postings: [posting('saramin', '1', 'iOS 개발자')], failures: [] }), jobkorea: empty, wanted: empty, jumpit: empty },
    fetchOne: {},
    extract: async p => { calls.push(`local-extract:${p.title}`); return requirements('프론트엔드'); },
    candidate: async () => { calls.push('local-candidate'); return { ...candidate, careers: [{ family: '프론트엔드', months: 12, stack: [] }] }; },
    waitMs,
  };
}
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-ai-'));
  const path = join(dir, 'db.sqlite');
  const app = createApp(path);
  const signup = async email => {
    const db = openDatabase(path); const inviteCode = createInvite(db); db.close();
    const cookie = await signIn(app, email, inviteCode);
    await app.inject({ method: 'PUT', url: '/documents/resume', headers: { cookie, 'content-type': 'application/pdf', 'x-filename': 'r.pdf' }, payload: readFileSync(new URL('./fixtures/resume-text.pdf', import.meta.url)) });
    await app.inject({ method: 'PUT', url: '/profile', headers: { cookie }, payload: { jobFamilies: ['앱 개발', '프론트엔드'], experiences: [], regions: ['서울'], remoteOk: true, employmentTypes: ['정규직'], skills: [], summary: '' } });
    return cookie;
  };
  const api = (cookie, method, url, payload) => app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const runner = (cookie, loggedIn = true) => api(cookie, 'POST', '/ai/runner', { device: '테스트 Mac', codex: { installed: true, loggedIn, version: '0.172.0' } });
  return { dir, path, app, signup, api, runner, done: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}
// 가짜 실행기: 받을 일이 없을 때까지 받아서 정해진 결과를 올린다.
async function drain(s, cookie, outputFor) {
  for (let i = 0; i < 10; i++) {
    const job = (await s.api(cookie, 'POST', '/ai/tasks/claim')).json();
    if (!job.kind) return;
    const ids = job.prompt.match(/"id":\s*"([^"]+)"/g)?.map(m => m.split('"')[3]) ?? [];
    const res = await s.api(cookie, 'POST', '/ai/tasks/submit', { provider: 'codex', taskIds: job.taskIds, output: outputFor(job.kind, ids) });
    assert.equal(res.statusCode, 200, res.body);
  }
}
const output = (kind, ids) => (kind === 'candidate' ? candidate : { items: ids.map(id => ({ id, result: requirements('앱 개발') })) });

test('실행기가 켜져 있으면 갱신이 서류·공고를 내 AI 일로 올리고 결과를 기다려 판정한다(로컬 호출 없음)', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    const status = (await s.runner(a)).json();
    assert.equal(status.active, true);
    assert.deepEqual(status.settings, { enabled: true, sendPostings: true, sendDocuments: true, sendMail: false, dailyLimit: 30 });
    // 실행기 알림만으로 서류 분석 일이 생긴다.
    assert.equal(status.pending, 1);
    await s.api(a, 'POST', '/postings/refresh');
    const calls = [];
    const db = openDatabase(s.path);
    try {
      const running = runNext(db, createHandler(db, deps(calls, 5000)));
      // 갱신이 기다리는 동안 실행기가 처리한다.
      await new Promise(resolve => setTimeout(resolve, 200));
      await drain(s, a, output);
      await running;
    } finally { db.close(); }
    assert.deepEqual(calls, []);
    const items = (await s.api(a, 'GET', '/recommendations')).json().items;
    assert.equal(items.length, 1);
    const after = (await s.api(a, 'GET', '/ai/status')).json();
    assert.equal(after.pending, 0);
    assert.equal(after.remotePostings, 1);
    assert.equal(after.remoteDocuments, true);
    assert.equal(after.usage.calls, 2);
  } finally { await s.done(); }
});

test('실행기가 없으면 로컬로 처리하고, 실행기가 나중에 켜지면 내 AI로 다시 분석해 판정을 바꾼다', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    // 일주일 안에 연결한 적은 있지만 지금은 꺼져 있다(로그아웃).
    await s.runner(a, false);
    await s.api(a, 'POST', '/postings/refresh');
    const calls = [];
    let db = openDatabase(s.path);
    try { await runNext(db, createHandler(db, deps(calls, 5000))); } finally { db.close(); }
    assert.deepEqual(calls, ['local-extract:iOS 개발자', 'local-candidate']);
    const before = (await s.api(a, 'GET', '/recommendations')).json().items[0];
    // 로컬 결과는 승격 일로 남는다(공고 1, 서류 1).
    assert.equal((await s.api(a, 'GET', '/ai/status')).json().pending, 2);
    // 실행기가 켜지면 처리하고, 결과가 들어오면 바로 다시 판정한다.
    await s.runner(a);
    await drain(s, a, output);
    await new Promise(resolve => setTimeout(resolve, 100));
    const after = (await s.api(a, 'GET', '/recommendations')).json().items[0];
    assert.notEqual(after.evaluatedAt, before.evaluatedAt);
    assert.equal((await s.api(a, 'GET', '/ai/status')).json().pending, 0);
    db = openDatabase(s.path);
    try { assert.equal(JSON.parse(db.prepare('SELECT requirements FROM postings').get().requirements).provider, 'codex'); } finally { db.close(); }
  } finally { await s.done(); }
});

test('실행기가 켜져 있어도 10분(테스트는 짧게) 안에 안 끝나면 로컬로 처리하고 일은 승격용으로 남긴다', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    await s.runner(a);
    await s.api(a, 'POST', '/postings/refresh');
    const calls = [];
    const db = openDatabase(s.path);
    try { await runNext(db, createHandler(db, deps(calls, 300))); } finally { db.close(); }
    assert.deepEqual(calls, ['local-extract:iOS 개발자', 'local-candidate']);
    assert.equal((await s.api(a, 'GET', '/recommendations')).json().items.length, 1);
    assert.equal((await s.api(a, 'GET', '/ai/status')).json().pending, 2);
  } finally { await s.done(); }
});

test('다른 사용자의 일은 받거나 올릴 수 없고, 끄면 대기 중인 일과 입력을 지우며, 하루 상한을 넘으면 주지 않는다', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    const b = await s.signup('b@example.com');
    await s.runner(a);
    await s.runner(b);
    const job = (await s.api(a, 'POST', '/ai/tasks/claim')).json();
    assert.equal(job.kind, 'candidate');
    // B가 A의 일 ID로 결과를 올려도 반영되지 않는다.
    assert.equal((await s.api(b, 'POST', '/ai/tasks/submit', { provider: 'codex', taskIds: job.taskIds, output: candidate })).json().applied, 0);
    // 형식이 틀린 결과는 422이고 일은 대기로 돌아간다.
    assert.equal((await s.api(a, 'POST', '/ai/tasks/submit', { provider: 'codex', taskIds: job.taskIds, output: { careers: 'x' } })).statusCode, 422);
    assert.equal((await s.api(a, 'POST', '/ai/tasks/claim')).json().kind, 'candidate');
    // 하루 상한(1번)을 넘으면 주지 않는다.
    const settings = { enabled: true, sendPostings: true, sendDocuments: true, sendMail: false, dailyLimit: 1 };
    await s.api(a, 'PUT', '/ai/settings', settings);
    assert.equal((await s.api(a, 'POST', '/ai/tasks/claim')).json().kind, null);
    // 서류 보내기를 끄면 대기 중인 서류 일을 지운다.
    await s.api(b, 'PUT', '/ai/settings', { ...settings, dailyLimit: 30, sendDocuments: false });
    assert.equal((await s.api(b, 'GET', '/ai/status')).json().pending, 0);
    assert.equal((await s.api(b, 'POST', '/ai/tasks/claim')).json().kind, null);
    assert.equal((await s.api(a, 'PUT', '/ai/settings', { ...settings, dailyLimit: 0 })).statusCode, 400);
    assert.equal((await s.app.inject({ method: 'POST', url: '/ai/tasks/claim' })).statusCode, 401);
  } finally { await s.done(); }
});

test('1시간 안에 내 AI가 안 한 서류는 로컬로 처리하고, 3일 지난 일(입력 포함)은 지운다', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    await s.runner(a);
    const calls = [];
    const local = async () => { calls.push('local'); return { careers: [], skills: [], experiences: [], roles: [], education: '대졸' }; };
    const db = openDatabase(s.path);
    try {
      await sweep(db, local, Date.now() + 30 * 60_000);
      assert.deepEqual(calls, []);
      await sweep(db, local, Date.now() + 61 * 60_000);
      assert.deepEqual(calls, ['local']);
      assert.equal(db.prepare('SELECT count(*) n FROM candidate_facts').get().n, 1);
      assert.equal(db.prepare('SELECT fallback_at FROM ai_tasks').get().fallback_at, null);
      await sweep(db, local, Date.now() + 4 * 86_400_000);
      assert.equal(db.prepare('SELECT count(*) n FROM ai_tasks').get().n, 0);
    } finally { db.close(); }
  } finally { await s.done(); }
});
