import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { applicationCreateSchema, applicationDetailSchema, applicationImportSchema, applicationSchema, applicationUpdateSchema, type ApplicationImportResult } from '@nextstep/contracts';
import { parseCsv } from './csv.js';
import { normalizeName } from './mail/apply.js';
import { enqueue } from './recommend/jobs.js';
import { requireUser } from './auth.js';

type Row = { id: string; company: string; role_title: string; posting_url: string | null; status: string; read_status: string; locked_fields: string; created_at: string; updated_at: string };
const toApplication = (r: Row) => applicationSchema.parse({ id: r.id, company: r.company, roleTitle: r.role_title, postingUrl: r.posting_url, status: r.status, readStatus: r.read_status, lockedFields: JSON.parse(r.locked_fields), createdAt: r.created_at, updatedAt: r.updated_at });
// 가져오기 상태 → 지원 상태·열람. 이력서 열람은 지원 완료에 열람 표시, 서류 합격은 전형 진행중으로 둔다.
const IMPORT_STATUS: Record<string, [string, string]> = {
  미지원: ['미지원', '정보 없음'], '지원 완료': ['지원 완료', '정보 없음'], '이력서 열람': ['지원 완료', '열람'], 열람: ['지원 완료', '열람'],
  '서류 합격': ['전형 진행중', '정보 없음'], '전형 진행중': ['전형 진행중', '정보 없음'], 합격: ['합격', '정보 없음'], 불합격: ['불합격', '정보 없음'],
};
// Notion 내보내기는 마크다운 기호를 \[ \~처럼 이스케이프해 둔다. 메일 직무명과 맞도록 백슬래시를 지운다.
export const unescapeMarkdown = (value: string) => value.replace(/\\([\\`*_{}[\]()#+\-.!~|<>])/g, '$1');
const httpsUrl = (value: string | undefined) => { try { return value && new URL(value).protocol === 'https:' ? value.slice(0, 2000) : null; } catch { return null; } };

// CSV의 지원 건을 한 번에 넣는다. 같은 회사·직무 또는 같은 공고 URL이 이미 있으면 건너뛰고(다시 올려도 중복 없음),
// 대기 중인 연결 불명 확인 요청은 가져온 지원 건으로 다시 연결해 보도록 해석 대기로 되돌린 뒤 메일 작업을 넣는다.
export function importApplications(db: DatabaseSync, userId: string, csv: string): ApplicationImportResult {
  const rows = parseCsv(csv);
  const result = { imported: 0, duplicates: 0, invalid: 0, requeued: 0 };
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT company, role_title, posting_url FROM applications WHERE user_id = ?').all(userId) as { company: string; role_title: string; posting_url: string | null }[];
    const seen = new Set(existing.map(a => `${normalizeName(a.company)}|${normalizeName(a.role_title)}`));
    const urls = new Set(existing.map(a => a.posting_url).filter(Boolean));
    const insert = db.prepare("INSERT INTO applications (id, user_id, company, role_title, posting_url, status, read_status, created_at, updated_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'import')");
    const log = db.prepare("INSERT INTO application_events (id, application_id, field, from_value, to_value, source, at) VALUES (?, ?, ?, ?, ?, 'import', ?)");
    const at = new Date().toISOString();
    for (const row of rows) {
      const company = unescapeMarkdown(row['회사'] ?? '').trim().slice(0, 200), role = unescapeMarkdown(row['직무'] ?? '').trim().slice(0, 200);
      const mapped = IMPORT_STATUS[(row['상태'] ?? '').trim()];
      if (!company || !role || !mapped) { result.invalid++; continue; }
      const key = `${normalizeName(company)}|${normalizeName(role)}`, url = httpsUrl(row['공고URL']?.trim());
      if (seen.has(key) || (url && urls.has(url))) { result.duplicates++; continue; }
      seen.add(key); if (url) urls.add(url);
      const id = randomUUID();
      insert.run(id, userId, company, role, url, mapped[0], mapped[1], at, at);
      log.run(randomUUID(), id, 'status', '미지원', mapped[0], at);
      if (mapped[1] === '열람') log.run(randomUUID(), id, 'readStatus', '정보 없음', '열람', at);
      result.imported++;
    }
    // 메일 연결이 없으면 다시 해석할 작업을 넣을 수 없으므로 확인 요청을 그대로 둔다.
    if (result.imported && db.prepare('SELECT 1 FROM mail_connections WHERE user_id = ?').get(userId)) {
      const pending = db.prepare("SELECT message_id FROM review_requests WHERE user_id = ? AND status = '대기' AND held = 0 AND reason = '연결 불명'").all(userId) as { message_id: string }[];
      for (const r of pending) {
        db.prepare("DELETE FROM review_requests WHERE message_id = ? AND user_id = ? AND status = '대기'").run(r.message_id, userId);
        db.prepare("UPDATE mail_messages SET outcome = 'unlinked', interpret_attempts = 0 WHERE id = ? AND user_id = ?").run(r.message_id, userId);
      }
      result.requeued = pending.length;
    }
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
  if (result.requeued) enqueue(db, userId, 'mail');
  return result;
}

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
    // 같은 공고 URL의 지원 건이 있으면 새로 만들지 않고 그 건을 돌려준다(추천에서 두 번 저장해도 하나). 조회와 삽입 사이에 await가 없어 같은 프로세스에서 겹치지 않는다.
    if (body.data.postingUrl) {
      const same = db.prepare('SELECT * FROM applications WHERE user_id = ? AND posting_url = ? ORDER BY created_at LIMIT 1').get(user.id, body.data.postingUrl) as Row | undefined;
      if (same) return reply.status(200).send(toApplication(same));
    }
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

  app.post('/applications/import', { bodyLimit: 3 * 1024 * 1024 }, async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const body = applicationImportSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ message: 'CSV 파일을 확인하세요.' });
    const result = importApplications(db, user.id, body.data.csv);
    if (!result.imported && !result.duplicates) return reply.status(400).send({ message: '가져올 행이 없습니다. 회사·직무·상태 열이 있는지 확인하세요.' });
    return result;
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
        locked_fields: patch.lockedFields ? JSON.stringify([...new Set(patch.lockedFields)]) : current.locked_fields,
      };
      db.prepare('UPDATE applications SET company = ?, role_title = ?, posting_url = ?, status = ?, read_status = ?, locked_fields = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(next.company, next.role_title, next.posting_url, next.status, next.read_status, next.locked_fields, at, current.id, user.id);
      const log = db.prepare("INSERT INTO application_events (id, application_id, field, from_value, to_value, source, at) VALUES (?, ?, ?, ?, ?, 'manual', ?)");
      if (next.status !== current.status) log.run(randomUUID(), current.id, 'status', current.status, next.status, at);
      if (next.read_status !== current.read_status) log.run(randomUUID(), current.id, 'readStatus', current.read_status, next.read_status, at);
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
    return toApplication(db.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').get(request.params.id, user.id) as Row);
  });

  app.delete<{ Params: { id: string } }>('/applications/:id', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const result = db.prepare('DELETE FROM applications WHERE id = ? AND user_id = ?').run(request.params.id, user.id);
    return result.changes === 1 ? reply.status(204).send() : reply.status(404).send({ message: '찾을 수 없습니다.' });
  });
}
