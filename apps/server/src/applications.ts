import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { applicationCreateSchema, applicationDetailSchema, applicationSchema, applicationUpdateSchema } from '@nextstep/contracts';
import { requireUser } from './auth.js';

type Row = { id: string; company: string; role_title: string; posting_url: string | null; status: string; read_status: string; created_at: string; updated_at: string };
const toApplication = (r: Row) => applicationSchema.parse({ id: r.id, company: r.company, roleTitle: r.role_title, postingUrl: r.posting_url, status: r.status, readStatus: r.read_status, createdAt: r.created_at, updatedAt: r.updated_at });
type EventRow = { field: string; from_value: string | null; to_value: string; source: string; at: string };

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
    if (!row) return reply.status(404).send({ message: '찾을 수 없습니다.' });
    const events = db.prepare('SELECT field, from_value, to_value, source, at FROM application_events WHERE application_id = ? ORDER BY at DESC, rowid DESC').all(row.id) as EventRow[];
    return applicationDetailSchema.parse({ ...toApplication(row), events: events.map(e => ({ field: e.field, from: e.from_value, to: e.to_value, source: e.source, at: e.at })) });
  });

  // 직접 수정. 현재 값을 트랜잭션 안에서 다시 읽고, 상태·열람이 실제로 바뀐 경우만 이력을 남긴다.
  app.patch<{ Params: { id: string } }>('/applications/:id', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const body = applicationUpdateSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ message: '요청을 확인하세요.' });
    const patch = body.data;
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = db.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').get(request.params.id, user.id) as Row | undefined;
      if (!current) {
        db.exec('ROLLBACK');
        return reply.status(404).send({ message: '찾을 수 없습니다.' });
      }
      const at = new Date().toISOString();
      const next = {
        company: patch.company ?? current.company,
        role_title: patch.roleTitle ?? current.role_title,
        posting_url: patch.postingUrl === undefined ? current.posting_url : patch.postingUrl,
        status: patch.status ?? current.status,
        read_status: patch.readStatus ?? current.read_status,
      };
      db.prepare('UPDATE applications SET company = ?, role_title = ?, posting_url = ?, status = ?, read_status = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(next.company, next.role_title, next.posting_url, next.status, next.read_status, at, current.id, user.id);
      const log = db.prepare("INSERT INTO application_events (id, application_id, field, from_value, to_value, source, at) VALUES (?, ?, ?, ?, ?, 'manual', ?)");
      if (next.status !== current.status) log.run(randomUUID(), current.id, 'status', current.status, next.status, at);
      if (next.read_status !== current.read_status) log.run(randomUUID(), current.id, 'readStatus', current.read_status, next.read_status, at);
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
    return toApplication(db.prepare('SELECT * FROM applications WHERE id = ?').get(request.params.id) as Row);
  });

  app.delete<{ Params: { id: string } }>('/applications/:id', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const result = db.prepare('DELETE FROM applications WHERE id = ? AND user_id = ?').run(request.params.id, user.id);
    return result.changes === 1 ? reply.status(204).send() : reply.status(404).send({ message: '찾을 수 없습니다.' });
  });
}
