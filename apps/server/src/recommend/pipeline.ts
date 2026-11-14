import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { profileSchema, type JobFamily, type Profile, type SourceId } from '@nextstep/contracts';
import { resetBlockedHosts } from '../sources/http.js';
import type { CollectedPosting, CollectFailure } from '../sources/types.js';
import { collectJobkorea, fetchJobkorea } from '../sources/jobkorea.js';
import { collectWanted, fetchWanted } from '../sources/wanted.js';
import { collectSaramin, fetchSaramin } from '../sources/saramin.js';
import { collectJumpit, fetchJumpit } from '../sources/jumpit.js';
import { DEV_FAMILIES } from '../sources/types.js';
import { collectJasoseol, fetchJasoseol } from '../sources/jasoseol.js';
import { extractRequirements, REQUIREMENTS_PROMPT_VERSION, type Requirements } from '../prompts/requirements.js';
import { extractCandidate, CANDIDATE_PROMPT_VERSION, type Candidate } from '../prompts/candidate.js';
import { classify, RULES_VERSION, type PostingInput } from './classify.js';
import type { ClaimedJob, JobOutcome } from './jobs.js';
import { passesFilter } from '../sources/filter.js';

type Collected = { postings: CollectedPosting[]; failures: CollectFailure[] };
export type PipelineDeps = {
  collect: { saramin: (f: JobFamily, n: number, p: Profile) => Promise<Collected>; wanted: (f: JobFamily, n: number, p: Profile) => Promise<Collected>; jumpit: (f: JobFamily, n: number, p: Profile) => Promise<Collected>; jobkorea: (f: JobFamily, n: number, p: Profile) => Promise<Collected>; jasoseol: (f: JobFamily[], cap: number) => Promise<Collected> };
  fetchOne: Record<SourceId, (id: string) => Promise<CollectedPosting | CollectFailure>>;
  extract: (posting: { title: string; company: string; body: string }) => Promise<Requirements>;
  candidate: (text: string) => Promise<Candidate>;
};
export const defaultDeps: PipelineDeps = {
  // 자동 수집 출처(기획서 0.2.4): 사람인·잡코리아·원티드·자소설닷컴·점핏. 점핏은 개발 직무만.
  collect: { saramin: collectSaramin, jobkorea: collectJobkorea, wanted: collectWanted, jumpit: collectJumpit, jasoseol: collectJasoseol },
  fetchOne: { saramin: fetchSaramin, jobkorea: fetchJobkorea, wanted: fetchWanted, jumpit: fetchJumpit, jasoseol: fetchJasoseol },
  extract: extractRequirements,
  candidate: extractCandidate,
};

// 실행당 요청·판정 상한(출처 부담·요금 제한).
const PER_FAMILY = 5;
// 자소설닷컴은 직무별 목록에서 직무당 이 수만큼 상세를 읽는다.
const JASOSEOL_PER_FAMILY = 5;
// 채용이 아닌 교육·부트캠프 모집은 공고로 받지 않는다(자소설닷컴 직무별 목록에 섞여 나온다).
const NOT_HIRING = /교육생|수강생|훈련생|부트캠프|클래스메이트|국비\s*(?:지원|교육)|\d+기\s*모집/;
export const isNotHiring = (title: string) => NOT_HIRING.test(title);
// 실패 원인 코드만 센다(요청 본문은 남기지 않는다).
const failureCode = (error: unknown) => (error as { code?: string }).code ?? 'internal';
type Counts = { aiFailures: number; aiFailureCodes: Record<string, number> };
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
  if (host === 'jasoseol.com' || host === 'www.jasoseol.com') { const id = match(/^\/recruit\/(\d+)/); return id ? { source: 'jasoseol', id } : undefined; }
  return undefined;
}

const SAME_POSTING: Partial<Record<SourceId, SourceId>> = { saramin: 'jumpit', jumpit: 'saramin' };

type PostingRow = { id: string; source: SourceId; title: string; company: string; deadline: string | null; always_hire: number; location: string | null; remote: number | null; careers: string; company_type: string | null; employee_count: number | null; requirements: string | null; body_failure: string | null; acquired_by: 'auto' | 'link'; owner_user_id: string };

// 공고는 갱신을 요청한 사용자의 자료로만 저장한다. 다른 사용자와 공유하지 않는다(사용자 결정 2026-11-10).
function upsertPosting(db: DatabaseSync, p: CollectedPosting, acquiredBy: 'auto' | 'link', ownerUserId: string) {
  const at = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM postings WHERE source = ? AND source_id = ? AND owner_user_id = ?').get(p.source, p.sourceId, ownerUserId) as { id: string } | undefined;
  const values = [p.url, p.title, p.company, p.deadline, p.alwaysHire ? 1 : 0, p.location, p.remote === null ? null : p.remote ? 1 : 0, JSON.stringify(p.careers), p.companyType, p.employeeCount, p.externalApplyUrl, p.bodyFailure, acquiredBy, at] as const;
  if (existing) {
    // 사용자가 링크로 넣은 공고는 자동 수집에 다시 걸려도 링크 공고로 둔다(필터로 숨기지 않음).
    db.prepare("UPDATE postings SET url = ?, title = ?, company = ?, deadline = ?, always_hire = ?, location = ?, remote = ?, careers = ?, company_type = ?, employee_count = ?, external_apply_url = ?, body_failure = ?, acquired_by = CASE acquired_by WHEN 'link' THEN 'link' ELSE ? END, checked_at = ? WHERE id = ?").run(...values, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  db.prepare('INSERT INTO postings (id, source, source_id, owner_user_id, url, title, company, deadline, always_hire, location, remote, careers, company_type, employee_count, external_apply_url, body_failure, acquired_by, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, p.source, p.sourceId, ownerUserId, ...values);
  return id;
}

// 원문은 조건 추출에만 쓰고 버린다. 추출 결과(구조화 사실)만 저장한다.
async function storeRequirements(db: DatabaseSync, deps: PipelineDeps, postingId: string, p: CollectedPosting, counts: Counts) {
  const row = db.prepare('SELECT requirements FROM postings WHERE id = ?').get(postingId) as { requirements: string | null };
  if (row.requirements && JSON.parse(row.requirements).version === REQUIREMENTS_PROMPT_VERSION) return;
  if (!p.body) return;
  try {
    const req = await deps.extract({ title: p.title, company: p.company, body: p.body });
    db.prepare('UPDATE postings SET requirements = ? WHERE id = ?').run(JSON.stringify({ version: REQUIREMENTS_PROMPT_VERSION, ...req }), postingId);
  } catch (error) {
    countFailure(counts, error);
  }
}

function loadUserBasis(db: DatabaseSync, userId: string) {
  const profileRow = db.prepare('SELECT data, updated_at FROM profiles WHERE user_id = ?').get(userId) as { data: string; updated_at: string } | undefined;
  const resume = db.prepare("SELECT id, text FROM documents WHERE user_id = ? AND kind = 'resume'").get(userId) as { id: string; text: string } | undefined;
  if (!profileRow || !resume) return undefined;
  const profile = profileSchema.parse(JSON.parse(profileRow.data));
  // 프로필·이력서·추출 지시·규칙이 바뀌면 다시 판정한다. 과거 판정을 새 기준으로 위장하지 않는다.
  return { profile, resume, basis: `${profileRow.updated_at}|${resume.id}|${CANDIDATE_PROMPT_VERSION}|${REQUIREMENTS_PROMPT_VERSION}|${RULES_VERSION}` };
}

// 필터용 공고 사실(저장된 값만 쓴다).
export function rowFacts(row: Pick<PostingRow, 'location' | 'remote' | 'careers' | 'requirements'>) {
  const req = row.requirements ? JSON.parse(row.requirements) as Partial<Requirements> : null;
  return { location: row.location, remote: row.remote === null ? (req?.remote === '전면' ? true : null) : row.remote === 1, careers: JSON.parse(row.careers), employmentTypes: req?.employmentTypes };
}

// 저장된 공고 사실을 규칙 입력으로 바꾼다. 이전 형식 추출 결과는 본문 조건 미확인으로 둔다(다시 수집하면 새로 추출).
function postingInput(row: PostingRow): PostingInput {
  const raw = row.requirements ? JSON.parse(row.requirements) as Partial<Requirements> & { version?: string } : null;
  const req = raw?.version === REQUIREMENTS_PROMPT_VERSION ? raw as Requirements : null;
  return {
    families: req ? req.jobFamilies : null, required: req ? req.required : null, preferred: req?.preferred ?? [],
    careers: JSON.parse(row.careers), location: row.location,
    remote: row.remote === null ? (req?.remote ?? null) : row.remote ? '전면' : '없음',
    deadline: row.deadline, alwaysHire: row.always_hire === 1, companyType: row.company_type,
    bodyNote: req ? null : `본문 조건 미확인(${row.body_failure ?? '추출 전 형식 또는 추출 실패'})`,
  };
}

// 지원자 사실은 갱신마다 서류에서 한 번 뽑는다. 사용자가 확인한 프로필 직무 경력이 있으면 그 기간을 쓴다.
// ponytail: 갱신마다 1회 호출. 로컬 LLM이 느려 부담되면 서류 ID별로 저장해 재사용한다.
async function candidateFacts(deps: PipelineDeps, basis: { profile: Profile; resume: { text: string } }): Promise<Candidate> {
  const c = await deps.candidate(basis.resume.text);
  const confirmed = basis.profile.experiences.map(e => ({ family: e.jobFamily, months: Math.round(e.years * 12) }));
  const careers = c.careers.map(r => ({ ...r, months: confirmed.find(e => e.family === r.family)?.months ?? r.months }));
  for (const e of confirmed) if (!careers.some(r => r.family === e.family)) careers.push({ ...e, stack: [] });
  return { ...c, careers, skills: [...c.skills, ...basis.profile.skills] };
}

async function judgeFor(db: DatabaseSync, deps: PipelineDeps, userId: string, basis: { profile: Profile; resume: { text: string }; basis: string }, rows: PostingRow[], counts: Counts & { judged: number }) {
  const at = new Date().toISOString();
  const pending = rows.filter(row => (db.prepare('SELECT basis FROM recommendations WHERE user_id = ? AND posting_id = ?').get(userId, row.id) as { basis: string } | undefined)?.basis !== basis.basis);
  if (!pending.length) return;
  let candidate: Candidate;
  try { candidate = await candidateFacts(deps, basis); } catch (error) { countFailure(counts, error); return; }
  const seeker = { jobFamilies: basis.profile.jobFamilies, regions: basis.profile.regions, remoteOk: basis.profile.remoteOk };
  for (const row of pending) {
    const j = classify(at, seeker, candidate, postingInput(row));
    // 판정 중 계정이 삭제되면 외래키가 저장을 거부해 추천이 되살아나지 않는다.
    try {
      db.prepare(`INSERT INTO recommendations (user_id, posting_id, basis, classification, judgement, evaluated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, posting_id) DO UPDATE SET basis = excluded.basis, classification = excluded.classification, judgement = excluded.judgement, evaluated_at = excluded.evaluated_at`)
        .run(userId, row.id, basis.basis, j.classification, JSON.stringify(j), at);
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
    const counts = { collected: 0, judged: 0, notHiring: 0, filteredOut: 0, aiFailures: 0, aiFailureCodes: {} as Record<string, number>, sourceFailures: [] as CollectFailure[] };

    if (job.kind === 'link') {
      const link = parsePostingLink((job.payload as { url: string }).url);
      if (!link) return { status: '실패', errorCode: 'unsupported_link', result: {} };
      const fetched = await deps.fetchOne[link.source](link.id);
      if ('code' in fetched) return { status: '실패', errorCode: `fetch_${fetched.code}`, result: {} };
      const id = upsertPosting(db, fetched, 'link', job.userId);
      await storeRequirements(db, deps, id, fetched, counts);
      await judgeFor(db, deps, job.userId, basis, [db.prepare('SELECT * FROM postings WHERE id = ?').get(id) as PostingRow], counts);
      return { status: counts.aiFailures ? '일부 실패' : '성공', result: { postingId: id, judged: counts.judged, aiFailures: counts.aiFailures, aiFailureCodes: counts.aiFailureCodes } };
    }

    const families = basis.profile.jobFamilies;
    const runs: (() => Promise<Collected>)[] = [];
    for (const family of families) {
      runs.push(() => deps.collect.saramin(family, PER_FAMILY, basis.profile));
      runs.push(() => deps.collect.jobkorea(family, PER_FAMILY, basis.profile));
      runs.push(() => deps.collect.wanted(family, PER_FAMILY, basis.profile));
      if (DEV_FAMILIES.includes(family)) runs.push(() => deps.collect.jumpit(family, PER_FAMILY, basis.profile));
    }
    runs.push(() => deps.collect.jasoseol(families, JASOSEOL_PER_FAMILY));
    // 출처끼리는 순서대로 요청한다(같은 출처에 동시 요청을 만들지 않는다).
    for (const run of runs) {
      const { postings, failures } = await run();
      counts.sourceFailures.push(...failures);
      for (const p of postings) {
        if (isNotHiring(p.title)) { counts.notHiring++; continue; }
        // 점핏 공고 ID는 사람인 공고 번호와 같다. 같은 공고를 두 출처로 두 번 저장·판정하지 않는다.
        const twin = SAME_POSTING[p.source];
        if (twin && db.prepare('SELECT 1 FROM postings WHERE source = ? AND source_id = ? AND owner_user_id = ?').get(twin, p.sourceId, job.userId)) continue;
        const id = upsertPosting(db, p, 'auto', job.userId);
        await storeRequirements(db, deps, id, p, counts);
        counts.collected++;
      }
    }
    const rows = db.prepare('SELECT p.* FROM postings p WHERE p.owner_user_id = ? ORDER BY p.checked_at DESC').all(job.userId) as PostingRow[];
    // 사용자 필터에 맞지 않는 공고는 판정하지 않는다(요금 절감). 사용자가 넣은 링크 공고는 거르지 않는다. 고용 형태는 본문 추출 결과로 거른다.
    const matching = rows.filter(row => row.acquired_by === 'link' || passesFilter(rowFacts(row), basis.profile));
    counts.filteredOut = rows.length - matching.length;
    await judgeFor(db, deps, job.userId, basis, matching, counts);
    const failed = counts.sourceFailures.length > 0 || counts.aiFailures > 0;
    const result = { collected: counts.collected, judged: counts.judged, notHiring: counts.notHiring, filteredOut: counts.filteredOut, aiFailures: counts.aiFailures, aiFailureCodes: counts.aiFailureCodes, sourceFailures: counts.sourceFailures.map(f => `${f.source}:${f.code}`) };
    if (counts.collected === 0 && failed) return { status: '실패', errorCode: 'collect_failed', result };
    return { status: failed ? '일부 실패' : '성공', result };
  };
}
