import { execFileSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';

// 운영자 초대 링크 발급 명령으로 e2e 서버와 같은 DB에 코드를 만든다.
export const inviteLink = () => new URL(execFileSync('pnpm', ['--silent', '--filter', '@nextstep/server', 'invite'], { encoding: 'utf8' }).trim());
export const invite = () => inviteLink().searchParams.get('invite') ?? '';
export const alert = (page: Page) => page.getByRole('alert').filter({ hasText: /\S/ });

// 구글 로그인 버튼 → 모의 구글 인가 화면(e2e 설정의 fake-google)에서 이메일 고르기 → 첫 화면으로 돌아옴.
export async function googleLogin(page: Page, email: string, path = '/') {
  await page.goto(path);
  await page.getByRole('link', { name: '구글로 로그인' }).click();
  await page.getByLabel('구글 이메일').fill(email);
  await page.getByRole('button', { name: '계속' }).click();
}

export async function signup(page: Page, email: string) {
  const link = inviteLink();
  await googleLogin(page, email, link.pathname + link.search);
  await expect(page.getByRole('heading', { name: '지원 현황' })).toBeVisible();
}

export async function deleteAccount(page: Page) {
  await page.goto('/settings');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '계정 삭제' }).click();
  await expect(page.getByRole('link', { name: '구글로 로그인' })).toBeVisible();
}
