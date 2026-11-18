import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { automationSchema, automationStatusSchema, connectionStatusSchema, sourceIdSchema } from '@nextstep/contracts';
import { ollamaModel, ollamaStatus } from './ai/llm.js';
import { requireUser } from './auth.js';
import { cancelQueuedScheduled } from './schedule.js';

function status(db: DatabaseSync, userId: string) {
  const row = db.prepare('SELECT auto_enabled FROM users WHERE id = ?').get(userId) as { auto_enabled: number };
  // 종류별 가장 최근 예약 실행(메일은 매시간, 공고 갱신은 하루 한 번).
  const last = db.prepare(`SELECT s.kind, j.status, j.finished_at, s.run_date FROM schedule_runs s LEFT JOIN jobs j ON j.id = s.job_id
    WHERE s.user_id = ? AND s.created_at = (SELECT max(created_at) FROM schedule_runs x WHERE x.user_id = s.user_id AND x.kind = s.kind) ORDER BY s.created_at DESC`).all(userId) as { kind: string; status: string | null; finished_at: string | null; run_date: string }[];
  return automationStatusSchema.parse({ enabled: row.auto_enabled === 1, lastScheduled: last.map(l => ({ kind: l.kind, status: l.status, finishedAt: l.finished_at, runDate: l.run_date })) });
}

// 자동 ON/OFF는 사용자별 설정이다. 예약 실행(P1-06)은 이 값과 연결 상태를 함께 확인한다.
export function registerUserSettings(app: FastifyInstance, db: DatabaseSync) {
  // 연결 상태(기획서 4절): 로컬 AI는 지금 묻고, 메일은 저장된 연결 상태, 공고 출처는 마지막으로 끝난 갱신 작업의 출처별 실패로 본다.
  app.get('/settings/connections', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const mail = db.prepare('SELECT status, last_success_at, last_error FROM mail_connections WHERE user_id = ?').get(user.id) as { status: '정상' | '인증 실패'; last_success_at: string | null; last_error: string | null } | undefined;
    const job = db.prepare("SELECT status, result, finished_at FROM jobs WHERE user_id = ? AND kind = 'refresh' AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1").get(user.id) as { status: string; result: string | null; finished_at: string } | undefined;
    const failures = (JSON.parse(job?.result ?? '{}') as { sourceFailures?: string[] }).sourceFailures ?? [];
    // 작업 전체가 실패(서류 없음 등)면 출처를 확인하지 못한 것이다.
    const ran = job && job.status !== '실패';
    return connectionStatusSchema.parse({
      checkedAt: new Date().toISOString(),
      ai: { model: ollamaModel(), status: await ollamaStatus() },
      mail: mail ? { status: mail.status, lastSuccessAt: mail.last_success_at, lastError: mail.last_error } : null,
      sources: sourceIdSchema.options.map(source => {
        const codes = [...new Set(failures.filter(f => f.startsWith(`${source}:`)).map(f => f.slice(source.length + 1)))];
        return { source, status: !ran ? '확인 전' : codes.length ? '실패' : '정상', codes, finishedAt: ran ? job.finished_at : null };
      }),
    });
  });
  app.get('/settings/automation', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    return status(db, user.id);
  });
  app.put('/settings/automation', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const body = automationSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ message: '요청을 확인하세요.' });
    db.prepare('UPDATE users SET auto_enabled = ? WHERE id = ?').run(body.data.enabled ? 1 : 0, user.id);
    if (!body.data.enabled) cancelQueuedScheduled(db, user.id);
    return status(db, user.id);
  });
}
