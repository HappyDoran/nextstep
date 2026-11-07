import { test, expect } from '@playwright/test';
import { alert, deleteAccount, invite, PASSWORD, signup } from './helpers';

test('초대 가입·로그아웃·재로그인·계정 삭제와 오류 표시', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto('/');
  await page.getByRole('tab', { name: '초대 코드로 가입' }).click();
  await page.getByLabel('초대 코드').fill('wrong-code-123');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(PASSWORD);
  await page.getByRole('button', { name: '가입' }).click();
  await expect(alert(page)).toHaveText('초대 코드를 확인하세요.');
  expect(invite()).toMatch(/^[\w-]{16}$/);

  await signup(page, email);
  await page.reload();
  await expect(page.getByRole('heading', { name: '지원 현황' })).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByRole('status').filter({ hasText: email })).toHaveText(`${email} 계정으로 로그인했습니다.`);
  await page.getByRole('button', { name: '로그아웃' }).click();
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill('wrong password!');
  await page.getByRole('button', { name: '로그인' }).last().click();
  await expect(alert(page)).toHaveText('이메일 또는 비밀번호를 확인하세요.');
  await page.getByLabel('비밀번호').fill(PASSWORD);
  await page.getByRole('button', { name: '로그인' }).last().click();
  await expect(page.getByRole('status').filter({ hasText: email })).toBeVisible();

  await deleteAccount(page);
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(PASSWORD);
  await page.getByRole('button', { name: '로그인' }).last().click();
  await expect(alert(page)).toHaveText('이메일 또는 비밀번호를 확인하세요.');

  // 다른 출처나 Origin 없는 변경 요청은 웹 경유 단계에서 거부한다.
  expect((await page.request.post('/api/auth/logout')).status()).toBe(403);
  expect((await page.request.post('/api/auth/logout', { headers: { origin: 'https://evil.example' } })).status()).toBe(403);
  expect((await page.request.get('/api/internal')).status()).toBe(404);
});
