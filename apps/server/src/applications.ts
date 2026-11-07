import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { applicationCreateSchema, applicationSchema } from '@nextstep/contracts';
import { requireUser } from './auth.js';

type Row = { id: string; company: string; role_title: string; posting_url: string | null; status: string; created_at: string; updated_at: string };
const toApplication = (r: Row) => applicationSchema.parse({ id: r.id, company: r.company, roleTitle: r.role_title, postingUrl: r.posting_url, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at });

// 모든 조회·변경·삭제는 세션 사용자 ID 조건을 함께 건다. 다른 사용자의 자료는 존재 여부도 드러내지 않고 404로 답한다.
export function registerApplications(app: FastifyInstance, db: DatabaseSync) {
  app.get('/applications', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const rows = db.prepare('SELECT * FROM applications WHERE user_id = ? ORDER BY created_at DESC, id').all(user.id) as Row[];
    return rows.map(toApplication);
  });

  app.post('/applications', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const body = applicationCreateSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ message: '요청을 확인하세요.' });
    const at = new Date().toISOString();
    const id = randomUUID();
    // 계정 삭제와 겹치면 외래키가 삽입을 거부해 삭제된 사용자의 자료가 되살아나지 않는다.
    try {
      db.prepare('INSERT INTO applications (id, user_id, company, role_title, posting_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, user.id, body.data.company, body.data.roleTitle, body.data.postingUrl ?? null, body.data.status, at, at);
    } catch (error) {
      if ((error as { errcode?: number }).errcode === 787) return reply.status(401).send({ message: '로그인이 필요합니다.' });
      throw error;
    }
    return reply.status(201).send(toApplication(db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as Row));
  });

  app.get<{ Params: { id: string } }>('/applications/:id', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const row = db.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').get(request.params.id, user.id) as Row | undefined;
    return row ? toApplication(row) : reply.status(404).send({ message: '찾을 수 없습니다.' });
  });

  app.delete<{ Params: { id: string } }>('/applications/:id', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const result = db.prepare('DELETE FROM applications WHERE id = ? AND user_id = ?').run(request.params.id, user.id);
    return result.changes === 1 ? reply.status(204).send() : reply.status(404).send({ message: '찾을 수 없습니다.' });
  });
}
