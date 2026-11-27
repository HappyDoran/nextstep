import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listPostingIds, parseCareers, parsePosting, saraminSearchUrl } from '../dist/sources/saramin.js';

// 실제 공고 원문을 저장하지 않으려고 사람인 공고 상세의 구조만 본뜬 합성 HTML을 쓴다.
const page = ({ end = '<dt class="end">마감일</dt>\n    <dd>2026.11.22 23:59</dd>', career = '신입·경력 3년 ↓' } = {}) => `
<div class="jv_header"><a href="/zf_user/company-info/view?csn=x" title="가상회사&amp;파트너스" class="company" target="_blank"> 가상회사 </a>
<h1 class="tit_job">
  [성수역] 가상 프론트엔드 개발자 </h1></div>
<div class="jv_cont jv_summary"><dl><dt>경력</dt><dd><strong>${career}</strong></dd></dl>
<dl><dt>근무형태</dt><dd><strong>정규직</strong> 수습기간 3개월</dd></dl>
<dl><dt>근무지역</dt><dd>서울 성동구 <button>지도보기</button></dd></dl></div>
<div class="jv_cont jv_howto"><dl class="info_period"><dt>시작일</dt><dd>2026.11.04 16:00</dd>${end}</dl></div>
<div class="jv_cont jv_location" data-company-name="가상회사" data-address="(04782) 서울 성동구 가상로 1 8층"></div>`;

test('사람인 검색 목록에서 공고 ID를 중복 없이 추출한다', () => {
  assert.deepEqual(listPostingIds('<div class="item_recruit" value="11"></div><div class="item_recruit" value="11"></div><div class="item_recruit" value="22">'), ['11', '22']);
});

test('사람인 상세의 제목·회사·마감·근무지·경력을 추출하고 없는 기업 정보는 미확인으로 둔다', () => {
  assert.deepEqual(parsePosting('7', page()), {
    source: 'saramin', sourceId: '7', url: 'https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=7',
    title: '[성수역] 가상 프론트엔드 개발자', company: '가상회사&파트너스',
    deadline: '2026-11-22T23:59:59+09:00', alwaysHire: false, location: '서울 성동구', remote: null,
    careers: [{ type: 'NEWBIE', fromYears: null, toYears: null }, { type: 'EXPERIENCED', fromYears: null, toYears: 3 }],
    companyType: null, employeeCount: null, externalApplyUrl: null,
  });
  const always = parsePosting('8', page({ end: '' }));
  assert.equal(always.deadline, null);
  assert.equal(always.alwaysHire, true);
  assert.deepEqual(parsePosting('9', '<html></html>'), { code: 'parse_failed' });
  // 회사 링크 속성 순서가 바뀐 공고(class가 title보다 앞)도 읽는다(2026-11-27 실제 해석 실패 2건).
  const swapped = page().replace('title="가상회사&amp;파트너스" class="company"', 'class="company" title="가상회사&amp;파트너스"');
  assert.equal(parsePosting('10', swapped).company, '가상회사&파트너스');
});

test('사람인 경력 표기를 연차 범위로 바꾼다', () => {
  assert.deepEqual(parseCareers('경력 4~10년'), [{ type: 'EXPERIENCED', fromYears: 4, toYears: 10 }]);
  assert.deepEqual(parseCareers('경력 3년 ↑'), [{ type: 'EXPERIENCED', fromYears: 3, toYears: null }]);
  assert.deepEqual(parseCareers('경력무관(신입포함)'), [{ type: 'ANY', fromYears: null, toYears: null }]);
  assert.deepEqual(parseCareers('신입'), [{ type: 'NEWBIE', fromYears: null, toYears: null }]);
  assert.deepEqual(parseCareers('경력'), [{ type: 'EXPERIENCED', fromYears: null, toYears: null }]);
});

test('사람인 검색은 정규직만 고르면 고용 형태 조건을 넣는다', () => {
  const base = { jobFamilies: ['디자인'], experiences: [], regions: [], remoteOk: false, employmentTypes: [], careerMax: null, skills: [], summary: '' };
  const u = new URL(saraminSearchUrl('디자인', { ...base, employmentTypes: ['정규직'] }));
  assert.equal(u.pathname, '/zf_user/search/recruit');
  assert.equal(u.searchParams.get('searchword'), 'UI/UX 디자이너');
  assert.equal(u.searchParams.get('job_type'), '1');
  assert.equal(new URL(saraminSearchUrl('디자인', base)).searchParams.get('job_type'), null);
});
