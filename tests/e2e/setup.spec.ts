import { test, expect } from '@playwright/test';
test('로컬 웹이 API·DB 준비를 확인하고 실패 후 재시도한다', async ({ page }) => {
  const status = page.getByRole('status').filter({ hasText: /서버|API/ });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('다음 기회를 준비하는');
  await expect(status).toHaveText('API와 로컬 DB가 준비되었습니다.');
  const retry = page.getByRole('button', { name: '다시 확인' });
  // 공통 패키지의 유틸리티가 앱 content 스캔에서 빠져도 텍스트만으로 통과하지 않는다.
  await expect(retry).toHaveCSS('min-height', '44px');
  await expect(retry.locator('svg')).toHaveCSS('width', '20px');
  await expect(retry.locator('svg')).toHaveCSS('stroke-width', '1.5px');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '32px');

  await page.route('**/api/health', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.getByRole('button', { name: '다시 확인' }).click();
  await expect(status).toContainText('서버에 연결하지 못했습니다');
  await page.unroute('**/api/health');
  await page.getByRole('button', { name: '다시 확인' }).click();
  await expect(status).toHaveText('API와 로컬 DB가 준비되었습니다.');
});
