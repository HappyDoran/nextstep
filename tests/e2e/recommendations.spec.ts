import { test, expect } from '@playwright/test';
import { alert, deleteAccount, signup } from './helpers';

const fixture = (name: string) => `apps/server/tests/fixtures/${name}`;

test('이력서 등록·버전 되돌리기·실패 시 유지·프로필 저장과 초안 실패 안내', async ({ page }) => {
  await signup(page, `e2e-rec-${Date.now()}@example.com`);
  try {
    await page.goto('/settings');
    await page.getByRole('button', { name: '서류', exact: true }).click();
    // 파일을 고르면 바로 올린다(별도 등록 버튼 없음).
    await page.getByLabel(/이력서 올리기/).setInputFiles(fixture('resume-text.pdf'));
    await expect(page.getByRole('heading', { name: 'resume-text.pdf' })).toBeVisible();
    await page.getByText('읽어 들인 내용 확인·고치기').click();
    await expect(page.getByLabel('읽어 들인 내용')).toHaveValue(/프론트엔드 개발자 경력 3년/);
    // 읽어 들인 내용을 고치면 저장되고 고침 표시가 남는다.
    await page.getByLabel('읽어 들인 내용').fill('# 가상 지원자\n프론트엔드 개발자 경력 3년, React·TypeScript 실무');
    await page.getByRole('button', { name: '내용 저장' }).click();
    await expect(page.getByText('내용 고침')).toBeVisible();
    // 새 파일을 올리면 새 버전이 사용 중이 되고, 이전 버전으로 되돌릴 수 있다.
    await page.getByLabel(/새 이력서 버전 올리기/).setInputFiles(fixture('resume-text.pdf'));
    await expect(page.getByRole('button', { name: '이 버전 사용' })).toBeVisible();
    await expect(page.getByText('내용 고침')).toBeVisible();
    await page.getByRole('button', { name: '이 버전 사용' }).click();
    await expect(page.getByRole('heading', { name: 'resume-text.pdf' }).locator('..')).toContainText('내용 고침');
    // 선택 서류(경력기술서)는 이력서와 따로 등록된다.
    await page.getByRole('button', { name: '경력기술서' }).click();
    await page.getByLabel(/경력기술서 올리기/).setInputFiles(fixture('resume-text.pdf'));
    await expect(page.getByRole('heading', { name: 'resume-text.pdf' })).toBeVisible();
    await page.getByRole('button', { name: '이력서 (필수)' }).click();
    await page.getByLabel(/새 이력서 버전 올리기/).setInputFiles(fixture('resume-encrypted.pdf'));
    await expect(alert(page)).toContainText('암호가 걸린 PDF');
    await expect(alert(page)).toContainText('기존 이력서는 유지됩니다.');
    await expect(page.getByRole('heading', { name: 'resume-text.pdf' })).toBeVisible();

    await page.getByRole('button', { name: '프로필·필터', exact: true }).click();
    await page.getByRole('button', { name: '이력서로 초안 만들기' }).click();
    // e2e 서버는 닿지 않는 Ollama 주소를 써서 실패 안내만 확인한다(실제 AI 호출 없음). 모델·처리 방식은 화면에 적지 않는다.
    await expect(alert(page)).toContainText('초안을 만들지 못했습니다');
    await expect(page.getByText(/Ollama|qwen|로컬 AI/)).toHaveCount(0);
    await page.getByRole('checkbox', { name: '앱 개발' }).check();
    await page.getByLabel('업무·도구·기술 (쉼표로 구분)').fill('React, Swift');
    await page.getByRole('button', { name: '프로필 저장' }).click();
    await expect(page.getByRole('status').filter({ hasText: '마지막 저장' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('checkbox', { name: '앱 개발' })).toBeChecked();
    await expect(page.getByLabel('업무·도구·기술 (쉼표로 구분)')).toHaveValue('React, Swift');
  } finally { await deleteAccount(page); }
});

test('추천 목록 표시·관심 없음·지원 현황 저장과 작업 실패 표시', async ({ page }) => {
  await signup(page, `e2e-rec2-${Date.now()}@example.com`);
  try {
    await page.goto('/recommendations');
    // 이력서·프로필이 없으면 갱신 작업이 이유와 함께 실패로 끝난다(실제 작업자 처리).
    await page.getByRole('button', { name: '새로 가져오기' }).click();
    await expect(page.getByRole('status').filter({ hasText: '실패' })).toContainText('이력서와 프로필을 먼저 저장하세요', { timeout: 15_000 });
    await page.getByRole('button', { name: '링크로 판정' }).click();
    await page.getByLabel('공고 링크', { exact: true }).fill('https://www.saramin.co.kr/x');
    await page.getByRole('button', { name: '판정', exact: true }).click();
    await expect(alert(page)).toContainText('공고 상세 링크');
    await page.getByRole('button', { name: '취소' }).click();

    // 판정 결과 화면은 응답을 모의로 바꿔 표시 규칙만 확인한다(실제 수집·AI 검증 아님).
    const item = { postingId: 'p1', source: 'wanted', linkOnly: true, url: 'https://www.wanted.co.kr/wd/1', externalApplyUrl: null, title: '가상 프론트엔드', company: '가상회사', deadline: null, alwaysHire: false, postingStatus: '미확인', companyType: null, employeeCount: null, checkedAt: '2026-11-07T00:00:00.000Z', classification: '미확인', met: ['React 실무 3년'], unmet: [], unknown: ['기업 유형·규모 미기재'], reason: '필수 기술 일부 확인 불가', hidden: false, evaluatedAt: '2026-11-07T00:00:00.000Z' };
    const excluded = { ...item, postingId: 'p2', source: 'jobkorea', linkOnly: false, url: 'https://www.jobkorea.co.kr/Recruit/GI_Read/2', title: '가상 백엔드', company: '다른회사', classification: '제외', unmet: ['공고 직무가 희망 직무와 다름'], reason: '공고 직무가 희망 직무와 다름' };
    await page.route('**/api/recommendations', route => route.fulfill({ json: { items: [item, excluded], lastJob: null } }));
    let feedbackBody: unknown;
    await page.route('**/api/recommendations/p2/feedback', route => { feedbackBody = route.request().postDataJSON(); return route.fulfill({ json: { feedback: null, restored: true, hidden: false } }); });
    await page.reload();
    // 줄을 누르면 상세 창이 열리고 근거·행동은 창에서 본다.
    const row = (title: string) => page.getByRole('button', { name: new RegExp(title) });
    await row('가상 프론트엔드').click();
    const card = page.getByRole('dialog');
    await expect(card).toContainText('마감 미확인');
    await expect(card).toContainText('기업 유형·규모 미확인');
    await expect(card).toContainText('원티드 · 링크 판정');
    await expect(card.getByRole('link', { name: /지원 페이지 열기/ })).toHaveAttribute('href', 'https://www.wanted.co.kr/wd/1');
    await card.getByRole('button', { name: '지원 현황에 저장' }).click();
    await expect(card.getByRole('button', { name: '지원 현황에 저장됨' })).toBeVisible();
    await card.getByRole('button', { name: '닫기' }).click();
    // 분류별 건수와 고급 필터(출처·검색).
    await expect(page.getByRole('button', { name: '제외 1' })).toBeVisible();
    await page.getByLabel('출처').selectOption('jobkorea');
    await expect(row('가상 프론트엔드')).toHaveCount(0);
    await page.getByLabel('출처').selectOption('전체');
    await page.getByLabel('검색(제목·회사)').fill('다른회사');
    await expect(row('가상 백엔드')).toBeVisible();
    await expect(row('가상 프론트엔드')).toHaveCount(0);
    // 제외 공고는 상세 창에서 직접 복구할 수 있다.
    await row('가상 백엔드').click();
    await page.getByRole('dialog').getByRole('button', { name: '제외 복구' }).click();
    await expect.poll(() => feedbackBody).toEqual({ restored: true });
    await page.getByRole('dialog').getByRole('button', { name: '닫기' }).click();
    await page.getByLabel('검색(제목·회사)').fill('');
    await page.getByRole('button', { name: '도전' }).click();
    await expect(page.getByRole('status').filter({ hasText: '조건에 맞는 추천이 없습니다.' })).toBeVisible();
    await page.unroute('**/api/recommendations/p2/feedback');
    await page.unroute('**/api/recommendations');
    await page.goto('/');
    const saved = page.getByRole('listitem').filter({ hasText: '가상 프론트엔드' });
    await expect(saved.getByRole('combobox', { name: '상태' })).toHaveValue('미지원');
  } finally { await deleteAccount(page); }
});
