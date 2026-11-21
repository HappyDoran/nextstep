import { test, expect } from '@playwright/test';
import { alert, deleteAccount, signup } from './helpers';

test('지원 직접 등록·검색·필터·공고 열기와 접수 구분·상태 수정 이력·재접속 유지·오류 재시도', async ({ page, context }) => {
  await signup(page, `e2e-app-${Date.now()}@example.com`);
  // 지원 건 한 줄 = 목록 항목. 줄을 누르면 상세 창이 열린다.
  const apps = page.getByRole('listitem').filter({ has: page.getByRole('combobox', { name: '상태' }) });
  const row = (company: string) => apps.filter({ hasText: company });
  try {
    await expect(page.getByText('등록한 지원 건이 없습니다.')).toBeVisible();
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
    await detail.getByRole('combobox', { name: '상태' }).selectOption('지원 완료');
    await detail.getByRole('combobox', { name: '열람' }).selectOption('미열람');
    await detail.getByRole('button', { name: '저장' }).click();
    await expect(detail.getByText('저장했습니다.')).toBeVisible();
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
