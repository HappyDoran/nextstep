import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicationStatusSchema, healthSchema } from '../dist/index.js';
test('공고 마감과 열람을 개인 상태로 허용하지 않는다', () => {
  for (const value of ['마감', '열람', '지원 클릭']) assert.equal(applicationStatusSchema.safeParse(value).success, false);
  assert.equal(applicationStatusSchema.parse('전형 진행중'), '전형 진행중');
});
test('DB 준비 여부가 없는 응답은 성공 계약을 만족하지 않는다', () => {
  assert.equal(healthSchema.safeParse({ service: 'nextstep', status: 'ok' }).success, false);
});
