// 채용 메일 규칙 판정. 명확한 문구만 상태로 보고, 결과 문맥은 있으나 불명확하면 '모호'로 둔다.
// 규칙 출처: 전신 개인 도구의 검증된 패턴을 서비스 상태(기획서 5절)로 옮겼다. 메일 본문은 판정 후 버린다.
export type MailStatus = '지원 완료' | '전형 진행중' | '합격' | '불합격' | '열람' | '모호';
export type MailInput = { fromAddress: string; subject: string; text: string; links: string[] };
export type MailVerdict = { status: MailStatus; evidence: string | null; platform: string | null; postingKeys: string[] };

const PLATFORMS: Record<string, string[]> = { 원티드: ['wanted.co.kr', 'wantedlab.com'], 잡코리아: ['jobkorea.co.kr'], 자소설닷컴: ['jasoseol.com'], 사람인: ['saramin.co.kr'], 점핏: ['jumpit.co.kr'] };
const RECRUIT_SUBJECT = /서류|면접|인터뷰|전형|과제|채용.{0,12}결과|합격|불합격|탈락|지원(?:서|이)?\s*(?:접수|완료)|입사\s*지원|열람/;
const PROMOTION = /^\s*\(광고\)|채용마감|추천\s*공고|인증번호|OpenAPI|뉴스레터/i;
const APPLIED = /지원(?:이|서가)?\s*(?:성공적으로\s*)?(?:접수|완료)|입사\s*지원.{0,20}완료|접수(?:가)?\s*완료/;
// '최종 합격 시 보상금'·'최종 합격자 발표 예정' 같은 안내 문구는 결과가 아니다. 결과 통보 표현만 인정한다.
const FINAL_PASS = /최종\s*(?:전형\s*)?합격(?:을|하셨|되셨|자로\s*선정|\s*(?:안내|통보|소식))|합격을\s*(?:진심으로\s*)?축하/;
const REJECT = /서류\s*(?:전형\s*)?(?:에서\s*)?(?:불합격|탈락)|불합격|(?:아쉽게도|안타깝게도|아쉽지만|유감스럽게도).{0,200}(?:함께하기\s*어렵|함께하지\s*못|모시기\s*어렵|모시지\s*못|합격\s*소식을\s*전(?:해\s*드리|하)지\s*못|선발되지\s*못|다음\s*(?:전형|단계).{0,20}(?:어렵|진행하지\s*못))/s;
const PROGRESS = /서류\s*(?:전형\s*)?(?:합격(?!률|율)|통과)|(?:\d차\s*)?면접\s*(?:일정|요청|제안|안내)|인터뷰를?\s*제안|과제\s*(?:전형|안내)/;
const VIEWED = /(?:이력서|지원서|프로필).{0,12}(?:열람|확인했|조회했)|(?:열람|조회).{0,12}(?:이력서|지원서|프로필)/;
const RESULT_CONTEXT = /결과|채용\s*종료|전형/;

export function platformOf(address: string) {
  const domain = address.split('@')[1]?.toLowerCase() ?? '';
  return Object.keys(PLATFORMS).find(p => PLATFORMS[p]!.some(d => domain === d || domain.endsWith(`.${d}`))) ?? null;
}

// 메일 안 공고 링크를 출처:ID로 정규화한다. 지원 건의 공고 URL과 같은 키로 대조한다.
export function postingKey(raw: string) {
  let url: URL;
  try { url = new URL(raw.replace(/&amp;/g, '&')); } catch { return null; }
  const host = url.hostname.toLowerCase();
  const id = (re: RegExp) => url.pathname.match(re)?.[1];
  if (/(^|\.)jobkorea\.co\.kr$/.test(host)) { const v = id(/\/Recruit\/GI_Read(?:Home)?\/(\d+)/i); return v ? `jobkorea:${v}` : null; }
  if (/(^|\.)wanted\.co\.kr$/.test(host)) { const v = id(/\/(?:wd|jobs)\/(\d+)/); return v ? `wanted:${v}` : null; }
  if (/(^|\.)jasoseol\.com$/.test(host)) { const v = id(/\/recruit\/(\d+)/); return v ? `jasoseol:${v}` : null; }
  if (host === 'jumpit.saramin.co.kr') { const v = id(/\/position\/(\d+)/); return v ? `jumpit:${v}` : null; }
  if (/(^|\.)saramin\.co\.kr$/.test(host)) { const v = url.searchParams.get('rec_idx'); return v && /^\d+$/.test(v) ? `saramin:${v}` : null; }
  return null;
}

function excerpt(text: string, match: RegExpMatchArray | null) {
  if (!match || match.index === undefined) return null;
  return text.slice(Math.max(0, match.index - 20), match.index + match[0].length + 30).replace(/\s+/g, ' ').trim().slice(0, 120);
}

// 채용과 무관하거나 홍보면 null.
export function classifyMail(input: MailInput): MailVerdict | null {
  const platform = platformOf(input.fromAddress);
  const subject = input.subject.trim();
  if (PROMOTION.test(subject)) return null;
  // 추천 공고·광고 블록 이후 문구는 지원 결과가 아니다.
  const primary = input.text.split(/다른 포지션 찾아|지원해 볼 만한 다른 포지션|추천 공고|서류 합격률을 올려/)[0]!.slice(0, 20_000);
  if (!platform && !RECRUIT_SUBJECT.test(subject)) return null;
  const all = `${subject}\n${primary}`;
  const keys = [...new Set(input.links.map(postingKey).filter((k): k is string => k !== null))];
  const verdict = (status: MailStatus, m: RegExpMatchArray | null): MailVerdict => ({ status, evidence: excerpt(all, m), platform, postingKeys: keys });
  // 순서: 최종 결과 > 진행 > 접수 > 열람. 불합격 문구가 있으면 진행 문구보다 우선한다.
  let m = all.match(FINAL_PASS);
  if (m) return verdict('합격', m);
  m = all.match(REJECT);
  if (m) return verdict('불합격', m);
  m = all.match(PROGRESS);
  if (m) return verdict('전형 진행중', m);
  m = subject.match(APPLIED) ?? primary.slice(0, 2000).match(APPLIED);
  if (m) return verdict('지원 완료', m);
  // 열람은 플랫폼 알림 제목에서만 인정한다.
  m = platform ? subject.match(VIEWED) : null;
  if (m) return verdict('열람', m);
  if (RESULT_CONTEXT.test(subject)) return verdict('모호', null);
  return null;
}
