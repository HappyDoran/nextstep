// P1-01 원티드 개인 모드 검증. 약관상 사전 허락 없는 자동 수집이 금지된 출처라 개인 모드에서만 실행한다.
// 목록은 웹 화면이 쓰는 공개 JSON, 상세는 공개 페이지의 __NEXT_DATA__에서 읽는다. 로그인·차단 우회는 하지 않는다.
// 실행: pnpm --filter @nextstep/server verify:wanted
import { pathToFileURL } from 'node:url';
import { nextData, politeGet } from '../sources/http.js';
import { requireAutoCollect } from './mode.js';

const ORIGIN = 'https://www.wanted.co.kr';
const PER_ROLE = 3;
// 원티드 직무 태그 ID(2026-11-07 목록 응답으로 확인한 검증용 초기값).
const ROLES: Record<string, number[]> = { frontend: [669], app: [677, 678, 10111], design: [597, 599], planning: [559, 565] };

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

async function main() {
  if (!requireAutoCollect('wanted')) return;
  const report: Record<string, unknown> = {};
  // 차단 응답을 받으면 이 출처 요청을 모두 멈춘다.
  let blocked = false;
  for (const [role, tags] of Object.entries(ROLES)) {
    if (blocked) break;
    const query = new URLSearchParams({ country: 'kr', locations: 'all', years: '-1', limit: String(PER_ROLE), job_sort: 'job.latest_order' });
    for (const tag of tags) query.append('tag_type_ids', String(tag));
    const list = await politeGet(`${ORIGIN}/api/v4/jobs?${query}`, { accept: 'application/json' });
    if ('code' in list) { report[role] = { list }; blocked = list.code === 'blocked'; continue; }
    const postings = [];
    for (const id of listIds(list.text)) {
      const page = await politeGet(`${ORIGIN}/wd/${id}`);
      if ('code' in page) { postings.push({ id, failure: page.code }); blocked = page.code === 'blocked'; if (blocked) break; continue; }
      const parsed = parseDetail(id, page.text);
      // 원문은 출력하지 않고 길이만 남긴다.
      postings.push('code' in parsed ? { id, failure: parsed.code } : { ...parsed, body: Object.fromEntries(Object.entries(parsed.body).map(([k, v]) => [k, v.length])) });
    }
    report[role] = { tags, postings };
  }
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
