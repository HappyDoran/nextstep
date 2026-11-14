// 사람인 공개 페이지 해석. robots.txt가 허용한 검색 목록(/zf_user/search)과 공고 상세(/zf_user/jobs/view·relay/view-detail)만 읽는다.
// OpenAPI 승인 전까지의 1차 수집 경로다(2026-11-10 사용자 결정).
import type { JobFamily, Profile } from '@nextstep/contracts';
import type { Career, CollectedPosting, CollectFailure } from './types.js';
import { htmlText, politeGet } from './http.js';
import { careerOk, regionOk } from './filter.js';

export const ORIGIN = 'https://www.saramin.co.kr';
const KEYWORDS: Record<JobFamily, string> = { 프론트엔드: '프론트엔드', '앱 개발': '앱 개발', 디자인: 'UI/UX 디자이너', 기획: '서비스 기획', 백엔드: '백엔드', QA: 'QA 엔지니어' };

export type SaraminPosting = Omit<CollectedPosting, 'body' | 'bodyFailure'>;

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

export function listPostingIds(html: string) {
  return [...new Set([...html.matchAll(/class="item_recruit" value="(\d+)"/g)].map(m => m[1]!))];
}

// 검색이 받는 조건(실제 확인): 정규직(job_type=1). 경력은 여러 값을 함께 주면 신입만 돌아와 수집 후 거른다. 지역은 상세에서 거른다.
export function saraminSearchUrl(family: JobFamily, f: Profile) {
  const q = new URLSearchParams({ searchword: KEYWORDS[family], recruitPageCount: '20' });
  if (f.employmentTypes.length === 1 && f.employmentTypes[0] === '정규직') q.set('job_type', '1');
  return `${ORIGIN}/zf_user/search/recruit?${q}`;
}

// 핵심 정보의 경력 표기: '신입', '경력 3년 ↑', '경력 4~10년', '신입·경력 3년 ↓', '경력무관(신입포함)'.
export function parseCareers(raw: string): Career[] {
  if (/무관/.test(raw)) return [{ type: 'ANY', fromYears: null, toYears: null }];
  const careers: Career[] = [];
  if (raw.includes('신입')) careers.push({ type: 'NEWBIE', fromYears: null, toYears: null });
  const exp = raw.match(/경력\s*(?:(\d+)\s*~\s*(\d+)\s*년|(\d+)\s*년\s*([↑↓]))?/);
  if (exp) {
    const [, from, to, n, dir] = exp;
    const years = from ? [Number(from), Number(to)] : n ? (dir === '↑' ? [Number(n), null] : [null, Number(n)]) : [null, null];
    careers.push({ type: 'EXPERIENCED', fromYears: years[0] ?? null, toYears: years[1] ?? null });
  }
  return careers;
}

export function parsePosting(id: string, html: string): SaraminPosting | { code: 'parse_failed' } {
  const title = html.match(/class="tit_job">([\s\S]*?)<\/h1>/)?.[1];
  const company = html.match(/title="([^"]*)" class="company"/)?.[1];
  if (!title || !company) return { code: 'parse_failed' };
  const summary = html.slice(html.indexOf('jv_cont jv_summary'), html.indexOf('jv_cont jv_howto'));
  const facts = Object.fromEntries([...summary.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)].map(m => [text(m[1]!), text(m[2]!)]));
  // 마감일이 없으면 상시·채용시 마감이다.
  const end = html.match(/<dt class="end">마감일<\/dt>\s*<dd>(\d{4})\.(\d{2})\.(\d{2}) (\d{2}:\d{2})<\/dd>/);
  const area = html.match(/jv_location"[^>]*data-address="([^"]*)"/)?.[1] ?? facts['근무지역'] ?? '';
  return {
    source: 'saramin', sourceId: id, url: `${ORIGIN}/zf_user/jobs/view?rec_idx=${id}`,
    title: text(title), company: text(company),
    deadline: end ? `${end[1]}-${end[2]}-${end[3]}T${end[4]}:59+09:00` : null, alwaysHire: !end,
    // 근무지는 우편번호를 빼고 주소 앞부분(시·구)만 쓴다.
    location: text(area).replace(/^\(\d+\)\s*/, '').replace(/지도보기/, '').split(/\s+/).slice(0, 2).join(' ') || null,
    remote: null,
    careers: parseCareers(facts['경력'] ?? ''),
    // 사람인 상세는 기업 유형·규모를 공고에 명시하지 않아 미확인(null)으로 둔다.
    companyType: null, employeeCount: null,
    // 홈페이지 지원은 사람인 추적 경유 링크라 외부 URL로 쓰지 않고 공고 URL로 이동한다.
    externalApplyUrl: null,
  };
}

export async function fetchSaramin(id: string): Promise<CollectedPosting | CollectFailure> {
  const page = await politeGet(`${ORIGIN}/zf_user/jobs/view?rec_idx=${id}`);
  if ('code' in page) return { source: 'saramin', id, code: page.code };
  const p = parsePosting(id, page.text);
  if ('code' in p) return { source: 'saramin', id, code: p.code };
  const raw = await politeGet(`${ORIGIN}/zf_user/jobs/relay/view-detail?rec_idx=${id}&rec_seq=0`, { referer: p.url });
  const body = 'text' in raw ? htmlText(raw.text) : raw;
  return { ...p, body: 'text' in body ? body.text : null, bodyFailure: 'code' in body ? body.code : null };
}

export async function collectSaramin(family: JobFamily, limit: number, f: Profile) {
  const postings: CollectedPosting[] = [];
  const failures: CollectFailure[] = [];
  const list = await politeGet(saraminSearchUrl(family, f));
  if ('code' in list) return { postings, failures: [{ source: 'saramin' as const, code: list.code }] };
  // 지역·경력은 상세에서 확인해 거르므로 목록을 세 배까지 본다.
  for (const id of listPostingIds(list.text).slice(0, limit * 3)) {
    if (postings.length >= limit) break;
    const r = await fetchSaramin(id);
    if ('code' in r) failures.push(r); else if (regionOk(r, f) && careerOk(r, f)) postings.push(r);
  }
  return { postings, failures };
}
