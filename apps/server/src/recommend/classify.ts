import type { Career } from '../sources/types.js';
import { regionOk } from '../sources/filter.js';
import type { Candidate } from '../prompts/candidate.js';
import type { Requirement } from '../prompts/requirements.js';
import type { Judgement } from '../prompts/recommend.js';

// 추천 분류 규칙(기술 설계 D절, 사용자 확정 2026-11-07). 모델은 사실만 뽑고 분류는 여기서 정한다.
// 우선순위: 제외 > 도전 > 미확인 > 기본. 같은 입력이면 같은 분류가 나온다.
// 규칙을 바꾸면 반드시 올린다. 저장된 추천은 이 값이 바뀌어야 다시 판정된다(2026-11-15 올리지 않아 재판정 누락).
export const RULES_VERSION = 'rules-2026-11-27';

// 제목에 직무 이름이 분명하면 그 직무를 더한다(2026-11-27 평가: 로컬 모델이 iOS 공고를 프론트엔드로, 앱 공고를 본문 '웹뷰'로 프론트엔드로 봄).
// 모델이 '기타'로 둔 공고도 제목이 대상 직무를 말하면 그 직무로 본다. 제목이 앱만 말하면 모델의 프론트엔드는 뺀다. 본문 추출이 없으면 제목 직무만 쓴다.
const TITLE_FAMILIES: [string, RegExp][] = [
  ['앱 개발', /(?<![a-z])(ios|android)(?![a-z])|안드로이드|아이폰|flutter|플러터|react\s*native|모바일\s*앱|앱\s*개발/i],
  ['프론트엔드', /프론트\s*엔드|front[\s-]*end|웹\s*퍼블리/i],
  ['백엔드', /백엔드|back[\s-]*end|서버\s*개발/i],
  ['디자인', /ui\s*\/?\s*ux|ux\s*\/?\s*ui|프로덕트\s*디자이너|product\s+designer/i],
  ['기획', /서비스\s*기획|(?<![a-z])(pm|po)(?![a-z])|product\s+(manager|owner)|프로덕트\s*(매니저|오너)/i],
  ['QA', /(?<![a-z])qa(?![a-z])|품질\s*보증|테스트\s*엔지니어/i],
];
export function withTitleFamilies(title: string, families: string[] | null): string[] | null {
  const named = TITLE_FAMILIES.filter(([, re]) => re.test(title)).map(([family]) => family);
  if (!named.length) return families;
  const merged = [...new Set([...(families ?? []).filter(f => f !== '기타'), ...named])];
  return named.includes('앱 개발') && !named.includes('프론트엔드') ? merged.filter(f => f !== '프론트엔드') : merged;
}

export type Seeker = { jobFamilies: string[]; regions: string[]; remoteOk: boolean };
export type PostingInput = {
  title?: string;
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

const ALIASES: Record<string, string> = { ts: 'typescript', js: 'javascript', rn: 'reactnative' };
// 직무 이름 비교에만 쓰는 별칭(일반 경험 비교에 쓰면 '기획'이 '사업기획'과 맞아 버린다).
const FAMILY_ALIASES: Record<string, string> = Object.fromEntries(Object.entries({
  앱개발: ['ios', 'android', 'ios개발', 'ios개발자', 'android개발', '안드로이드', '안드로이드개발', '모바일앱', '모바일앱개발', '모바일개발', '앱개발자', '크로스플랫폼'],
  기획: ['서비스기획', '서비스기획자', '기획자', 'pm', '프로덕트매니저', '제품기획'],
  디자인: ['프로덕트디자인', '프로덕트디자이너', 'uiux디자인', 'uiux디자이너', 'ui디자인', 'ux디자인', 'ui디자이너', '디자이너'],
  백엔드: ['서버', '서버개발', '서버개발자', '백엔드개발', '백엔드개발자', 'backend', '서버백엔드', '서버백엔드개발'],
  프론트엔드: ['frontend', '프론트엔드개발', '프론트엔드개발자', '웹프론트엔드', '프론트'],
  qa: ['qa엔지니어', '소프트웨어qa', '테스트엔지니어', '품질보증', 'sqa'],
}).flatMap(([to, from]) => from.map(f => [f, to])));
// 공고 제목에 이런 직무명이 있으면 대상 직무가 아니다(기술 설계 D절: 공간·패션 디자인, 사업·상품·영업기획 제외). 모델 분류보다 우선한다.
const NOT_TARGET = /데이터\s*(?:엔지니어|분석가?|사이언티스트)|사업\s*기획|전략\s*기획|상품\s*기획|영업\s*기획|\bMD\b|(?:공간|전시|패션|시각|제품|인테리어)\s*디자(?:인|이너)|품질\s*관리|\bQC\b/i;
export function norm(s: string) {
  // 같은 뜻의 한글 업무 표현은 하나로 맞춘다(이슈·버그 리포팅 = 결함 리포팅). 작은 모델이 단어 중간에 넣는 콜론(예: '백엔:드')도 지운다.
  // 별칭(JS·TS)을 먼저 맞추고 'React.js'·'Node.js'의 js 꼬리를 뗀다. 떼서 비면 원래 값을 쓴다.
  const n = s.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[\s.\-_/·:]/g, '').replace(/이슈|버그/g, '결함');
  return ALIASES[n] ?? (n.replace(/js$/, '') || n);
}
// 직무 이름: 별칭 → 대상 직무, 대상 직무 이름의 앞부분만 잘린 표기(예: '프론트엔')도 같은 직무로 본다.
const TARGET_KEYS = ['프론트엔드', '앱개발', '디자인', '기획', '백엔드', 'qa'];
function family(s: string) {
  const n = norm(s);
  return FAMILY_ALIASES[n] ?? TARGET_KEYS.find(t => n.length >= 3 && t.startsWith(n)) ?? n;
}
const hangul = (s: string) => /[가-힣]/.test(s);
// 기술 이름은 정확히 같아야 한다(React ≠ React Native). 한글 업무 경험은 한쪽이 다른 쪽을 포함하면 같다고 본다.
export function matches(keys: string[], pool: string[]) {
  // 괄호·기호만 있던 키는 비어 버리므로 비교하지 않는다(빈 키끼리 같다고 보지 않음).
  const ps = pool.map(norm).filter(Boolean);
  return keys.map(norm).filter(Boolean).some(k => ps.some(p => p === k || (hangul(k) && hangul(p) && Math.min(k.length, p.length) >= 3 && (p.includes(k) || k.includes(p)))));
}
// 직무 실무 경력이 있으면 당연히 하는 기본 업무·기본기(작은 모델이 추출에서 빠뜨려도 규칙이 채운다).
const CORE: Record<string, string[]> = {
  프론트엔드: ['HTML', 'CSS', 'JavaScript', 'Git', '웹 UI 개발'], 앱개발: ['Git', '모바일 앱 개발'], 백엔드: ['SQL', 'Git', 'API 개발'],
  디자인: ['UI 디자인', '화면 설계', '프로토타이핑'], 기획: ['화면 설계', '기능 명세', '와이어프레임'], qa: ['테스트 케이스 설계', '결함 리포팅', '회귀 테스트'],
};
// 조건 원문의 영문 기술명(직무·역할 이름 제외). "Vue.js 실무 경력 2년 이상"처럼 기술 실무 연차 요구를 모델 분류와 상관없이 알아본다.
const NOT_TECH = new Set(['qa', 'pm', 'po', 'ux', 'ui', 'ios', 'android', 'web', 'it', 'sw', 'hw', 'b2b', 'b2c', 'ai']);
function techTokens(text: string) {
  return [...text.matchAll(/[A-Za-z][A-Za-z0-9.+#-]*(?:\s[A-Z][A-Za-z0-9.+#-]*)?/g)].map(m => m[0].trim()).filter(t => !NOT_TECH.has(norm(t)));
}
const yearsIn = (text: string) => Number(text.match(/(\d+)\s*년\s*이상/)?.[1] ?? 0) || null;
const months = (c: Candidate, f: string) => Math.max(0, ...c.careers.filter(r => family(r.family) === family(f)).map(r => r.months));
const span = (m: number) => (m % 12 ? `${Math.floor(m / 12)}년 ${m % 12}개월` : `${m / 12}년`);
// 조사 '으로/로': 받침이 없거나 ㄹ이면 '로'(개월로), 아니면 '으로'(년으로).
const ro = (word: string) => { const code = word.charCodeAt(word.length - 1) - 0xac00; const final = code >= 0 && code < 11172 ? code % 28 : 0; return `${word}${final === 0 || final === 8 ? '로' : '으로'}`; };
// '신입 가능'·'경력무관'·'경력 3년 이상'처럼 직무 없이 지원 자격만 말하는 문구(작은 모델이 필수 경력으로 뽑음, 2026-11-15 실제 흐름에서 제외 53건 중 16건).
// 다른 직무 경력으로 보지 않는다: 연차 하한만 직무 경력과 비교하고 나머지는 충족으로 둔다.
const ELIGIBILITY = /^(?:(?:학력|나이|성별)\s*무관|신입|경력\s*무관|무관|주니어|경력\s*(?:\/|·|및)?\s*신입|경력\s*:?\s*\d+\s*년|\d+\s*년\s*(?:이상|이하|차)|\d{4}\s*년\s*\d+\s*월\s*(?:수시|정기)\s*채용)/;

export function classify(evaluatedAt: string, seeker: Seeker, c: Candidate, p: PostingInput): Judgement {
  const met: string[] = [], unmet: string[] = [], unknown: string[] = [], unsureWhy: string[] = [], excludeWhy: string[] = [];
  let exclude = false, challenge = false, unsure = false;
  const out = (kind: 'met' | 'exclude' | 'challenge' | 'unsure' | 'note', text: string) => {
    if (kind === 'met') met.push(text);
    else if (kind === 'exclude' || kind === 'challenge') { unmet.push(text); if (kind === 'exclude') { exclude = true; excludeWhy.push(text); } else challenge = true; }
    else { unknown.push(text); if (kind === 'unsure') { unsure = true; unsureWhy.push(text); } }
  };

  // 직무: 희망 직무 중 하나만 맞아도 된다(OR). 제목이 대상 아닌 직무명이면 모델 분류와 상관없이 제외한다.
  // 제목이 직무를 밝히면 모델 분류를 제목으로 보정한다(어느 AI 경로든 같은 실수를 막음).
  const off = p.title?.match(NOT_TARGET)?.[0];
  const postingFamilies = p.title ? withTitleFamilies(p.title, p.families) : p.families;
  const families = off ? [] : postingFamilies?.filter(f => seeker.jobFamilies.includes(f)) ?? [];
  if (off) out('exclude', `공고 직무(${off})가 대상 직무가 아님`);
  else if (postingFamilies && !families.length) out('exclude', `공고 직무(${postingFamilies.join('·')})가 희망 직무(${seeker.jobFamilies.join('·')})와 다름`);
  const jobFamilies = families.length ? families : seeker.jobFamilies;

  // 마감: 기준 시각과 같거나 앞서면 제외(개인 불합격이 아님). 사용자가 방금 마감 표시한 공고도 같은 밀리초 판정에서 제외된다.
  if (!p.alwaysHire && p.deadline && Date.parse(p.deadline) <= Date.parse(evaluatedAt)) out('exclude', `공고 마감(${p.deadline.slice(0, 10)} 경과, 개인 불합격 아님)`);

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
    if (need > 0 && have < need * 12) out('challenge', `직무 경력 ${ro(span(have))} 요구 ${need}년보다 부족`);
    else if (need > 0) out('met', `직무 경력 ${span(have)}(요구 ${need}년 이상)`);
  }

  if (!p.required) out('unsure', p.bodyNote ?? '본문 조건 미확인');
  const practical = c.careers.flatMap(r => r.stack);
  // 직무 이름은 경험 비교에 넣지 않는다('앱 개발'이 '하이브리드 앱 개발'과 맞아 버림). 직무 경력은 career 조건에서만 본다.
  const known = [...c.skills, ...practical, ...c.experiences, ...c.careers.filter(r => r.months > 0).flatMap(r => CORE[family(r.family)] ?? [])];
  // 추출에서 빠졌어도 서류 원문에 같은 말이 그대로 있으면 있는 것으로 본다(작은 모델의 추출 누락 보완). 세 글자 이상만.
  // 작은 모델이 키워드를 줄이거나 망가뜨리므로(예: '테스트 케이:케이스') 조건 원문(text)도 함께 대조한다.
  const raw = c.text ? norm(c.text) : '';
  // 긴 조건 문구는 '·', ',', '/', 괄호, '등', '또는'으로 나누고 끝의 일반어(경험·수행·작성 등)를 떼어 각 조각을 대조한다.
  const parts = (k: string) => [k, ...k.split(/[·,/()]|\s등\s|\s또는\s/)].map(x => x.trim().replace(/(\s*(경험|수행|작성|협업|능력|역량|이해|활용|가능자?|보유|우대))+$/, '')).filter(Boolean);
  const inText = (keys: string[]) => Boolean(raw) && keys.flatMap(parts).map(norm).some(k => k.length >= 3 && raw.includes(k));
  const has = (keys: string[], pool: string[]) => matches(keys, pool) || inText(keys);
  // 'AWS 운영 경험'처럼 원문의 영문 기술명이 모두 보유 기술이면 충족으로 본다.
  const allTech = (text: string) => { const t = techTokens(text); return t.length > 0 && t.every(x => matches([x], known)); };
  for (const original of p.required ?? []) {
    // 원문 보정: 기술명과 연차·실무가 함께 있으면 기술 실무 요구, 직무 경력이면 원문에 들어 있는 직무 이름도 키로 쓴다.
    const tech = techTokens(original.text);
    const years = original.years ?? yearsIn(original.text);
    const r = tech.length && years && /실무|경력/.test(original.text) ? { ...original, type: 'skill' as const, keys: tech, years, practical: true }
      : original.type === 'career' ? { ...original, keys: [...original.keys, ...TARGET_KEYS.filter(t => norm(original.text).includes(t))] } : original;
    // '경력 3년 이하'는 작은 모델이 경험 항목으로도 뽑는다.
    // 실제 이력서 확인(2026-11-15): 'Android 개발 신입/경력 1~3년'·'경력: 신입/ 경력 (~3년 이하)'처럼 신입이 들어가면 지원 가능,
    // '동일경력 2~3년차'처럼 범위면 하한만 직무 경력과 비교한다. '학력무관'은 유형과 상관없이 충족.
    const t = r.text.trim();
    const careerLike = r.type === 'career' || ['experience', 'role', 'skill'].includes(r.type) && /^(?:동일\s*)?경력\s*:?/.test(t);
    if (/^(?:학력|나이|성별)\s*무관/.test(t) || careerLike && (ELIGIBILITY.test(t) || /신입/.test(t) || /^(?:동일\s*)?경력\s*:?\s*\d+\s*(?:년\s*)?~/.test(t))) {
      const min = /신입/.test(t) ? null : yearsIn(t) ?? (Number(t.match(/(\d+)\s*(?:년\s*)?~/)?.[1] ?? 0) || null);
      if (min && have < min * 12) out('challenge', `${r.text}: 직무 경력 ${span(have)}`);
      else out('met', `지원 자격 ${r.text}`);
    } else if (r.type === 'career') {
      // 같은 직무 연차 부족은 도전, 다른 성격의 필수 경력(직책·다른 직무)은 유사 경험으로 대체하지 않고 제외.
      const best = Math.max(0, ...r.keys.map(k => months(c, k)));
      const sameJob = r.keys.some(k => jobFamilies.some(f => family(f) === family(k)));
      const need = (r.years ?? 0) * 12;
      if (best > 0 && best >= need) out('met', `${r.text}: ${span(best)}`);
      else if (best > 0 || (sameJob && need > 0)) out('challenge', `${r.text}: 확인된 경력 ${span(best)}`);
      else if (sameJob) out('unsure', `${r.text}: 실무 경력 미기재`);
      else if (matches(r.keys, c.roles)) out('unsure', `${r.text}: 직책은 있으나 기간 미기재`);
      else if (r.keys.some(k => !TARGET_KEYS.includes(family(k))) || need > 0) out('exclude', `필수 ${r.text} 없음(유사 경험으로 대체하지 않음)`);
      else out('unsure', `${r.text} 확인 불가`);
    } else if (r.type === 'skill') {
      if (r.practical && r.years) {
        // 연차를 밝혀 실무를 요구한 기술은 실무 스택에 있어야 한다. 사이드 프로젝트·비슷한 기술로 대신하지 않는다.
        const used = c.careers.filter(k => matches(r.keys, k.stack));
        const best = Math.max(0, ...used.map(k => k.months));
        if (!used.length) out('exclude', `필수 ${r.text}: 실무 경력 없음`);
        else if (best < r.years * 12) out('challenge', `${r.text}: 실무 ${span(best)}`);
        else out('met', r.text);
      } else if (has([...r.keys, r.text], known) || allTech(r.text)) out('met', r.text);
      else out('unsure', `필수 ${r.text}: 서류에 미기재`);
    } else if (r.type === 'experience' || r.type === 'role') {
      if (has([...r.keys, r.text], [...known, ...c.roles]) || allTech(r.text)) out('met', r.text);
      else out('unsure', `필수 ${r.text}: 서류로 확인 불가`);
    } else if (r.type === 'portfolio') out('unsure', `필수 ${r.text}: 포트폴리오 내용은 서류로 확인 불가`);
    // ponytail: 학력·기타 조건은 판정을 바꾸지 않고 기록만 한다. 학력 필터가 필요해지면 education 비교를 추가한다.
    else if (r.type === 'education') out(c.education === '미기재' ? 'note' : 'met', `${r.text}(최종 학력 ${c.education})`);
    else out('note', `${r.text}: 확인 필요`);
  }
  for (const r of p.preferred) if (has([...r.keys, r.text], known)) out('met', `우대: ${r.text}`);
  if (!p.companyType) out('note', '기업 유형·규모 미기재');

  const classification = exclude ? '제외' : challenge ? '도전' : unsure ? '미확인' : '기본';
  const reason = classification === '기본' ? '필수 조건과 희망 조건에 맞지 않는 항목이 없음' : classification === '미확인' ? `확인할 수 없는 조건: ${unsureWhy[0]}` : classification === '제외' ? excludeWhy[0]! : unmet[0]!;
  return { classification, met, unmet, unknown, reason };
}
