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
test('서비스 모드는 약관상 허락이 필요한 출처를 자동 수집하지 않는다', async () => {
  const { SOURCE_POLICY, collectionModeUpdateSchema } = await import('../dist/index.js');
  assert.deepEqual(SOURCE_POLICY.service, { jobkorea: 'auto', wanted: 'link_only', jasoseol: 'link_only' });
  assert.equal(collectionModeUpdateSchema.safeParse({ mode: 'personal' }).success, true);
  for (const body of [{ mode: 'admin' }, { mode: 'service', sources: {} }, {}]) assert.equal(collectionModeUpdateSchema.safeParse(body).success, false);
});
