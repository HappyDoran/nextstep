import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postingIds } from '../dist/verify/naver-imap.js';

test('알림 메일 본문과 인코딩된 추적 링크에서 출처 공고 ID를 찾는다', () => {
  const body = '<a href="https://www.jobkorea.co.kr/Recruit/GI_Read/123?Oem=1&amp;x=2">a</a> https://www.jobkorea.co.kr/Recruit/GI_Read/123';
  assert.deepEqual(postingIds('jobkorea', body), ['123']);
  assert.deepEqual(postingIds('wanted', 'https://click.example.com/r?u=https%253A%252F%252Fwww.wanted.co.kr%252Fwd%252F456'), ['456']);
  assert.deepEqual(postingIds('jasoseol', 'https://jasoseol.com/recruit/789'), ['789']);
  assert.deepEqual(postingIds('wanted', 'https://www.wanted.co.kr/events/1 %E0%A4%A'), []);
});
