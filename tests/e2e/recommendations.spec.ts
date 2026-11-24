import { test, expect } from '@playwright/test';
import { alert, deleteAccount, signup } from './helpers';

const fixture = (name: string) => `apps/server/tests/fixtures/${name}`;

test('이력서 등록·버전 되돌리기·실패 시 유지·프로필 저장과 초안 실패 알림', async ({ page }) => {
  await signup(page, `e2e-rec-${Date.now()}@example.com`);
  try {
    // 추천이 없는 첫 화면은 시작 단계를 보여 주고, 이력서·프로필 전에는 가져오기를 막는다.
    await page.goto('/recommendations');
    await expect(page.getByRole('heading', { name: '추천을 받으려면' })).toBeVisible();
    await expect(page.getByRole('button', { name: '공고 가져오기' })).toBeDisabled();
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
    // 초안은 서버 작업이라 설정 창을 닫아도 계속되고, 끝나면 다른 화면에서도 알린다.
    // e2e 서버는 닿지 않는 Ollama 주소를 써서 실패 흐름만 확인한다(실제 AI 호출 없음). 모델·처리 방식은 화면에 적지 않는다.
    await page.keyboard.press('Escape');
    await expect(page.getByText('프로필 초안을 만들지 못했어요')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: '확인하기' }).click();
    await expect(alert(page)).toContainText('초안을 만들지 못했습니다');
    await expect(page.getByText('프로필 초안을 만들지 못했어요')).toHaveCount(0);
    await expect(page.getByText(/Ollama|qwen|로컬 AI/)).toHaveCount(0);
    await page.getByRole('checkbox', { name: '앱 개발' }).check();
    await page.getByLabel('업무·도구·기술 (쉼표로 구분)').fill('React, Swift');
    await page.getByRole('button', { name: '프로필 저장' }).click();
    await expect(page.getByRole('status').filter({ hasText: '마지막 저장' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('checkbox', { name: '앱 개발' })).toBeChecked();
    await expect(page.getByLabel('업무·도구·기술 (쉼표로 구분)')).toHaveValue('React, Swift');
    await page.goto('/recommendations');
    await expect(page.getByRole('link', { name: /이력서 올리기.*완료/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '공고 가져오기' })).toBeEnabled();
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

    // 상세 행동 API는 웹 중계를 통과해 서버까지 간다(중계 허용 목록 누락 시 404). 잘못된 값은 서버가 400으로 거른다.
    for (const action of ['hide', 'feedback', 'closed']) {
      const res = await page.request.put(`/api/recommendations/none/${action}`, { data: { hidden: 'x', closed: 'x', feedback: 'x' }, headers: { origin: new URL(page.url()).origin } });
      expect(res.status(), action).toBe(400);
    }
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
    // 다시 열어도 같은 공고 URL의 지원 건이 있으면 저장됨으로 보인다(중복 저장 방지).
    await row('가상 프론트엔드').click();
    await expect(card.getByRole('button', { name: '지원 현황에 저장됨' })).toBeDisabled();
    await card.getByRole('button', { name: '닫기' }).click();
    // 분류별 건수와 고급 필터(출처·검색).
    await expect(page.getByRole('button', { name: '제외 1' })).toBeVisible();
    await page.getByLabel('출처').selectOption('jobkorea');
    await expect(row('가상 프론트엔드')).toHaveCount(0);
    // 보기 조건(출처·정렬)은 이 기기에 기억해 다시 열어도 유지된다.
    await page.getByLabel('정렬').selectOption('분류순');
    await page.reload();
    await expect(page.getByLabel('출처')).toHaveValue('jobkorea');
    await expect(page.getByLabel('정렬')).toHaveValue('분류순');
    await page.getByLabel('정렬').selectOption('마감순');
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

test('마감된 공고는 지원한 것만 마감으로 남고 나머지는 목록에서 빠지며, 다른 곳에서 시작한 갱신도 따라간다', async ({ page }) => {
  await signup(page, `e2e-rec3-${Date.now()}@example.com`);
  try {
    // 표시 규칙만 확인한다(추천·작업 응답은 모의, 실제 수집 아님).
    const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
    const base = { linkOnly: false, externalApplyUrl: null, company: '가상회사', alwaysHire: false, postingStatus: '모집중', companyType: null, employeeCount: null, checkedAt: '2026-11-07T00:00:00.000Z', classification: '기본', met: [], unmet: [], unknown: [], reason: '조건 맞음', hidden: false, evaluatedAt: '2026-11-07T00:00:00.000Z' };
    const past = Array.from({ length: 31 }, (_, i) => ({ ...base, postingId: `old${i}`, source: 'saramin', url: `https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=${i}`, title: `지난 공고 ${i}`, deadline: at(-2 - i) }));
    const soon = { ...base, postingId: 'soon', source: 'wanted', url: 'https://www.wanted.co.kr/wd/9', title: '곧 마감 공고', deadline: at(3) };
    await page.route('**/api/recommendations', route => route.fulfill({ json: { items: [...past, soon], lastJob: null } }));
    // 트레이·자동 갱신 등 다른 곳에서 시작한 갱신 작업.
    const job = { id: 'outside', kind: 'refresh', status: '실행중', errorCode: null, result: null, createdAt: '2026-11-07T00:00:00.000Z', finishedAt: null };
    await page.route('**/api/jobs/latest', route => route.fulfill({ json: { job, counts: null } }));
    await page.route('**/api/jobs/outside', route => route.fulfill({ json: job }));
    // 지난 공고 30은 지원 완료, 지난 공고 29는 저장만(미지원) 했다.
    const origin = { origin: new URL(page.url()).origin };
    for (const [i, status] of [[30, '지원 완료'], [29, '미지원']] as const) {
      expect((await page.request.post('/api/applications', { data: { company: '가상회사', roleTitle: `지난 공고 ${i}`, postingUrl: past[i]!.url, status }, headers: origin })).status()).toBe(201);
    }
    await page.goto('/recommendations');
    await expect(page.getByRole('heading', { name: '7일 안에 마감' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: '곧 마감 공고' })).toBeVisible();
    const old = page.getByRole('listitem').filter({ hasText: '지난 공고 30' });
    await expect(old).toContainText('마감');
    await expect(old).not.toContainText('오늘');
    await expect(page.getByRole('listitem').filter({ hasText: '지난 공고 29' })).toHaveCount(0);
    await expect(page.getByRole('listitem').filter({ hasText: '지난 공고 0' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '새로 가져오기' })).toBeDisabled();
    await expect(page.getByRole('status').filter({ hasText: '창을 닫아도 서버에서 계속합니다' })).toBeVisible();
  } finally { await deleteAccount(page); }
});
