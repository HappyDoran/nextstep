import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { automationSchema, automationStatusSchema } from '@nextstep/contracts';
import { requireUser } from './auth.js';
import { cancelQueuedScheduled } from './schedule.js';

function status(db: DatabaseSync, userId: string) {
  const row = db.prepare('SELECT auto_enabled FROM users WHERE id = ?').get(userId) as { auto_enabled: number };
  const last = db.prepare('SELECT s.kind, j.status, j.finished_at, s.run_date FROM schedule_runs s LEFT JOIN jobs j ON j.id = s.job_id WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 2').all(userId) as { kind: string; status: string | null; finished_at: string | null; run_date: string }[];
  return automationStatusSchema.parse({ enabled: row.auto_enabled === 1, lastScheduled: last.map(l => ({ kind: l.kind, status: l.status, finishedAt: l.finished_at, runDate: l.run_date })) });
}

// 자동 ON/OFF는 사용자별 설정이다. 예약 실행(P1-06)은 이 값과 연결 상태를 함께 확인한다.
export function registerUserSettings(app: FastifyInstance, db: DatabaseSync) {
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
