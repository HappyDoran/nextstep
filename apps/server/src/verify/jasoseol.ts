// P1-01 자소설닷컴 개인 모드 검증. 약관상 허가 없는 자동 수집이 금지된 출처라 개인 모드에서만 실행한다.
// 목록은 자소설닷컴이 robots.txt로 공개한 sitemap, 상세는 공개 페이지의 __NEXT_DATA__에서 읽는다.
// 실행: pnpm --filter @nextstep/server verify:jasoseol
import { pathToFileURL } from 'node:url';
import { politeGet } from '../sources/http.js';
import { ORIGIN, DETAIL_CAP, parseDetail, sitemapRecruitIds } from '../sources/jasoseol.js';
import { requireAutoCollect } from './mode.js';

async function main() {
  if (!requireAutoCollect('jasoseol')) return;
  const sitemap = await politeGet(`${ORIGIN}/sitemap/employment_companies.xml`, { accept: 'application/xml' });
  if ('code' in sitemap) return console.log(JSON.stringify({ sitemap }));
  const ids = sitemapRecruitIds(sitemap.text, DETAIL_CAP);
  const postings = [];
  for (const id of ids) {
    const page = await politeGet(`${ORIGIN}/recruit/${id}`);
    if ('code' in page) { postings.push({ id, failure: page.code }); if (page.code === 'blocked') break; continue; }
    const parsed = parseDetail(id, page.text);
    // 원문은 출력하지 않고 길이·실패만 남긴다.
    postings.push('code' in parsed ? { id, failure: parsed.code } : { ...parsed, fields: parsed.fields.length, body: 'text' in parsed.body ? { chars: parsed.body.text.length } : parsed.body });
  }
  console.log(JSON.stringify({ checked: postings.length, postings }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
