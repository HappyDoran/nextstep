// P1-01 잡코리아 공개 공고 소량 수집 검증. 원문을 저장하지 않고 추출 가능 여부·실패 구분만 출력한다.
// 원티드·자소설닷컴은 약관상 자동 수집에 사전 허락이 필요해 검증 대상에서 제외했다(gap-analysis 미결 결정).
// 실행: pnpm --filter @nextstep/server verify:jobkorea
import { pathToFileURL } from 'node:url';
import { htmlText, politeGet } from '../sources/http.js';
import { requireAutoCollect } from './mode.js';
const ORIGIN = 'https://www.jobkorea.co.kr';
// 사람 속도의 소량 요청: 직무당 목록 1회·상세 3건.
const PER_ROLE = 3;
const ROLES: Record<string, string> = { frontend: '프론트엔드', app: '앱 개발', design: 'UI/UX 디자이너', planning: '서비스 기획' };

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
    deadline: recruitment.alwaysHire ? null : (recruitment.applicationEndAt ?? null),
    alwaysHire: recruitment.alwaysHire === true,
    workFields: recruitment.workFields ?? [],
    careers: (base.requirement?.careers ?? []).map(c => ({ type: c.type, fromYears: c.range?.from ?? null, toYears: c.range?.to ?? null })),
    receptionTypes: options.map(o => o.type),
    externalApplyUrl: external,
    // 기업 유형·규모는 출처가 명시한 값만 사용하고 없으면 미확인(null)으로 둔다.
    companyType: corp?.info?.companyTypeName ?? null,
    // 0명은 미입력으로 보고 미확인 처리한다.
    employeeCount: corp?.info?.employeeCount || null,
  };
}

async function main() {
  if (!requireAutoCollect('jobkorea')) return;
  const report: Record<string, unknown> = {};
  for (const [role, keyword] of Object.entries(ROLES)) {
    const list = await politeGet(`${ORIGIN}/Search/?stext=${encodeURIComponent(keyword)}&tabType=recruit`);
    if ('code' in list) { report[role] = { list: list }; continue; }
    const ids = listPostingIds(list.text);
    const postings = [];
    for (const id of ids.slice(0, PER_ROLE)) {
      const page = await politeGet(`${ORIGIN}/Recruit/GI_Read/${id}`);
      if ('code' in page) { postings.push({ id, failure: page.code }); continue; }
      const parsed = parsePosting(id, page.text);
      if ('code' in parsed) { postings.push({ id, failure: parsed.code }); continue; }
      const body = await politeGet(`${ORIGIN}/Recruit/GI_Read_Comt_Ifrm?Gno=${id}`, { referer: parsed.url });
      const text = 'text' in body ? htmlText(body.text) : body;
      // 원문 본문은 출력하지 않고 길이만 남긴다.
      postings.push({ ...parsed, body: 'text' in text ? { chars: text.text.length } : { failure: text.code } });
    }
    report[role] = { keyword, listed: ids.length, postings };
  }
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
