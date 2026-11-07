// P1-01 자소설닷컴 개인 모드 검증. 약관상 허가 없는 자동 수집이 금지된 출처라 개인 모드에서만 실행한다.
// 목록은 자소설닷컴이 robots.txt로 공개한 sitemap, 상세는 공개 페이지의 __NEXT_DATA__에서 읽는다.
// 실행: pnpm --filter @nextstep/server verify:jasoseol
import { pathToFileURL } from 'node:url';
import { htmlText, nextData, politeGet, type BodyFailure } from '../sources/http.js';
import { requireAutoCollect } from './mode.js';

const ORIGIN = 'https://jasoseol.com';
// 사이트맵에 직무 정보가 없어 최신 공고 상세를 정해진 수만 확인한다.
const DETAIL_CAP = 20;
// ponytail: 모집 분야 문구 키워드로 직무를 고른다. 출처 직무 분류 코드 매핑은 P1-04에서 검증한다.
const ROLE_KEYWORDS: Record<string, RegExp> = {
  frontend: /프론트|front[- ]?end|웹\s*개발|react|vue/i,
  app: /\bios\b|안드로이드|android|모바일\s*앱|앱\s*개발|flutter|react\s*native|크로스\s*플랫폼/i,
  design: /ui\/?ux|ux\/?ui|프로덕트\s*디자인|product\s*design|ui\s*디자인|ux\s*디자인|웹\s*디자인/i,
  planning: /서비스\s*기획|웹\s*기획|앱\s*기획|\bpm\b|\bpo\b|프로덕트\s*매니저|product\s*(manager|owner)/i,
};

export type JasoseolPosting = {
  id: string;
  url: string;
  title: string;
  company: string;
  startAt: string | null;
  deadline: string | null;
  fields: { name: string; division: number | null }[];
  roles: string[];
  externalApplyUrl: string | null;
  // 출처가 명시한 기업 규모 코드만 쓴다(예: middle_market). 없으면 미확인.
  companyType: string | null;
  employeeCount: null;
  body: { text: string } | { code: BodyFailure };
};

type Detail = {
  id?: number;
  name?: string;
  title?: string;
  start_time?: string | null;
  end_time?: string | null;
  employment_page_url?: string | null;
  content?: string | null;
  company_group?: { business_size?: string | null } | null;
  employments?: { field?: string; division?: number | null }[];
};

export function sitemapRecruitIds(xml: string, limit: number) {
  const ids = [...new Set([...xml.matchAll(/<loc>https:\/\/jasoseol\.com\/recruit\/(\d+)<\/loc>/g)].map(m => Number(m[1])))];
  return ids.sort((a, b) => b - a).slice(0, limit).map(String);
}

export function parseDetail(id: string, html: string): JasoseolPosting | { code: 'parse_failed' } {
  let d: Detail | undefined;
  try {
    d = (nextData(html) as { props?: { pageProps?: { initialEmploymentCompany?: Detail } } } | undefined)?.props?.pageProps?.initialEmploymentCompany;
  } catch {
    return { code: 'parse_failed' };
  }
  if (!d?.title || !d.name || String(d.id) !== id) return { code: 'parse_failed' };
  const fields = (d.employments ?? []).map(e => ({ name: e.field ?? '', division: e.division ?? null }));
  const haystack = [d.title, ...fields.map(f => f.name)].join(' ');
  return {
    id,
    url: `${ORIGIN}/recruit/${id}`,
    title: d.title,
    company: d.name,
    startAt: d.start_time ?? null,
    deadline: d.end_time ?? null,
    fields,
    roles: Object.keys(ROLE_KEYWORDS).filter(role => ROLE_KEYWORDS[role]!.test(haystack)),
    externalApplyUrl: d.employment_page_url && /^https:\/\//.test(d.employment_page_url) ? d.employment_page_url : null,
    companyType: d.company_group?.business_size ?? null,
    employeeCount: null,
    body: htmlText(d.content ?? ''),
  };
}

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
