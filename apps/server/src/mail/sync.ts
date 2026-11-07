import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { decrypt } from '../secrets.js';
import type { ClaimedJob, JobOutcome } from '../recommend/jobs.js';
import { classifyMail } from './classify.js';
import { applyMessage, type Outcome } from './apply.js';
import { MailSourceError, type Cursor, type MailSource } from './naver.js';

// 최초 조회는 동의받은 최근 3개월 고정값이다.
export const INITIAL_DAYS = 90;

type Conn = { account: string; secret: string; status: string; consent_at: string };

export function createMailHandler(db: DatabaseSync, secretKey: Buffer, source: MailSource) {
  return async (job: ClaimedJob): Promise<JobOutcome> => {
    const conn = db.prepare('SELECT account, secret, status, consent_at FROM mail_connections WHERE user_id = ?').get(job.userId) as Conn | undefined;
    if (!conn) return { status: '실패', errorCode: 'not_connected', result: {} };
    const cursors = new Map((db.prepare('SELECT mailbox, uid_validity, last_uid FROM mail_cursors WHERE user_id = ?').all(job.userId) as { mailbox: string; uid_validity: string; last_uid: number }[])
      .map(r => [r.mailbox, { uidValidity: r.uid_validity, lastUid: r.last_uid } satisfies Cursor]));
    const since = new Date(Date.now() - INITIAL_DAYS * 86_400_000);
    let batches;
    try {
      batches = await source(conn.account, decrypt(secretKey, conn.secret), cursors, since);
    } catch (error) {
      const code = error instanceof MailSourceError ? error.code : 'internal';
      db.prepare('UPDATE mail_connections SET status = ?, last_error = ? WHERE user_id = ?').run(code === 'auth_failed' ? '인증 실패' : conn.status, code, job.userId);
      return { status: '실패', errorCode: code, result: {} };
    }
    const counts: Record<Outcome | 'stored' | 'skipped', number> = { stored: 0, skipped: 0, applied: 0, created: 0, no_change: 0, review: 0, suppressed: 0, unlinked: 0 };
    let rangeIncomplete = false;
    let more = false;
    for (const batch of batches) {
      if (batch.oldestDate && batch.oldestDate > since.toISOString()) rangeIncomplete = true;
      if (!batch.complete) more = true;
      for (const mail of batch.messages) {
        // 연결 해제·계정 삭제가 겹치면 연결 행이 없으므로 더 반영하지 않는다.
        db.exec('BEGIN IMMEDIATE');
        try {
          if (!db.prepare('SELECT 1 FROM mail_connections WHERE user_id = ?').get(job.userId)) { db.exec('ROLLBACK'); return { status: '실패', errorCode: 'disconnected', result: counts }; }
          const verdict = classifyMail(mail);
          const exists = db.prepare("SELECT 1 FROM mail_messages WHERE user_id = ? AND provider = 'naver' AND message_key = ?").get(job.userId, mail.messageKey);
          // 채용과 무관한 메일과 이미 처리한 메일은 저장하지 않는다(같은 메일 반복 처리 방지).
          if (!verdict || exists) { counts.skipped++; db.exec('COMMIT'); continue; }
          const id = randomUUID();
          // 최소 근거만 저장한다: 메시지 키·수신 시각·제목 앞부분·짧은 발췌·공고 키. 본문·주소는 저장하지 않는다.
          db.prepare("INSERT INTO mail_messages (id, user_id, provider, message_key, received_at, subject, platform, classification, evidence, posting_key, outcome, processed_at) VALUES (?, ?, 'naver', ?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
            .run(id, job.userId, mail.messageKey, mail.receivedAt, mail.subject.slice(0, 80), verdict.platform, verdict.status, verdict.evidence, verdict.postingKeys.join(',') || null, new Date().toISOString());
          const outcome = applyMessage(db, { id, userId: job.userId, messageKey: mail.messageKey, verdict, subject: mail.subject, receivedAt: mail.receivedAt });
          db.prepare('UPDATE mail_messages SET outcome = ? WHERE id = ?').run(outcome, id);
          db.exec('COMMIT');
          counts.stored++;
          counts[outcome]++;
        } catch (error) {
          if (db.isTransaction) db.exec('ROLLBACK');
          throw error;
        }
      }
      // 메일 처리를 모두 저장한 뒤 위치를 전진시킨다.
      const lastUid = batch.messages.length ? Math.max(...batch.messages.map(m => m.uid)) : (cursors.get(batch.mailbox)?.uidValidity === batch.uidValidity ? cursors.get(batch.mailbox)!.lastUid : 0);
      db.prepare(`INSERT INTO mail_cursors (user_id, mailbox, uid_validity, last_uid) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, mailbox) DO UPDATE SET uid_validity = excluded.uid_validity, last_uid = excluded.last_uid`).run(job.userId, batch.mailbox, batch.uidValidity, lastUid);
    }
    // 범위 미달은 최초 조회에서만 알 수 있으므로 한 번 기록하면 재연결 전까지 유지한다.
    db.prepare("UPDATE mail_connections SET status = '정상', last_success_at = ?, last_error = NULL, range_incomplete = max(range_incomplete, ?) WHERE user_id = ?").run(new Date().toISOString(), rangeIncomplete ? 1 : 0, job.userId);
    return { status: '성공', result: { ...counts, rangeIncomplete, more } };
  };
}
