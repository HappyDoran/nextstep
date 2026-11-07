import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

// 운영자 초대 코드 발급 명령으로 e2e 서버와 같은 DB에 코드를 만든다.
const invite = () => execFileSync('pnpm', ['--silent', '--filter', '@nextstep/server', 'invite'], { encoding: 'utf8' }).trim();

test('초대 가입·로그아웃·재로그인·계정 삭제와 오류 표시', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'correct horse battery';
  await page.goto('/');
  const status = page.getByRole('status').filter({ hasText: /계정/ });
  await expect(status).toHaveCount(0);
  await page.getByRole('tab', { name: '초대 코드로 가입' }).click();
  await page.getByLabel('초대 코드').fill('wrong-code-123');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '가입' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /확인하세요/ })).toHaveText('초대 코드를 확인하세요.');

  await page.getByLabel('초대 코드').fill(invite());
  await page.getByRole('button', { name: '가입' }).click();
  await expect(page.getByRole('status').filter({ hasText: email })).toHaveText(`${email} 계정으로 로그인했습니다.`);

  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: email })).toBeVisible();
  await page.getByRole('button', { name: '로그아웃' }).click();
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill('wrong password!');
  await page.getByRole('button', { name: '로그인' }).last().click();
  await expect(page.getByRole('alert').filter({ hasText: /확인하세요/ })).toHaveText('이메일 또는 비밀번호를 확인하세요.');
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).last().click();
  await expect(page.getByRole('status').filter({ hasText: email })).toBeVisible();

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '계정 삭제' }).click();
  await expect(page.getByRole('tab', { name: '로그인' })).toBeVisible();
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).last().click();
  await expect(page.getByRole('alert').filter({ hasText: /확인하세요/ })).toHaveText('이메일 또는 비밀번호를 확인하세요.');

  // 다른 출처나 Origin 없는 변경 요청은 웹 경유 단계에서 거부한다.
  expect((await page.request.post('/api/auth/logout')).status()).toBe(403);
  expect((await page.request.post('/api/auth/logout', { headers: { origin: 'https://evil.example' } })).status()).toBe(403);
  expect((await page.request.get('/api/health/../../internal')).status()).toBe(404);
});
