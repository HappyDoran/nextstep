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
    return [{ mailbox: 'INBOX', uidValidity: '0', messages: state.mails.filter(m => m.uid > last), oldestDate: '2026-08-12T00:00:00.000Z', complete: true }];
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
