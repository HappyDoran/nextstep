import { test, expect } from '@playwright/test';
import { alert, deleteAccount, signup } from './helpers';

test('지원 직접 등록·검색·필터·공고 열기와 접수 구분·상태 수정 이력·재접속 유지·오류 재시도', async ({ page, context }) => {
  await signup(page, `e2e-app-${Date.now()}@example.com`);
  // 지원 건 한 줄 = 목록 항목. 줄을 누르면 상세 창이 열린다.
  const apps = page.getByRole('listitem').filter({ has: page.getByRole('combobox', { name: '상태' }) });
  const row = (company: string) => apps.filter({ hasText: company });
  try {
    await expect(page.getByText('등록한 지원 건이 없습니다.')).toBeVisible();
    // 잘못 인코딩된 주소 해시는 설정이 아닌 것으로 보고 화면을 그대로 둔다(오류 화면 없음).
    await page.goto('/#%E0%A4');
    await expect(page.getByRole('heading', { name: '지원 현황' })).toBeVisible();
    await page.goto('/settings#%E0%A4');
    await expect(page.getByRole('dialog', { name: '설정' })).toBeVisible();
    await page.goto('/');
    for (const [company, role, url] of [['가상커머스', '프론트엔드 개발자', 'https://example.com/posting/1'], ['가상페이', 'iOS 개발자', '']]) {
      await page.getByRole('button', { name: '직접 등록' }).first().click();
      const dialog = page.getByRole('dialog', { name: '지원 직접 등록' });
      await dialog.getByLabel('회사').fill(company!);
      await dialog.getByLabel('직무').fill(role!);
      await dialog.getByLabel('공고 URL').fill(url!);
      await dialog.getByRole('button', { name: '등록' }).click();
      await expect(page.getByRole('status').filter({ hasText: `${company} · ${role}를 등록했어요` })).toBeVisible();
      await expect(row(company!)).toBeVisible();
    }
    const commerce = row('가상커머스');
    // 공고 열기는 외부 이동만 하고 지원 완료로 바꾸지 않는다.
    await context.route('https://example.com/**', route => route.fulfill({ status: 200, body: 'posting' }));
    const popup = page.waitForEvent('popup');
    await commerce.getByRole('link', { name: '공고 열기' }).click();
    await (await popup).close();
    await expect(commerce.getByRole('combobox', { name: '상태' })).toHaveValue('미지원');

    await page.getByLabel('검색 (회사·직무)').fill('ios');
    await expect(apps).toHaveCount(1);
    await page.getByLabel('검색 (회사·직무)').fill('');
    await commerce.getByRole('button', { name: /가상커머스/ }).click();
    const detail = page.getByRole('dialog', { name: '가상커머스' });
    // 상세 저장은 바꾼 값만 보낸다(창을 연 뒤 메일이 바꾼 값을 덮어쓰지 않음).
    let patched: unknown;
    await page.route('**/api/applications/*', route => { if (route.request().method() === 'PATCH') patched = route.request().postDataJSON(); return route.continue(); });
    await detail.getByRole('combobox', { name: '상태' }).selectOption('지원 완료');
    await detail.getByRole('combobox', { name: '열람' }).selectOption('미열람');
    await detail.getByRole('button', { name: '저장' }).click();
    await expect(detail.getByText('저장했습니다.')).toBeVisible();
    expect(patched).toEqual({ status: '지원 완료', readStatus: '미열람' });
    await page.unroute('**/api/applications/*');
    await expect(detail.getByText(/상태 미지원 → 지원 완료/)).toBeVisible();
    await detail.getByRole('button', { name: '닫기' }).click();
    // 줄 안에서 바로 상태를 바꿀 수 있다.
    await row('가상페이').getByRole('combobox', { name: '상태' }).selectOption('불합격');
    await expect(page.getByRole('button', { name: '불합격', exact: true })).toBeVisible();
    await page.getByLabel('상태 필터').selectOption('지원 완료');
    await expect(apps).toHaveCount(1);

    await page.reload();
    await expect(row('가상커머스').getByRole('combobox', { name: '상태' })).toHaveValue('지원 완료');
    // 불합격 묶음은 처음에 접혀 있다.
    await expect(apps).toHaveCount(1);
    await page.getByRole('button', { name: '불합격', exact: true }).click();
    await expect(apps).toHaveCount(2);
    // 펼친 묶음은 이 기기에 기억한다.
    await page.reload();
    await expect(apps).toHaveCount(2);

    await page.route('**/api/applications', route => route.request().method() === 'GET' ? route.fulfill({ status: 503, body: '{}' }) : route.continue());
    await page.reload();
    await expect(alert(page)).toContainText('서버 연결을 확인');
    await page.unroute('**/api/applications');
    await page.getByRole('button', { name: '다시 시도' }).click();
    await expect(apps).toHaveCount(2);
  } finally {
    await deleteAccount(page);
  }
});

test('접힌 묶음을 펼치면 앞 페이지 밖이어도 묶음 머리와 더 보기가 남는다', async ({ page }) => {
  await signup(page, `e2e-lane-${Date.now()}@example.com`);
  try {
    // 표시 규칙만 확인한다(목록 응답은 모의): 지원 완료 30건으로 첫 페이지를 채우고 불합격 1건은 접힌 묶음에 둔다.
    const app = (i: number, status: string) => ({ id: `a${i}`, company: `가상회사${i}`, roleTitle: '디자이너', postingUrl: null, status, readStatus: '정보 없음', lockedFields: [], createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' });
    await page.route('**/api/applications', route => route.fulfill({ json: [...Array.from({ length: 30 }, (_, i) => app(i, '지원 완료')), app(30, '불합격')] }));
    await page.reload();
    const lane = page.getByRole('button', { name: '불합격', exact: true });
    await expect(lane).toHaveAttribute('aria-expanded', 'false');
    await lane.click();
    await expect(lane).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: '30건 더 보기', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: '가상회사30' })).toBeVisible();
  } finally { await deleteAccount(page); }
});
