import { test, expect } from '@playwright/test';
import { alert, deleteAccount, signup } from './helpers';

test('지원 직접 등록·검색·필터·공고 열기와 접수 구분·상태 수정 이력·재접속 유지·오류 재시도', async ({ page, context }) => {
  await signup(page, `e2e-app-${Date.now()}@example.com`);
  const list = page.getByRole('list').filter({ has: page.getByRole('listitem') });
  // 변경 이력 목록의 항목을 빼고 지원 건 항목만 센다.
  const apps = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: /상세·수정|닫기/ }) });
  try {
    await expect(page.getByRole('status').filter({ hasText: '등록한 지원 건이 없습니다.' })).toBeVisible();
    for (const [company, role, url] of [['가상커머스', '프론트엔드 개발자', 'https://example.com/posting/1'], ['가상페이', 'iOS 개발자', '']]) {
      await page.getByLabel('회사').first().fill(company!);
      await page.getByLabel('직무').first().fill(role!);
      await page.getByLabel('공고 URL (선택)').fill(url!);
      await page.getByRole('button', { name: '등록' }).click();
      await expect(list.getByText(company!)).toBeVisible();
    }
    const commerce = apps.filter({ hasText: '가상커머스' });
    // 공고 열기는 외부 이동만 하고 지원 완료로 바꾸지 않는다.
    await context.route('https://example.com/**', route => route.fulfill({ status: 200, body: 'posting' }));
    const popup = page.waitForEvent('popup');
    await commerce.getByRole('link', { name: '공고 열기' }).click();
    await (await popup).close();
    await expect(commerce.getByText('미지원', { exact: true })).toBeVisible();

    await page.getByLabel('검색 (회사·직무)').fill('ios');
    await expect(apps).toHaveCount(1);
    await page.getByLabel('검색 (회사·직무)').fill('');
    await commerce.getByRole('button', { name: '상세·수정' }).click();
    await commerce.getByRole('combobox', { name: /^상태/ }).selectOption('지원 완료');
    await commerce.getByRole('combobox', { name: /^열람/ }).selectOption('미열람');
    await commerce.getByRole('button', { name: '저장' }).click();
    await expect(commerce.getByText('저장했습니다.')).toBeVisible();
    await expect(commerce.getByText(/상태 미지원 → 지원 완료/)).toBeVisible();
    await page.getByLabel('상태 필터').selectOption('지원 완료');
    await expect(apps).toHaveCount(1);

    await page.reload();
    await expect(apps.filter({ hasText: '가상커머스' }).getByText('지원 완료', { exact: true })).toBeVisible();
    await expect(apps).toHaveCount(2);

    await page.route('**/api/applications', route => route.request().method() === 'GET' ? route.fulfill({ status: 503, body: '{}' }) : route.continue());
    await page.reload();
    await expect(alert(page)).toContainText('서버 연결을 확인');
    await page.unroute('**/api/applications');
    await page.getByRole('button', { name: '다시 시도' }).click();
    await expect(apps).toHaveCount(2);
  } finally {
    await deleteAccount(page);
  }
});
