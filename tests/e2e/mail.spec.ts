import { test, expect } from '@playwright/test';
import { deleteAccount, signup } from './helpers';

// 실제 네이버 연결은 하지 않는다. 화면 규칙만 확인하고 서버 응답은 모의로 바꾼다.
test('네이버 연결 동의 필수·연결 상태 표시와 확인 목록 처리', async ({ page }) => {
  await signup(page, `e2e-mail-${Date.now()}@example.com`);
  try {
    // 설정은 한 번에 한 구역만 보인다. 주소의 #구역으로 바로 연다.
    await page.goto('/settings#mail');
    await page.getByLabel('네이버 메일 주소').fill('tester@naver.com');
    await page.getByLabel('애플리케이션 비밀번호').fill('x');
    // 처음 조회할 기간을 고른다(기본 3개월).
    await expect(page.getByLabel('처음 조회할 기간')).toHaveValue('90');
    await page.getByLabel('처음 조회할 기간').selectOption('180');
    await page.getByRole('button', { name: '연결 검사 후 연결' }).click();
    // 동의하지 않으면 브라우저 필수 입력 검사로 제출되지 않는다.
    await expect(page.getByLabel(/읽기 전용으로 조회하고/)).toHaveJSProperty('validity.valueMissing', true);

    await page.route('**/api/mail/connection', route => route.fulfill({ json: { provider: 'naver', account: 'tester@naver.com', status: '정상', consentAt: '2026-11-07T00:00:00.000Z', lastSuccessAt: '2026-11-07T01:00:00.000Z', lastError: null, rangeIncomplete: true, coveredSince: '2026-08-09T00:00:00.000Z', backfillSince: null, lastJob: { id: 'j', kind: 'mail', status: '성공', errorCode: null, result: { stored: 3, applied: 2, created: 0, review: 1 }, createdAt: '2026-11-07T00:00:00.000Z', finishedAt: '2026-11-07T01:00:00.000Z' } } }));
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: 'tester@naver.com' })).toContainText('채용 메일 3건, 반영 2건, 확인 필요 1건');
    await expect(page.getByText(/고른 조회 기간보다 짧습니다/)).toBeVisible();
    await expect(page.getByText(/조회 범위: .* 이후 받은 메일/)).toContainText('1시간마다');
    // 과거 범위 넓히기는 고른 기간으로 별도 작업을 요청한다.
    let pastBody: unknown;
    await page.route('**/api/mail/backfill', route => { pastBody = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { id: 'j2', kind: 'mail', status: '대기', errorCode: null, result: null, createdAt: '2026-11-07T02:00:00.000Z', finishedAt: null } }); });
    await page.getByLabel('과거 범위 넓히기').selectOption('365');
    await page.getByRole('button', { name: '더 오래된 메일 가져오기' }).click();
    await expect.poll(() => pastBody).toEqual({ days: 365 });
    await page.unroute('**/api/mail/backfill');
    await page.unroute('**/api/mail/connection');

    let posted: unknown;
    await page.route('**/api/reviews', route => route.fulfill({ json: [{ id: 'r1', reason: '연결 불명', createdAt: '2026-11-07T00:00:00.000Z', subject: '서류 전형 결과 안내', receivedAt: '2026-11-06T00:00:00.000Z', platform: null, classification: '불합격', evidence: '아쉽게도 함께하기 어렵습니다' }] }));
    await page.route('**/api/reviews/r1', route => { posted = route.request().postDataJSON(); return route.fulfill({ status: 204 }); });
    await page.goto('/reviews');
    // 왼쪽 대기열의 첫 항목이 오른쪽에 열린다. 전체 본문은 누를 때만 읽는다.
    const item = page.getByRole('region', { name: '선택한 메일' });
    await expect(item).toContainText('근거: 아쉽게도 함께하기 어렵습니다');
    let bodyRequests = 0;
    await page.route('**/api/reviews/r1/body', route => { bodyRequests += 1; return route.fulfill({ json: { text: '가상회사 서류 전형 결과를 안내드립니다. 아쉽게도 함께하기 어렵습니다.', fromAddress: 'hr@example.com' } }); });
    expect(bodyRequests).toBe(0);
    await item.getByRole('button', { name: '메일 전체 보기' }).click();
    await expect(item).toContainText('가상회사 서류 전형 결과를 안내드립니다.');
    expect(bodyRequests).toBe(1);
    await item.getByRole('button', { name: '접기' }).click();
    await item.getByRole('button', { name: '새 지원 건으로 확정' }).click();
    await item.getByLabel('회사').fill('가상회사');
    await item.getByLabel('직무').fill('디자이너');
    await item.getByRole('button', { name: '확정', exact: true }).click();
    await expect.poll(() => posted).toEqual({ action: 'create', company: '가상회사', roleTitle: '디자이너', status: '불합격' });
  } finally { await deleteAccount(page); }
});
