import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../dist/app.js';
import { openDatabase } from '../dist/database.js';
import { createInvite } from '../dist/auth.js';
import { runNext } from '../dist/recommend/jobs.js';
import { createMailHandler } from '../dist/mail/sync.js';
import { MailSourceError } from '../dist/mail/naver.js';
import { loadSecretKey } from '../dist/secrets.js';
import { AiError } from '../dist/ai/llm.js';
import { classifyMail, postingKey } from '../dist/mail/classify.js';

// 합성 메일. 실제 사용자 메일 원문이 아니다.
const mail = (uid, from, subject, text = '', links = []) => ({ uid, messageKey: `<m${uid}@example.com>`, receivedAt: `2026-11-0${Math.min(uid, 9)}T00:00:00.000Z`, fromAddress: from, subject, text, links });

test('채용 메일 규칙 판정과 공고 키', () => {
  const v = (from, subject, text = '', links = []) => classifyMail({ fromAddress: from, subject, text, links })?.status ?? null;
  assert.equal(v('noreply@wanted.co.kr', '[원티드] 가상회사 지원이 완료되었습니다'), '지원 완료');
  assert.equal(v('hr@example.com', '서류 전형 결과 안내', '아쉽게도 이번에는 함께하기 어렵게 되었습니다.'), '불합격');
  assert.equal(v('hr@example.com', '서류 합격 및 면접 일정 안내'), '전형 진행중');
  assert.equal(v('hr@example.com', '최종 합격을 축하드립니다'), '합격');
  assert.equal(v('noreply@wanted.co.kr', '[원티드] 가상회사 지원이 완료되었습니다', '최종 합격 시 합격 보상금 50만원을 드립니다'), '지원 완료');
  assert.equal(v('hr@example.com', '면접 일정 안내', '최종 합격자 발표는 다음 주입니다'), '전형 진행중');
  assert.equal(v('noreply@jobkorea.co.kr', '가상회사에서 회원님의 이력서를 열람했습니다'), '열람');
  assert.equal(v('hr@example.com', '이력서를 열람했습니다'), null);
  assert.equal(v('noreply@wanted.co.kr', '(광고) 이번 주 추천 공고'), null);
  assert.equal(v('friend@example.com', '주말 약속'), null);
  assert.equal(v('hr@example.com', '채용 결과 안내', '결과는 채용 홈페이지에서 확인하세요.'), '모호');
  // 추천 공고 블록 뒤의 합격 문구는 결과가 아니다.
  assert.equal(v('noreply@wanted.co.kr', '[원티드] 지원 현황 안내', '지원해 볼 만한 다른 포지션 서류 합격 확률 높음'), null);
  assert.equal(postingKey('https://www.wanted.co.kr/wd/123?utm=x'), 'wanted:123');
  assert.equal(postingKey('https://www.jobkorea.co.kr/Recruit/GI_Read/456?Oem_Code=C1'), 'jobkorea:456');
  assert.equal(postingKey('https://evil.example/wd/1'), null);
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-mail-'));
  const path = join(dir, 'db.sqlite');
  const state = { mails: [], seenCursors: [] };
  const source = async (_account, password, cursors) => {
    if (password !== 'app-password') throw new MailSourceError('auth_failed');
    state.seenCursors.push(new Map(cursors));
    const last = cursors.get('INBOX')?.lastUid ?? 0;
    return [{ mailbox: 'INBOX', uidValidity: '0', messages: state.mails.filter(m => m.uid > last), oldestDate: new Date(Date.now() - 30 * 86_400_000).toISOString(), complete: true }];
  };
  const app = createApp(path, { mailSource: source });
  const signup = async email => {
    const db = openDatabase(path); const inviteCode = createInvite(db); db.close();
    return (await app.inject({ method: 'POST', url: '/auth/signup', payload: { inviteCode, email, password: 'correct horse battery' } })).headers['set-cookie'].split(';')[0];
  };
  const run = async () => {
    const db = openDatabase(path);
    try { await runNext(db, createMailHandler(db, loadSecretKey(join(dir, 'secret.key')), source)); } finally { db.close(); }
  };
  return { dir, path, app, signup, run, state, done: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('연결 검사·암호화 저장·증분 조회·중복 방지·상태 순서·충돌·확인 목록 처리·연결 해제', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    const b = await s.signup('b@example.com');
    const put = (cookie, appPassword) => s.app.inject({ method: 'PUT', url: '/mail/connection', headers: { cookie }, payload: { account: 'tester@naver.com', appPassword, consent: true } });
    assert.equal((await put(a, 'wrong')).statusCode, 422);
    assert.equal((await s.app.inject({ method: 'PUT', url: '/mail/connection', headers: { cookie: a }, payload: { account: 'tester@naver.com', appPassword: 'app-password' } })).statusCode, 400);
    const app1 = (await s.app.inject({ method: 'POST', url: '/applications', headers: { cookie: a }, payload: { company: '가상회사', roleTitle: '프론트엔드', postingUrl: 'https://www.wanted.co.kr/wd/123' } })).json();
    s.state.mails = [
      mail(1, 'noreply@wanted.co.kr', '[원티드] 가상회사 지원이 완료되었습니다', '', ['https://www.wanted.co.kr/wd/123?utm=mail']),
      mail(2, 'hr@example.com', '서류 합격 및 면접 일정 안내', '', ['https://www.wanted.co.kr/wd/123']),
      mail(3, 'hr@other.example', '서류 전형 결과 안내', '아쉽게도 함께하기 어렵습니다'),
      mail(4, 'friend@example.com', '점심'),
    ];
    assert.equal((await put(a, 'app-password')).statusCode, 202);
    const raw = new DatabaseSync(s.path);
    assert.equal(JSON.stringify(raw.prepare('SELECT * FROM mail_connections').all()).includes('app-password'), false);
    raw.close();
    assert.equal(statSync(join(s.dir, 'secret.key')).mode & 0o777, 0o600);
    await s.run();
    const conn = (await s.app.inject({ url: '/mail/connection', headers: { cookie: a } })).json();
    assert.equal(conn.status, '정상');
    assert.equal(conn.rangeIncomplete, true);
    assert.deepEqual({ stored: conn.lastJob.result.stored, skipped: conn.lastJob.result.skipped, applied: conn.lastJob.result.applied, review: conn.lastJob.result.review }, { stored: 3, skipped: 1, applied: 2, review: 0 });
    let detail = (await s.app.inject({ url: `/applications/${app1.id}`, headers: { cookie: a } })).json();
    assert.equal(detail.status, '전형 진행중');
    assert.deepEqual(detail.events.map(e => e.to), ['전형 진행중', '지원 완료']);

    // 같은 메일을 다시 받아도(위치 초기화 상황) 중복 처리하지 않고, 늦게 온 오래된 접수 메일은 상태를 되돌리지 않는다.
    s.state.mails.push(mail(5, 'noreply@wanted.co.kr', '[원티드] 가상회사 지원이 완료되었습니다', '', ['https://www.wanted.co.kr/wd/123']));
    await s.app.inject({ method: 'POST', url: '/mail/sync', headers: { cookie: a } });
    await s.run();
    assert.equal(s.state.seenCursors.at(-1).get('INBOX').lastUid, 4);
    detail = (await s.app.inject({ url: `/applications/${app1.id}`, headers: { cookie: a } })).json();
    assert.equal(detail.status, '전형 진행중');
    // 최종 결과 충돌은 현재 값을 유지하고 확인 요청으로 남긴다.
    s.state.mails.push(mail(6, 'hr@example.com', '최종 합격 안내', '최종 합격을 축하드립니다', ['https://www.wanted.co.kr/wd/123']));
    s.state.mails.push(mail(7, 'hr@example.com', '면접 결과 안내', '아쉽게도 함께하지 못하게 되었습니다', ['https://www.wanted.co.kr/wd/123']));
    s.state.mails.push(mail(8, 'hr@example.com', '채용 결과 안내', '결과는 채용 홈페이지에서 확인하세요', ['https://www.wanted.co.kr/wd/123']));
    await s.app.inject({ method: 'POST', url: '/mail/sync', headers: { cookie: a } });
    await s.run();
    detail = (await s.app.inject({ url: `/applications/${app1.id}`, headers: { cookie: a } })).json();
    assert.equal(detail.status, '합격');
    let reviews = (await s.app.inject({ url: '/reviews', headers: { cookie: a } })).json();
    assert.deepEqual(reviews.map(r => r.reason).sort(), ['모호', '최종 결과 충돌']);
    assert.deepEqual((await s.app.inject({ url: '/reviews', headers: { cookie: b } })).json(), []);
    const unknown = reviews.find(r => r.reason === '모호');
    assert.equal((await s.app.inject({ method: 'POST', url: `/reviews/${unknown.id}`, headers: { cookie: b }, payload: { action: 'ignore' } })).statusCode, 404);
    assert.equal((await s.app.inject({ method: 'POST', url: `/reviews/${unknown.id}`, headers: { cookie: a }, payload: { action: 'create', company: '다른회사', roleTitle: '디자이너' } })).statusCode, 400);
    assert.equal((await s.app.inject({ method: 'POST', url: `/reviews/${unknown.id}`, headers: { cookie: a }, payload: { action: 'create', company: '다른회사', roleTitle: '디자이너', status: '불합격' } })).statusCode, 204);
    const conflict = reviews.find(r => r.reason === '최종 결과 충돌');
    assert.equal((await s.app.inject({ method: 'POST', url: `/reviews/${conflict.id}`, headers: { cookie: a }, payload: { action: 'link', applicationId: app1.id } })).statusCode, 204);
    detail = (await s.app.inject({ url: `/applications/${app1.id}`, headers: { cookie: a } })).json();
    assert.equal(detail.status, '불합격');
    assert.deepEqual((await s.app.inject({ url: '/reviews', headers: { cookie: a } })).json(), []);
    const apps = (await s.app.inject({ url: '/applications', headers: { cookie: a } })).json();
    assert.equal(apps.find(x => x.company === '다른회사').status, '불합격');

    // 연결 해제(메일로 만든 지원 건 삭제 선택): 비밀정보·위치를 지우고 같은 과거 메일로 재생성하지 않는다.
    assert.equal((await s.app.inject({ method: 'DELETE', url: '/mail/connection?keepApplications=false', headers: { cookie: a } })).statusCode, 204);
    assert.equal((await s.app.inject({ url: '/mail/connection', headers: { cookie: a } })).statusCode, 404);
    assert.deepEqual((await s.app.inject({ url: '/applications', headers: { cookie: a } })).json().map(x => x.company), ['가상회사']);
    assert.equal((await s.app.inject({ method: 'POST', url: '/mail/sync', headers: { cookie: a } })).statusCode, 409);
    const db = new DatabaseSync(s.path);
    assert.equal(db.prepare('SELECT count(*) n FROM mail_cursors').get().n, 0);
    assert.ok(db.prepare('SELECT count(*) n FROM evidence_suppressions').get().n >= 1);
    db.close();
  } finally { await s.done(); }
});

test('저장된 비밀번호가 더는 맞지 않으면 인증 실패로 표시한다', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    await s.app.inject({ method: 'PUT', url: '/mail/connection', headers: { cookie: a }, payload: { account: 'tester@naver.com', appPassword: 'app-password', consent: true } });
    const db = openDatabase(s.path);
    try {
      await runNext(db, createMailHandler(db, loadSecretKey(join(s.dir, 'secret.key')), async () => { throw new MailSourceError('auth_failed'); }));
    } finally { db.close(); }
    const conn = (await s.app.inject({ url: '/mail/connection', headers: { cookie: a } })).json();
    assert.equal(conn.status, '인증 실패');
    assert.equal(conn.lastJob.errorCode, 'auth_failed');
  } finally { await s.done(); }
});

test('AI 해석: 회사·직무가 명확하면 지원 건을 만들고, 회사만 같거나 확신이 낮으면 확인받고, 홍보는 제외한다', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    await s.app.inject({ method: 'POST', url: '/applications', headers: { cookie: a }, payload: { company: '(주)기존회사', roleTitle: '디자이너' } });
    s.state.mails = [
      mail(1, 'hr@new.example', '서류 전형 결과 안내', `가상신규 프론트엔드 포지션 결과: 아쉽게도 함께하기 어렵습니다. ${'안내문 '.repeat(60)}본문끝표시`),
      mail(2, 'hr@old.example', '서류 합격 및 면접 안내', '기존회사 iOS 개발자 포지션 서류 합격'),
      mail(3, 'hr@low.example', '채용 결과 안내', '결과는 홈페이지에서 확인'),
      mail(4, 'news@ad.example', '면접 안내 특강 모집', '광고'),
    ];
    await s.app.inject({ method: 'PUT', url: '/mail/connection', headers: { cookie: a }, payload: { account: 'tester@naver.com', appPassword: 'app-password', consent: true } });
    const answers = {
      1: { isRecruiting: true, company: '가상신규', roleTitle: '프론트엔드', status: '불합격', confidence: 'high', evidence: '함께하기 어렵습니다' },
      2: { isRecruiting: true, company: '기존회사', roleTitle: 'iOS 개발자', status: '전형 진행중', confidence: 'high', evidence: '서류 합격' },
      3: { isRecruiting: true, company: null, roleTitle: null, status: '모호', confidence: 'low', evidence: '홈페이지 확인' },
      4: { isRecruiting: false, company: null, roleTitle: null, status: '모호', confidence: 'low', evidence: '광고' },
    };
    const seenBodies = [];
    const interpret = async m => { seenBodies.push(m.body); const uid = s.state.mails.find(x => x.text === m.body).uid; return answers[uid]; };
    const db = openDatabase(s.path);
    try {
      await runNext(db, createMailHandler(db, loadSecretKey(join(s.dir, 'secret.key')), async (_a, p, cursors) => [{ mailbox: 'INBOX', uidValidity: '7', messages: s.state.mails.filter(m => m.uid > (cursors.get('INBOX')?.lastUid ?? 0)), oldestDate: null, complete: true }], { interpret, bodies: async () => new Map() }));
    } finally { db.close(); }
    const apps = (await s.app.inject({ url: '/applications', headers: { cookie: a } })).json();
    assert.deepEqual(apps.map(x => [x.company, x.status]).sort(), [['(주)기존회사', '미지원'], ['가상신규', '불합격']]);
    const reviews = (await s.app.inject({ url: '/reviews', headers: { cookie: a } })).json();
    assert.deepEqual(reviews.map(r => r.reason).sort(), ['모호', '연결 불명']);
    // 본문은 저장하지 않고 짧은 근거 발췌만 남는다.
    const raw = new DatabaseSync(s.path);
    assert.equal(JSON.stringify(raw.prepare('SELECT * FROM mail_messages').all()).includes('본문끝표시'), false);
    assert.equal(raw.prepare("SELECT count(*) n FROM mail_messages WHERE outcome = 'ignored'").get().n, 1);
    raw.close();
    assert.equal(seenBodies.length, 4);
  } finally { await s.done(); }
});

test('AI 일시 실패(크레딧·연결)는 해석 시도 횟수를 쓰지 않고 멈춘다', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    s.state.mails = [mail(1, 'hr@x.example', '서류 전형 결과 안내', '아쉽게도 함께하기 어렵습니다'), mail(2, 'hr@y.example', '서류 전형 결과 안내', '아쉽지만 함께하지 못하게 되었습니다')];
    await s.app.inject({ method: 'PUT', url: '/mail/connection', headers: { cookie: a }, payload: { account: 'tester@naver.com', appPassword: 'app-password', consent: true } });
    let calls = 0;
    const interpret = async () => { calls++; throw new AiError('ai_http', 429); };
    const db = openDatabase(s.path);
    try {
      await runNext(db, createMailHandler(db, loadSecretKey(join(s.dir, 'secret.key')), async () => [{ mailbox: 'INBOX', uidValidity: '7', messages: s.state.mails, oldestDate: null, complete: true }], { interpret, bodies: async () => new Map() }));
    } finally { db.close(); }
    assert.equal(calls, 1);
    const raw = new DatabaseSync(s.path);
    assert.equal(raw.prepare("SELECT max(interpret_attempts) n FROM mail_messages").get().n, 0);
    raw.close();
  } finally { await s.done(); }
});

test('조회 기간을 골라 연결하고, 과거 범위 넓히기는 현재 조회 위치를 바꾸지 않고 나눠 가져온다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-mail-'));
  const path = join(dir, 'db.sqlite');
  const seen = { since: [], backfill: [] };
  const source = async (_a, _p, cursors, since) => { seen.since.push(since.toISOString()); return [{ mailbox: 'INBOX', uidValidity: '7', messages: cursors.size ? [] : [mail(50, 'noreply@wanted.co.kr', '[원티드] 가상A 지원이 완료되었습니다')], oldestDate: null, complete: true }]; };
  // 과거 메일 uid 1~3. 실행당 2건씩(최근 것부터) 돌려주며 진행 위치(belowUid)를 존중한다.
  const past = [mail(1, 'noreply@wanted.co.kr', '[원티드] 가상B 지원이 완료되었습니다'), mail(2, 'friend@example.com', '주말 약속'), mail(3, 'noreply@wanted.co.kr', '[원티드] 가상C 지원이 완료되었습니다')];
  const backfill = async (_a, _p, progress, since, before) => {
    seen.backfill.push([since.toISOString(), before.toISOString()]);
    const below = progress.get('INBOX')?.belowUid ?? Infinity;
    const left = past.filter(m => m.uid < below).sort((x, y) => y.uid - x.uid);
    const take = left.slice(0, 2);
    return [{ mailbox: 'INBOX', uidValidity: '7', messages: take, oldestDate: null, complete: left.length <= 2, lowestUid: take.length ? Math.min(...take.map(m => m.uid)) : null }];
  };
  const app = createApp(path, { mailSource: source });
  try {
    const db0 = openDatabase(path); const inviteCode = createInvite(db0); db0.close();
    const a = (await app.inject({ method: 'POST', url: '/auth/signup', payload: { inviteCode, email: 'a@example.com', password: 'correct horse battery' } })).headers['set-cookie'].split(';')[0];
    assert.equal((await app.inject({ method: 'PUT', url: '/mail/connection', headers: { cookie: a }, payload: { account: 't@naver.com', appPassword: 'x', consent: true, days: 45 } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PUT', url: '/mail/connection', headers: { cookie: a }, payload: { account: 't@naver.com', appPassword: 'x', consent: true, days: 30 } })).statusCode, 202);
    const run = async () => { const db = openDatabase(path); try { await runNext(db, createMailHandler(db, loadSecretKey(join(dir, 'secret.key')), source, undefined, backfill)); } finally { db.close(); } };
    await run();
    const conn = (await app.inject({ url: '/mail/connection', headers: { cookie: a } })).json();
    // 최초 조회는 고른 기간(30일)부터.
    assert.ok(Math.abs(Date.parse(seen.since.at(-1)) - (Date.now() - 30 * 86_400_000)) < 60_000);
    assert.equal(conn.coveredSince, seen.since.at(-1));
    assert.equal(conn.backfillSince, null);
    assert.equal(seen.backfill.length, 0);
    // 이미 조회한 범위보다 짧은 기간은 거부.
    assert.equal((await app.inject({ method: 'POST', url: '/mail/backfill', headers: { cookie: a }, payload: { days: 30 } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/mail/backfill', headers: { cookie: a }, payload: { days: 180 } })).statusCode, 202);
    await run();
    let c = (await app.inject({ url: '/mail/connection', headers: { cookie: a } })).json();
    assert.ok(c.backfillSince, '첫 실행 뒤에도 남은 과거 메일이 있어 진행 중');
    assert.deepEqual(seen.backfill[0], [c.backfillSince, c.coveredSince]);
    assert.equal(c.lastJob.result.more, true);
    await app.inject({ method: 'POST', url: '/mail/sync', headers: { cookie: a } });
    await run();
    c = (await app.inject({ url: '/mail/connection', headers: { cookie: a } })).json();
    // 다 가져오면 조회 범위 시작이 목표로 옮겨지고 진행 위치가 지워진다.
    assert.equal(c.backfillSince, null);
    assert.ok(Math.abs(Date.parse(c.coveredSince) - (Date.now() - 180 * 86_400_000)) < 60_000);
    const raw = new DatabaseSync(path);
    try {
      // 채용 메일만 저장(가상A·B·C), 현재 조회 위치(커서)는 최초 조회 때 그대로.
      assert.equal(raw.prepare('SELECT count(*) n FROM mail_messages').get().n, 3);
      assert.equal(raw.prepare("SELECT last_uid FROM mail_cursors WHERE mailbox = 'INBOX'").get().last_uid, 50);
      assert.equal(raw.prepare('SELECT count(*) n FROM mail_backfill').get().n, 0);
    } finally { raw.close(); }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('잠근 상태는 메일로 바뀌지 않고, 확인 요청은 보류했다가 다시 처리할 수 있다', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    const b = await s.signup('b@example.com');
    await s.app.inject({ method: 'PUT', url: '/mail/connection', headers: { cookie: a }, payload: { account: 'tester@naver.com', appPassword: 'app-password', consent: true } });
    const app1 = (await s.app.inject({ method: 'POST', url: '/applications', headers: { cookie: a }, payload: { company: '가상회사', roleTitle: '프론트엔드', postingUrl: 'https://www.wanted.co.kr/wd/123' } })).json();
    const locked = (await s.app.inject({ method: 'PATCH', url: `/applications/${app1.id}`, headers: { cookie: a }, payload: { status: '지원 완료', lockedFields: ['status'] } })).json();
    assert.deepEqual(locked.lockedFields, ['status']);
    s.state.mails = [
      mail(1, 'hr@example.com', '서류 합격 및 면접 일정 안내', '', ['https://www.wanted.co.kr/wd/123']),
      mail(2, 'hr@example.com', '채용 결과 안내', '결과는 채용 홈페이지에서 확인하세요.', ['https://www.wanted.co.kr/wd/123']),
    ];
    await s.run();
    // 잠근 상태는 메일(서류 합격)로 바뀌지 않는다.
    assert.equal((await s.app.inject({ url: `/applications/${app1.id}`, headers: { cookie: a } })).json().status, '지원 완료');
    // 모호한 결과는 확인 목록으로. 보류하면 목록 아래로 가고 다른 사용자는 못 바꾼다.
    const [r] = (await s.app.inject({ url: '/reviews', headers: { cookie: a } })).json();
    assert.equal(r.held, false);
    assert.equal((await s.app.inject({ method: 'POST', url: `/reviews/${r.id}`, headers: { cookie: b }, payload: { action: 'hold', held: true } })).statusCode, 404);
    assert.equal((await s.app.inject({ method: 'POST', url: `/reviews/${r.id}`, headers: { cookie: a }, payload: { action: 'hold', held: true } })).statusCode, 204);
    assert.equal((await s.app.inject({ url: '/reviews', headers: { cookie: a } })).json()[0].held, true);
    // 보류 중에도 사용자가 직접 확정하면 잠금과 상관없이 반영된다.
    assert.equal((await s.app.inject({ method: 'POST', url: `/reviews/${r.id}`, headers: { cookie: a }, payload: { action: 'link', applicationId: app1.id, status: '전형 진행중' } })).statusCode, 204);
    assert.equal((await s.app.inject({ url: `/applications/${app1.id}`, headers: { cookie: a } })).json().status, '전형 진행중');
  } finally { await s.done(); }
});

test('AI 응답 시간 초과는 그 메일만 시도 횟수를 쓰고 다음 메일을 계속 해석한다', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    s.state.mails = [mail(1, 'hr@x.example', '서류 전형 결과 안내', '아쉽게도 함께하기 어렵습니다'), mail(2, 'hr@y.example', '서류 전형 결과 안내', '아쉽지만 함께하지 못하게 되었습니다')];
    await s.app.inject({ method: 'PUT', url: '/mail/connection', headers: { cookie: a }, payload: { account: 'tester@naver.com', appPassword: 'app-password', consent: true } });
    let calls = 0;
    const interpret = async () => { calls++; throw new AiError('ai_timeout'); };
    const db = openDatabase(s.path);
    try {
      await runNext(db, createMailHandler(db, loadSecretKey(join(s.dir, 'secret.key')), async () => [{ mailbox: 'INBOX', uidValidity: '7', messages: s.state.mails, oldestDate: null, complete: true }], { interpret, bodies: async () => new Map() }));
      assert.equal(calls, 2);
      assert.equal(db.prepare('SELECT min(interpret_attempts) n FROM mail_messages').get().n, 1);
      assert.deepEqual(JSON.parse(db.prepare("SELECT result FROM jobs WHERE kind = 'mail'").get().result).aiFailureCodes, { ai_timeout: 2 });
    } finally { db.close(); }
  } finally { await s.done(); }
});

test('AI가 플랫폼 이름이나 지시문이 섞인 문자열을 회사로 내면 지원 건을 만들지 않고 확인받는다', async () => {
  const { applyInterpretation } = await import('../dist/mail/apply.js');
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    const db = openDatabase(s.path);
    try {
      const userId = db.prepare('SELECT id FROM users').get().id;
      for (const [i, company] of [['1', '원티드'], ['2', '(주)가상: 1. 지원한 회사 이름을 정확히 추출']]) {
        const id = `m${i}`;
        db.prepare("INSERT INTO mail_messages (id, user_id, provider, message_key, received_at, subject, classification, outcome, processed_at) VALUES (?, ?, 'naver', ?, NULL, '결과 안내', '불합격', 'unlinked', '2026-11-14')").run(id, userId, `<k${i}>`);
        const out = applyInterpretation(db, { id, userId, messageKey: `<k${i}>`, subject: '결과 안내', receivedAt: null, verdict: { status: '불합격', evidence: null, platform: null, postingKeys: [] } }, { isRecruiting: true, company, roleTitle: '프론트엔드 개발자', status: '불합격', confidence: 'high' });
        assert.equal(out, 'review', company);
      }
      assert.equal(db.prepare('SELECT count(*) n FROM applications').get().n, 0);
    } finally { db.close(); }
    void a;
  } finally { await s.done(); }
});

test('AI 해석은 오래된 메일부터 하고, 같은 회사 지원 건이 하나면 직무명이 포함 관계일 때 같은 지원으로 본다', async () => {
  const s = await setup();
  try {
    const a = await s.signup('a@example.com');
    // 최근 메일(열람·결과)이 먼저 보관되도록 역순으로 넣는다. 해석은 받은 시각 오름차순.
    s.state.mails = [
      mail(3, 'hr@n.example', '서류 전형 결과 안내', '결과'),
      mail(2, 'noreply@jobkorea.co.kr', '이력서를 열람했습니다', '열람'),
      mail(1, 'hr@n.example', '지원 완료 안내', '접수'),
      mail(4, 'hr@n.example', '면접 안내', '다른 직무'),
    ];
    await s.app.inject({ method: 'PUT', url: '/mail/connection', headers: { cookie: a }, payload: { account: 'tester@naver.com', appPassword: 'app-password', consent: true } });
    const answers = {
      1: { isRecruiting: true, company: '가상회사', roleTitle: '프론트엔드 개발자', status: '지원 완료', confidence: 'high', evidence: '접수' },
      2: { isRecruiting: true, company: '가상회사', roleTitle: '프론트엔드 개발자', status: '열람', confidence: 'high', evidence: '열람' },
      3: { isRecruiting: true, company: '(주)가상회사', roleTitle: '프론트엔드 개발자 (React)', status: '불합격', confidence: 'high', evidence: '결과' },
      4: { isRecruiting: true, company: '가상회사', roleTitle: '백엔드 개발자', status: '전형 진행중', confidence: 'high', evidence: '면접' },
    };
    const order = [];
    const interpret = async m => { const uid = s.state.mails.find(x => x.text === m.body).uid; order.push(uid); return answers[uid]; };
    const db = openDatabase(s.path);
    try {
      await runNext(db, createMailHandler(db, loadSecretKey(join(s.dir, 'secret.key')), async () => [{ mailbox: 'INBOX', uidValidity: '7', messages: s.state.mails, oldestDate: null, complete: true }], { interpret, bodies: async () => new Map() }));
    } finally { db.close(); }
    // 열람 메일(uid 2)은 규칙으로 판정돼 해석 대상이 아닐 수 있어, 해석 순서는 받은 시각 오름차순인지만 본다.
    assert.deepEqual(order, [...order].sort((x, y) => x - y));
    const apps = (await s.app.inject({ url: '/applications', headers: { cookie: a } })).json();
    assert.equal(apps.length, 1);
    assert.equal(apps[0].status, '불합격');
    // 직무명이 포함 관계가 아닌 같은 회사 메일(백엔드)은 확인받는다.
    assert.deepEqual((await s.app.inject({ url: '/reviews', headers: { cookie: a } })).json().map(r => r.reason), ['연결 불명']);
  } finally { await s.done(); }
});

test('메일 상태는 규칙이 명확하면 규칙을, AI만 합격이라 하면 확인 요청(모호)으로 둔다', async () => {
  const { mergeMailStatus } = await import('../dist/mail/sync.js');
  assert.equal(mergeMailStatus('열람', '합격'), '열람');
  assert.equal(mergeMailStatus('지원 완료', '불합격'), '지원 완료');
  assert.equal(mergeMailStatus('합격', '지원 완료'), '합격');
  assert.equal(mergeMailStatus(null, '합격'), '모호');
  assert.equal(mergeMailStatus('모호', '합격'), '모호');
  assert.equal(mergeMailStatus('모호', '불합격'), '불합격');
  assert.equal(mergeMailStatus(null, '전형 진행중'), '전형 진행중');
});

test('열람은 직무명이 없거나 확신이 낮아도 같은 회사 지원 건이 하나면 붙이고, 여럿이면 직무명이 같은 건에만 붙인다', async () => {
  const { applyInterpretation } = await import('../dist/mail/apply.js');
  const s = await setup();
  try {
    await s.signup('a@example.com');
    const db = openDatabase(s.path);
    try {
      const userId = db.prepare('SELECT id FROM users').get().id;
      const app = (id, company, role) => db.prepare("INSERT INTO applications (id, user_id, company, role_title, status, created_at, updated_at, origin) VALUES (?, ?, ?, ?, '지원 완료', '2026-11-15', '2026-11-15', 'mail')").run(id, userId, company, role);
      app('one', '가상회사', '프론트엔드 개발자');
      app('two-a', '둘회사', '프론트엔드 개발자');
      app('two-b', '둘회사', '백엔드 개발자');
      const read = (i, company, roleTitle, confidence = 'low') => {
        db.prepare("INSERT INTO mail_messages (id, user_id, provider, message_key, received_at, subject, classification, outcome, processed_at) VALUES (?, ?, 'naver', ?, NULL, '이력서를 열람했습니다', '열람', 'unlinked', '2026-11-15')").run(`r${i}`, userId, `<r${i}>`);
        return applyInterpretation(db, { id: `r${i}`, userId, messageKey: `<r${i}>`, subject: '이력서를 열람했습니다', receivedAt: null, verdict: { status: '열람', evidence: null, platform: '잡코리아', postingKeys: [] } }, { isRecruiting: true, company, roleTitle, status: '열람', confidence });
      };
      assert.equal(read(1, '(주)가상회사', null), 'applied');
      assert.equal(read(2, '둘회사', null), 'no_change');
      assert.equal(read(3, '둘회사', '백엔드 개발자'), 'applied');
      assert.equal(read(4, '없는회사', null), 'no_change');
      const status = id => db.prepare('SELECT status, read_status FROM applications WHERE id = ?').get(id);
      assert.deepEqual({ ...status('one') }, { status: '지원 완료', read_status: '열람' });
      assert.notEqual(status('two-a').read_status, '열람');
      assert.equal(status('two-b').read_status, '열람');
      assert.equal(db.prepare('SELECT count(*) n FROM review_requests').get().n, 0);
    } finally { db.close(); }
  } finally { await s.done(); }
});
