import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { automationSchema } from '@nextstep/contracts';
import { requireUser } from './auth.js';

// 자동 ON/OFF는 사용자별 설정이다. 예약 실행(P1-06)은 이 값과 연결 상태를 함께 확인한다.
export function registerUserSettings(app: FastifyInstance, db: DatabaseSync) {
  app.get('/settings/automation', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const row = db.prepare('SELECT auto_enabled FROM users WHERE id = ?').get(user.id) as { auto_enabled: number };
    return automationSchema.parse({ enabled: row.auto_enabled === 1 });
  });
  app.put('/settings/automation', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const body = automationSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ message: '요청을 확인하세요.' });
    db.prepare('UPDATE users SET auto_enabled = ? WHERE id = ?').run(body.data.enabled ? 1 : 0, user.id);
    return body.data;
  });
}
