import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { profileSchema, SOURCE_POLICY, type JobFamily, type Profile, type SourceId } from '@nextstep/contracts';
import { readCollectionMode } from '../sources/policy.js';
import { resetBlockedHosts } from '../sources/http.js';
import type { CollectedPosting, CollectFailure } from '../sources/types.js';
import { collectJobkorea, fetchJobkorea } from '../sources/jobkorea.js';
import { collectWanted, fetchWanted } from '../sources/wanted.js';
import { collectJasoseol, fetchJasoseol } from '../sources/jasoseol.js';
import { extractRequirements, REQUIREMENTS_PROMPT_VERSION, type Requirements } from '../prompts/requirements.js';
import { judge, RECOMMEND_PROMPT_VERSION, type Judgement } from '../prompts/recommend.js';
import type { ClaimedJob, JobOutcome } from './jobs.js';

type Collected = { postings: CollectedPosting[]; failures: CollectFailure[] };
export type PipelineDeps = {
  collect: { jobkorea: (f: JobFamily, n: number) => Promise<Collected>; wanted: (f: JobFamily, n: number) => Promise<Collected>; jasoseol: (f: JobFamily[], cap: number) => Promise<Collected> };
  fetchOne: Record<SourceId, (id: string) => Promise<CollectedPosting | CollectFailure>>;
  extract: (posting: { title: string; company: string; body: string }) => Promise<Requirements>;
  judge: (evaluatedAt: string, candidate: unknown, posting: unknown) => Promise<Judgement>;
};
export const defaultDeps: PipelineDeps = {
  collect: { jobkorea: collectJobkorea, wanted: collectWanted, jasoseol: collectJasoseol },
  fetchOne: { jobkorea: fetchJobkorea, wanted: fetchWanted, jasoseol: fetchJasoseol },
  extract: extractRequirements,
  judge,
};

// 실행당 요청·판정 상한(출처 부담·요금 제한).
const PER_FAMILY = 5;
// 자소설닷컴은 직무별 목록에서 직무당 이 수만큼 상세를 읽는다.
const JASOSEOL_PER_FAMILY = 5;
const JUDGE_CAP = 40;

// 사용자가 넣는 링크에서 출처와 공고 ID를 찾는다. 지원 출처가 아니면 undefined.
export function parsePostingLink(raw: string): { source: SourceId; id: string } | undefined {
  let url: URL;
  try { url = new URL(raw); } catch { return undefined; }
  if (url.protocol !== 'https:') return undefined;
  const host = url.hostname.toLowerCase();
  const match = (re: RegExp) => url.pathname.match(re)?.[1];
  if (host === 'www.jobkorea.co.kr' || host === 'm.jobkorea.co.kr') { const id = match(/^\/Recruit\/GI_Read\/(\d+)/i); return id ? { source: 'jobkorea', id } : undefined; }
  if (host === 'www.wanted.co.kr' || host === 'wanted.co.kr') { const id = match(/^\/wd\/(\d+)/); return id ? { source: 'wanted', id } : undefined; }
  if (host === 'jasoseol.com' || host === 'www.jasoseol.com') { const id = match(/^\/recruit\/(\d+)/); return id ? { source: 'jasoseol', id } : undefined; }
  return undefined;
}

type PostingRow = { id: string; source: SourceId; title: string; company: string; deadline: string | null; always_hire: number; location: string | null; remote: number | null; careers: string; company_type: string | null; employee_count: number | null; requirements: string | null; body_failure: string | null; collected_mode: string; owner_user_id: string | null };

function upsertPosting(db: DatabaseSync, p: CollectedPosting, mode: string, ownerUserId: string | null) {
  const at = new Date().toISOString();
  const existing = db.prepare("SELECT id FROM postings WHERE source = ? AND source_id = ? AND ifnull(owner_user_id, '') = ?").get(p.source, p.sourceId, ownerUserId ?? '') as { id: string } | undefined;
  const values = [p.url, p.title, p.company, p.deadline, p.alwaysHire ? 1 : 0, p.location, p.remote === null ? null : p.remote ? 1 : 0, JSON.stringify(p.careers), p.companyType, p.employeeCount, p.externalApplyUrl, p.bodyFailure, mode, at] as const;
  if (existing) {
    db.prepare('UPDATE postings SET url = ?, title = ?, company = ?, deadline = ?, always_hire = ?, location = ?, remote = ?, careers = ?, company_type = ?, employee_count = ?, external_apply_url = ?, body_failure = ?, collected_mode = ?, checked_at = ? WHERE id = ?').run(...values, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  db.prepare('INSERT INTO postings (id, source, source_id, owner_user_id, url, title, company, deadline, always_hire, location, remote, careers, company_type, employee_count, external_apply_url, body_failure, collected_mode, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, p.source, p.sourceId, ownerUserId, ...values);
  return id;
}

// 원문은 조건 추출에만 쓰고 버린다. 추출 결과(구조화 사실)만 저장한다.
async function storeRequirements(db: DatabaseSync, deps: PipelineDeps, postingId: string, p: CollectedPosting, counts: { aiFailures: number }) {
  const row = db.prepare('SELECT requirements FROM postings WHERE id = ?').get(postingId) as { requirements: string | null };
  if (row.requirements && JSON.parse(row.requirements).version === REQUIREMENTS_PROMPT_VERSION) return;
  if (!p.body) return;
  try {
    const req = await deps.extract({ title: p.title, company: p.company, body: p.body });
    db.prepare('UPDATE postings SET requirements = ? WHERE id = ?').run(JSON.stringify({ version: REQUIREMENTS_PROMPT_VERSION, ...req }), postingId);
  } catch {
    counts.aiFailures++;
  }
}

function loadUserBasis(db: DatabaseSync, userId: string) {
  const profileRow = db.prepare('SELECT data, updated_at FROM profiles WHERE user_id = ?').get(userId) as { data: string; updated_at: string } | undefined;
  const resume = db.prepare("SELECT id, text FROM documents WHERE user_id = ? AND kind = 'resume'").get(userId) as { id: string; text: string } | undefined;
  if (!profileRow || !resume) return undefined;
  const profile = profileSchema.parse(JSON.parse(profileRow.data));
  // 프로필·이력서·프롬프트가 바뀌면 다시 판정한다. 과거 판정을 새 기준으로 위장하지 않는다.
  return { profile, resume, basis: `${profileRow.updated_at}|${resume.id}|${RECOMMEND_PROMPT_VERSION}` };
}

function postingFacts(row: PostingRow) {
  const req = row.requirements ? JSON.parse(row.requirements) as Requirements : null;
  return {
    title: row.title, company: row.company, deadline: row.deadline, alwaysHire: row.always_hire === 1,
    location: row.location ?? '미기재', remote: req?.remote ?? (row.remote === null ? '미기재' : row.remote ? '전면' : '없음'),
    careers: JSON.parse(row.careers), companyType: row.company_type, employeeCount: row.employee_count,
    jobFamilies: req?.jobFamilies ?? [], required: req?.required ?? [], preferred: req?.preferred ?? [],
    portfolioRequired: req?.portfolioRequired ?? false,
    bodyStatus: req ? '본문 조건 추출됨' : `본문 미확인(${row.body_failure ?? '추출 실패'})`,
  };
}

async function judgeFor(db: DatabaseSync, deps: PipelineDeps, userId: string, basis: { profile: Profile; resume: { text: string }; basis: string }, rows: PostingRow[], counts: { judged: number; aiFailures: number }) {
  const at = new Date().toISOString();
  const candidate = { profile: basis.profile, resumeExcerpt: basis.resume.text.slice(0, 8000) };
  for (const row of rows.slice(0, JUDGE_CAP)) {
    const prior = db.prepare('SELECT basis FROM recommendations WHERE user_id = ? AND posting_id = ?').get(userId, row.id) as { basis: string } | undefined;
    if (prior?.basis === basis.basis) continue;
    let j: Judgement;
    try { j = await deps.judge(at, candidate, postingFacts(row)); } catch { counts.aiFailures++; continue; }
    // 판정 중 계정이 삭제되면 외래키가 저장을 거부해 추천이 되살아나지 않는다.
    db.prepare(`INSERT INTO recommendations (user_id, posting_id, basis, classification, judgement, evaluated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, posting_id) DO UPDATE SET basis = excluded.basis, classification = excluded.classification, judgement = excluded.judgement, evaluated_at = excluded.evaluated_at`)
      .run(userId, row.id, basis.basis, j.classification, JSON.stringify(j), at);
    counts.judged++;
  }
}

// 서비스 모드에서는 개인 모드로 모은 원티드·자소설닷컴 공고를 추천 대상에서 뺀다.
export function visiblePostingsSql(mode: 'service' | 'personal') {
  return mode === 'service' ? "AND NOT (p.owner_user_id IS NULL AND p.source IN ('wanted', 'jasoseol') AND p.collected_mode = 'personal')" : '';
}

export function createHandler(db: DatabaseSync, deps: PipelineDeps = defaultDeps) {
  return async (job: ClaimedJob): Promise<JobOutcome> => {
    const basis = loadUserBasis(db, job.userId);
    if (!basis) return { status: '실패', errorCode: 'profile_or_resume_missing', result: {} };
    const mode = readCollectionMode(db);
    // 차단 기록은 실행 단위로 둔다. 다음 실행에서는 다시 한 번 시도한다.
    resetBlockedHosts();
    const counts = { collected: 0, judged: 0, aiFailures: 0, sourceFailures: [] as CollectFailure[] };

    if (job.kind === 'link') {
      const link = parsePostingLink((job.payload as { url: string }).url);
      if (!link) return { status: '실패', errorCode: 'unsupported_link', result: {} };
      const fetched = await deps.fetchOne[link.source](link.id);
      if ('code' in fetched) return { status: '실패', errorCode: `fetch_${fetched.code}`, result: {} };
      // 사용자가 넣은 링크로 가져온 공고는 그 사용자 전용이다.
      const id = upsertPosting(db, fetched, mode, job.userId);
      await storeRequirements(db, deps, id, fetched, counts);
      await judgeFor(db, deps, job.userId, basis, [db.prepare('SELECT * FROM postings WHERE id = ?').get(id) as PostingRow], counts);
      return { status: counts.aiFailures ? '일부 실패' : '성공', result: { postingId: id, judged: counts.judged, aiFailures: counts.aiFailures } };
    }

    const families = basis.profile.jobFamilies;
    const runs: (() => Promise<Collected>)[] = [];
    for (const family of families) {
      if (SOURCE_POLICY[mode].jobkorea === 'auto') runs.push(() => deps.collect.jobkorea(family, PER_FAMILY));
      if (SOURCE_POLICY[mode].wanted === 'auto') runs.push(() => deps.collect.wanted(family, PER_FAMILY));
    }
    if (SOURCE_POLICY[mode].jasoseol === 'auto') runs.push(() => deps.collect.jasoseol(families, JASOSEOL_PER_FAMILY));
    // 출처끼리는 순서대로 요청한다(같은 출처에 동시 요청을 만들지 않는다).
    for (const run of runs) {
      const { postings, failures } = await run();
      counts.sourceFailures.push(...failures);
      for (const p of postings) {
        const id = upsertPosting(db, p, mode, null);
        await storeRequirements(db, deps, id, p, counts);
        counts.collected++;
      }
    }
    const rows = db.prepare(`SELECT p.* FROM postings p WHERE (p.owner_user_id IS NULL OR p.owner_user_id = ?) ${visiblePostingsSql(mode)} ORDER BY p.checked_at DESC`).all(job.userId) as PostingRow[];
    await judgeFor(db, deps, job.userId, basis, rows, counts);
    const failed = counts.sourceFailures.length > 0 || counts.aiFailures > 0;
    const result = { mode, collected: counts.collected, judged: counts.judged, aiFailures: counts.aiFailures, sourceFailures: counts.sourceFailures.map(f => `${f.source}:${f.code}`) };
    if (counts.collected === 0 && failed) return { status: '실패', errorCode: 'collect_failed', result };
    return { status: failed ? '일부 실패' : '성공', result };
  };
}
