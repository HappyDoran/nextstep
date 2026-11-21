import { execFileSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';

// 운영자 초대 코드 발급 명령(누구나 쓰는 코드)으로 e2e 서버와 같은 DB에 코드를 만든다.
export const invite = () => execFileSync('pnpm', ['--silent', '--filter', '@nextstep/server', 'invite'], { encoding: 'utf8' }).trim();
// 미등록 계정이 구글 로그인하면 모의 Discord 웹훅에 그 계정 전용 초대 코드가 온다.
export const requestedCode = async () => {
  const message = await (await fetch('http://127.0.0.1:4199/discord/last')).json() as { content: string } | null;
  return message?.content.match(/초대 코드: `([\w-]+)`/)?.[1] ?? '';
};
export const alert = (page: Page) => page.getByRole('alert').filter({ hasText: /\S/ });

// 구글 로그인 버튼 → 모의 구글 인가 화면(e2e 설정의 fake-google)에서 이메일 고르기 → 첫 화면으로 돌아옴.
export async function googleLogin(page: Page, email: string, path = '/') {
  await page.goto(path);
  await page.getByRole('link', { name: '구글로 로그인' }).click();
  await page.getByLabel('구글 이메일').fill(email);
  await page.getByRole('button', { name: '계속' }).click();
}

// 처음 구글 로그인 → 코드 입력 화면 → 운영자에게 온 코드로 가입.
export async function signup(page: Page, email: string) {
  await googleLogin(page, email);
  await expect(page.getByLabel('초대 코드')).toBeVisible();
  await page.getByLabel('초대 코드').fill(await requestedCode());
  await page.getByRole('button', { name: '가입' }).click();
  await expect(page.getByRole('heading', { name: '지원 현황' })).toBeVisible();
}

export async function deleteAccount(page: Page) {
  await page.goto('/settings');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '계정 삭제' }).click();
  await expect(page.getByRole('link', { name: '구글로 로그인' })).toBeVisible();
}
