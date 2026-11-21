import { test, expect } from '@playwright/test';
import { alert, deleteAccount, googleLogin, invite, requestedCode } from './helpers';

test('미등록 구글 계정은 코드 입력 화면에서 이어지고, 받은 코드로 가입한 뒤에는 바로 로그인한다', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await googleLogin(page, email);
  await expect(page.getByRole('status').filter({ hasText: email })).toContainText('운영자에게 초대 코드를 요청했으니');
  const code = await requestedCode();
  expect(code).toMatch(/^[\w-]{16}$/);
  await page.getByLabel('초대 코드').fill('wrong-code-123');
  await page.getByRole('button', { name: '가입하기' }).click();
  await expect(alert(page)).toHaveText('초대 코드를 확인하세요.');
  // 코드를 넣지 않고 나갔다 다시 와도 입력 화면부터 이어진다.
  await page.goto('/');
  await expect(page.getByLabel('초대 코드')).toBeVisible();
  await page.getByLabel('초대 코드').fill(code);
  await page.getByRole('button', { name: '가입하기' }).click();
  await expect(page.getByRole('heading', { name: '지원 현황' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '지원 현황' })).toBeVisible();

  await page.goto('/settings');
  // 설정은 일반(이 기기 화면 설정)부터 열리고 계정(로그아웃·삭제)은 맨 아래 구역이다.
  await expect(page.getByRole('button', { name: '일반', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // 글자 크기는 다시 열어도 첫 그리기부터, 시작 화면은 새 창에서 적용된다. 알림 조건은 웹에서 잠겨 있다.
  await page.getByRole('group', { name: '글자 크기' }).getByRole('button', { name: '크게', exact: true }).click();
  await page.getByRole('group', { name: '시작 화면' }).getByRole('button', { name: '추천' }).click();
  await expect(page.getByRole('group', { name: '갱신 알림' }).getByRole('button', { name: '끄기' })).toBeDisabled();
  const next = await page.context().newPage();
  await next.goto('/');
  await expect(next).toHaveURL(/\/recommendations$/);
  await expect(next.locator('html')).toHaveCSS('font-size', '18px');
  await next.close();
  await page.getByRole('group', { name: '글자 크기' }).getByRole('button', { name: '보통' }).click();
  await page.getByRole('group', { name: '시작 화면' }).getByRole('button', { name: '지원 현황' }).click();
  await page.getByRole('button', { name: '계정', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: email })).toHaveText(email);
  await page.getByRole('button', { name: '로그아웃' }).click();
  // 가입한 뒤에는 코드 없이 같은 구글 계정으로 로그인한다. 왼쪽 메뉴의 계정 메뉴로도 로그아웃한다.
  await googleLogin(page, email);
  await expect(page).toHaveTitle(/지원 현황 · NextStep/);
  await page.getByRole('button', { name: `계정 메뉴 (${email})` }).click();
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page.getByRole('link', { name: 'Google로 계속하기' })).toBeVisible();
  await googleLogin(page, email);
  await page.goto('/settings');
  await page.getByRole('button', { name: '계정', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: email })).toBeVisible();

  // 계정을 지우면 다시 미등록 계정이 된다.
  await deleteAccount(page);
  await googleLogin(page, email);
  await expect(page.getByLabel('초대 코드')).toBeVisible();

  // 다른 출처나 Origin 없는 변경 요청은 웹 경유 단계에서 거부하고, 비밀번호 로그인 경로는 없다.
  expect((await page.request.post('/api/auth/logout')).status()).toBe(403);
  expect((await page.request.post('/api/auth/logout', { headers: { origin: 'https://evil.example' } })).status()).toBe(403);
  expect((await page.request.get('/api/internal')).status()).toBe(404);
  expect((await page.request.post('/api/auth/login', { headers: { origin: new URL(page.url()).origin } })).status()).toBe(404);

  // 없는 주소는 공통 안내 화면을 보여 준다.
  await page.goto('/no-such-page');
  await expect(page.getByText('찾는 화면이 없어요')).toBeVisible();
  // 구글 동의 화면이 연결하는 개인정보처리방침은 로그인 없이 열린다.
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: '개인정보처리방침' })).toBeVisible();
});

test('코드 입력 화면에서 다른 구글 계정으로 바꾸거나 처음으로 돌아가고, 운영자 명령 코드로도 가입한다', async ({ page }) => {
  await googleLogin(page, `e2e-first-${Date.now()}@example.com`);
  await expect(page.getByLabel('초대 코드')).toBeVisible();
  const second = `e2e-second-${Date.now()}@example.com`;
  await page.getByRole('link', { name: '다른 Google 계정으로 로그인' }).click();
  await page.getByLabel('구글 이메일').fill(second);
  await page.getByRole('button', { name: '계속' }).click();
  await expect(page.getByRole('status').filter({ hasText: second })).toBeVisible();
  await page.getByRole('button', { name: '처음으로' }).click();
  await expect(page.getByRole('link', { name: 'Google로 계속하기' })).toBeVisible();
  await googleLogin(page, second);
  await page.getByLabel('초대 코드').fill(invite());
  await page.getByRole('button', { name: '가입하기' }).click();
  await expect(page.getByRole('heading', { name: '지원 현황' })).toBeVisible();
  await deleteAccount(page);
});
