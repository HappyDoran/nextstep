// 점핏 공개 목록·상세 해석. 웹 화면이 쓰는 공개 JSON API를 읽는다(로그인 없음).
// 점핏은 개발 직무 전용이라 개발 직무에만 쓴다(기획서 3절). 점핏 공고 ID는 사람인 공고 번호와 같다(2026-11-14 확인).
import type { JobFamily, Profile } from '@nextstep/contracts';
import type { Career, CollectedPosting, CollectFailure } from './types.js';
import { htmlText, politeGet } from './http.js';
import { careerOk, regionOk } from './filter.js';

export const ORIGIN = 'https://jumpit.saramin.co.kr';
const API = 'https://jumpit-api.saramin.co.kr/api';
// 점핏 직무 분류 ID(2026-11-14 목록 응답으로 확인).
export const CATEGORIES: Partial<Record<JobFamily, number[]>> = { 프론트엔드: [2], '앱 개발': [4, 16, 18], 백엔드: [1], QA: [11] };

type ListItem = { id?: number; newcomer?: boolean; minCareer?: number; maxCareer?: number; locations?: string[] };
type Detail = {
  id?: number; title?: string; companyName?: string; newcomer?: boolean; minCareer?: number; maxCareer?: number;
  closedAt?: string | null; alwaysOpen?: boolean; location?: string | null;
  responsibility?: string; qualifications?: string; preferredRequirements?: string;
};

export function careersOf(p: { newcomer?: boolean; minCareer?: number; maxCareer?: number }): Career[] {
  const careers: Career[] = [];
  if (p.newcomer) careers.push({ type: 'NEWBIE', fromYears: null, toYears: null });
  if (p.minCareer || !p.newcomer) careers.push({ type: 'EXPERIENCED', fromYears: p.minCareer ?? null, toYears: p.maxCareer ?? null });
  return careers;
}

export function listItems(json: string): ListItem[] {
  const items = (JSON.parse(json) as { result?: { positions?: ListItem[] } }).result?.positions;
  return Array.isArray(items) ? items.filter(p => Number.isInteger(p.id)) : [];
}

export function parseDetail(id: string, json: string): Omit<CollectedPosting, 'bodyFailure'> | { code: 'parse_failed' } {
  const d = (JSON.parse(json) as { result?: Detail }).result;
  if (!d?.title || !d.companyName) return { code: 'parse_failed' };
  const body = [['주요 업무', d.responsibility], ['자격 요건', d.qualifications], ['우대 사항', d.preferredRequirements]].filter(([, t]) => t?.trim()).map(([h, t]) => `[${h}]\n${t!.trim()}`).join('\n\n');
  const closed = d.closedAt?.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  return {
    source: 'jumpit', sourceId: id, url: `${ORIGIN}/position/${id}`, title: d.title, company: d.companyName,
    deadline: !d.alwaysOpen && closed ? `${closed[1]}T${closed[2]}+09:00` : null, alwaysHire: d.alwaysOpen === true || !closed,
    // 근무지는 주소 앞부분(시·구)만 쓴다.
    location: d.location?.trim().split(/\s+/).slice(0, 2).join(' ') || null, remote: null,
    careers: careersOf(d),
    // 점핏 상세는 기업 유형·직원 수를 주지 않아 미확인으로 둔다.
    companyType: null, employeeCount: null, externalApplyUrl: null,
    body: body || null,
  };
}

export async function fetchJumpit(id: string): Promise<CollectedPosting | CollectFailure> {
  const page = await politeGet(`${API}/position/${id}`, { accept: 'application/json', referer: `${ORIGIN}/position/${id}` });
  if ('code' in page) return { source: 'jumpit', id, code: page.code };
  let p;
  try { p = parseDetail(id, page.text); } catch { return { source: 'jumpit', id, code: 'parse_failed' }; }
  if ('code' in p) return { source: 'jumpit', id, code: p.code };
  const body = p.body ? htmlText(p.body) : { code: 'body_missing' as const };
  return { ...p, body: 'text' in body ? p.body : null, bodyFailure: 'code' in body ? body.code : null };
}

export async function collectJumpit(family: JobFamily, limit: number, f: Profile) {
  const postings: CollectedPosting[] = [];
  const failures: CollectFailure[] = [];
  for (const category of CATEGORIES[family] ?? []) {
    const list = await politeGet(`${API}/positions?jobCategory=${category}&sort=reg_dt&page=1`, { accept: 'application/json', referer: `${ORIGIN}/positions` });
    if ('code' in list) { failures.push({ source: 'jumpit', code: list.code }); continue; }
    let items: ListItem[];
    try { items = listItems(list.text); } catch { failures.push({ source: 'jumpit', code: 'parse_failed' }); continue; }
    // 목록의 근무지·경력으로 먼저 걸러 상세 요청을 줄인다.
    for (const item of items.filter(i => regionOk({ location: i.locations?.[0] ?? null, remote: null, careers: [] }, f) && careerOk({ location: null, remote: null, careers: careersOf(i) }, f))) {
      if (postings.length >= limit) break;
      if (postings.some(p => p.sourceId === String(item.id))) continue;
      const r = await fetchJumpit(String(item.id));
      if ('code' in r) failures.push(r); else postings.push(r);
    }
  }
  return { postings, failures };
}
