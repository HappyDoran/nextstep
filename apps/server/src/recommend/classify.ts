import type { Career } from '../sources/types.js';
import { regionOk } from '../sources/filter.js';
import type { Candidate } from '../prompts/candidate.js';
import type { Requirement } from '../prompts/requirements.js';
import type { Judgement } from '../prompts/recommend.js';

// 추천 분류 규칙(기술 설계 D절, 사용자 확정 2026-11-07). 모델은 사실만 뽑고 분류는 여기서 정한다.
// 우선순위: 제외 > 도전 > 미확인 > 기본. 같은 입력이면 같은 분류가 나온다.
export const RULES_VERSION = 'rules-2026-11-14c';

export type Seeker = { jobFamilies: string[]; regions: string[]; remoteOk: boolean };
export type PostingInput = {
  families: string[] | null;
  required: Requirement[] | null;
  preferred: { text: string; keys: string[] }[];
  careers: Career[];
  location: string | null;
  remote: '전면' | '부분' | '없음' | '미기재' | null;
  deadline: string | null;
  alwaysHire: boolean;
  companyType: string | null;
  bodyNote: string | null;
};

const TARGETS = ['프론트엔드', '앱 개발', '디자인', '기획', '백엔드', 'QA'];
const ALIASES: Record<string, string> = { ts: 'typescript', js: 'javascript', rn: 'reactnative' };
// 직무 이름 비교에만 쓰는 별칭(일반 경험 비교에 쓰면 '기획'이 '사업기획'과 맞아 버린다).
const FAMILY_ALIASES: Record<string, string> = { ios: '앱개발', android: '앱개발', ios개발: '앱개발', 모바일앱: '앱개발', 서비스기획: '기획', 프로덕트디자인: '디자인', uiux디자인: '디자인' };
export function norm(s: string) {
  // 같은 뜻의 한글 업무 표현은 하나로 맞춘다(이슈·버그 리포팅 = 결함 리포팅).
  const n = s.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[\s.\-_/·]/g, '').replace(/js$/, '').replace(/이슈|버그/g, '결함');
  return ALIASES[n] ?? n;
}
const family = (s: string) => FAMILY_ALIASES[norm(s)] ?? norm(s);
const hangul = (s: string) => /[가-힣]/.test(s);
// 기술 이름은 정확히 같아야 한다(React ≠ React Native). 한글 업무 경험은 한쪽이 다른 쪽을 포함하면 같다고 본다.
export function matches(keys: string[], pool: string[]) {
  const ps = pool.map(norm);
  return keys.map(norm).some(k => ps.some(p => p === k || (hangul(k) && hangul(p) && Math.min(k.length, p.length) >= 3 && (p.includes(k) || k.includes(p)))));
}
const months = (c: Candidate, f: string) => Math.max(0, ...c.careers.filter(r => family(r.family) === family(f)).map(r => r.months));
const span = (m: number) => (m % 12 ? `${Math.floor(m / 12)}년 ${m % 12}개월` : `${m / 12}년`);

export function classify(evaluatedAt: string, seeker: Seeker, c: Candidate, p: PostingInput): Judgement {
  const met: string[] = [], unmet: string[] = [], unknown: string[] = [], unsureWhy: string[] = [];
  let exclude = false, challenge = false, unsure = false;
  const out = (kind: 'met' | 'exclude' | 'challenge' | 'unsure' | 'note', text: string) => {
    if (kind === 'met') met.push(text);
    else if (kind === 'exclude' || kind === 'challenge') { unmet.push(text); if (kind === 'exclude') exclude = true; else challenge = true; }
    else { unknown.push(text); if (kind === 'unsure') { unsure = true; unsureWhy.push(text); } }
  };

  // 직무: 희망 직무 중 하나만 맞아도 된다(OR).
  const families = p.families?.filter(f => seeker.jobFamilies.includes(f)) ?? [];
  if (p.families && !families.length) out('exclude', `공고 직무(${p.families.join('·')})가 희망 직무(${seeker.jobFamilies.join('·')})와 다름`);
  const jobFamilies = families.length ? families : seeker.jobFamilies;

  // 마감: 기준 시각보다 앞서면 제외(개인 불합격이 아님).
  if (!p.alwaysHire && p.deadline && Date.parse(p.deadline) < Date.parse(evaluatedAt)) out('exclude', `공고 마감(${p.deadline.slice(0, 10)} 경과, 개인 불합격 아님)`);

  // 근무지: 전면 원격은 원격 가능이면 지역과 무관. 미기재는 미확인.
  if (p.remote === '전면' && seeker.remoteOk) out('met', '전면 원격');
  else if (!p.location) { if (seeker.regions.length) out('unsure', '근무지·원격 여부 미기재'); }
  else if (!regionOk({ location: p.location, remote: false, careers: [] }, { regions: seeker.regions, remoteOk: false })) out('exclude', `근무지 ${p.location}가 희망 지역(${seeker.regions.join('·')})이 아님${p.remote === '부분' ? '(부분 원격은 원격 근무가 아님)' : ''}`);
  else if (seeker.regions.length) out('met', `근무지 ${p.location}`);

  // 요구 연차(출처 정보): 신입·경력무관이 함께 있으면 연차를 보지 않는다.
  const have = Math.max(0, ...jobFamilies.map(f => months(c, f)));
  const experienced = p.careers.filter(k => k.type === 'EXPERIENCED' && k.fromYears !== null);
  if (experienced.length && !p.careers.some(k => k.type !== 'EXPERIENCED')) {
    const need = Math.min(...experienced.map(k => k.fromYears!));
    if (need > 0 && have < need * 12) out('challenge', `직무 경력 ${span(have)}로 요구 ${need}년보다 부족`);
    else if (need > 0) out('met', `직무 경력 ${span(have)}(요구 ${need}년 이상)`);
  }

  if (!p.required) out('unsure', p.bodyNote ?? '본문 조건 미확인');
  const practical = c.careers.flatMap(r => r.stack);
  // 직무 이름은 경험 비교에 넣지 않는다('앱 개발'이 '하이브리드 앱 개발'과 맞아 버림). 직무 경력은 career 조건에서만 본다.
  const known = [...c.skills, ...practical, ...c.experiences];
  for (const r of p.required ?? []) {
    if (r.type === 'career') {
      // 같은 직무 연차 부족은 도전, 다른 성격의 필수 경력(직책·다른 직무)은 유사 경험으로 대체하지 않고 제외.
      const best = Math.max(0, ...r.keys.map(k => months(c, k)));
      const sameJob = r.keys.some(k => jobFamilies.some(f => family(f) === family(k)));
      const need = (r.years ?? 0) * 12;
      if (best > 0 && best >= need) out('met', `${r.text}: ${span(best)}`);
      else if (best > 0 || (sameJob && need > 0)) out('challenge', `${r.text}: 확인된 경력 ${span(best)}`);
      else if (sameJob) out('unsure', `${r.text}: 실무 경력 미기재`);
      else if (matches(r.keys, c.roles)) out('unsure', `${r.text}: 직책은 있으나 기간 미기재`);
      else if (r.keys.some(k => !TARGETS.some(t => family(t) === family(k))) || need > 0) out('exclude', `필수 ${r.text} 없음(유사 경험으로 대체하지 않음)`);
      else out('unsure', `${r.text} 확인 불가`);
    } else if (r.type === 'skill') {
      if (r.practical) {
        // 실무를 요구한 기술은 실무 스택에 있어야 한다. 사이드 프로젝트·비슷한 기술로 대신하지 않는다.
        const used = c.careers.filter(k => matches(r.keys, k.stack));
        const best = Math.max(0, ...used.map(k => k.months));
        if (!used.length) out('exclude', `필수 ${r.text}: 실무 경력 없음`);
        else if (r.years && best < r.years * 12) out('challenge', `${r.text}: 실무 ${span(best)}`);
        else out('met', r.text);
      } else if (matches(r.keys, known)) out('met', r.text);
      else out('unsure', `필수 ${r.text}: 서류에 미기재`);
    } else if (r.type === 'experience' || r.type === 'role') {
      if (matches(r.keys, [...known, ...c.roles])) out('met', r.text);
      else out('unsure', `필수 ${r.text}: 서류로 확인 불가`);
    } else if (r.type === 'portfolio') out('unsure', `필수 ${r.text}: 포트폴리오 내용은 서류로 확인 불가`);
    // ponytail: 학력·기타 조건은 판정을 바꾸지 않고 기록만 한다. 학력 필터가 필요해지면 education 비교를 추가한다.
    else if (r.type === 'education') out(c.education === '미기재' ? 'note' : 'met', `${r.text}(최종 학력 ${c.education})`);
    else out('note', `${r.text}: 확인 필요`);
  }
  for (const r of p.preferred) if (matches(r.keys, known)) out('met', `우대: ${r.text}`);
  if (!p.companyType) out('note', '기업 유형·규모 미기재');

  const classification = exclude ? '제외' : challenge ? '도전' : unsure ? '미확인' : '기본';
  const reason = classification === '기본' ? '필수 조건과 희망 조건에 맞지 않는 항목이 없음' : classification === '미확인' ? `확인할 수 없는 조건: ${unsureWhy[0]}` : unmet[0]!;
  return { classification, met, unmet, unknown, reason };
}
