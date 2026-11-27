import type { Profile } from '@nextstep/contracts';
import type { Career } from './types.js';

// 사용자가 고른 선호 필터. 출처 요청에 넣을 수 있는 것은 넣고, 나머지는 판정 전에 여기서 거른다.
export type PostingFacts = { location: string | null; remote: boolean | null; careers: Career[]; employmentTypes?: string[] | undefined; company?: string };

const SIDO: Record<string, string> = { 서울특별시: '서울', 경기도: '경기', 인천광역시: '인천', 부산광역시: '부산', 대구광역시: '대구', 대전광역시: '대전', 광주광역시: '광주', 울산광역시: '울산', 세종특별자치시: '세종' };
const norm = (text: string) => text.trim().split(/\s+/).map(w => SIDO[w] ?? w).join(' ');

// 근무지를 모르면 통과시킨다(판정에서 미확인). 원격 허용이면 전면 원격 공고는 지역과 무관하다.
export function regionOk(p: PostingFacts, f: Pick<Profile, 'regions' | 'remoteOk'>) {
  if (!f.regions.length || !p.location || (f.remoteOk && p.remote)) return true;
  const loc = norm(p.location);
  return f.regions.some(r => loc.startsWith(norm(r)));
}

// 요구 경력 하한이 상한을 넘는 경력직 공고만 뺀다. 신입·무관·미기재는 통과.
export function careerOk(p: PostingFacts, f: Pick<Profile, 'careerMax'>) {
  if (f.careerMax === null || !p.careers.length) return true;
  return p.careers.some(c => c.type !== 'EXPERIENCED' || c.fromYears === null || c.fromYears <= f.careerMax!);
}

// 고용 형태는 본문 추출 결과로만 안다. 미기재면 통과.
export function employmentOk(p: PostingFacts, f: Pick<Profile, 'employmentTypes'>) {
  const known = (p.employmentTypes ?? []).filter(t => t !== '미기재');
  return !f.employmentTypes.length || !known.length || known.some(t => (f.employmentTypes as string[]).includes(t));
}

// 회사 이름 비교: (주)·㈜·주식회사·공백·대소문자를 무시하고 사용자가 적은 이름이 들어 있으면 같은 회사로 본다.
const companyKey = (name: string) => name.replace(/\(주\)|㈜|주식회사|\(유\)|\s+/g, '').toLowerCase();
export const companyMatches = (company: string, names: string[]) => names.some(n => companyKey(n) && companyKey(company).includes(companyKey(n)));

// 제외 회사(2026-11-27): 판정·목록에서 뺀다.
export function companyOk(p: PostingFacts, f: Pick<Profile, 'excludeCompanies'>) {
  return !p.company || !f.excludeCompanies.length || !companyMatches(p.company, f.excludeCompanies);
}

export const passesFilter = (p: PostingFacts, f: Profile) => regionOk(p, f) && careerOk(p, f) && employmentOk(p, f) && companyOk(p, f);
