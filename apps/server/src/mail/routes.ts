import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { mailBackfillRequestSchema, mailConnectRequestSchema, mailConnectionSchema, reviewActionSchema, reviewSchema } from '@nextstep/contracts';
import { requireUser } from '../auth.js';
import { encrypt } from '../secrets.js';
import { enqueue, latestJob } from '../recommend/jobs.js';
import { applyToApplication, type StoredMessage } from './apply.js';
import { MailSourceError, type MailSource } from './naver.js';

type ConnRow = { account: string; status: string; consent_at: string; last_success_at: string | null; last_error: string | null; range_incomplete: number; covered_since: string | null; backfill_since: string | null };
type ReviewRow = { id: string; reason: string; status: string; held: number; created_at: string; message_id: string; message_key: string; subject: string; received_at: string | null; platform: string | null; classification: string; evidence: string | null };

export function registerMail(app: FastifyInstance, db: DatabaseSync, secretKey: Buffer, source: MailSource) {
  app.get('/mail/connection', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const row = db.prepare('SELECT account, status, consent_at, last_success_at, last_error, range_incomplete, covered_since, backfill_since FROM mail_connections WHERE user_id = ?').get(user.id) as ConnRow | undefined;
    if (!row) return reply.status(404).send({ message: '연결한 메일이 없습니다.' });
    return mailConnectionSchema.parse({ provider: 'naver', account: row.account, status: row.status, consentAt: row.consent_at, lastSuccessAt: row.last_success_at, lastError: row.last_error, rangeIncomplete: row.range_incomplete === 1, coveredSince: row.covered_since, backfillSince: row.backfill_since, lastJob: latestJob(db, user.id, 'mail') });
  });

  // 연결 검사: 실제 로그인으로 확인한 뒤에만 암호화해 저장하고 최초 조회 작업을 만든다.
  app.put('/mail/connection', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const body = mailConnectRequestSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ message: '요청을 확인하세요.' });
    try {
      await source(body.data.account, body.data.appPassword, new Map(), new Date(Date.now() + 86_400_000));
    } catch (error) {
      const code = error instanceof MailSourceError ? error.code : 'protocol';
      // 원인별 상태: 인증 422, 네트워크 503, 보안 연결·서버 응답 502. 화면이 원인별 안내를 보여 준다.
      return reply.status(code === 'auth_failed' ? 422 : code === 'network' ? 503 : 502).send({ message: code === 'auth_failed' ? '네이버 계정 또는 애플리케이션 비밀번호를 확인하세요. IMAP 사용 설정이 켜져 있어야 합니다.' : '네이버 메일에 연결하지 못했습니다. 잠시 후 다시 시도하세요.', code });
    }
    const at = new Date().toISOString();
    // 고른 최초 조회 기간으로 조회 범위를 정한다. 재연결하면 과거 범위 넓히기 진행도 지운다.
    const coveredSince = new Date(Date.now() - body.data.days * 86_400_000).toISOString();
    db.prepare(`INSERT INTO mail_connections (user_id, provider, account, secret, status, consent_at, created_at, covered_since) VALUES (?, 'naver', ?, ?, '정상', ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET account = excluded.account, secret = excluded.secret, status = '정상', consent_at = excluded.consent_at, last_error = NULL, range_incomplete = 0, covered_since = excluded.covered_since, backfill_since = NULL`)
      .run(user.id, body.data.account, encrypt(secretKey, body.data.appPassword), at, at, coveredSince);
    db.prepare('DELETE FROM mail_backfill WHERE user_id = ?').run(user.id);
    return reply.status(202).send(enqueue(db, user.id, 'mail'));
  });

  // 과거 범위 넓히기: 지금 조회 범위보다 이전만 대상으로 한다. 현재 조회 위치(커서)는 바꾸지 않는다.
  app.post('/mail/backfill', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const body = mailBackfillRequestSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ message: '기간을 확인하세요.' });
    const conn = db.prepare('SELECT covered_since FROM mail_connections WHERE user_id = ?').get(user.id) as { covered_since: string | null } | undefined;
    if (!conn) return reply.status(409).send({ message: '네이버 메일을 먼저 연결하세요.' });
    const target = new Date(Date.now() - body.data.days * 86_400_000).toISOString();
    if (conn.covered_since && target >= conn.covered_since) return reply.status(400).send({ message: '이미 조회한 범위입니다. 더 긴 기간을 고르세요.' });
    db.prepare('UPDATE mail_connections SET backfill_since = ? WHERE user_id = ?').run(target, user.id);
    db.prepare('DELETE FROM mail_backfill WHERE user_id = ?').run(user.id);
    return reply.status(202).send(enqueue(db, user.id, 'mail'));
  });

  app.post('/mail/sync', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    if (!db.prepare('SELECT 1 FROM mail_connections WHERE user_id = ?').get(user.id)) return reply.status(409).send({ message: '네이버 메일을 먼저 연결하세요.' });
    return reply.status(202).send(enqueue(db, user.id, 'mail'));
  });

  // 연결 해제: 조회를 멈추고 비밀정보·위치를 지운다. 메일로 만든 지원 건은 유지 또는 삭제를 고른다.
  app.delete<{ Querystring: { keepApplications?: string } }>('/mail/connection', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const keep = request.query.keepApplications !== 'false';
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM mail_connections WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM mail_cursors WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM mail_backfill WHERE user_id = ?').run(user.id);
      // 연결 해제는 수동·예약 구분 없이 대기 중인 메일 작업을 모두 정리한다.
      db.prepare("DELETE FROM jobs WHERE user_id = ? AND kind = 'mail' AND status = '대기'").run(user.id);
      if (!keep) {
        // 같은 과거 메일로 다시 만들어지지 않도록 근거 키를 억제 목록에 남긴다.
        db.prepare(`INSERT OR IGNORE INTO evidence_suppressions (user_id, message_key, application_id, created_at)
          SELECT m.user_id, m.message_key, m.application_id, ? FROM mail_messages m JOIN applications a ON a.id = m.application_id WHERE a.user_id = ? AND a.origin = 'mail'`).run(new Date().toISOString(), user.id);
        db.prepare("DELETE FROM applications WHERE user_id = ? AND origin = 'mail'").run(user.id);
      }
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
    return reply.status(204).send();
  });

  app.get('/reviews', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const rows = db.prepare(`SELECT r.id, r.reason, r.status, r.held, r.created_at, m.id AS message_id, m.message_key, m.subject, m.received_at, m.platform, m.classification, m.evidence
      FROM review_requests r JOIN mail_messages m ON m.id = r.message_id WHERE r.user_id = ? AND r.status = '대기' ORDER BY r.held, m.received_at DESC`).all(user.id) as ReviewRow[];
    return rows.map(r => reviewSchema.parse({ id: r.id, reason: r.reason, createdAt: r.created_at, subject: r.subject, receivedAt: r.received_at, platform: r.platform, classification: r.classification, evidence: r.evidence, held: r.held === 1 }));
  });

  // 확인 목록 처리: 연결·새 지원 건으로 확정·무시만 제공한다. 무시한 근거는 다시 요청하지 않는다.
  app.post<{ Params: { id: string } }>('/reviews/:id', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const action = reviewActionSchema.safeParse(request.body);
    if (!action.success) return reply.status(400).send({ message: '요청을 확인하세요.' });
    // 보류: 처리하지 않고 목록 아래로 옮긴다. 보류를 풀면 다시 위로 온다.
    if (action.data.action === 'hold') {
      const r = db.prepare("UPDATE review_requests SET held = ? WHERE id = ? AND user_id = ? AND status = '대기'").run(action.data.held ? 1 : 0, request.params.id, user.id);
      return r.changes ? reply.status(204).send() : reply.status(404).send({ message: '찾을 수 없습니다.' });
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare("SELECT r.id, m.id AS message_id, m.message_key, m.subject, m.received_at, m.classification, m.platform FROM review_requests r JOIN mail_messages m ON m.id = r.message_id WHERE r.id = ? AND r.user_id = ? AND r.status = '대기'")
        .get(request.params.id, user.id) as { id: string; message_id: string; message_key: string; subject: string; received_at: string | null; classification: string; platform: string | null } | undefined;
      if (!row) { db.exec('ROLLBACK'); return reply.status(404).send({ message: '찾을 수 없습니다.' }); }
      const status = action.data.action === 'ignore' ? null : (action.data.status ?? row.classification);
      const msg: StoredMessage = { id: row.message_id, userId: user.id, messageKey: row.message_key, subject: row.subject, receivedAt: row.received_at, verdict: { status: status as never, evidence: null, platform: row.platform, postingKeys: [] } };
      if (action.data.action === 'link') {
        const target = db.prepare('SELECT id, status, read_status, posting_url, locked_fields FROM applications WHERE id = ? AND user_id = ?').get(action.data.applicationId, user.id) as { id: string; status: string; read_status: string; posting_url: string | null; locked_fields: string } | undefined;
        if (!target || status === '모호') { db.exec('ROLLBACK'); return reply.status(400).send({ message: '연결할 지원 건과 상태를 확인하세요.' }); }
        // 사용자가 확정한 연결은 충돌 확인 없이 반영하되 이력은 남긴다.
        db.prepare("UPDATE review_requests SET status = '처리', resolved_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
        applyToApplication(db, msg, target, { force: true });
      } else if (action.data.action === 'create') {
        if (!status || status === '모호' || status === '열람') { db.exec('ROLLBACK'); return reply.status(400).send({ message: '상태를 선택하세요.' }); }
        const appId = randomUUID();
        const at = new Date().toISOString();
        db.prepare("INSERT INTO applications (id, user_id, company, role_title, status, created_at, updated_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?, 'mail')")
          .run(appId, user.id, action.data.company, action.data.roleTitle, status, at, at);
        db.prepare("INSERT INTO application_events (id, application_id, field, from_value, to_value, source, at, message_id) VALUES (?, ?, 'status', '미지원', ?, 'mail', ?, ?)").run(randomUUID(), appId, status, at, row.message_id);
        db.prepare('UPDATE mail_messages SET application_id = ? WHERE id = ?').run(appId, row.message_id);
        db.prepare("UPDATE review_requests SET status = '처리', resolved_at = ? WHERE id = ?").run(at, row.id);
      } else {
        db.prepare("UPDATE review_requests SET status = '무시', resolved_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
        db.prepare('INSERT OR IGNORE INTO evidence_suppressions (user_id, message_key, created_at) VALUES (?, ?, ?)').run(user.id, row.message_key, new Date().toISOString());
      }
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
    return reply.status(204).send();
  });
}
