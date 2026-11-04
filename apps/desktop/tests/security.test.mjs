import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceUrl, isExternalUrl, isServiceNavigation } from '../dist/security.js';
test('개발 중에만 loopback HTTP를 허용한다', () => {
  assert.equal(serviceUrl(undefined, true).origin, 'http://127.0.0.1:3100');
  for (const value of [undefined, 'http://127.0.0.1:3100', 'file:///etc/passwd', 'https://user:pass@example.com']) assert.throws(() => serviceUrl(value, false));
  assert.throws(() => serviceUrl('http://example.com', true));
});
test('서비스와 외부 URL·위험 스킴을 구분한다', () => {
  const service = new URL('https://nextstep.example');
  assert.equal(isServiceNavigation('https://nextstep.example/settings', service), true);
  for (const url of ['https://nextstep.example.evil.test', 'javascript:alert(1)', 'file:///tmp/test', 'https://user@nextstep.example']) assert.equal(isServiceNavigation(url, service), false);
  for (const url of ['file:///tmp/test', 'javascript:alert(1)', 'http://example.com', 'https://user@example.com']) assert.equal(isExternalUrl(url), false);
  assert.equal(isExternalUrl('https://example.com/jobs/1'), true);
});
