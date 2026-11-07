import { execFileSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';

// 운영자 초대 코드 발급 명령으로 e2e 서버와 같은 DB에 코드를 만든다.
export const invite = () => execFileSync('pnpm', ['--silent', '--filter', '@nextstep/server', 'invite'], { encoding: 'utf8' }).trim();
export const PASSWORD = 'correct horse battery';
export const alert = (page: Page) => page.getByRole('alert').filter({ hasText: /\S/ });

export async function signup(page: Page, email: string) {
  await page.goto('/');
  await page.getByRole('tab', { name: '초대 코드로 가입' }).click();
  await page.getByLabel('초대 코드').fill(invite());
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(PASSWORD);
  await page.getByRole('button', { name: '가입' }).click();
  await expect(page.getByRole('heading', { name: '지원 현황' })).toBeVisible();
}

export async function deleteAccount(page: Page) {
  await page.goto('/settings');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '계정 삭제' }).click();
  await expect(page.getByRole('tab', { name: '로그인' })).toBeVisible();
}
