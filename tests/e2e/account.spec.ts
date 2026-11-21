import { test, expect } from '@playwright/test';
import { alert, deleteAccount, googleLogin, invite, inviteLink, signup } from './helpers';

test('초대 가입·로그아웃·재로그인·계정 삭제와 오류 표시', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  // 초대 없이 처음 로그인하는 구글 계정은 거부한다.
  await googleLogin(page, email);
  await expect(alert(page)).toHaveText('초대받은 구글 계정이 아닙니다. 초대 링크로 처음 한 번 로그인하세요.');
  expect(new URL(page.url()).search).toBe('');
  expect(invite()).toMatch(/^[\w-]{16}$/);

  await signup(page, email);
  await page.reload();
  await expect(page.getByRole('heading', { name: '지원 현황' })).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByRole('status').filter({ hasText: email })).toHaveText(`${email} 계정으로 로그인했습니다.`);
  await page.getByRole('button', { name: '로그아웃' }).click();
  // 가입한 뒤에는 초대 없이 같은 구글 계정으로 로그인한다.
  await googleLogin(page, email);
  await page.goto('/settings');
  await expect(page.getByRole('status').filter({ hasText: email })).toBeVisible();

  await deleteAccount(page);
  await googleLogin(page, email);
  await expect(alert(page)).toHaveText('초대받은 구글 계정이 아닙니다. 초대 링크로 처음 한 번 로그인하세요.');

  // 다른 출처나 Origin 없는 변경 요청은 웹 경유 단계에서 거부하고, 비밀번호 로그인 경로는 없다.
  expect((await page.request.post('/api/auth/logout')).status()).toBe(403);
  expect((await page.request.post('/api/auth/logout', { headers: { origin: 'https://evil.example' } })).status()).toBe(403);
  expect((await page.request.get('/api/internal')).status()).toBe(404);
  expect((await page.request.post('/api/auth/login', { headers: { origin: new URL(page.url()).origin } })).status()).toBe(404);
});

test('초대 링크로 열면 주소에서 코드를 지우고 그 코드로 구글 가입한다', async ({ page }) => {
  const link = inviteLink();
  await page.goto(link.pathname + link.search);
  await expect(page.getByText('초대 링크로 가입합니다.')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  await page.getByRole('link', { name: '구글로 로그인' }).click();
  await page.getByLabel('구글 이메일').fill(`e2e-link-${Date.now()}@example.com`);
  await page.getByRole('button', { name: '계속' }).click();
  await expect(page.getByRole('heading', { name: '지원 현황' })).toBeVisible();
  await deleteAccount(page);
});
