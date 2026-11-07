import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listPostingIds, parsePosting, bodyText } from '../dist/verify/jobkorea.js';

// 실제 공고 원문을 저장하지 않으려고 잡코리아 상세 페이지의 RSC hydration 구조만 본뜬 합성 HTML을 쓴다.
function page(jobs, corp) {
  const flight = JSON.stringify({
    queries: [
      { dehydratedAt: 1, state: { data: jobs }, queryKey: ['JOBS', '1'] },
      { dehydratedAt: 1, state: { data: corp }, queryKey: ['CORP_INFO', '1'] },
    ],
  });
  const half = Math.floor(flight.length / 2);
  // 실제 페이지처럼 문자열 조각 두 개로 나눠 담는다.
  return [flight.slice(0, half), flight.slice(half)].map(s => `<script>self.__next_f.push([1,${JSON.stringify(s)}])</script>`).join('');
}
const jobs = (reception, recruitment = { applicationEndAt: '2026-12-01T23:59:59+09:00', workFields: ['프론트엔드'] }) => ({
  base: {
    title: '가상 프론트엔드 개발자 {중괄호} "따옴표"',
    post: { postingCompanyName: '가상회사' },
    overview: { recruitment },
    reception: { receptionOptions: reception },
    requirement: { careers: [{ type: 'EXPERIENCED', range: { from: 3, to: null } }] },
  },
});

test('목록에서 공고 ID를 중복 없이 추출한다', () => {
  assert.deepEqual(listPostingIds('<a href="/Recruit/GI_Read/11?x">a</a><a href="/Recruit/GI_Read/11">b</a><a href="/Recruit/GI_Read/22">'), ['11', '22']);
});

test('상세의 마감·경력·홈페이지 지원 URL·명시된 기업 규모를 추출한다', () => {
  const html = page(jobs([{ type: 'HOMEPAGE', contents: ['javascript:alert(1)', 'https://careers.example.com/1'] }]), { info: { companyTypeName: '중견기업', employeeCount: 300 } });
  assert.deepEqual(parsePosting('1', html), {
    id: '1',
    url: 'https://www.jobkorea.co.kr/Recruit/GI_Read/1',
    title: '가상 프론트엔드 개발자 {중괄호} "따옴표"',
    company: '가상회사',
    deadline: '2026-12-01T23:59:59+09:00',
    alwaysHire: false,
    workFields: ['프론트엔드'],
    careers: [{ type: 'EXPERIENCED', fromYears: 3, toYears: null }],
    receptionTypes: ['HOMEPAGE'],
    externalApplyUrl: 'https://careers.example.com/1',
    companyType: '중견기업',
    employeeCount: 300,
  });
});

test('상시채용·즉시지원·규모 미기재를 미확인으로 둔다', () => {
  const html = page(jobs([{ type: 'ONLINE', contents: null }], { alwaysHire: true, applicationEndAt: '2099-01-01' }), { info: { employeeCount: 0 } });
  const parsed = parsePosting('2', html);
  assert.equal(parsed.deadline, null);
  assert.equal(parsed.alwaysHire, true);
  assert.equal(parsed.externalApplyUrl, null);
  assert.equal(parsed.companyType, null);
  assert.equal(parsed.employeeCount, null);
});

test('구조가 없거나 본문이 이미지뿐이면 실패를 구분한다', () => {
  assert.deepEqual(parsePosting('3', '<html>점검 중</html>'), { code: 'parse_failed' });
  assert.deepEqual(bodyText('<div><img src="a.png"></div>'), { code: 'body_image_only' });
  assert.deepEqual(bodyText('<div>짧음</div>'), { code: 'body_missing' });
  assert.equal(bodyText(`<style>x{}</style><p>${'담당업무 &gt; '.repeat(20)}</p>`).text.startsWith('담당업무 > '), true);
});
