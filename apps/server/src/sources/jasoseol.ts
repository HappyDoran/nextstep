// jasoseol 공개 페이지 해석. 수집 정책(모드)은 호출하는 쪽이 확인한다.
import type { JobFamily } from '@nextstep/contracts';
import type { CollectedPosting, CollectFailure } from './types.js';
import { htmlText, nextData, politeGet, type BodyFailure } from './http.js';

export const ORIGIN = 'https://jasoseol.com';
// 사이트맵에 직무 정보가 없어 최신 공고 상세를 정해진 수만 확인한다.
export const DETAIL_CAP = 20;
// ponytail: 모집 분야 문구 키워드로 직무를 고른다. 출처 직무 분류 코드 매핑은 P1-04에서 검증한다.
export const ROLE_KEYWORDS: Record<string, RegExp> = {
  frontend: /프론트|front[- ]?end|웹\s*개발|react|vue/i,
  app: /\bios\b|안드로이드|android|모바일\s*앱|앱\s*개발|flutter|react\s*native|크로스\s*플랫폼/i,
  design: /ui\/?ux|ux\/?ui|프로덕트\s*디자인|product\s*design|ui\s*디자인|ux\s*디자인|웹\s*디자인/i,
  planning: /서비스\s*기획|웹\s*기획|앱\s*기획|\bpm\b|\bpo\b|프로덕트\s*매니저|product\s*(manager|owner)/i,
  backend: /백엔드|back[- ]?end|서버\s*개발|server/i,
  qa: /\bqa\b|테스트\s*엔지니어|소프트웨어\s*품질|sqa/i,
};

// 자소설닷컴 기업 규모 코드. 모르는 코드는 미확인으로 둔다.
const BUSINESS_SIZE: Record<string, string> = { big_business: '대기업', middle_market: '중견기업', small_business: '중소기업', public_institution: '공공기관', foreign_company: '외국계', startup: '스타트업' };

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
    companyType: BUSINESS_SIZE[d.company_group?.business_size ?? ''] ?? null,
    employeeCount: null,
    body: htmlText(d.content ?? ''),
  };
}


export async function fetchJasoseol(id: string): Promise<(CollectedPosting & { roles: string[] }) | CollectFailure> {
  const page = await politeGet(`${ORIGIN}/recruit/${id}`);
  if ('code' in page) return { source: 'jasoseol', id, code: page.code };
  const p = parseDetail(id, page.text);
  if ('code' in p) return { source: 'jasoseol', id, code: p.code };
  // 본문이 이미지면 모집 분야 문구만 판정 근거로 쓴다.
  const fieldText = p.fields.map(f => f.name).join('\n');
  return {
    source: 'jasoseol', sourceId: id, url: p.url, title: p.title, company: p.company, deadline: p.deadline, alwaysHire: false,
    location: null, remote: null, careers: [], companyType: p.companyType, employeeCount: null, externalApplyUrl: p.externalApplyUrl,
    body: 'text' in p.body ? `${fieldText}\n\n${p.body.text}` : `[모집 분야]\n${fieldText}`, bodyFailure: 'code' in p.body ? p.body.code : null,
    roles: p.roles,
  };
}

// 자소설닷컴 직무 분류 ID(2026-11-07 /api/v1/duty-groups로 확인, 서버·백엔드 176·QA 160은 2026-11-14 확인).
export const DUTY_GROUPS: Record<JobFamily, number[]> = { 프론트엔드: [175, 162], '앱 개발': [161, 172, 173], 디자인: [241], 기획: [171], 백엔드: [176], QA: [160] };

export function dutyListIds(json: string) {
  const list = JSON.parse(json) as { id?: number }[];
  return Array.isArray(list) ? list.map(e => String(e.id)).filter(id => /^\d+$/.test(id)) : [];
}

// 웹 화면이 쓰는 공개 직무별 목록으로 후보를 찾고 상세를 읽는다(개인 모드 전용).
export async function collectJasoseol(families: JobFamily[], perFamily: number) {
  const postings: CollectedPosting[] = [];
  const failures: CollectFailure[] = [];
  const seen = new Set<string>();
  for (const family of families) {
    const ids: string[] = [];
    for (const group of DUTY_GROUPS[family]) {
      const list = await politeGet(`${ORIGIN}/api/v1/duty-groups/${group}/employment-companies?per_page=${perFamily}`, { accept: 'application/json' });
      if ('code' in list) { failures.push({ source: 'jasoseol', code: list.code }); continue; }
      for (const id of dutyListIds(list.text)) if (!ids.includes(id)) ids.push(id);
    }
    for (const id of ids.filter(id => !seen.has(id)).slice(0, perFamily)) {
      seen.add(id);
      const r = await fetchJasoseol(id);
      if ('code' in r) failures.push(r); else postings.push(r);
    }
  }
  return { postings, failures };
}
