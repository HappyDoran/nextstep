import { test, expect } from '@playwright/test';
test('관리 토글로 수집 모드를 바꾸고 재접속 후 유지된다', async ({ page }) => {
  await page.goto('/settings');
  const personal = page.getByRole('radio', { name: /개인/ });
  const service = page.getByRole('radio', { name: /서비스/ });
  const status = page.getByRole('status').filter({ hasText: /잡코리아|수집 모드/ });
  try {
    await service.click();
    await expect(status).toHaveText('잡코리아 자동 수집 · 원티드 링크만 · 자소설닷컴 링크만');
    await personal.click();
    await expect(status).toHaveText('잡코리아 자동 수집 · 원티드 자동 수집 · 자소설닷컴 자동 수집');
    await page.reload();
    await expect(personal).toBeChecked();

    await page.route('**/api/settings/collection', route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, body: '{}' }) : route.continue());
    await service.click();
    await expect(status).toHaveText('수집 모드를 바꾸지 못했습니다. 다시 선택하세요.');
    await expect(personal).toBeChecked();
    await page.unroute('**/api/settings/collection');
  } finally {
    // 로컬 DB에 남기지 않도록 기본값으로 되돌린다.
    await page.request.put('/api/settings/collection', { data: { mode: 'service' }, headers: { origin: 'http://127.0.0.1:3100' } });
  }
});
