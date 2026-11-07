import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { politeGet, nextData } from '../dist/sources/http.js';
import * as wanted from '../dist/sources/wanted.js';
import * as jasoseol from '../dist/sources/jasoseol.js';

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
  assert.equal(parsed.deadline, '2026-12-01');
  assert.equal(parsed.alwaysHire, false);
  assert.deepEqual(parsed.careers, [{ type: 'EXPERIENCED', fromYears: 2, toYears: 6 }]);
  assert.equal(parsed.location, '서울 강남구');
  assert.equal(parsed.externalApplyUrl, 'https://careers.example.com/1');
  assert.equal(parsed.employeeCount, null);
  const always = wanted.parseDetail('1', page({ initialData: { ...base, due_time: null, out_link: 'javascript:x', career: { is_newbie: true, is_expert: true } } }));
  assert.equal(always.alwaysHire, true);
  assert.equal(always.externalApplyUrl, null);
  assert.equal(always.careers[0].type, 'ANY');
  assert.deepEqual(wanted.parseDetail('2', page({ initialData: base })), { code: 'parse_failed' });
  assert.deepEqual(wanted.listIds('{"data":[{"id":5},{"id":"x"}]}'), ['5']);
});

test('자소설닷컴 사이트맵 최신 ID와 상세의 모집 분야·직무·이미지 본문을 구분한다', () => {
  const xml = '<loc>https://jasoseol.com/recruit/10</loc><loc>https://jasoseol.com/career/30</loc><loc>https://jasoseol.com/recruit/20</loc><loc>https://jasoseol.com/recruit/10</loc>';
  assert.deepEqual(jasoseol.sitemapRecruitIds(xml, 5), ['20', '10']);
  const detail = { id: 7, name: '가상회사', title: '2026 하반기 채용', start_time: '2026-11-01', end_time: '2026-11-15', employment_page_url: 'https://careers.example.com', content: '<img src="a.png">', company_group: { business_size: 'middle_market' }, employments: [{ field: 'iOS 앱 개발', division: 2 }, { field: 'UX/UI 디자이너', division: 1 }] };
  const parsed = jasoseol.parseDetail('7', page({ initialEmploymentCompany: detail }));
  assert.deepEqual(parsed.roles, ['app', 'design']);
  assert.deepEqual(parsed.body, { code: 'body_image_only' });
  assert.equal(parsed.companyType, '중견기업');
  assert.deepEqual(jasoseol.parseDetail('7', '<html></html>'), { code: 'parse_failed' });
  assert.equal(nextData('<html></html>'), undefined);
});
