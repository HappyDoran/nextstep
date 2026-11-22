import { jobFamilySchema, profileSchema, type JobFamily, type Profile } from '@nextstep/contracts';
import { extractCandidate, type Candidate } from './candidate.js';

// 프로필 초안은 추천 판정이 쓰는 지원자 추출(candidate)에서 만든다. 같은 서류면 갱신과 결과를 공유해 다시 부르지 않고(서버 메모리 캐시),
// 직무별 실무 기간을 합쳐 경력 연수를 낸다. 화면은 지금 프로필에 더하기만 한다(빼지 않음).
// 선호(지역·원격·고용 형태·요구 경력)와 경력 요약은 사용자 몫이라 비워 둔다(화면은 빈 요약이면 지금 값을 유지).
// 소형 모델은 직무를 영어로(Frontend), 개월을 연도로(2025) 답하기도 한다(2026-11-22 홈서버 실측). 직무는 별칭으로 맞추고 개월은 1~480만 쓴다.
const FAMILIES = jobFamilySchema.options;
const ALIASES: [RegExp, JobFamily][] = [[/front|프론트|웹\s*개발/i, '프론트엔드'], [/\bapp\b|mobile|ios|android|앱|모바일/i, '앱 개발'], [/back|server|백엔드|서버/i, '백엔드'], [/design|\bui\b|\bux\b|디자인/i, '디자인'], [/plan|\bpm\b|\bpo\b|product\s*(manager|owner)|기획/i, '기획'], [/\bqa\b|test|품질/i, 'QA']];
const familyOf = (name: string) => FAMILIES.find(f => f.replace(/\s/g, '') === name.replace(/\s/g, '')) ?? ALIASES.find(([re]) => re.test(name))?.[1];

export function profileFromCandidate(c: Pick<Candidate, 'careers' | 'skills'>): Profile {
  const months = new Map<JobFamily, number>();
  for (const r of c.careers) { const f = familyOf(r.family); if (f) months.set(f, (months.get(f) ?? 0) + (r.months >= 1 && r.months <= 480 ? r.months : 0)); }
  const jobFamilies = [...months.keys()];
  return profileSchema.parse({
    jobFamilies: jobFamilies.length ? jobFamilies : ['프론트엔드'],
    // 반 년 단위로 반올림한다(화면 입력 단위와 같음).
    experiences: jobFamilies.map(f => ({ jobFamily: f, years: Math.min(50, Math.round(months.get(f)! / 6) / 2) })).filter(e => e.years > 0),
    regions: [], remoteOk: false, employmentTypes: [], careerMax: null,
    skills: [...new Set(c.skills.map(s => s.trim()).filter(s => s && s.length <= 60))].slice(0, 60),
    summary: '',
  });
}

/** 서류(이력서·경력기술서·포트폴리오를 합친 글)에서 프로필 초안을 만든다. 저장은 사용자가 확인·수정한 뒤에만 한다. */
export async function suggestProfile(documentsText: string) {
  return profileFromCandidate(await extractCandidate(documentsText));
}
