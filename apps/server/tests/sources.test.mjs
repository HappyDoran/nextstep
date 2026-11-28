import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { politeGet } from '../dist/sources/http.js';
import * as wanted from '../dist/sources/wanted.js';

const page = data => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: data } })}</script></html>`;

test('차단 응답을 받은 호스트에는 다시 요청하지 않는다', async () => {
  let hits = 0;
  const server = createServer((_req, res) => { hits++; res.writeHead(429).end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/a`;
    assert.equal((await politeGet(url)).code, 'blocked');
    assert.deepEqual(await politeGet(url.replace('/a', '/b')), { code: 'blocked' });
    assert.equal(hits, 1);
  } finally { server.close(); }
});

test('원티드 상세에서 마감·상시·경력·원격·외부 지원 URL을 읽고 기업 규모는 미확인으로 둔다', () => {
  const base = { id: 1, position: '가상 프론트엔드', status: 'active', company: { company_name: '가상회사' }, address: { location: '서울', district: '강남구' }, career: { annual_from: 2, annual_to: 6, is_newbie: false, is_expert: true }, is_remote_work: false, out_link: 'https://careers.example.com/1', due_time: '2026-12-01', main_tasks: '업무', requirements: '자격', preferred_points: '우대' };
  const parsed = wanted.parseDetail('1', page({ initialData: base }));
  // 날짜만 오는 마감은 그날 KST 끝으로 본다(UTC 자정으로 읽으면 KST 오전 9시에 마감 처리된다).
  assert.equal(parsed.deadline, '2026-12-01T23:59:59+09:00');
  assert.equal(parsed.alwaysHire, false);
  assert.deepEqual(parsed.careers, [{ type: 'EXPERIENCED', fromYears: 2, toYears: 6 }]);
  assert.equal(parsed.location, '서울 강남구');
  assert.equal(parsed.externalApplyUrl, 'https://careers.example.com/1');
  assert.equal(parsed.employeeCount, null);
  const always = wanted.parseDetail('1', page({ initialData: { ...base, due_time: null, out_link: 'javascript:x', career: { is_newbie: true, is_expert: true } } }));
  assert.equal(always.alwaysHire, true);
  // 닫힌 공고는 마감일이 없어도 상시가 아니라 마감(확인 시각)으로 둔다.
  const closed = wanted.parseDetail('1', page({ initialData: { ...base, status: 'close', due_time: null } }));
  assert.equal(closed.alwaysHire, false);
  assert.ok(Date.parse(closed.deadline) <= Date.now());
  assert.equal(always.externalApplyUrl, null);
  assert.equal(always.careers[0].type, 'ANY');
  assert.deepEqual(wanted.parseDetail('2', page({ initialData: base })), { code: 'parse_failed' });
  assert.deepEqual(wanted.listIds('{"data":[{"id":5},{"id":"x"}]}'), ['5']);
});

test('사용자 선호 필터: 출처 요청 조건과 수집 후 지역·경력·고용 형태 거르기', async () => {
  const { regionOk, careerOk, employmentOk } = await import('../dist/sources/filter.js');
  const { wantedListQuery } = await import('../dist/sources/wanted.js');
  const { jobkoreaSearchUrl } = await import('../dist/sources/jobkorea.js');
  const base = { jobFamilies: ['프론트엔드'], experiences: [], regions: [], remoteOk: false, employmentTypes: [], careerMax: null, skills: [], summary: '' };
  const f = { ...base, regions: ['서울', '경기 성남시'], careerMax: 2, employmentTypes: ['정규직'] };
  // 지역: 비우면 전국, 시·군·구까지 앞부분 일치, 근무지 미기재는 통과, 원격 허용이면 전면 원격 통과.
  assert.equal(regionOk({ location: '경기 하남시', remote: false, careers: [] }, base), true);
  assert.equal(regionOk({ location: '서울특별시 강남구', remote: false, careers: [] }, f), true);
  assert.equal(regionOk({ location: '경기 성남시 분당구', remote: false, careers: [] }, f), true);
  assert.equal(regionOk({ location: '경기 하남시', remote: false, careers: [] }, f), false);
  assert.equal(regionOk({ location: null, remote: null, careers: [] }, f), true);
  assert.equal(regionOk({ location: '부산', remote: true, careers: [] }, { ...f, remoteOk: true }), true);
  // 경력: 요구 하한이 상한을 넘는 경력직만 제외.
  assert.equal(careerOk({ location: null, remote: null, careers: [{ type: 'EXPERIENCED', fromYears: 3, toYears: null }] }, f), false);
  assert.equal(careerOk({ location: null, remote: null, careers: [{ type: 'EXPERIENCED', fromYears: 1, toYears: 5 }] }, f), true);
  assert.equal(careerOk({ location: null, remote: null, careers: [{ type: 'NEWBIE', fromYears: null, toYears: null }] }, f), true);
  // 고용 형태: 미기재는 통과.
  assert.equal(employmentOk({ location: null, remote: null, careers: [], employmentTypes: ['프리랜서'] }, f), false);
  assert.equal(employmentOk({ location: null, remote: null, careers: [], employmentTypes: ['미기재'] }, f), true);
  // 출처 요청: 원티드는 시·도와 연차 범위, 잡코리아는 경력 범위·정규직.
  const q = wantedListQuery('프론트엔드', 15, f);
  assert.deepEqual(q.getAll('locations'), ['seoul.all', 'gyeonggi.all']);
  assert.deepEqual(q.getAll('years'), ['0', '2']);
  assert.deepEqual(wantedListQuery('프론트엔드', 15, { ...f, remoteOk: true }).getAll('locations'), ['all']);
  const u = new URL(jobkoreaSearchUrl('프론트엔드', f));
  assert.equal(u.searchParams.get('careerMax'), '2');
  assert.equal(u.searchParams.get('jobtype'), '1');
});

test('점핏 상세의 마감·상시·경력·근무지·본문을 읽고 기업 규모는 미확인으로 둔다', async () => {
  const jumpit = await import('../dist/sources/jumpit.js');
  const detail = { title: '가상 백엔드 개발자', companyName: '가상회사', newcomer: true, minCareer: 2, maxCareer: 5, closedAt: '2026-12-13 23:59:59', alwaysOpen: false, location: '서울 금천구 가상로 1, 4층', responsibility: '- API 개발', qualifications: '- Java 실무 2년', preferredRequirements: '' };
  const p = jumpit.parseDetail('55566561', JSON.stringify({ result: detail }));
  assert.equal(p.url, 'https://jumpit.saramin.co.kr/position/55566561');
  assert.equal(p.deadline, '2026-12-13T23:59:59+09:00');
  assert.equal(p.location, '서울 금천구');
  assert.deepEqual(p.careers, [{ type: 'NEWBIE', fromYears: null, toYears: null }, { type: 'EXPERIENCED', fromYears: 2, toYears: 5 }]);
  assert.equal(p.companyType, null);
  assert.match(p.body, /\[자격 요건\]\n- Java 실무 2년/);
  assert.equal(jumpit.parseDetail('1', JSON.stringify({ result: { ...detail, alwaysOpen: true } })).alwaysHire, true);
  assert.deepEqual(jumpit.parseDetail('1', JSON.stringify({ result: {} })), { code: 'parse_failed' });
  assert.deepEqual(jumpit.listItems('{"result":{"positions":[{"id":1},{"id":"x"}]}}').map(i => i.id), [1]);
});

test('연결이 한 번 끊기면 같은 간격을 두고 한 번만 다시 요청한다', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; if (calls === 1) throw new TypeError('fetch failed'); return { ok: true, status: 200, text: async () => 'ok' }; };
  try {
    assert.deepEqual(await politeGet('https://retry.example/a'), { text: 'ok' });
    assert.equal(calls, 2);
    calls = -10;
    globalThis.fetch = async () => { calls++; throw new TypeError('fetch failed'); };
    assert.deepEqual(await politeGet('https://retry.example/b'), { code: 'network' });
    assert.equal(calls, -8, '두 번까지만 시도');
  } finally { globalThis.fetch = original; }
});

test('출처 마감 값을 시각대 있는 ISO로 맞추고 읽을 수 없으면 미확인(null)으로 둔다', async () => {
  const { kstDeadline } = await import('../dist/sources/http.js');
  assert.equal(kstDeadline('2026-12-01'), '2026-12-01T23:59:59+09:00');
  assert.equal(kstDeadline('2026-12-01T18:00:00'), '2026-12-01T18:00:00+09:00');
  assert.equal(kstDeadline('2026-12-01 18:00:00'), '2026-12-01T18:00:00+09:00');
  assert.equal(kstDeadline('2026-12-01T09:00:00.000Z'), '2026-12-01T09:00:00.000Z');
  assert.equal(kstDeadline('2026-12-01T23:59:59+09:00'), '2026-12-01T23:59:59+09:00');
  assert.equal(kstDeadline('채용시 마감'), null);
  assert.equal(kstDeadline(null), null);
});

test('응답 본문을 읽다 실패하면(시간 초과 등) 예외 대신 연결 실패로 돌려준다', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); } });
  try {
    assert.deepEqual(await politeGet('https://body-timeout.example/a'), { code: 'network' });
  } finally { globalThis.fetch = original; }
});

test('검색어: 직무 기본어 → 선호 기술(없으면 프로필 기술 앞 2개) → 다른 이름, 같은 공고는 회사·제목으로 알아본다', async () => {
  const { searchWords, postingKey } = await import('../dist/sources/filter.js');
  assert.deepEqual(searchWords('앱 개발', { skills: ['Swift', 'Kotlin', 'Java'], preferredSkills: [] }), ['앱 개발', '앱 개발 Swift', '앱 개발 Kotlin', 'iOS 개발자', 'Android 개발자', 'Flutter']);
  assert.deepEqual(searchWords('기획', { skills: ['Figma'], preferredSkills: ['SQL'] }), ['서비스 기획', '서비스 기획 SQL', '프로덕트 매니저']);
  assert.equal(postingKey('(주)휴넷', '[휴넷] IOS 앱 개발자 [정규직/경력]'), postingKey('휴넷', 'iOS 앱개발자'));
  assert.notEqual(postingKey('휴넷', '백엔드 개발자 (신입)'), postingKey('휴넷', '백엔드 개발자 (경력)'));
});
