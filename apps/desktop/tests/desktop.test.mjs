import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceUrl, isExternalUrl, isServiceNavigation } from '../dist/security.js';
import { noticeFor } from '../dist/notify.js';

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

test('끝난 갱신만 한 번 알리고 건수와 실패를 구분한다', () => {
  const job = (status, extra = {}) => ({ id: 'j1', status, errorCode: null, result: { judged: 12 }, finishedAt: '2026-11-18T12:00:00Z', ...extra });
  const counts = { basic: 2, challenge: 5 };
  assert.equal(noticeFor({ job: null, counts: null }, undefined), null);
  assert.equal(noticeFor({ job: job('실행중', { finishedAt: null }), counts: null }, undefined), null);
  assert.deepEqual(noticeFor({ job: job('성공'), counts }, undefined), { id: 'j1', title: '공고 가져오기 끝', body: '이번에 판정한 공고 12건 중 기본 2건 · 도전 5건' });
  assert.equal(noticeFor({ job: job('성공'), counts }, 'j1'), null);
  assert.equal(noticeFor({ job: job('일부 실패'), counts }, 'j0').title, '공고 가져오기 끝(일부 실패)');
  assert.equal(noticeFor({ job: job('실패', { result: {} }), counts: null }, 'j0').title, '공고 가져오기 실패');
  assert.equal(noticeFor({ job: job('성공', { result: { judged: 0 } }), counts: { basic: 0, challenge: 0 } }, 'j0').body, '새로 판정한 공고가 없습니다.');
});
