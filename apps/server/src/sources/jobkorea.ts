// jobkorea 공개 페이지 해석. 수집 정책(모드)은 호출하는 쪽이 확인한다.
import type { JobFamily, Profile } from '@nextstep/contracts';
import type { CollectedPosting, CollectFailure } from './types.js';
import { htmlText, kstDeadline, politeGet } from './http.js';
import { careerOk, regionOk } from './filter.js';
export const ORIGIN = 'https://www.jobkorea.co.kr';
// 사람 속도의 소량 요청: 직무당 목록 1회·상세 3건.
export const PER_ROLE = 3;
export const ROLES: Record<string, string> = { frontend: '프론트엔드', app: '앱 개발', design: 'UI/UX 디자이너', planning: '서비스 기획', backend: '백엔드', qa: 'QA 엔지니어' };

export type ParseFailure = 'parse_failed';

export type JobkoreaPosting = {
  id: string;
  url: string;
  title: string;
  company: string;
  deadline: string | null;
  alwaysHire: boolean;
  workFields: string[];
  careers: { type: string; fromYears: number | null; toYears: number | null }[];
  receptionTypes: string[];
  externalApplyUrl: string | null;
  location: string | null;
  companyType: string | null;
  employeeCount: number | null;
};

export function listPostingIds(html: string) {
  return [...new Set([...html.matchAll(/\/Recruit\/GI_Read\/(\d+)/g)].map(m => m[1]!))];
}

// Next.js RSC 스트림의 문자열 조각을 이어 붙여 hydration 데이터를 복원한다.
function flightText(html: string) {
  let out = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) out += JSON.parse(m[1]!) as string;
  return out;
}

function objectAt(text: string, start: number): unknown {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('unterminated');
}

function queryData(flight: string, key: string): Record<string, unknown> | undefined {
  const at = flight.indexOf(`"queryKey":["${key}"`);
  if (at < 0) return undefined;
  const start = flight.lastIndexOf('{"dehydratedAt"', at);
  return (objectAt(flight, start) as { state?: { data?: Record<string, unknown> } }).state?.data;
}

type Jobs = {
  base?: {
    title?: string;
    overview?: { recruitment?: { alwaysHire?: boolean; applicationEndAt?: string | null; workFields?: string[] } };
    post?: { postingCompanyName?: string };
    reception?: { receptionOptions?: { type: string; contents?: unknown }[] };
    requirement?: { careers?: { type: string; range?: { from?: number | null; to?: number | null } | null }[] };
    workCondition?: { workplace?: { locationAttributes?: { address?: string | null; fullAddress?: string | null }[] } };
  };
};
type Corp = { info?: { companyTypeName?: string; employeeCount?: number } };

export function parsePosting(id: string, html: string): JobkoreaPosting | { code: ParseFailure } {
  let jobs: Jobs | undefined;
  let corp: Corp | undefined;
  try {
    const flight = flightText(html);
    jobs = queryData(flight, 'JOBS') as Jobs | undefined;
    corp = queryData(flight, 'CORP_INFO') as Corp | undefined;
  } catch {
    return { code: 'parse_failed' };
  }
  const base = jobs?.base;
  if (!base?.title || !base.post?.postingCompanyName) return { code: 'parse_failed' };
  const recruitment = base.overview?.recruitment ?? {};
  const options = base.reception?.receptionOptions ?? [];
  // 홈페이지 접수는 contents의 https URL만 인정한다. 없으면 null로 두고 공고 URL로 이동한다.
  const external = options.flatMap(o => (o.type === 'HOMEPAGE' ? [o.contents].flat() : [])).find((c): c is string => typeof c === 'string' && /^https:\/\//.test(c)) ?? null;
  return {
    id,
    url: `${ORIGIN}/Recruit/GI_Read/${id}`,
    title: base.title,
    company: base.post.postingCompanyName,
    deadline: recruitment.alwaysHire ? null : kstDeadline(recruitment.applicationEndAt),
    alwaysHire: recruitment.alwaysHire === true,
    workFields: recruitment.workFields ?? [],
    careers: (base.requirement?.careers ?? []).map(c => ({ type: c.type, fromYears: c.range?.from ?? null, toYears: c.range?.to ?? null })),
    receptionTypes: options.map(o => o.type),
    externalApplyUrl: external,
    // 근무지는 출처에 적힌 주소 앞부분(시·구)만 쓴다.
    location: base.workCondition?.workplace?.locationAttributes?.map(l => (l.address ?? l.fullAddress ?? '').trim()).find(Boolean)?.split(/\s+/).slice(0, 2).join(' ') || null,
    // 기업 유형·규모는 출처가 명시한 값만 사용하고 없으면 미확인(null)으로 둔다.
    companyType: corp?.info?.companyTypeName ?? null,
    // 0명은 미입력으로 보고 미확인 처리한다.
    employeeCount: corp?.info?.employeeCount || null,
  };
}


export async function fetchJobkorea(id: string): Promise<CollectedPosting | CollectFailure> {
  const page = await politeGet(`${ORIGIN}/Recruit/GI_Read/${id}`);
  if ('code' in page) return { source: 'jobkorea', id, code: page.code };
  const p = parsePosting(id, page.text);
  if ('code' in p) return { source: 'jobkorea', id, code: p.code };
  const raw = await politeGet(`${ORIGIN}/Recruit/GI_Read_Comt_Ifrm?Gno=${id}`, { referer: p.url });
  const body = 'text' in raw ? htmlText(raw.text) : raw;
  return {
    source: 'jobkorea', sourceId: id, url: p.url, title: p.title, company: p.company, deadline: p.deadline, alwaysHire: p.alwaysHire,
    location: p.location, remote: null, careers: p.careers.map(c => ({ ...c, type: c.type === 'NEWBIE' || c.type === 'EXPERIENCED' ? c.type : 'ANY' })),
    companyType: p.companyType, employeeCount: p.employeeCount, externalApplyUrl: p.externalApplyUrl,
    body: 'text' in body ? body.text : null, bodyFailure: 'code' in body ? body.code : null,
  };
}

const KEYWORDS: Record<JobFamily, string> = { 프론트엔드: '프론트엔드', '앱 개발': '앱 개발', 디자인: 'UI/UX 디자이너', 기획: '서비스 기획', 백엔드: '백엔드', QA: 'QA 엔지니어' };

// 검색이 받는 조건(실제 확인): 경력 범위(careerType=1,2&careerMin&careerMax), 정규직(jobtype=1). 지역은 받지 않아 수집 후 거른다.
export function jobkoreaSearchUrl(family: JobFamily, f: Profile) {
  const q = new URLSearchParams({ stext: KEYWORDS[family], tabType: 'recruit' });
  if (f.careerMax !== null) { q.set('careerType', '1,2'); q.set('careerMin', '0'); q.set('careerMax', String(f.careerMax)); }
  if (f.employmentTypes.length === 1 && f.employmentTypes[0] === '정규직') q.set('jobtype', '1');
  return `${ORIGIN}/Search/?${q}`;
}

export async function collectJobkorea(family: JobFamily, limit: number, f: Profile) {
  const postings: CollectedPosting[] = [];
  const failures: CollectFailure[] = [];
  const list = await politeGet(jobkoreaSearchUrl(family, f));
  if ('code' in list) return { postings, failures: [{ source: 'jobkorea' as const, code: list.code }] };
  // 지역은 상세에서만 알 수 있어 목록을 세 배까지 본다.
  for (const id of listPostingIds(list.text).slice(0, limit * 3)) {
    if (postings.length >= limit) break;
    const r = await fetchJobkorea(id);
    if ('code' in r) failures.push(r); else if (regionOk(r, f) && careerOk(r, f)) postings.push(r);
  }
  return { postings, failures };
}
