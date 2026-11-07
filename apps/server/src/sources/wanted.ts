// wanted 공개 페이지 해석. 수집 정책(모드)은 호출하는 쪽이 확인한다.
import type { JobFamily } from '@nextstep/contracts';
import { FAMILY_KEYS, type CollectedPosting, type CollectFailure } from './types.js';
import { nextData, politeGet } from './http.js';

export const ORIGIN = 'https://www.wanted.co.kr';
export const PER_ROLE = 3;
// 원티드 직무 태그 ID(2026-11-07 목록 응답으로 확인한 검증용 초기값).
export const ROLES: Record<string, number[]> = { frontend: [669], app: [677, 678, 10111], design: [597, 599], planning: [559, 565] };

export type WantedPosting = {
  id: string;
  url: string;
  title: string;
  company: string;
  deadline: string | null;
  alwaysHire: boolean;
  active: boolean;
  careers: { type: 'NEWBIE' | 'EXPERIENCED' | 'ANY'; fromYears: number | null; toYears: number | null }[];
  location: string | null;
  remote: boolean | null;
  externalApplyUrl: string | null;
  // 원티드 상세에는 기업 유형·직원 수가 없어 미확인으로 둔다.
  companyType: null;
  employeeCount: null;
  body: { mainTasks: string; requirements: string; preferred: string };
};

type Detail = {
  id?: number;
  position?: string;
  status?: string;
  due_time?: string | null;
  company?: { company_name?: string };
  address?: { location?: string; district?: string } | null;
  career?: { annual_from?: number | null; annual_to?: number | null; is_newbie?: boolean; is_expert?: boolean } | null;
  is_remote_work?: boolean | null;
  out_link?: string | null;
  main_tasks?: string;
  requirements?: string;
  preferred_points?: string;
};

export function listIds(json: string) {
  const data = (JSON.parse(json) as { data?: { id?: number }[] }).data ?? [];
  return data.map(item => String(item.id)).filter(id => /^\d+$/.test(id));
}

export function parseDetail(id: string, html: string): WantedPosting | { code: 'parse_failed' } {
  let d: Detail | undefined;
  try {
    d = (nextData(html) as { props?: { pageProps?: { initialData?: Detail } } } | undefined)?.props?.pageProps?.initialData;
  } catch {
    return { code: 'parse_failed' };
  }
  if (!d?.position || !d.company?.company_name || String(d.id) !== id) return { code: 'parse_failed' };
  const c = d.career;
  const careers: WantedPosting['careers'] = [];
  if (c?.is_newbie && !c.is_expert) careers.push({ type: 'NEWBIE', fromYears: null, toYears: null });
  else if (c?.is_expert) careers.push({ type: c.is_newbie ? 'ANY' : 'EXPERIENCED', fromYears: c.annual_from ?? null, toYears: c.annual_to ?? null });
  const location = [d.address?.location, d.address?.district].filter(Boolean).join(' ') || null;
  return {
    id,
    url: `${ORIGIN}/wd/${id}`,
    title: d.position,
    company: d.company.company_name,
    deadline: d.due_time ?? null,
    // 원티드는 마감일 없는 공고를 상시로 표시한다.
    alwaysHire: !d.due_time,
    active: d.status === 'active',
    careers,
    location,
    remote: typeof d.is_remote_work === 'boolean' ? d.is_remote_work : null,
    externalApplyUrl: d.out_link && /^https:\/\//.test(d.out_link) ? d.out_link : null,
    companyType: null,
    employeeCount: null,
    body: { mainTasks: d.main_tasks ?? '', requirements: d.requirements ?? '', preferred: d.preferred_points ?? '' },
  };
}


export async function fetchWanted(id: string): Promise<CollectedPosting | CollectFailure> {
  const page = await politeGet(`${ORIGIN}/wd/${id}`);
  if ('code' in page) return { source: 'wanted', id, code: page.code };
  const p = parseDetail(id, page.text);
  if ('code' in p) return { source: 'wanted', id, code: p.code };
  const body = [`[주요업무]\n${p.body.mainTasks}`, `[자격요건]\n${p.body.requirements}`, `[우대사항]\n${p.body.preferred}`].join('\n\n');
  return {
    source: 'wanted', sourceId: id, url: p.url, title: p.title, company: p.company, deadline: p.deadline, alwaysHire: p.alwaysHire,
    location: p.location, remote: p.remote, careers: p.careers, companyType: null, employeeCount: null, externalApplyUrl: p.externalApplyUrl,
    body: p.active ? body : null, bodyFailure: p.active ? null : 'closed',
  };
}

export async function collectWanted(family: JobFamily, limit: number) {
  const postings: CollectedPosting[] = [];
  const failures: CollectFailure[] = [];
  const query = new URLSearchParams({ country: 'kr', locations: 'all', years: '-1', limit: String(limit), job_sort: 'job.latest_order' });
  for (const tag of ROLES[FAMILY_KEYS[family]]!) query.append('tag_type_ids', String(tag));
  const list = await politeGet(`${ORIGIN}/api/v4/jobs?${query}`, { accept: 'application/json' });
  if ('code' in list) return { postings, failures: [{ source: 'wanted' as const, code: list.code }] };
  for (const id of listIds(list.text)) {
    const r = await fetchWanted(id);
    if ('code' in r) failures.push(r); else postings.push(r);
  }
  return { postings, failures };
}
