import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceUrl, isExternalUrl, isServiceNavigation, googleLoginUrl, desktopLoginPath } from '../dist/security.js';
import { noticeFor, wanted } from '../dist/notify.js';

test('원격 서비스는 HTTPS만, 같은 컴퓨터는 HTTP도 허용한다', () => {
  assert.equal(serviceUrl(undefined).origin, 'http://127.0.0.1:3100');
  assert.equal(serviceUrl('https://nextstep.tailnet.ts.net').origin, 'https://nextstep.tailnet.ts.net');
  for (const value of ['http://example.com', 'http://100.64.0.1:3100', 'file:///etc/passwd', 'https://user:pass@example.com']) assert.throws(() => serviceUrl(value), value);
});

test('서비스와 외부 URL·위험 스킴을 구분한다', () => {
  const service = new URL('https://nextstep.example');
  assert.equal(isServiceNavigation('https://nextstep.example/settings', service), true);
  for (const url of ['https://nextstep.example.evil.test', 'javascript:alert(1)', 'file:///tmp/test', 'https://user@nextstep.example']) assert.equal(isServiceNavigation(url, service), false);
  for (const url of ['file:///tmp/test', 'javascript:alert(1)', 'http://example.com', 'https://user@example.com']) assert.equal(isExternalUrl(url), false);
  assert.equal(isExternalUrl('https://example.com/jobs/1'), true);
});

test('구글 로그인 시작만 기본 브라우저로 넘기고 앱 주소의 로그인 코드는 형식이 맞을 때만 받는다', () => {
  const service = new URL('https://nextstep.example');
  assert.equal(googleLoginUrl('https://nextstep.example/api/auth/google/start?invite=abc12345', service), 'https://nextstep.example/api/auth/google/start?invite=abc12345&client=desktop');
  for (const url of ['https://nextstep.example/api/auth/me', 'https://evil.test/api/auth/google/start']) assert.equal(googleLoginUrl(url, service), undefined);
  const code = 'a'.repeat(43);
  assert.equal(desktopLoginPath(`nextstep://auth?code=${code}`), `/?desktop_code=${code}`);
  for (const link of [`nextstep://other?code=${code}`, 'nextstep://auth?code=short', `https://auth?code=${code}`, `nextstep://auth?code=${'a'.repeat(42)}%26x`, 'not a url']) assert.equal(desktopLoginPath(link), undefined);
});

test('끝난 갱신만 한 번 알리고 건수와 실패를 구분한다', () => {
  const job = (status, extra = {}) => ({ id: 'j1', status, errorCode: null, result: { judged: 12 }, finishedAt: '2026-11-18T12:00:00Z', ...extra });
  const counts = { basic: 2, challenge: 5 };
  assert.equal(noticeFor({ job: null, counts: null }, undefined), null);
  assert.equal(noticeFor({ job: job('실행중', { finishedAt: null }), counts: null }, undefined), null);
  assert.deepEqual(noticeFor({ job: job('성공'), counts }, undefined), { id: 'j1', title: '공고 가져오기 끝', body: '이번에 판정한 공고 12건 중 기본 2건 · 도전 5건', failed: false, basic: 2 });
  assert.equal(noticeFor({ job: job('성공'), counts }, 'j1'), null);
  // 건수를 못 읽어도 문장이 끊기지 않는다.
  assert.equal(noticeFor({ job: job('성공'), counts: null }, undefined).body, '이번에 판정한 공고 12건');
  assert.equal(noticeFor({ job: job('일부 실패'), counts }, 'j0').title, '공고 가져오기 끝(일부 실패)');
  assert.equal(noticeFor({ job: job('실패', { result: {} }), counts: null }, 'j0').title, '공고 가져오기 실패');
  assert.equal(noticeFor({ job: job('성공', { result: { judged: 0 } }), counts: { basic: 0, challenge: 0 } }, 'j0').body, '새로 판정한 공고가 없습니다.');
});

test('갱신 알림 조건: 모두·기본 추천 있을 때·실패만·끄기', () => {
  const ok = { id: 'a', title: '', body: '', failed: false, basic: 0 };
  const hit = { ...ok, basic: 2 };
  const bad = { ...ok, failed: true };
  assert.equal(wanted(ok, {}), true);
  assert.equal(wanted(ok, { notify: 'basic' }), false);
  assert.equal(wanted(hit, { notify: 'basic' }), true);
  assert.equal(wanted(bad, { notify: 'basic' }), false);
  assert.equal(wanted(hit, { notify: 'failures' }), false);
  assert.equal(wanted(bad, { notify: 'failures' }), true);
  assert.equal(wanted(bad, { notify: 'off' }), false);
});
