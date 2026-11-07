import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { profileSchema } from '@nextstep/contracts';
import { requireUser } from './auth.js';

// 프로필·필터는 사용자가 확인·저장한 값만 추천 기준으로 쓴다.
export function registerProfile(app: FastifyInstance, db: DatabaseSync) {
  app.get('/profile', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const row = db.prepare('SELECT data, updated_at FROM profiles WHERE user_id = ?').get(user.id) as { data: string; updated_at: string } | undefined;
    if (!row) return reply.status(404).send({ message: '저장한 프로필이 없습니다.' });
    return { profile: profileSchema.parse(JSON.parse(row.data)), updatedAt: row.updated_at };
  });
  app.put('/profile', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const body = profileSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ message: '요청을 확인하세요.' });
    const at = new Date().toISOString();
    db.prepare('INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .run(user.id, JSON.stringify(body.data), at);
    return { profile: body.data, updatedAt: at };
  });
}
