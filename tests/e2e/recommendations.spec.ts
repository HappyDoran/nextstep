import { test, expect } from '@playwright/test';
import { alert, deleteAccount, signup } from './helpers';

const fixture = (name: string) => `apps/server/tests/fixtures/${name}`;

test('이력서 등록·실패 시 유지·프로필 저장과 AI 미설정 표시', async ({ page }) => {
  await signup(page, `e2e-rec-${Date.now()}@example.com`);
  try {
    await page.goto('/settings');
    await expect(page.getByRole('status').filter({ hasText: '등록한 이력서가 없습니다.' })).toBeVisible();
    await page.getByLabel(/이력서 파일/).setInputFiles(fixture('resume-text.pdf'));
    await page.getByRole('button', { name: '등록' }).click();
    await expect(page.getByRole('status').filter({ hasText: '등록된 이력서: resume-text.pdf' })).toBeVisible();
    await page.getByText('추출된 본문 확인').click();
    await expect(page.getByText(/프론트엔드 개발자 경력 3년/)).toBeVisible();
    await page.getByLabel(/이력서 파일/).setInputFiles(fixture('resume-encrypted.pdf'));
    await page.getByRole('button', { name: '교체' }).click();
    await expect(alert(page)).toContainText('암호가 걸린 PDF');
    await expect(alert(page)).toContainText('기존 이력서는 유지됩니다.');
    await expect(page.getByRole('status').filter({ hasText: '등록된 이력서: resume-text.pdf' })).toBeVisible();

    await page.getByRole('button', { name: '이력서로 초안 만들기' }).click();
    await expect(alert(page).filter({ hasText: 'AI 처리' })).toContainText('AI 처리가 설정되지 않았습니다');
    // 본인 OpenAI 키가 없으면 설정에 미등록으로 보이고, 키 없이 저장할 수 없다(실제 OpenAI 호출은 하지 않음).
    await expect(page.getByRole('status').filter({ hasText: '등록한 키가 없습니다' })).toBeVisible();
    await expect(page.getByRole('button', { name: '확인 후 저장' })).toBeDisabled();
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
    await page.getByLabel(/공고 링크로 판정/).fill('https://www.saramin.co.kr/x');
    await page.getByRole('button', { name: '판정' }).click();
    await expect(alert(page)).toContainText('공고 상세 링크');

    // 판정 결과 화면은 응답을 모의로 바꿔 표시 규칙만 확인한다(실제 수집·AI 검증 아님).
    const item = { postingId: 'p1', source: 'wanted', linkOnly: true, url: 'https://www.wanted.co.kr/wd/1', externalApplyUrl: null, title: '가상 프론트엔드', company: '가상회사', deadline: null, alwaysHire: false, postingStatus: '미확인', companyType: null, employeeCount: null, checkedAt: '2026-11-07T00:00:00.000Z', classification: '미확인', met: ['React 실무 3년'], unmet: [], unknown: ['기업 유형·규모 미기재'], reason: '필수 기술 일부 확인 불가', hidden: false, evaluatedAt: '2026-11-07T00:00:00.000Z' };
    await page.route('**/api/recommendations', route => route.fulfill({ json: { items: [item], lastJob: null } }));
    await page.reload();
    const card = page.getByRole('listitem').filter({ hasText: '가상 프론트엔드' });
    await expect(card).toContainText('마감 미확인');
    await expect(card).toContainText('기업 유형·규모 미확인');
    await expect(card).toContainText('원티드 · 링크 판정');
    await expect(card.getByRole('link', { name: /지원하기/ })).toHaveAttribute('href', 'https://www.wanted.co.kr/wd/1');
    await card.getByRole('button', { name: '지원 현황에 저장' }).click();
    await expect(card.getByRole('button', { name: '지원 현황에 저장됨' })).toBeVisible();
    await page.getByRole('button', { name: '도전' }).click();
    await expect(page.getByRole('status').filter({ hasText: '조건에 맞는 추천이 없습니다.' })).toBeVisible();
    await page.unroute('**/api/recommendations');
    await page.goto('/');
    const saved = page.getByRole('listitem').filter({ hasText: '가상 프론트엔드' });
    await expect(saved.getByText('미지원', { exact: true })).toBeVisible();
  } finally { await deleteAccount(page); }
});
