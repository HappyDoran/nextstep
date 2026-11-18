import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../dist/app.js';
import { openDatabase } from '../dist/database.js';
import { createInvite } from '../dist/auth.js';
import { runNext, claim, recoverExpired } from '../dist/recommend/jobs.js';
import { createHandler, isNotHiring, parsePostingLink } from '../dist/recommend/pipeline.js';

// 출처·AI를 가짜로 바꿔 작업·저장·격리 규칙만 확인한다(실제 수집·AI 검증이 아님).
const posting = (source, sourceId, title, body = '필수: React 3년') => ({ source, sourceId, url: `https://example.com/${source}/${sourceId}`, title, company: '가상회사', deadline: '2099-01-01T00:00:00+09:00', alwaysHire: false, location: '서울', remote: false, careers: [], companyType: null, employeeCount: null, externalApplyUrl: null, body, bodyFailure: null });
function fakeDeps(calls) {
  return {
    collect: {
      jobkorea: async family => { calls.push(`jobkorea:${family}`); return { postings: [posting('jobkorea', '1', '프론트엔드 개발자')], failures: [] }; },
      saramin: async family => { calls.push(`saramin:${family}`); return { postings: [posting('saramin', '2', '프론트엔드')], failures: [{ source: 'saramin', id: '9', code: 'blocked' }] }; },
      wanted: async () => ({ postings: [], failures: [] }),
      // 점핏 공고 ID는 사람인 공고 번호와 같아 사람인으로 이미 받은 공고는 다시 저장하지 않는다.
      jumpit: async family => { calls.push(`jumpit:${family}`); return { postings: [posting('jumpit', '2', '점핏 중복 공고')], failures: [] }; },
      jasoseol: async () => { calls.push('jasoseol'); return { postings: [], failures: [] }; },
    },
    fetchOne: { saramin: async id => posting('saramin', id, '링크'), jobkorea: async () => ({ source: 'jobkorea', code: 'not_found' }), wanted: async id => posting('wanted', id, '링크 공고'), jasoseol: async id => posting('jasoseol', id, '링크') },
    extract: async p => { calls.push(`extract:${p.title}`); return { jobFamilies: ['프론트엔드'], required: [{ text: 'React 실무 3년', type: 'skill', keys: ['React'], years: 3, practical: true }], preferred: [], remote: '없음', portfolioRequired: false, employmentTypes: ['정규직'] }; },
    // 지원자 사실 추출은 갱신 작업당 한 번이며, 공고 원문이 아니라 서류만 받는다.
    candidate: async text => { calls.push('candidate'); assert.equal(text.includes('필수: React'), false); return { careers: [{ family: '프론트엔드', months: 36, stack: ['React'] }], skills: ['React'], experiences: [], roles: [], education: '대졸' }; },
  };
}
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-rec-'));
  const path = join(dir, 'db.sqlite');
  const app = createApp(path);
  const signup = async email => {
    const db = openDatabase(path); const inviteCode = createInvite(db); db.close();
    const cookie = (await app.inject({ method: 'POST', url: '/auth/signup', payload: { inviteCode, email, password: 'correct horse battery' } })).headers['set-cookie'].split(';')[0];
    await app.inject({ method: 'PUT', url: '/documents/resume', headers: { cookie, 'content-type': 'application/pdf', 'x-filename': 'r.pdf' }, payload: readFileSync(new URL('./fixtures/resume-text.pdf', import.meta.url)) });
    await app.inject({ method: 'PUT', url: '/profile', headers: { cookie }, payload: { jobFamilies: ['프론트엔드'], experiences: [{ jobFamily: '프론트엔드', years: 3 }], regions: ['서울'], remoteOk: true, employmentTypes: ['정규직'], skills: ['React'], summary: '' } });
    return cookie;
  };
  return { dir, path, app, signup, done: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('갱신 작업: 세 출처를 수집하고 원문 없이 조건·판정을 저장하며 중복 작업을 합친다', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    const first = (await s.app.inject({ method: 'POST', url: '/postings/refresh', headers: { cookie: a } })).json();
    const again = (await s.app.inject({ method: 'POST', url: '/postings/refresh', headers: { cookie: a } })).json();
    assert.equal(first.id, again.id);
    assert.equal(first.status, '대기');
    const db = openDatabase(s.path);
    const calls = [];
    // 실행 중에는 진행(끝낸 출처 묶음 수·전체·받은 공고·남은 시간 어림)을 result에 적는다.
    const seen = [];
    const deps = fakeDeps(calls);
    const jobkorea = deps.collect.jobkorea;
    deps.collect.jobkorea = async (...args) => { seen.push(JSON.parse(db.prepare('SELECT result FROM jobs WHERE id = ?').get(first.id).result).progress); return jobkorea(...args); };
    try {
      assert.equal(await runNext(db, createHandler(db, deps)), true);
      assert.equal(await runNext(db, createHandler(db, fakeDeps(calls))), false);
    } finally { db.close(); }
    assert.equal(seen[0].done, 1);
    assert.equal(seen[0].total, 5, '직무 1개 × 출처 4곳 + 자소설닷컴 1');
    assert.equal(typeof seen[0].etaSeconds, 'number');
    // 출처는 순서대로 수집하고, 판정 순서는 확인 시각이 같으면 정해지지 않는다.
    assert.deepEqual(calls, ['saramin:프론트엔드', 'extract:프론트엔드', 'jobkorea:프론트엔드', 'extract:프론트엔드 개발자', 'jumpit:프론트엔드', 'jasoseol', 'candidate']);
    const job = (await s.app.inject({ url: `/jobs/${first.id}`, headers: { cookie: a } })).json();
    // 가짜 사람인이 상세 한 건 실패를 돌려주므로 일부 실패다.
    assert.equal(job.status, '일부 실패');
    const list = (await s.app.inject({ url: '/recommendations', headers: { cookie: a } })).json();
    assert.deepEqual(list.items.map(i => i.source).sort(), ['jobkorea', 'saramin']);
    assert.equal(list.items[0].classification, '기본');
    assert.equal(list.items[0].postingStatus, '모집중');
    assert.equal(list.items[0].companyType, null);
    assert.equal(list.lastJob.id, first.id);
    // 데스크톱 알림용 마지막 갱신: 끝난 작업과 그 작업이 판정한 기본·도전 건수, 다른 사용자는 자기 것만.
    const latest = (await s.app.inject({ url: '/jobs/latest', headers: { cookie: a } })).json();
    assert.equal(latest.job.id, first.id);
    assert.deepEqual(latest.counts, { basic: list.items.filter(i => i.classification === '기본').length, challenge: list.items.filter(i => i.classification === '도전').length });
    const other = await s.signup('latest-other@example.com');
    assert.deepEqual((await s.app.inject({ url: '/jobs/latest', headers: { cookie: other } })).json(), { job: null, counts: null });
    assert.equal((await s.app.inject({ url: '/jobs/latest' })).statusCode, 401);
    // 연결 상태: 출처는 마지막 갱신의 실패로(가짜 사람인 상세 실패), AI는 닿지 않는 주소면 연결 실패, 메일은 연결 전.
    process.env.NEXTSTEP_OLLAMA_URL = 'http://127.0.0.1:9';
    const conn = (await s.app.inject({ url: '/settings/connections', headers: { cookie: a } })).json();
    delete process.env.NEXTSTEP_OLLAMA_URL;
    assert.equal(conn.ai.status, '연결 실패');
    assert.equal(conn.mail, null);
    // 가짜 사람인은 공고를 받은 뒤 상세 한 건만 실패하므로 일부 실패다.
    const saramin = conn.sources.find(x => x.source === 'saramin');
    assert.equal(saramin.status, '일부 실패');
    assert.ok(saramin.collected > 0);
    assert.equal(Object.values(saramin.failures).reduce((a, b) => a + b, 0), 1);
    assert.equal(conn.sources.find(x => x.source === 'jobkorea').status, '정상');
    assert.deepEqual((await s.app.inject({ url: '/settings/connections', headers: { cookie: other } })).json().sources.map(x => x.status), ['확인 전', '확인 전', '확인 전', '확인 전', '확인 전']);
    assert.equal((await s.app.inject({ url: '/settings/connections' })).statusCode, 401);
    const raw = new DatabaseSync(s.path);
    assert.equal(JSON.stringify(raw.prepare('SELECT * FROM postings').all()).includes('필수: React 3년'), false);
    raw.close();
  } finally { await s.done(); }
});

test('수집한 공고는 갱신한 사용자 자료로만 저장되고 다른 사용자와 공유하지 않는다. 판정 기준이 같으면 다시 판정하지 않는다', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    const b = await s.signup('b@example.com');
    await s.app.inject({ method: 'POST', url: '/postings/refresh', headers: { cookie: a } });
    const calls = [];
    let db = openDatabase(s.path);
    try { await runNext(db, createHandler(db, fakeDeps(calls))); } finally { db.close(); }
    let list = (await s.app.inject({ url: '/recommendations', headers: { cookie: a } })).json();
    assert.equal(list.items.length, 2);
    assert.equal(list.lastJob.status, '일부 실패');
    // B는 A가 모은 공고를 받지 않고, 자기 갱신에서 따로 수집·저장한다.
    assert.deepEqual((await s.app.inject({ url: '/recommendations', headers: { cookie: b } })).json().items, []);
    await s.app.inject({ method: 'POST', url: '/postings/refresh', headers: { cookie: b } });
    const callsB = [];
    db = openDatabase(s.path);
    try { await runNext(db, createHandler(db, fakeDeps(callsB))); } finally { db.close(); }
    assert.ok(callsB.includes('jobkorea:프론트엔드') && callsB.includes('extract:프론트엔드 개발자'));
    const raw = new DatabaseSync(s.path);
    assert.equal(raw.prepare('SELECT count(*) n FROM postings').get().n, 4);
    assert.equal(raw.prepare('SELECT count(DISTINCT owner_user_id) n FROM postings').get().n, 2);
    raw.close();
    // 같은 기준으로 다시 실행하면 지원자 추출(AI 호출)도 다시 하지 않는다.
    await s.app.inject({ method: 'POST', url: '/postings/refresh', headers: { cookie: a } });
    const again = [];
    db = openDatabase(s.path);
    try { await runNext(db, createHandler(db, fakeDeps(again))); } finally { db.close(); }
    assert.equal(again.filter(c => c === 'candidate').length, 0);
  } finally { await s.done(); }
});

test('링크 판정은 그 사용자 전용이고, 숨김·작업 조회는 본인 것만 된다', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    const b = await s.signup('b@example.com');
    assert.equal((await s.app.inject({ method: 'POST', url: '/postings/link', headers: { cookie: a }, payload: { url: 'https://www.saramin.co.kr/x' } })).statusCode, 400);
    const job = (await s.app.inject({ method: 'POST', url: '/postings/link', headers: { cookie: a }, payload: { url: 'https://www.wanted.co.kr/wd/123?utm=x' } })).json();
    const db = openDatabase(s.path);
    try { await runNext(db, createHandler(db, fakeDeps([]))); } finally { db.close(); }
    assert.equal((await s.app.inject({ url: `/jobs/${job.id}`, headers: { cookie: b } })).statusCode, 404);
    const listA = (await s.app.inject({ url: '/recommendations', headers: { cookie: a } })).json();
    assert.equal(listA.items.length, 1);
    assert.equal(listA.items[0].linkOnly, true);
    assert.deepEqual((await s.app.inject({ url: '/recommendations', headers: { cookie: b } })).json().items, []);
    const id = listA.items[0].postingId;
    assert.equal((await s.app.inject({ method: 'PUT', url: `/recommendations/${id}/hide`, headers: { cookie: b }, payload: { hidden: true } })).statusCode, 404);
    assert.equal((await s.app.inject({ method: 'PUT', url: `/recommendations/${id}/hide`, headers: { cookie: a }, payload: { hidden: true } })).statusCode, 200);
    assert.equal((await s.app.inject({ url: '/recommendations', headers: { cookie: a } })).json().items[0].hidden, true);
    // 계정 삭제 시 개인 링크 공고·추천·작업이 함께 지워진다.
    await s.app.inject({ method: 'DELETE', url: '/account', headers: { cookie: a } });
    const raw = new DatabaseSync(s.path);
    assert.equal(raw.prepare('SELECT count(*) n FROM postings').get().n, 0);
    assert.equal(raw.prepare('SELECT count(*) n FROM jobs').get().n, 0);
    raw.close();
  } finally { await s.done(); }
});

test('프로필·이력서가 없으면 작업이 실패로 끝나고, 실행 만료 작업은 재시작 후 다시 대기로 돌아간다', async () => {
  const s = await setup();
  try {
    const db0 = openDatabase(s.path); const inviteCode = createInvite(db0); db0.close();
    const c = (await s.app.inject({ method: 'POST', url: '/auth/signup', payload: { inviteCode, email: 'c@example.com', password: 'correct horse battery' } })).headers['set-cookie'].split(';')[0];
    const job = (await s.app.inject({ method: 'POST', url: '/postings/refresh', headers: { cookie: c } })).json();
    const db = openDatabase(s.path);
    try {
      await runNext(db, createHandler(db, fakeDeps([])));
      assert.equal((await s.app.inject({ url: `/jobs/${job.id}`, headers: { cookie: c } })).json().errorCode, 'profile_or_resume_missing');
      const next = (await s.app.inject({ method: 'POST', url: '/postings/refresh', headers: { cookie: c } })).json();
      assert.notEqual(next.id, job.id);
      claim(db);
      db.prepare("UPDATE jobs SET lease_until = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(next.id);
      recoverExpired(db);
      assert.equal(db.prepare('SELECT status FROM jobs WHERE id = ?').get(next.id).status, '대기');
    } finally { db.close(); }
  } finally { await s.done(); }
});

test('공고 링크 해석은 지원 출처 상세만 받는다', () => {
  assert.deepEqual(parsePostingLink('https://www.saramin.co.kr/zf_user/jobs/relay/view?view_type=search&rec_idx=55484655&location=ts'), { source: 'saramin', id: '55484655' });
  assert.deepEqual(parsePostingLink('https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=55484655'), { source: 'saramin', id: '55484655' });
  assert.deepEqual(parsePostingLink('https://jumpit.saramin.co.kr/position/55566561?x=1'), { source: 'jumpit', id: '55566561' });
  assert.deepEqual(parsePostingLink('https://www.jobkorea.co.kr/Recruit/GI_Read/50050518?Oem_Code=C1'), { source: 'jobkorea', id: '50050518' });
  assert.deepEqual(parsePostingLink('https://www.wanted.co.kr/wd/397013'), { source: 'wanted', id: '397013' });
  assert.deepEqual(parsePostingLink('https://jasoseol.com/recruit/107128'), { source: 'jasoseol', id: '107128' });
  for (const bad of ['http://www.wanted.co.kr/wd/1', 'https://evil.example/wd/1', 'https://www.wanted.co.kr.evil.example/wd/1', 'https://jasoseol.com/career/1', 'https://www.saramin.co.kr/zf_user/company-info/view?rec_idx=1', 'https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=1x', 'not a url']) assert.equal(parsePostingLink(bad), undefined);
});

test('교육생·부트캠프 모집은 채용 공고로 받지 않는다', () => {
  for (const t of ['청년취업사관학교 성북캠퍼스 6기 교육생 모집', '[취업·인턴 연계] SeSAC AI 서비스 기획·PM 부트캠프', '모빌리티 SW 스쿨 5기 클래스메이트 모집']) assert.equal(isNotHiring(t), true, t);
  for (const t of ['2026년 하반기 신입사원 채용', '2027 엔키업 채용연계형 인턴십', 'AI 영상 콘텐츠 크리에이터 (기획·제작)', '시니어 React Native 개발자']) assert.equal(isNotHiring(t), false, t);
});

test('사용자 필터에 맞지 않는 공고는 판정하지 않고, 필터를 바꾸면 기존 결과도 현재 필터로 거른다', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    await s.app.inject({ method: 'POST', url: '/postings/refresh', headers: { cookie: a } });
    const calls = [];
    const deps = fakeDeps(calls);
    deps.collect.jobkorea = async () => ({ postings: [posting('jobkorea', '1', '서울 공고'), { ...posting('jobkorea', '2', '하남 공고'), location: '경기 하남시' }, posting('jobkorea', '3', '프리랜서 공고')], failures: [] });
    deps.collect.saramin = async () => ({ postings: [], failures: [] });
    deps.collect.jumpit = async () => ({ postings: [], failures: [] });
    deps.extract = async p => ({ jobFamilies: ['프론트엔드'], required: [], preferred: [], remote: '없음', portfolioRequired: false, employmentTypes: p.title.includes('프리랜서') ? ['프리랜서'] : ['정규직'] });
    const db = openDatabase(s.path);
    try {
      await runNext(db, createHandler(db, deps));
      assert.deepEqual(db.prepare('SELECT p.title FROM recommendations r JOIN postings p ON p.id = r.posting_id').all().map(r => r.title), ['서울 공고']);
    } finally { db.close(); }
    assert.equal((await s.app.inject({ url: '/recommendations', headers: { cookie: a } })).json().items.length, 1);
    // 지역을 하남으로 바꾸면 다시 가져오기 전에도 서울 공고는 목록에서 빠진다.
    await s.app.inject({ method: 'PUT', url: '/profile', headers: { cookie: a }, payload: { jobFamilies: ['프론트엔드'], experiences: [], regions: ['경기 하남시'], remoteOk: false, employmentTypes: [], careerMax: null, skills: [], summary: '' } });
    assert.equal((await s.app.inject({ url: '/recommendations', headers: { cookie: a } })).json().items.length, 0);
  } finally { await s.done(); }
});

test('좋아요·별로·제외 복구는 그 사용자 목록에만 반영되고 다시 판정해도 유지된다', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    const b = await s.signup('b@example.com');
    await s.app.inject({ method: 'POST', url: '/postings/refresh', headers: { cookie: a } });
    let db = openDatabase(s.path);
    try { await runNext(db, createHandler(db, fakeDeps([]))); } finally { db.close(); }
    const [first, second] = (await s.app.inject({ url: '/recommendations', headers: { cookie: a } })).json().items;
    const fb = (cookie, id, body) => s.app.inject({ method: 'PUT', url: `/recommendations/${id}/feedback`, headers: { cookie }, payload: body });
    assert.equal((await fb(b, first.postingId, { feedback: 'up' })).statusCode, 404);
    assert.equal((await fb(a, first.postingId, {})).statusCode, 400);
    assert.deepEqual((await fb(a, second.postingId, { feedback: 'up' })).json(), { feedback: 'up', restored: false, hidden: false });
    // 별로는 숨김으로도 처리하고, 피드백을 지우면 숨김도 풀린다.
    assert.equal((await fb(a, first.postingId, { feedback: 'down' })).json().hidden, true);
    assert.equal((await fb(a, first.postingId, { feedback: null })).json().hidden, false);
    assert.equal((await fb(a, first.postingId, { restored: true })).json().restored, true);
    // 같은 분류 안에서 좋아요가 위로 온다.
    let items = (await s.app.inject({ url: '/recommendations', headers: { cookie: a } })).json().items;
    assert.equal(items[0].postingId, second.postingId);
    // 판정 기준이 바뀌어 다시 판정해도 피드백·복구는 남는다.
    db = openDatabase(s.path);
    try { db.prepare("UPDATE recommendations SET basis = 'old'").run(); } finally { db.close(); }
    await s.app.inject({ method: 'POST', url: '/postings/refresh', headers: { cookie: a } });
    db = openDatabase(s.path);
    try { await runNext(db, createHandler(db, fakeDeps([]))); } finally { db.close(); }
    items = (await s.app.inject({ url: '/recommendations', headers: { cookie: a } })).json().items;
    assert.equal(items.find(i => i.postingId === second.postingId).feedback, 'up');
    assert.equal(items.find(i => i.postingId === first.postingId).restored, true);
  } finally { await s.done(); }
});
