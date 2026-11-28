import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { profileSchema, type JobFamily, type Profile, type SourceId } from '@nextstep/contracts';
import { resetBlockedHosts } from '../sources/http.js';
import type { CollectedPosting, CollectFailure } from '../sources/types.js';
import { collectJobkorea, fetchJobkorea } from '../sources/jobkorea.js';
import { collectWanted, fetchWanted } from '../sources/wanted.js';
import { collectSaramin, fetchSaramin } from '../sources/saramin.js';
import { collectJumpit, fetchJumpit } from '../sources/jumpit.js';
import { DEV_FAMILIES } from '../sources/types.js';
import { extractRequirements, REQUIREMENTS_PROMPT_VERSION, type Requirements } from '../prompts/requirements.js';
import { extractCandidate, CANDIDATE_PROMPT_VERSION, type Candidate } from '../prompts/candidate.js';
import { classify, RULES_VERSION, type PostingInput } from './classify.js';
import { reportProgress, type ClaimedJob, type JobOutcome } from './jobs.js';
import { passesFilter, postingKey } from '../sources/filter.js';
import { aiState, candidateFor, docsKey, isRemote, missingProviders, POSTING_WAIT_MS, postingTaskInput, queueDocuments, queuePosting, saveRequirements, saveSample, teacherHints, waitTasks, type AiState } from '../ai/remote.js';
import { postingModel } from '../ai/llm.js';
import { seoulParts } from '../schedule.js';

type Collected = { postings: CollectedPosting[]; failures: CollectFailure[] };
export type PipelineDeps = {
  collect: Record<'saramin' | 'jobkorea' | 'wanted' | 'jumpit', (f: JobFamily, n: number, p: Profile, skip?: (id: string) => boolean) => Promise<Collected>>;
  fetchOne: Record<SourceId, (id: string) => Promise<CollectedPosting | CollectFailure>>;
  // hints: Codex·Claude가 비슷한 공고를 분석한 결과 요약(로컬 모델 참고용, 없으면 빈 문자열).
  extract: (posting: { title: string; company: string; body: string }, hints?: string) => Promise<Requirements>;
  candidate: (text: string) => Promise<Candidate>;
  // 내 AI 결과를 기다리는 최대 시간(테스트는 짧게).
  waitMs?: number;
};
export const defaultDeps: PipelineDeps = {
  // 자동 수집 출처: 사람인·잡코리아·원티드·점핏(점핏은 개발 직무만). 자소설닷컴은 사이트 차단으로 제거(2026-11-25).
  collect: { saramin: collectSaramin, jobkorea: collectJobkorea, wanted: collectWanted, jumpit: collectJumpit },
  fetchOne: { saramin: fetchSaramin, jobkorea: fetchJobkorea, wanted: fetchWanted, jumpit: fetchJumpit },
  extract: extractRequirements,
  candidate: extractCandidate,
};

// 실행당 요청·판정 상한(출처 부담·요금 제한).
// 직무·출처마다 새 공고를 이만큼(사용자 결정 2026-11-26: 15건부터). 이미 분석한 공고는 세지 않는다.
const PER_FAMILY = 15;
// 로컬 LLM은 느려(1건 약 1분) 실행당 이만큼만 뽑고 나머지는 다음 실행·내 AI로 넘긴다(기획서: 하루 처리 상한).
const LOCAL_EXTRACT_LIMIT = 40;
// 노출 공고 마감 재확인: 매일 0시(KST) 이 시간보다 오래 확인 안 한 노출 공고를 모두 다시 읽는다(요청당 2.5초, 21시 갱신에서 받은 공고는 건너뜀).
const RECHECK_AFTER_MS = 3 * 60 * 60_000;
const RECHECK_HOUR = 0;
// 채용이 아닌 교육·부트캠프 모집은 공고로 받지 않는다(직무별 목록에 섞여 나온다).
const NOT_HIRING = /교육생|수강생|훈련생|부트캠프|클래스메이트|국비\s*(?:지원|교육)|\d+기\s*모집/;
export const isNotHiring = (title: string) => NOT_HIRING.test(title);
// 실패 원인 코드만 센다(요청 본문은 남기지 않는다).
const failureCode = (error: unknown) => (error as { code?: string }).code ?? 'internal';
type Counts = { aiFailures: number; aiFailureCodes: Record<string, number>; localExtracts?: number };
function countFailure(counts: Counts, error: unknown) {
  counts.aiFailures++;
  const code = failureCode(error);
  counts.aiFailureCodes[code] = (counts.aiFailureCodes[code] ?? 0) + 1;
}

// 사용자가 넣는 링크에서 출처와 공고 ID를 찾는다. 지원 출처가 아니면 undefined.
export function parsePostingLink(raw: string): { source: SourceId; id: string } | undefined {
  let url: URL;
  try { url = new URL(raw); } catch { return undefined; }
  if (url.protocol !== 'https:') return undefined;
  const host = url.hostname.toLowerCase();
  const match = (re: RegExp) => url.pathname.match(re)?.[1];
  if (host === 'jumpit.saramin.co.kr') { const id = match(/^\/position\/(\d+)/); return id ? { source: 'jumpit', id } : undefined; }
  if (host === 'www.saramin.co.kr' || host === 'm.saramin.co.kr') { const id = url.searchParams.get('rec_idx'); return id && /^\d+$/.test(id) && url.pathname.startsWith('/zf_user/jobs/') ? { source: 'saramin', id } : undefined; }
  if (host === 'www.jobkorea.co.kr' || host === 'm.jobkorea.co.kr') { const id = match(/^\/Recruit\/GI_Read\/(\d+)/i); return id ? { source: 'jobkorea', id } : undefined; }
  if (host === 'www.wanted.co.kr' || host === 'wanted.co.kr') { const id = match(/^\/wd\/(\d+)/); return id ? { source: 'wanted', id } : undefined; }
  return undefined;
}

const SAME_POSTING: Partial<Record<SourceId, SourceId>> = { saramin: 'jumpit', jumpit: 'saramin' };

// 본문을 못 읽은 이유(출처 코드) → 화면 문구.
const BODY_FAILURES: Record<string, string> = { closed: '마감된 공고', body_image_only: '본문이 이미지', body_missing: '본문 없음' };
type PostingRow = { id: string; source: SourceId; title: string; company: string; deadline: string | null; always_hire: number; location: string | null; remote: number | null; careers: string; company_type: string | null; employee_count: number | null; requirements: string | null; body_failure: string | null; closed_at: string | null; acquired_by: 'auto' | 'link'; owner_user_id: string };

// 공고는 갱신을 요청한 사용자의 자료로만 저장한다. 다른 사용자와 공유하지 않는다(사용자 결정 2026-11-10).
function upsertPosting(db: DatabaseSync, p: CollectedPosting, acquiredBy: 'auto' | 'link', ownerUserId: string) {
  const at = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM postings WHERE source = ? AND source_id = ? AND owner_user_id = ?').get(p.source, p.sourceId, ownerUserId) as { id: string } | undefined;
  const values = [p.url, p.title, p.company, p.deadline, p.alwaysHire ? 1 : 0, p.location, p.remote === null ? null : p.remote ? 1 : 0, JSON.stringify(p.careers), p.companyType, p.employeeCount, p.externalApplyUrl, p.bodyFailure, acquiredBy, at] as const;
  if (existing) {
    // 사용자가 링크로 넣은 공고는 자동 수집에 다시 걸려도 링크 공고로 둔다(필터로 숨기지 않음).
    db.prepare("UPDATE postings SET url = ?, title = ?, company = ?, deadline = ?, always_hire = ?, location = ?, remote = ?, careers = ?, company_type = ?, employee_count = ?, external_apply_url = ?, body_failure = ?, acquired_by = CASE acquired_by WHEN 'link' THEN 'link' ELSE ? END, checked_at = ? WHERE id = ? AND owner_user_id = ?").run(...values, existing.id, ownerUserId);
    return existing.id;
  }
  const id = randomUUID();
  db.prepare('INSERT INTO postings (id, source, source_id, owner_user_id, url, title, company, deadline, always_hire, location, remote, careers, company_type, employee_count, external_apply_url, body_failure, acquired_by, checked_at, first_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, p.source, p.sourceId, ownerUserId, ...values, at);
  return id;
}

// 원문은 조건 추출에만 쓴다. 추출 결과(구조화 사실)만 저장하고, 내 AI 분석을 기다리는 동안만 원문을 일(ai_tasks)에 둔다.
// 내 AI(실행기)를 지금 쓸 수 있으면 일로 올리고 ID를 돌려준다(갱신이 10분 기다린 뒤 남은 것만 로컬로).
// 아니면 바로 로컬로 뽑고, 실행기를 쓰는 사용자면 나중에 내 AI로 다시 뽑을 일(승격)을 쌓는다.
// 켠 경로(Codex·Claude)마다 같은 입력으로 일을 올린다. 갱신은 지금 쓸 수 있는 경로 중 가장 믿는 경로(Codex 우선)의 결과만 기다리고,
// 다른 경로의 결과는 비교·학습 표본으로 쌓인다(사용자 결정 2026-11-28).
async function storeRequirements(db: DatabaseSync, deps: PipelineDeps, userId: string, postingId: string, p: CollectedPosting, counts: Counts, ai: AiState): Promise<string[]> {
  const row = db.prepare('SELECT requirements FROM postings WHERE id = ? AND owner_user_id = ?').get(postingId, userId) as { requirements: string | null } | undefined;
  if (!row || !p.body) return [];
  const current = row.requirements ? JSON.parse(row.requirements) as { version?: string; provider?: string } : null;
  const fresh = current?.version === REQUIREMENTS_PROMPT_VERSION;
  const send = ai.registered && ai.settings.sendPostings;
  const need = send ? missingProviders(db, userId, postingId, ai.registeredProviders) : [];
  const input = postingTaskInput({ id: postingId, title: p.title, company: p.company, body: p.body });
  if (fresh && (isRemote(current?.provider) || !send)) { queuePosting(db, userId, postingId, input, need); return []; }
  const primary = ai.settings.sendPostings ? ai.providers.find(provider => need.includes(provider)) : undefined;
  if (primary) return queuePosting(db, userId, postingId, input, need, { provider: primary, fallbackAt: new Date(Date.now() + (deps.waitMs ?? POSTING_WAIT_MS)).toISOString() });
  if (!fresh) await extractLocal(db, deps, userId, postingId, { title: p.title, company: p.company, body: p.body }, counts);
  queuePosting(db, userId, postingId, input, need);
  return [];
}

async function extractLocal(db: DatabaseSync, deps: PipelineDeps, userId: string, postingId: string, p: { title: string; company: string; body: string }, counts: Counts) {
  // 상한을 넘으면 이번 실행에서는 뽑지 않는다(본문 조건 미확인으로 판정, 다음 실행·내 AI가 다시 본다).
  if ((counts.localExtracts ?? 0) >= LOCAL_EXTRACT_LIMIT) return;
  counts.localExtracts = (counts.localExtracts ?? 0) + 1;
  try {
    const result = await deps.extract(p, teacherHints(db, p.title));
    saveSample(db, userId, postingId, postingTaskInput({ id: postingId, ...p }), 'local', result, await postingModel());
    saveRequirements(db, userId, postingId, result, 'local');
  } catch (error) { countFailure(counts, error); }
}

/** 내 AI 일을 기다린 뒤, 끝나지 않은 공고는 로컬로 뽑고 그 일은 승격 일로 남긴다. */
async function settleRemote(db: DatabaseSync, deps: PipelineDeps, userId: string, ids: string[], counts: Counts) {
  if (!ids.length) return;
  const rest = await waitTasks(db, userId, ids, deps.waitMs ?? POSTING_WAIT_MS);
  // 실행기가 지금도 일하고 있으면(1분 조회 중) 남은 공고를 로컬로 중복 처리하지 않고 내 AI가 마저 하게 둔다(끝나면 다시 판정).
  const busy = aiState(db, userId).active && Boolean(db.prepare("SELECT 1 FROM ai_tasks WHERE user_id = ? AND status = '실행중'").get(userId));
  for (const id of rest) {
    const task = db.prepare("SELECT kind, ref, input FROM ai_tasks WHERE id = ? AND user_id = ?").get(id, userId) as { kind: string; ref: string; input: string } | undefined;
    if (!task) continue;
    if (task.kind === 'posting' && !busy) {
      const has = db.prepare('SELECT requirements FROM postings WHERE id = ? AND owner_user_id = ?').get(task.ref, userId) as { requirements: string | null } | undefined;
      if (has && !(has.requirements && JSON.parse(has.requirements).version === REQUIREMENTS_PROMPT_VERSION)) {
        const { title, company, body } = JSON.parse(task.input) as { title: string; company: string; body: string };
        await extractLocal(db, deps, userId, task.ref, { title, company, body }, counts);
      }
    }
    db.prepare('UPDATE ai_tasks SET fallback_at = NULL WHERE id = ? AND user_id = ?').run(id, userId);
  }
}

/** 이력서(필수)와 경력기술서·포트폴리오(선택)의 사용 중 버전 MD를 합친 글. 지원자 추출(추천·프로필 초안 공용)의 입력이다. 이력서가 없으면 undefined. */
export function documentsText(db: DatabaseSync, userId: string) {
  const docs = db.prepare("SELECT id, kind, text FROM documents WHERE user_id = ? AND active = 1 ORDER BY CASE kind WHEN 'resume' THEN 0 WHEN 'career' THEN 1 ELSE 2 END").all(userId) as { id: string; kind: string; text: string }[];
  if (!docs.some(d => d.kind === 'resume')) return undefined;
  const titles: Record<string, string> = { resume: '이력서', career: '경력기술서', portfolio: '포트폴리오' };
  return { ids: docs.map(d => d.id), text: docs.map(d => `# ${titles[d.kind] ?? d.kind}\n${d.text}`).join('\n\n') };
}

function loadUserBasis(db: DatabaseSync, userId: string) {
  const profileRow = db.prepare('SELECT data, updated_at FROM profiles WHERE user_id = ?').get(userId) as { data: string; updated_at: string } | undefined;
  const combined = documentsText(db, userId);
  if (!profileRow || !combined) return undefined;
  const { text } = combined;
  // 서류를 고치면(교체·MD 수정) 본문 해시가 바뀌어 다시 판정한다.
  const resume = { id: `${combined.ids.join('+')}:${createHash('sha256').update(text).digest('hex').slice(0, 16)}`, text };
  const profile = profileSchema.parse(JSON.parse(profileRow.data));
  // 프로필·이력서·추출 지시·규칙과 저장된 지원자 사실(로컬 → 내 AI로 바뀌면)이 바뀌면 다시 판정한다. 과거 판정을 새 기준으로 위장하지 않는다.
  const facts = db.prepare('SELECT provider, created_at FROM candidate_facts WHERE user_id = ? AND docs_key = ?').get(userId, docsKey(text)) as { provider: string; created_at: string } | undefined;
  return { profile, resume, basis: `${profileRow.updated_at}|${resume.id}|${CANDIDATE_PROMPT_VERSION}|${REQUIREMENTS_PROMPT_VERSION}|${RULES_VERSION}|${facts ? `${facts.provider}@${facts.created_at}` : 'none'}` };
}

// 필터용 공고 사실(저장된 값만 쓴다).
export function rowFacts(row: Pick<PostingRow, 'location' | 'remote' | 'careers' | 'requirements' | 'company'>) {
  const req = row.requirements ? JSON.parse(row.requirements) as Partial<Requirements> : null;
  return { location: row.location, remote: row.remote === null ? (req?.remote === '전면' ? true : null) : row.remote === 1, careers: JSON.parse(row.careers), employmentTypes: req?.employmentTypes, company: row.company };
}

// 저장된 공고 사실을 규칙 입력으로 바꾼다. 이전 형식 추출 결과는 본문 조건 미확인으로 둔다(다시 수집하면 새로 추출).
function postingInput(row: PostingRow): PostingInput {
  const raw = row.requirements ? JSON.parse(row.requirements) as Partial<Requirements> & { version?: string } : null;
  const req = raw?.version === REQUIREMENTS_PROMPT_VERSION ? raw as Requirements : null;
  return {
    families: req ? req.jobFamilies : null, required: req ? req.required : null, preferred: req?.preferred ?? [],
    careers: JSON.parse(row.careers), location: row.location,
    remote: row.remote === null ? (req?.remote ?? null) : row.remote ? '전면' : '없음',
    // 사용자가 마감을 확인했으면 그 시각을 마감으로 본다(규칙이 마감으로 제외).
    title: row.title, deadline: row.closed_at ?? row.deadline, alwaysHire: !row.closed_at && row.always_hire === 1, companyType: row.company_type,
    salary: req?.salary ?? null,
    bodyNote: req ? null : `본문 조건 미확인(${BODY_FAILURES[row.body_failure ?? ''] ?? '본문을 읽지 못함'})`,
  };
}

// 지원자 사실은 서류 묶음별로 저장한 것(내 AI 우선)을 쓰고 없을 때만 로컬로 뽑는다. 사용자가 확인한 프로필 직무 경력이 있으면 그 기간을 쓴다.
async function candidateFacts(db: DatabaseSync, userId: string, deps: PipelineDeps, basis: { profile: Profile; resume: { text: string } }): Promise<Candidate> {
  const { facts: c } = await candidateFor(db, userId, basis.resume.text, deps.candidate);
  const confirmed = basis.profile.experiences.map(e => ({ family: e.jobFamily, months: Math.round(e.years * 12) }));
  const careers = c.careers.map(r => ({ ...r, months: confirmed.find(e => e.family === r.family)?.months ?? r.months }));
  for (const e of confirmed) if (!careers.some(r => r.family === e.family)) careers.push({ ...e, stack: [] });
  return { ...c, careers, skills: [...c.skills, ...basis.profile.skills], text: basis.resume.text };
}

/** 공고 하나의 상세를 다시 읽어 마감·조건을 갱신한다. 없어진 공고(404·410)는 지금 마감으로 둔다. 확인했으면 true, 차단·연결·해석 실패면 false(다음에 다시 본다). */
export async function recheckPosting(db: DatabaseSync, userId: string, p: { id: string; source: SourceId; source_id: string }, fetchOne = defaultDeps.fetchOne) {
  try {
    const fetched = await fetchOne[p.source](p.source_id);
    if (!('code' in fetched)) {
      upsertPosting(db, fetched, 'auto', userId);
      // 본문을 다시 읽은 김에, 아직 그 경로로 분석하지 않은 공고는 내 AI 일로 올린다(로컬 결과 승격, Codex·Claude 비교·학습 표본).
      const ai = aiState(db, userId);
      if (fetched.body && ai.registered && ai.settings.sendPostings) {
        queuePosting(db, userId, p.id, postingTaskInput({ id: p.id, title: fetched.title, company: fetched.company, body: fetched.body }), missingProviders(db, userId, p.id, ai.registeredProviders));
      }
      return true;
    }
    if (fetched.code !== 'not_found') return false;
    const at = new Date().toISOString();
    db.prepare('UPDATE postings SET closed_at = COALESCE(closed_at, ?), checked_at = ? WHERE id = ? AND owner_user_id = ?').run(at, at, p.id, userId);
    return true;
  } catch { return false; }
}

/**
 * 노출 공고 마감 재확인(사용자 결정 2026-11-24): 목록에서 빠진 공고는 조기 마감돼도 저장된 마감일이 그대로라(사람인 조기 마감 확인) 상세를 다시 읽는다.
 * 공고를 열 때가 아니라 매일 밤 미리 확인해, 마감된 공고는 사용자가 보기 전에 목록에서 빠진다. 숨김·제외·이미 마감인 공고는 건너뛴다.
 * 공고 갱신이 실행 중이면 출처 요청이 겹치지 않게 null(건너뜀)을 돌려준다. 아니면 확인한 공고 수.
 */
export async function recheckVisible(db: DatabaseSync, now = Date.now(), fetchOne = defaultDeps.fetchOne): Promise<number | null> {
  if (db.prepare("SELECT 1 FROM jobs WHERE kind = 'refresh' AND status = '실행중'").get()) return null;
  resetBlockedHosts();
  const before = new Date(now - RECHECK_AFTER_MS).toISOString();
  const users = db.prepare('SELECT DISTINCT user_id FROM recommendations').all() as { user_id: string }[];
  let rechecked = 0;
  for (const { user_id: userId } of users) {
    const stale = (db.prepare(`SELECT p.id, p.source, p.source_id, p.deadline, p.always_hire FROM postings p JOIN recommendations r ON r.posting_id = p.id AND r.user_id = p.owner_user_id
        WHERE p.owner_user_id = ? AND p.checked_at < ? AND p.closed_at IS NULL AND r.hidden = 0 AND r.classification != '제외' ORDER BY p.checked_at`)
      .all(userId, before) as { id: string; source: SourceId; source_id: string; deadline: string | null; always_hire: number }[])
      .filter(p => p.always_hire === 1 || !p.deadline || !(Date.parse(p.deadline) < now));
    for (const p of stale) if (await recheckPosting(db, userId, p, fetchOne)) rechecked++;
  }
  return rechecked;
}

/**
 * 매일 0시(KST)에 노출 공고 마감 재확인을 한 번 돈다. 서버 안에서 따로 돌아 그 시각에 쓰는 사용자의 화면·요청을 막지 않는다.
 * 1분마다 시각을 보고, 갱신 실행 중이라 건너뛰었으면 0시 안에서 다시 시도한다. 서버가 0시에 꺼져 있었으면 그날은 건너뛴다(다음 날 확인).
 */
export function startRecheck(db: DatabaseSync) {
  let running = false;
  let doneDate = '';
  const timer = setInterval(() => {
    const { date, hour } = seoulParts(new Date());
    if (running || hour !== RECHECK_HOUR || doneDate === date) return;
    running = true;
    recheckVisible(db).then(n => { if (n !== null) doneDate = date; }, () => { doneDate = date; }).finally(() => { running = false; });
  }, 60_000);
  return () => clearInterval(timer);
}

// 판정에 쓰는 저장된 공고 사실의 버전. 나중 수집에서 조건 추출·마감·경력 등이 바뀌면 다시 판정한다(규칙만 다시 돌고 공고 추출은 하지 않음).
export function postingVersion(row: Pick<PostingRow, 'title' | 'deadline' | 'always_hire' | 'location' | 'remote' | 'careers' | 'company_type' | 'requirements' | 'body_failure' | 'closed_at'>) {
  const facts = [row.title, row.deadline, row.always_hire, row.location, row.remote, row.careers, row.company_type, row.requirements, row.body_failure, ...(row.closed_at ? [row.closed_at] : [])];
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 16);
}

async function judgeFor(db: DatabaseSync, deps: PipelineDeps, userId: string, basis: { profile: Profile; resume: { text: string }; basis: string }, rows: PostingRow[], counts: Counts & { judged: number }) {
  const at = new Date().toISOString();
  const keyOf = (row: PostingRow) => `${basis.basis}|${postingVersion(row)}`;
  const pending = rows.filter(row => (db.prepare('SELECT basis FROM recommendations WHERE user_id = ? AND posting_id = ?').get(userId, row.id) as { basis: string } | undefined)?.basis !== keyOf(row));
  if (!pending.length) return;
  let candidate: Candidate;
  try { candidate = await candidateFacts(db, userId, deps, basis); } catch (error) { countFailure(counts, error); return; }
  const seeker = { jobFamilies: basis.profile.jobFamilies, regions: basis.profile.regions, remoteOk: basis.profile.remoteOk, salaryMin: basis.profile.salaryMin };
  for (const row of pending) {
    const j = classify(at, seeker, candidate, postingInput(row));
    // 판정 중 계정이 삭제되면 외래키가 저장을 거부해 추천이 되살아나지 않는다.
    try {
      db.prepare(`INSERT INTO recommendations (user_id, posting_id, basis, classification, judgement, evaluated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, posting_id) DO UPDATE SET basis = excluded.basis, classification = excluded.classification, judgement = excluded.judgement, evaluated_at = excluded.evaluated_at`)
        .run(userId, row.id, keyOf(row), j.classification, JSON.stringify(j), at);
    } catch { return; }
    counts.judged++;
  }
}

export function createHandler(db: DatabaseSync, deps: PipelineDeps = defaultDeps) {
  return async (job: ClaimedJob): Promise<JobOutcome> => {
    const basis = loadUserBasis(db, job.userId);
    if (!basis) return { status: '실패', errorCode: 'profile_or_resume_missing', result: {} };
    // 차단 기록은 실행 단위로 둔다. 다음 실행에서는 다시 한 번 시도한다.
    resetBlockedHosts();
    const counts = { collected: 0, judged: 0, notHiring: 0, duplicates: 0, filteredOut: 0, aiFailures: 0, aiFailureCodes: {} as Record<string, number>, sourceFailures: [] as CollectFailure[], sourceCollected: {} as Record<string, number> };
    // 내 AI(실행기)를 지금 쓸 수 있으면 서류·새 공고를 일로 올리고 수집 뒤 최대 10분 기다린다. 남은 것은 로컬로 처리한다.
    const ai = aiState(db, job.userId);
    const waiting: string[] = [];
    const doc = ai.active ? queueDocuments(db, job.userId, basis.resume.text, ai) : null;
    if (doc) waiting.push(doc);

    if (job.kind === 'link') {
      const link = parsePostingLink((job.payload as { url: string }).url);
      if (!link) return { status: '실패', errorCode: 'unsupported_link', result: {} };
      const fetched = await deps.fetchOne[link.source](link.id);
      if ('code' in fetched) return { status: '실패', errorCode: `fetch_${fetched.code}`, result: {} };
      const id = upsertPosting(db, fetched, 'link', job.userId);
      waiting.push(...await storeRequirements(db, deps, job.userId, id, fetched, counts, ai));
      await settleRemote(db, deps, job.userId, waiting, counts);
      await judgeFor(db, deps, job.userId, loadUserBasis(db, job.userId) ?? basis, [db.prepare('SELECT * FROM postings WHERE id = ? AND owner_user_id = ?').get(id, job.userId) as PostingRow], counts);
      return { status: counts.aiFailures ? '일부 실패' : '성공', result: { postingId: id, judged: counts.judged, aiFailures: counts.aiFailures, aiFailureCodes: counts.aiFailureCodes } };
    }

    const families = basis.profile.jobFamilies;
    // 이미 현재 지시문으로 분석해 둔 공고는 상세를 다시 받지 않고 새 공고로 자리를 채운다(마감은 0시 재확인이 본다).
    // 점핏 공고 번호는 사람인과 같아 사람인으로 받은 공고도 건너뛴다.
    const analyzed = (source: SourceId) => (id: string) => {
      const row = db.prepare('SELECT requirements FROM postings WHERE source = ? AND source_id = ? AND owner_user_id = ?').get(source, id, job.userId) as { requirements: string | null } | undefined;
      const twin = SAME_POSTING[source];
      if (twin && db.prepare('SELECT 1 FROM postings WHERE source = ? AND source_id = ? AND owner_user_id = ?').get(twin, id, job.userId)) return true;
      return Boolean(row?.requirements && (JSON.parse(row.requirements) as { version?: string }).version === REQUIREMENTS_PROMPT_VERSION);
    };
    // 다른 출처에 이미 있는 같은 공고(회사·제목)는 다시 저장·분석하지 않는다(2026-11-28, 목록도 하나만 보임).
    const seen = new Map((db.prepare('SELECT source, source_id, company, title FROM postings WHERE owner_user_id = ?').all(job.userId) as { source: string; source_id: string; company: string; title: string }[])
      .map(r => [postingKey(r.company, r.title), r.source] as const));
    const runs: [SourceId, () => Promise<Collected>][] = [];
    for (const family of families) {
      for (const source of ['saramin', 'jobkorea', 'wanted', 'jumpit'] as const) {
        if (source === 'jumpit' && !DEV_FAMILIES.includes(family)) continue;
        runs.push([source, () => deps.collect[source](family, PER_FAMILY, basis.profile, analyzed(source))]);
      }
    }
    // 출처끼리는 순서대로 요청한다(같은 출처에 동시 요청을 만들지 않는다).
    // 진행: 끝낸 출처·직무 묶음 수와 지금까지 걸린 시간으로 남은 시간을 어림한다(공고 수·AI 속도가 묶음마다 달라 대략값).
    const started = Date.now();
    const progress = (done: number) => reportProgress(db, job.id, { done, total: runs.length, collected: counts.collected, etaSeconds: done ? Math.round((Date.now() - started) / done * (runs.length - done) / 1000) : null });
    progress(0);
    for (const [index, [source, run]] of runs.entries()) {
      // 출처 하나의 예외(응답 해석 실패 등)는 그 출처 실패로 기록하고 다음 출처를 계속한다.
      let collected: Collected;
      try { collected = await run(); } catch (error) { collected = { postings: [], failures: [{ source, code: failureCode(error) }] }; }
      const { postings, failures } = collected;
      counts.sourceFailures.push(...failures);
      for (const p of postings) counts.sourceCollected[p.source] = (counts.sourceCollected[p.source] ?? 0) + 1;
      for (const p of postings) {
        if (isNotHiring(p.title)) { counts.notHiring++; continue; }
        // 점핏 공고 ID는 사람인 공고 번호와 같다. 같은 공고를 두 출처로 두 번 저장·판정하지 않는다.
        const twin = SAME_POSTING[p.source];
        if (twin && db.prepare('SELECT 1 FROM postings WHERE source = ? AND source_id = ? AND owner_user_id = ?').get(twin, p.sourceId, job.userId)) continue;
        const key = postingKey(p.company, p.title);
        if ((seen.get(key) ?? p.source) !== p.source) { counts.duplicates++; continue; }
        seen.set(key, p.source);
        const id = upsertPosting(db, p, 'auto', job.userId);
        waiting.push(...await storeRequirements(db, deps, job.userId, id, p, counts, ai));
        counts.collected++;
      }
      progress(index + 1);
    }
    await settleRemote(db, deps, job.userId, waiting, counts);
    // 기다리는 동안 내 AI 서류 결과가 들어왔으면 판정 기준도 바뀐다.
    const judged = loadUserBasis(db, job.userId) ?? basis;
    const rows = db.prepare('SELECT p.* FROM postings p WHERE p.owner_user_id = ? ORDER BY p.checked_at DESC').all(job.userId) as PostingRow[];
    // 사용자 필터에 맞지 않는 공고는 판정하지 않는다(요금 절감). 사용자가 넣은 링크 공고는 거르지 않는다. 고용 형태는 본문 추출 결과로 거른다.
    const matching = rows.filter(row => row.acquired_by === 'link' || passesFilter(rowFacts(row), judged.profile));
    counts.filteredOut = rows.length - matching.length;
    await judgeFor(db, deps, job.userId, judged, matching, counts);
    const failed = counts.sourceFailures.length > 0 || counts.aiFailures > 0;
    const result = { collected: counts.collected, judged: counts.judged, notHiring: counts.notHiring, duplicates: counts.duplicates, filteredOut: counts.filteredOut, aiFailures: counts.aiFailures, aiFailureCodes: counts.aiFailureCodes, sourceFailures: counts.sourceFailures.map(f => `${f.source}:${f.code}`),
      // 출처별로 받은 공고 수(일부 실패와 전체 실패를 가르는 데 씀)와 실패한 공고 번호(원인 확인용, 원문 아님).
      sourceCollected: counts.sourceCollected, sourceFailureIds: counts.sourceFailures.filter(f => f.id).map(f => `${f.source}:${f.id}`) };
    if (counts.collected === 0 && failed) return { status: '실패', errorCode: 'collect_failed', result };
    return { status: failed ? '일부 실패' : '성공', result };
  };
}

/**
 * 내 AI 결과가 들어오면 그 사용자 공고를 다시 판정한다(규칙만, AI 호출 없음). 지원자 사실이 아직 없으면 넘어간다.
 * 공고 갱신·링크 판정이 실행 중이면 그 작업이 판정하므로 건너뛴다.
 */
export async function rejudge(db: DatabaseSync, userId: string) {
  if (db.prepare("SELECT 1 FROM jobs WHERE user_id = ? AND kind IN ('refresh', 'link') AND status = '실행중'").get(userId)) return 0;
  const basis = loadUserBasis(db, userId);
  if (!basis) return 0;
  const rows = db.prepare('SELECT p.* FROM postings p WHERE p.owner_user_id = ?').all(userId) as PostingRow[];
  const matching = rows.filter(row => row.acquired_by === 'link' || passesFilter(rowFacts(row), basis.profile));
  const counts = { judged: 0, aiFailures: 0, aiFailureCodes: {} as Record<string, number> };
  await judgeFor(db, { ...defaultDeps, candidate: async () => { throw new Error('candidate_not_ready'); } }, userId, basis, matching, counts);
  return counts.judged;
}
