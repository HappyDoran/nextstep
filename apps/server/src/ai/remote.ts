import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AI_SETTINGS_DEFAULT, aiClaimRequestSchema, aiClaimSchema, type AiProvider, aiRunnerReportSchema, aiSettingsSchema, aiStatusSchema, aiSubmitSchema } from '@nextstep/contracts';
import { requireUser } from '../auth.js';
import { dataBlock, MAX_INPUT_CHARS, strictJsonSchema } from './llm.js';
import { REQUIREMENTS_INSTRUCTIONS, REQUIREMENTS_PROMPT_VERSION, requirementsSchema, type Requirements } from '../prompts/requirements.js';
import { CANDIDATE_INSTRUCTIONS, CANDIDATE_PROMPT_VERSION, candidateSchema, toCandidate, type Candidate } from '../prompts/candidate.js';

// 내 AI 연결(사용자 결정 2026-11-26, 기술 설계 D): 서버는 분석할 일을 사용자별로 쌓고, 사용자 기기의 실행기(데스크톱 앱)가
// 자기 Codex·Claude 계정으로 처리해 결과만 올린다(Claude 추가 2026-11-28). 공고는 켠 경로마다 같은 입력으로 한 번씩 분석해
// 경로별 결과를 ai_samples에 모은다(로컬 모델 학습 자료). 판정에는 Codex > Claude > 로컬 순으로 우선한 결과를 쓴다. 서버는 AI 로그인 정보를 갖지 않는다. 실행기가 없거나 늦으면 서버 로컬 모델이 처리하고,
// 그 결과는 나중에 실행기가 다시 분석해 바꾼다(승격). 운영자와 초대 사용자가 같은 경로를 쓴다.
const ACTIVE_MS = 3 * 60_000; // 실행기가 이 안에 알렸으면 지금 쓸 수 있다(1분마다 알림).
const REGISTERED_MS = 7 * 86_400_000; // 일주일 안에 알린 적이 있으면 승격할 일을 쌓아 둔다.
const LEASE_MS = 15 * 60_000;
const DOCUMENT_FALLBACK_MS = 60 * 60_000; // 서류: 1시간 안에 내 AI가 안 하면 로컬(사용자 결정).
export const POSTING_WAIT_MS = 10 * 60_000; // 갱신 공고: 10분 기다린 뒤 로컬(사용자 결정).
export const TASK_KEEP_MS = 3 * 86_400_000; // 모델 입력(공고 본문·서류 글)은 최대 3일(사용자 결정).
const BATCH = 10;
export const SAMPLE_KEEP_MS = 90 * 86_400_000; // 학습 표본(공고 본문·경로별 결과)은 90일(사용자 결정 2026-11-28).
export const PROVIDERS = ['codex', 'claude'] as const satisfies readonly AiProvider[];
// 판정에 쓰는 결과의 우선순위(사용자 결정 2026-11-28: Codex를 가장 믿는다). 낮은 경로의 결과가 높은 경로의 결과를 덮지 않는다.
const RANK: Record<string, number> = { codex: 3, claude: 2, local: 1 };
export const rank = (provider: string | null | undefined) => RANK[provider ?? ''] ?? 0;

type AiSettings = z.infer<typeof aiSettingsSchema>;
type Runner = z.infer<typeof aiRunnerReportSchema>;
const today = (now: number) => new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const parse = <T>(text: string | null | undefined): T | null => { try { return text ? JSON.parse(text) as T : null; } catch { return null; } };

export function aiState(db: DatabaseSync, userId: string, now = Date.now()) {
  const row = db.prepare('SELECT ai_settings, ai_runner, ai_runner_seen_at, ai_usage FROM users WHERE id = ?').get(userId) as { ai_settings: string | null; ai_runner: string | null; ai_runner_seen_at: string | null; ai_usage: string | null } | undefined;
  const settings: AiSettings = { ...AI_SETTINGS_DEFAULT, ...parse<Partial<AiSettings>>(row?.ai_settings) };
  const runner = parse<Runner>(row?.ai_runner);
  const seen = row?.ai_runner_seen_at ? Date.parse(row.ai_runner_seen_at) : 0;
  // 이전 버전은 Codex 횟수만 calls로 두었다.
  const stored = parse<{ date: string; calls?: number; codex?: number; claude?: number }>(row?.ai_usage);
  const usage = stored?.date === today(now) ? { date: stored.date, codex: stored.codex ?? stored.calls ?? 0, claude: stored.claude ?? 0 } : { date: today(now), codex: 0, claude: 0 };
  const on = (p: AiProvider) => settings.enabled && settings[p];
  // 일주일 안에 알렸고 그때 설치돼 있던 경로: 승격·비교할 일을 쌓아 둔다. 3분 안에 알렸고 로그인된 경로: 지금 쓸 수 있다.
  const registeredProviders = PROVIDERS.filter(p => on(p) && seen > now - REGISTERED_MS && runner?.[p]?.installed === true);
  const providers = PROVIDERS.filter(p => on(p) && seen > now - ACTIVE_MS && runner?.[p]?.loggedIn === true);
  return {
    settings, runner, seenAt: row?.ai_runner_seen_at ?? null, usage,
    registeredProviders, providers,
    registered: registeredProviders.length > 0,
    active: providers.length > 0,
  };
}
export type AiState = ReturnType<typeof aiState>;

/** 서류 묶음 키: 지시문 버전과 모델에 넣는 앞부분이 같으면 같은 결과로 본다. */
export const docsKey = (text: string) => createHash('sha256').update(`${CANDIDATE_PROMPT_VERSION}\n${text.slice(0, MAX_INPUT_CHARS)}`).digest('hex').slice(0, 32);

/** 같은 대상·경로의 일은 하나만 둔다. 이미 대기 중이면 입력·폴백 시각만 바꾼다(실행 중인 일은 그대로). provider ''는 어느 경로든 받는 일. */
export function queueTask(db: DatabaseSync, userId: string, kind: 'posting' | 'candidate', ref: string, input: string, fallbackAt: string | null, provider: AiProvider | '' = '') {
  db.prepare(`INSERT INTO ai_tasks (id, user_id, kind, ref, input, status, fallback_at, created_at, provider) VALUES (?, ?, ?, ?, ?, '대기', ?, ?, ?)
    ON CONFLICT(user_id, kind, ref, provider) DO UPDATE SET input = excluded.input, fallback_at = excluded.fallback_at WHERE ai_tasks.status = '대기'`)
    .run(randomUUID(), userId, kind, ref, input, fallbackAt, new Date().toISOString(), provider);
  return (db.prepare('SELECT id FROM ai_tasks WHERE user_id = ? AND kind = ? AND ref = ? AND provider = ?').get(userId, kind, ref, provider) as { id: string }).id;
}

/** 이 공고를 아직 현재 지시문으로 분석하지 않은 경로(판정에 쓰는 결과의 경로이거나 표본에 결과가 있으면 끝난 것으로 본다). */
export function missingProviders(db: DatabaseSync, userId: string, postingId: string, providers: readonly AiProvider[]) {
  const row = db.prepare('SELECT requirements FROM postings WHERE id = ? AND owner_user_id = ?').get(postingId, userId) as { requirements: string | null } | undefined;
  const current = parse<{ version?: string; provider?: string }>(row?.requirements);
  const sample = db.prepare('SELECT codex, claude FROM ai_samples WHERE user_id = ? AND posting_id = ? AND version = ?').get(userId, postingId, REQUIREMENTS_PROMPT_VERSION) as { codex: string | null; claude: string | null } | undefined;
  return providers.filter(p => !sample?.[p] && !(current?.version === REQUIREMENTS_PROMPT_VERSION && current.provider === p));
}

/**
 * 공고 분석 일을 경로마다 올린다. waitFor: 갱신이 결과를 기다릴 경로(지금 쓸 수 있는 경로 중 가장 믿는 것) — 그 일 ID만 돌려준다.
 * 나머지 경로의 일은 기다리지 않고(폴백 없음) 실행기가 처리하면 비교·학습 표본으로 쌓인다.
 */
export function queuePosting(db: DatabaseSync, userId: string, postingId: string, input: string, providers: readonly AiProvider[], waitFor?: { provider: AiProvider; fallbackAt: string }) {
  const ids: string[] = [];
  for (const p of providers) {
    const id = queueTask(db, userId, 'posting', postingId, input, p === waitFor?.provider ? waitFor.fallbackAt : null, p);
    if (p === waitFor?.provider) ids.push(id);
  }
  return ids;
}

/** 경로별 결과를 표본에 남긴다. 처음 만들 때 판정에 쓰는 결과가 현재 지시문의 다른 경로 결과면 그것도 함께 채운다(이전에 분석한 공고). */
export function saveSample(db: DatabaseSync, userId: string, postingId: string, input: string, provider: 'codex' | 'claude' | 'local', output: Requirements, localModel?: string) {
  const at = new Date().toISOString();
  const row = db.prepare('SELECT requirements FROM postings WHERE id = ? AND owner_user_id = ?').get(postingId, userId) as { requirements: string | null } | undefined;
  const current = parse<Requirements & { version?: string; provider?: string }>(row?.requirements);
  const seed = { codex: null as string | null, claude: null as string | null };
  if (current?.version === REQUIREMENTS_PROMPT_VERSION && (current.provider === 'codex' || current.provider === 'claude') && current.provider !== provider) {
    // 경로·버전 표시는 빼고 결과만(값이 undefined인 키는 JSON에서 빠진다).
    seed[current.provider] = JSON.stringify({ ...current, version: undefined, provider: undefined });
  }
  db.prepare(`INSERT INTO ai_samples (user_id, posting_id, version, input, codex, claude, local, local_model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    ON CONFLICT(user_id, posting_id, version) DO UPDATE SET input = excluded.input, updated_at = excluded.updated_at`)
    .run(userId, postingId, REQUIREMENTS_PROMPT_VERSION, input, seed.codex, seed.claude, at, at);
  // 열 이름은 위 세 값 중 하나뿐이다.
  db.prepare(`UPDATE ai_samples SET ${provider} = ?${provider === 'local' ? ', local_model = ?' : ''} WHERE user_id = ? AND posting_id = ? AND version = ?`)
    .run(...[JSON.stringify(output), ...(provider === 'local' ? [localModel ?? null] : []), userId, postingId, REQUIREMENTS_PROMPT_VERSION]);
}
export const postingTaskInput = (p: { id: string; title: string; company: string; body: string }) => JSON.stringify({ id: p.id, title: p.title, company: p.company, body: p.body.slice(0, MAX_INPUT_CHARS) });

// 제목 비교용 글자쌍(공백·기호를 지운 소문자).
const grams = (text: string) => {
  const t = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return new Set(Array.from({ length: Math.max(0, t.length - 1) }, (_, i) => t.slice(i, i + 2)));
};

/**
 * 로컬 모델 참고 문구(사용자 결정 2026-11-28: Codex 결과를 믿고 그것으로 로컬을 이끈다): Codex(없으면 Claude)가 분석한 최근 표본 2,000건 중
 * 제목 글자쌍이 가장 많이 겹치는 공고 3건의 직무·필수 조건 키. 로컬이 가장 많이 틀리는 직무 분류를 짧은 문구로 돕는다(입력이 길어지면 홈서버에서 느려짐).
 * 학습한 로컬 모델은 이 문구 없이 쓴다(requirements.ts).
 */
export function teacherHints(db: DatabaseSync, title: string, limit = 3) {
  const rows = db.prepare(`SELECT json_extract(input, '$.title') AS title, COALESCE(codex, claude) AS out FROM ai_samples
    WHERE version = ? AND (codex IS NOT NULL OR claude IS NOT NULL) ORDER BY updated_at DESC LIMIT 2000`).all(REQUIREMENTS_PROMPT_VERSION) as { title: string | null; out: string }[];
  return hintsFrom(rows.flatMap(r => { const out = parse<Requirements>(r.out); return r.title && out ? [{ title: r.title, out }] : []; }), title, limit);
}

/** 참고 문구 만들기(서버·학습 평가 공용). rows: Codex·Claude가 분석한 공고 제목과 결과. */
export function hintsFrom(rows: { title: string; out: Requirements }[], title: string, limit = 3) {
  const mine = grams(title);
  if (!mine.size) return '';
  const scored = rows.flatMap(r => {
    if (r.title === title) return [];
    const theirs = grams(r.title);
    const shared = [...mine].filter(g => theirs.has(g)).length;
    const score = shared / (mine.size + theirs.size - shared);
    return score >= 0.25 ? [{ ...r, score }] : [];
  }).sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const r of scored) {
    if (seen.has(r.title) || lines.length >= limit) continue;
    seen.add(r.title);
    const keys = [...new Set(r.out.required.flatMap(q => q.keys))].slice(0, 4);
    lines.push(`- "${r.title.slice(0, 60)}" → 직무 ${r.out.jobFamilies.join('·') || '기타'}${keys.length ? ` · 필수 ${keys.join(', ')}` : ''}`);
  }
  return lines.length ? `참고: 정확한 분석기가 비슷한 제목의 다른 공고를 이렇게 분석했다. 직무 판단에 참고하되 이 공고 본문과 다르면 본문을 따른다.\n${lines.join('\n')}` : '';
}

/** 공고 조건 저장(로컬·내 AI 공용). 어느 경로로 만들었는지 함께 남긴다. 현재 지시문의 더 믿는 경로 결과가 이미 있으면 덮지 않는다(저장했으면 true). */
export function saveRequirements(db: DatabaseSync, userId: string, postingId: string, req: Requirements, provider: string) {
  const row = db.prepare('SELECT requirements FROM postings WHERE id = ? AND owner_user_id = ?').get(postingId, userId) as { requirements: string | null } | undefined;
  const current = parse<{ version?: string; provider?: string }>(row?.requirements);
  if (current?.version === REQUIREMENTS_PROMPT_VERSION && rank(current.provider) > rank(provider)) return false;
  db.prepare('UPDATE postings SET requirements = ? WHERE id = ? AND owner_user_id = ?').run(JSON.stringify({ version: REQUIREMENTS_PROMPT_VERSION, provider, ...req }), postingId, userId);
  return true;
}
export const isRemote = (provider: string | null | undefined) => provider !== undefined && provider !== null && provider !== 'local';

/** 지원자 사실: 저장된 것(내 AI 결과 우선)을 쓰고, 없으면 로컬로 뽑아 저장한다. */
export async function candidateFor(db: DatabaseSync, userId: string, text: string, local: (text: string) => Promise<Candidate>) {
  const key = docsKey(text);
  const row = db.prepare('SELECT facts, provider FROM candidate_facts WHERE user_id = ? AND docs_key = ?').get(userId, key) as { facts: string; provider: string } | undefined;
  if (row) return { facts: JSON.parse(row.facts) as Candidate, provider: row.provider };
  const facts = await local(text);
  db.prepare('INSERT OR IGNORE INTO candidate_facts (user_id, docs_key, facts, provider, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, key, JSON.stringify(facts), 'local', new Date().toISOString());
  return { facts, provider: 'local' };
}

/** 서류를 내 AI로 분석할 일로 올린다(아직 내 AI 결과가 없을 때만). 로컬 결과가 이미 있으면 승격 일, 없으면 1시간 뒤 로컬 폴백. */
export function queueDocuments(db: DatabaseSync, userId: string, text: string | undefined, state: AiState) {
  if (!text || !state.registered || !state.settings.sendDocuments) return null;
  const key = docsKey(text);
  const row = db.prepare('SELECT provider FROM candidate_facts WHERE user_id = ? AND docs_key = ?').get(userId, key) as { provider: string } | undefined;
  if (row && isRemote(row.provider)) return null;
  return queueTask(db, userId, 'candidate', key, text.slice(0, MAX_INPUT_CHARS), row ? null : new Date(Date.now() + DOCUMENT_FALLBACK_MS).toISOString());
}

/** 일이 모두 끝나거나(지워지거나) 시간이 다 될 때까지 기다린다. 남은 일 ID를 돌려준다. */
export async function waitTasks(db: DatabaseSync, userId: string, ids: string[], waitMs: number, stepMs = 1000) {
  const deadline = Date.now() + waitMs;
  const left = () => ids.filter(id => db.prepare('SELECT 1 FROM ai_tasks WHERE id = ? AND user_id = ?').get(id, userId));
  let rest = left();
  while (rest.length && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, Math.min(stepMs, Math.max(0, deadline - Date.now()))));
    rest = left();
  }
  return rest;
}

export const batchSchema = z.object({ items: z.array(z.object({ id: z.string(), result: requirementsSchema }).strict()).max(BATCH) }).strict();
const POSTING_BATCH_NOTE = '\n- 공고는 <posting> 블록마다 JSON(id·title·company·body)으로 온다. 블록마다 결과 하나를 items에 넣고, id는 그 블록의 id를 그대로 쓴다.';

/** 공고 묶음 지시문(실행기·평가 공용). inputs는 postingTaskInput 결과. */
export const postingBatchPrompt = (inputs: string[]) => `${REQUIREMENTS_INSTRUCTIONS}${POSTING_BATCH_NOTE}\n\n${inputs.map(input => dataBlock('posting', input)).join('\n')}`;

/** 실행기가 그 경로로 받아 갈 분석 한 번. 서류를 먼저, 그다음 공고를 최대 10건 묶는다. 그 경로의 하루 상한을 넘으면 주지 않는다. */
export function claim(db: DatabaseSync, userId: string, provider: AiProvider = 'codex', now = Date.now()) {
  const empty = aiClaimSchema.parse({ kind: null, taskIds: [], prompt: '', schema: {} });
  const state = aiState(db, userId, now);
  if (!state.providers.includes(provider) || state.usage[provider] >= state.settings.dailyLimit) return empty;
  db.prepare("UPDATE ai_tasks SET status = '대기', lease_until = NULL WHERE user_id = ? AND status = '실행중' AND lease_until < ?").run(userId, new Date(now).toISOString());
  // 그 경로의 일과 어느 경로든 받는 일('')만. 같은 공고를 다른 경로가 이미 하는 중이어도 경로마다 따로 분석한다.
  const pick = (kind: string, limit: number) => db.prepare("SELECT id, input FROM ai_tasks WHERE user_id = ? AND kind = ? AND provider IN (?, '') AND status = '대기' ORDER BY fallback_at IS NULL, created_at LIMIT ?").all(userId, kind, provider, limit) as { id: string; input: string }[];
  const docs = state.settings.sendDocuments ? pick('candidate', 1) : [];
  const kind = docs.length ? 'candidate' : 'posting';
  const tasks = docs.length ? docs : state.settings.sendPostings ? pick('posting', BATCH) : [];
  if (!tasks.length) return empty;
  const lease = new Date(now + LEASE_MS).toISOString();
  for (const t of tasks) db.prepare("UPDATE ai_tasks SET status = '실행중', lease_until = ? WHERE id = ? AND user_id = ?").run(lease, t.id, userId);
  db.prepare('UPDATE users SET ai_usage = ? WHERE id = ?').run(JSON.stringify({ ...state.usage, [provider]: state.usage[provider] + 1 }), userId);
  return aiClaimSchema.parse(kind === 'candidate'
    ? { kind, taskIds: [tasks[0]!.id], prompt: `${CANDIDATE_INSTRUCTIONS}\n\n${dataBlock('candidate', tasks[0]!.input)}`, schema: strictJsonSchema(candidateSchema) }
    : { kind, taskIds: tasks.map(t => t.id), prompt: postingBatchPrompt(tasks.map(t => t.input)), schema: strictJsonSchema(batchSchema) });
}

/** 실행기 결과 반영. 검증에 실패하거나 실패를 알리면 일을 대기로 돌린다. 반영한 수를 돌려준다. */
export function submit(db: DatabaseSync, userId: string, body: z.infer<typeof aiSubmitSchema>) {
  const tasks = body.taskIds.map(id => db.prepare("SELECT id, kind, ref, input FROM ai_tasks WHERE id = ? AND user_id = ? AND status = '실행중'").get(id, userId) as { id: string; kind: string; ref: string; input: string } | undefined).filter(t => t !== undefined);
  const release = (ids: string[]) => { for (const id of ids) db.prepare("UPDATE ai_tasks SET status = '대기', lease_until = NULL WHERE id = ? AND user_id = ?").run(id, userId); };
  if (!tasks.length) return { applied: 0, valid: true };
  if (body.error || body.output === undefined) { release(tasks.map(t => t.id)); return { applied: 0, valid: true }; }
  const done = (id: string) => db.prepare('DELETE FROM ai_tasks WHERE id = ? AND user_id = ?').run(id, userId);
  if (tasks[0]!.kind === 'candidate') {
    const parsed = candidateSchema.safeParse(body.output);
    if (!parsed.success) { release(tasks.map(t => t.id)); return { applied: 0, valid: false }; }
    const existing = db.prepare('SELECT provider FROM candidate_facts WHERE user_id = ? AND docs_key = ?').get(userId, tasks[0]!.ref) as { provider: string } | undefined;
    if (rank(existing?.provider) <= rank(body.provider)) {
      db.prepare(`INSERT INTO candidate_facts (user_id, docs_key, facts, provider, created_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, docs_key) DO UPDATE SET facts = excluded.facts, provider = excluded.provider, created_at = excluded.created_at`)
        .run(userId, tasks[0]!.ref, JSON.stringify(toCandidate(parsed.data)), body.provider, new Date().toISOString());
    }
    done(tasks[0]!.id);
    return { applied: 1, valid: true };
  }
  const parsed = batchSchema.safeParse(body.output);
  if (!parsed.success) { release(tasks.map(t => t.id)); return { applied: 0, valid: false }; }
  let applied = 0;
  for (const t of tasks) {
    const item = parsed.data.items.find(i => i.id === t.ref);
    if (!item) { release([t.id]); continue; }
    saveSample(db, userId, t.ref, t.input, body.provider, item.result);
    if (saveRequirements(db, userId, t.ref, item.result, body.provider)) applied++;
    done(t.id);
  }
  return { applied, valid: true };
}

/**
 * 1분마다: 만료된 잠금을 풀고, 1시간 안에 내 AI가 안 한 서류는 로컬로 처리하고(이미 로컬 결과가 있으면 승격 일로만 둔다),
 * 3일 지난 일(모델 입력 포함)은 지운다.
 */
export async function sweep(db: DatabaseSync, local: (text: string) => Promise<Candidate>, now = Date.now()) {
  const at = new Date(now).toISOString();
  db.prepare("UPDATE ai_tasks SET status = '대기', lease_until = NULL WHERE status = '실행중' AND lease_until < ?").run(at);
  db.prepare('DELETE FROM ai_tasks WHERE created_at < ?').run(new Date(now - TASK_KEEP_MS).toISOString());
  db.prepare('DELETE FROM ai_samples WHERE created_at < ?').run(new Date(now - SAMPLE_KEEP_MS).toISOString());
  const due = db.prepare("SELECT id, user_id, kind, ref, input FROM ai_tasks WHERE status = '대기' AND fallback_at IS NOT NULL AND fallback_at < ?").all(at) as { id: string; user_id: string; kind: string; ref: string; input: string }[];
  for (const t of due) {
    if (t.kind === 'candidate' && !db.prepare('SELECT 1 FROM candidate_facts WHERE user_id = ? AND docs_key = ?').get(t.user_id, t.ref)) {
      try { await candidateFor(db, t.user_id, t.input, local); } catch { continue; }
    }
    db.prepare('UPDATE ai_tasks SET fallback_at = NULL WHERE id = ?').run(t.id);
  }
}

export function startAiSweeper(db: DatabaseSync, local: (text: string) => Promise<Candidate>) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    sweep(db, local).catch(() => undefined).finally(() => { running = false; });
  }, 60_000);
  return () => clearInterval(timer);
}

function status(db: DatabaseSync, userId: string) {
  const state = aiState(db, userId);
  const pending = (db.prepare('SELECT count(*) AS n FROM ai_tasks WHERE user_id = ?').get(userId) as { n: number }).n;
  const remotePostings = (db.prepare("SELECT count(*) AS n FROM postings WHERE owner_user_id = ? AND json_extract(requirements, '$.provider') NOT IN ('local')").get(userId) as { n: number }).n;
  const remoteDocuments = Boolean(db.prepare("SELECT 1 FROM candidate_facts WHERE user_id = ? AND provider != 'local'").get(userId));
  return aiStatusSchema.parse({ settings: state.settings, runner: state.runner, seenAt: state.seenAt, active: state.active, providers: state.providers, usage: state.usage, pending: Number(pending), remotePostings: Number(remotePostings), remoteDocuments });
}

/**
 * 내 AI 연결 API. 실행기는 로그인한 본인의 일만 받고 올린다. onApplied: 결과가 반영되면 그 사용자 판정을 다시 한다(pipeline).
 * documents: 그 사용자의 사용 중 서류 글(실행기가 알릴 때 서류 분석 일을 올리는 데 쓴다).
 */
export function registerAi(app: FastifyInstance, db: DatabaseSync, hooks: { documents: (userId: string) => string | undefined; onApplied: (userId: string) => void }) {
  app.get('/ai/status', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    return status(db, user.id);
  });
  app.put('/ai/settings', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const body = aiSettingsSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ message: '요청을 확인하세요.' });
    db.prepare('UPDATE users SET ai_settings = ? WHERE id = ?').run(JSON.stringify(body.data), user.id);
    // 끄거나 보낼 항목을 빼면 아직 시작하지 않은 일과 그 입력을 지운다.
    if (!body.data.enabled || !body.data.sendPostings) db.prepare("DELETE FROM ai_tasks WHERE user_id = ? AND kind = 'posting' AND status = '대기'").run(user.id);
    for (const p of PROVIDERS) if (!body.data[p]) db.prepare("DELETE FROM ai_tasks WHERE user_id = ? AND provider = ? AND status = '대기'").run(user.id, p);
    if (!body.data.enabled || !body.data.sendDocuments) db.prepare("DELETE FROM ai_tasks WHERE user_id = ? AND kind = 'candidate' AND status = '대기'").run(user.id);
    return status(db, user.id);
  });
  // 실행기가 1분마다 그 기기의 Codex 설치·로그인 여부를 알린다. 서류 분석 일도 여기서 확인해 올린다(서류가 바뀌어도 잡힘).
  app.post('/ai/runner', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const body = aiRunnerReportSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ message: '요청을 확인하세요.' });
    db.prepare('UPDATE users SET ai_runner = ?, ai_runner_seen_at = ? WHERE id = ?').run(JSON.stringify(body.data), new Date().toISOString(), user.id);
    queueDocuments(db, user.id, hooks.documents(user.id), aiState(db, user.id));
    return status(db, user.id);
  });
  app.post('/ai/tasks/claim', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    // 이전 앱은 본문 없이 부른다(Codex).
    const body = aiClaimRequestSchema.safeParse(request.body ?? { provider: 'codex' });
    if (!body.success) return reply.status(400).send({ message: '요청을 확인하세요.' });
    return claim(db, user.id, body.data.provider);
  });
  app.post('/ai/tasks/submit', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const body = aiSubmitSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ message: '요청을 확인하세요.' });
    const result = submit(db, user.id, body.data);
    if (result.applied) hooks.onApplied(user.id);
    return result.valid ? result : reply.status(422).send({ message: '결과 형식이 맞지 않아 다시 분석해요.', applied: result.applied });
  });
}
