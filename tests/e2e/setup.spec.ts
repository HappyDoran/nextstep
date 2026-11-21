import { test, expect } from '@playwright/test';
test('로그인 전 첫 화면은 구글 로그인만 보여 주고 서버 준비 상태는 health로 확인한다', async ({ page }) => {
  expect((await page.request.get('/api/health')).ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('NextStep 시작하기');
  const google = page.getByRole('link', { name: 'Google로 계속하기' });
  // 공통 패키지의 유틸리티가 앱 content 스캔에서 빠져도 텍스트만으로 통과하지 않는다.
  await expect(google).toHaveCSS('height', '40px');
  await expect(google.locator('svg')).toHaveCSS('width', '18px');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '24px');
  // 서비스 연결 확인은 로그인 전 화면에 두지 않는다(기획서 0.2.15).
  await expect(page.getByRole('button', { name: '다시 확인' })).toHaveCount(0);
});
