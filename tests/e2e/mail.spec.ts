import { test, expect } from '@playwright/test';
import { deleteAccount, signup } from './helpers';

// 실제 네이버 연결은 하지 않는다. 화면 규칙만 확인하고 서버 응답은 모의로 바꾼다.
test('네이버 연결 동의 필수·연결 상태 표시와 확인 목록 처리', async ({ page }) => {
  await signup(page, `e2e-mail-${Date.now()}@example.com`);
  try {
    await page.goto('/settings');
    await page.getByLabel('네이버 메일 주소').fill('tester@naver.com');
    await page.getByLabel('애플리케이션 비밀번호').fill('x');
    await page.getByRole('button', { name: '연결 검사 후 연결' }).click();
    // 동의하지 않으면 브라우저 필수 입력 검사로 제출되지 않는다.
    await expect(page.getByLabel(/읽기 전용으로 조회하는 데 동의/)).toHaveJSProperty('validity.valueMissing', true);

    await page.route('**/api/mail/connection', route => route.fulfill({ json: { provider: 'naver', account: 'tester@naver.com', status: '정상', consentAt: '2026-11-07T00:00:00.000Z', lastSuccessAt: '2026-11-07T01:00:00.000Z', lastError: null, rangeIncomplete: true, lastJob: { id: 'j', kind: 'mail', status: '성공', errorCode: null, result: { stored: 3, applied: 2, created: 0, review: 1 }, createdAt: '2026-11-07T00:00:00.000Z', finishedAt: '2026-11-07T01:00:00.000Z' } } }));
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: 'tester@naver.com' })).toContainText('채용 메일 3건, 반영 2건, 확인 필요 1건');
    await expect(page.getByText(/최근 3개월보다 짧습니다/)).toBeVisible();
    await page.unroute('**/api/mail/connection');

    let posted: unknown;
    await page.route('**/api/reviews', route => route.fulfill({ json: [{ id: 'r1', reason: '연결 불명', createdAt: '2026-11-07T00:00:00.000Z', subject: '서류 전형 결과 안내', receivedAt: '2026-11-06T00:00:00.000Z', platform: null, classification: '불합격', evidence: '아쉽게도 함께하기 어렵습니다' }] }));
    await page.route('**/api/reviews/r1', route => { posted = route.request().postDataJSON(); return route.fulfill({ status: 204 }); });
    await page.goto('/reviews');
    const item = page.getByRole('listitem').filter({ hasText: '서류 전형 결과 안내' });
    await expect(item).toContainText('근거: 아쉽게도 함께하기 어렵습니다');
    await item.getByRole('button', { name: '새 지원 건으로 확정' }).click();
    await item.getByLabel('회사').fill('가상회사');
    await item.getByLabel('직무').fill('디자이너');
    await item.getByRole('button', { name: '확정', exact: true }).click();
    await expect.poll(() => posted).toEqual({ action: 'create', company: '가상회사', roleTitle: '디자이너', status: '불합격' });
  } finally { await deleteAccount(page); }
});
