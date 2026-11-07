import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { jobSchema, type Job } from '@nextstep/contracts';

export type JobKind = 'refresh' | 'link';
type Row = { id: string; user_id: string; kind: JobKind; payload: string | null; status: string; attempts: number; error_code: string | null; result: string | null; created_at: string; finished_at: string | null };
export type ClaimedJob = { id: string; userId: string; kind: JobKind; payload: unknown; attempts: number };
export type JobOutcome = { status: '성공' | '일부 실패' | '실패'; errorCode?: string; result: Record<string, unknown> };

const LEASE_MS = 15 * 60_000;
const MAX_ATTEMPTS = 3;
const now = () => new Date().toISOString();

export const toJob = (r: Row): Job => jobSchema.parse({ id: r.id, kind: r.kind, status: r.status, errorCode: r.error_code, result: r.result ? JSON.parse(r.result) : null, createdAt: r.created_at, finishedAt: r.finished_at });

// 사용자·종류별 대기·실행중 작업은 하나만 둔다(부분 고유 인덱스). 이미 있으면 그 작업을 돌려준다.
export function enqueue(db: DatabaseSync, userId: string, kind: JobKind, payload?: unknown): Job {
  const existing = db.prepare("SELECT * FROM jobs WHERE user_id = ? AND kind = ? AND status IN ('대기', '실행중')").get(userId, kind) as Row | undefined;
  if (existing) return toJob(existing);
  const id = randomUUID();
  db.prepare("INSERT INTO jobs (id, user_id, kind, payload, status, created_at) VALUES (?, ?, ?, ?, '대기', ?)").run(id, userId, kind, payload === undefined ? null : JSON.stringify(payload), now());
  return toJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row);
}

export function getJob(db: DatabaseSync, userId: string, id: string) {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').get(id, userId) as Row | undefined;
  return row ? toJob(row) : undefined;
}

export function latestJob(db: DatabaseSync, userId: string, kind: JobKind) {
  const row = db.prepare('SELECT * FROM jobs WHERE user_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1').get(userId, kind) as Row | undefined;
  return row ? toJob(row) : null;
}

// 서버 재시작 후 실행 만료된 작업을 다시 대기로 돌린다. 시도 한도를 넘으면 실패로 끝낸다.
export function recoverExpired(db: DatabaseSync) {
  db.prepare("UPDATE jobs SET status = '실패', error_code = 'lease_expired', finished_at = ? WHERE status = '실행중' AND lease_until < ? AND attempts >= ?").run(now(), now(), MAX_ATTEMPTS);
  db.prepare("UPDATE jobs SET status = '대기' WHERE status = '실행중' AND lease_until < ?").run(now());
}

// 가장 오래된 대기 작업 하나를 원자적으로 선점한다.
export function claim(db: DatabaseSync): ClaimedJob | undefined {
  const row = db.prepare(`UPDATE jobs SET status = '실행중', started_at = ?, lease_until = ?, attempts = attempts + 1
    WHERE id = (SELECT id FROM jobs WHERE status = '대기' ORDER BY created_at LIMIT 1) RETURNING *`).get(now(), new Date(Date.now() + LEASE_MS).toISOString()) as Row | undefined;
  return row ? { id: row.id, userId: row.user_id, kind: row.kind, payload: row.payload ? JSON.parse(row.payload) : undefined, attempts: row.attempts } : undefined;
}

export function finish(db: DatabaseSync, id: string, outcome: JobOutcome) {
  // 작업 중 계정이 삭제되면 작업 행도 사라졌으므로 갱신할 대상이 없다.
  db.prepare("UPDATE jobs SET status = ?, error_code = ?, result = ?, finished_at = ?, lease_until = NULL WHERE id = ? AND status = '실행중'")
    .run(outcome.status, outcome.errorCode ?? null, JSON.stringify(outcome.result), now(), id);
}

export async function runNext(db: DatabaseSync, handler: (job: ClaimedJob) => Promise<JobOutcome>) {
  const job = claim(db);
  if (!job) return false;
  let outcome: JobOutcome;
  try {
    outcome = await handler(job);
  } catch (error) {
    // 오류 메시지에는 개인 자료가 섞일 수 있어 코드만 남긴다.
    outcome = { status: '실패', errorCode: (error as { code?: string }).code ?? 'internal', result: {} };
  }
  finish(db, job.id, outcome);
  return true;
}

// ponytail: 프로세스 안 단일 작업자. 작업자를 여러 개 두려면 claim의 원자 선점을 그대로 쓰고 프로세스를 늘린다.
export function startWorker(db: DatabaseSync, handler: (job: ClaimedJob) => Promise<JobOutcome>, intervalMs = 2000) {
  recoverExpired(db);
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runNext(db, handler).finally(() => { running = false; });
  }, intervalMs);
  return () => clearInterval(timer);
}
