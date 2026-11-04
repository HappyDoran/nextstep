import { test, expect } from '@playwright/test';
test('로컬 웹이 API·DB 준비를 확인하고 실패 후 재시도한다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('다음 기회를 준비하는');
  await expect(page.getByRole('status')).toHaveText('API와 로컬 DB가 준비되었습니다.');
  await page.route('**/api/health', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.getByRole('button', { name: '다시 확인' }).click();
  await expect(page.getByRole('status')).toContainText('서버에 연결하지 못했습니다');
  await page.unroute('**/api/health');
  await page.getByRole('button', { name: '다시 확인' }).click();
  await expect(page.getByRole('status')).toHaveText('API와 로컬 DB가 준비되었습니다.');
});
