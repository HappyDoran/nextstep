// jasoseol 공개 페이지 해석. 수집 정책(모드)은 호출하는 쪽이 확인한다.
import type { JobFamily } from '@nextstep/contracts';
import type { CollectedPosting, CollectFailure } from './types.js';
import { htmlText, kstDeadline, nextData, politeGet, type BodyFailure } from './http.js';

export const ORIGIN = 'https://jasoseol.com';
// 자소설닷컴 기업 규모 코드. 모르는 코드는 미확인으로 둔다.
const BUSINESS_SIZE: Record<string, string> = { big_business: '대기업', middle_market: '중견기업', small_business: '중소기업', public_institution: '공공기관', foreign_company: '외국계', startup: '스타트업' };

export type JasoseolPosting = {
  id: string;
  url: string;
  title: string;
  company: string;
  deadline: string | null;
  fields: { name: string; division: number | null }[];
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
  end_time?: string | null;
  employment_page_url?: string | null;
  content?: string | null;
  company_group?: { business_size?: string | null } | null;
  employments?: { field?: string; division?: number | null }[];
};

export function parseDetail(id: string, html: string): JasoseolPosting | { code: 'parse_failed' } {
  let d: Detail | undefined;
  try {
    d = (nextData(html) as { props?: { pageProps?: { initialEmploymentCompany?: Detail } } } | undefined)?.props?.pageProps?.initialEmploymentCompany;
  } catch {
    return { code: 'parse_failed' };
  }
  if (!d?.title || !d.name || String(d.id) !== id) return { code: 'parse_failed' };
  const fields = (d.employments ?? []).map(e => ({ name: e.field ?? '', division: e.division ?? null }));
  return {
    id,
    url: `${ORIGIN}/recruit/${id}`,
    title: d.title,
    company: d.name,
    deadline: kstDeadline(d.end_time),
    fields,
    externalApplyUrl: d.employment_page_url && /^https:\/\//.test(d.employment_page_url) ? d.employment_page_url : null,
    companyType: BUSINESS_SIZE[d.company_group?.business_size ?? ''] ?? null,
    employeeCount: null,
    body: htmlText(d.content ?? ''),
  };
}


export async function fetchJasoseol(id: string): Promise<CollectedPosting | CollectFailure> {
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
