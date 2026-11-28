import type { JobFamily, Profile } from '@nextstep/contracts';
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
// 같은 공고 판단(2026-11-28): 여러 출처에 올린 같은 공고는 회사 이름과 제목(대괄호 머리말·띄어쓰기·기호 무시)이 같다.
export const postingKey = (company: string, title: string) => `${companyKey(company)}|${title.toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/[^0-9a-z가-힣]/g, '')}`;
export const companyMatches = (company: string, names: string[]) => names.some(n => companyKey(n) && companyKey(company).includes(companyKey(n)));

// 제외 회사(2026-11-27): 판정·목록에서 뺀다.
export function companyOk(p: PostingFacts, f: Pick<Profile, 'excludeCompanies'>) {
  return !p.company || !f.excludeCompanies.length || !companyMatches(p.company, f.excludeCompanies);
}

// 검색어(2026-11-28, 플랫폼은 늘리지 않고 같은 출처에서 더 찾기): 직무 기본 검색어 → 프로필 기술을 붙인 검색어 → 직무 다른 이름 순으로,
// 새 공고가 모자랄 때만 다음 검색어로 넘어간다. 선호 기술을 안 적었으면 프로필 기술 앞 2개를 쓴다(선호 입력은 선택).
const SEARCH_WORDS: Record<JobFamily, string[]> = {
  프론트엔드: ['프론트엔드', '웹 퍼블리셔', 'React 개발자'], '앱 개발': ['앱 개발', 'iOS 개발자', 'Android 개발자', 'Flutter'],
  디자인: ['UI/UX 디자이너', '프로덕트 디자이너'], 기획: ['서비스 기획', '프로덕트 매니저'], 백엔드: ['백엔드', '서버 개발자'], QA: ['QA 엔지니어', '테스트 엔지니어'],
};
export function searchWords(family: JobFamily, f: Pick<Profile, 'skills'> & Partial<Pick<Profile, 'preferredSkills'>>) {
  const [base, ...more] = SEARCH_WORDS[family];
  const skills = (f.preferredSkills?.length ? f.preferredSkills : f.skills).slice(0, 2);
  return [...new Set([base!, ...skills.map(s => `${base} ${s}`), ...more])];
}

export const passesFilter = (p: PostingFacts, f: Profile) => regionOk(p, f) && careerOk(p, f) && employmentOk(p, f) && companyOk(p, f);
