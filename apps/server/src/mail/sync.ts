import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { decrypt } from '../secrets.js';
import type { ClaimedJob, JobOutcome } from '../recommend/jobs.js';
import { classifyMail } from './classify.js';
import { applyInterpretation, applyMessage, type Outcome } from './apply.js';
import { bodyKey, MailSourceError, type Cursor, type MailBody, type MailBodySource, type MailSource } from './naver.js';
import type { MailInterpretation } from '../prompts/mail.js';
import { platformOf } from './classify.js';

export type Interpret = (mail: { subject: string; senderDomain: string; ruleStatus: string; body: string }) => Promise<MailInterpretation>;
// 실행당 AI 해석 상한(요금·처리 시간). 남은 메일은 다음 실행에서 이어서 해석한다.
const INTERPRET_CAP = 60;
const MAX_INTERPRET_ATTEMPTS = 3;

// 최초 조회는 동의받은 최근 3개월 고정값이다.
export const INITIAL_DAYS = 90;

type Conn = { account: string; secret: string; status: string; consent_at: string };

export function createMailHandler(db: DatabaseSync, secretKey: Buffer, source: MailSource, ai?: { interpret: Interpret; bodies: MailBodySource }) {
  return async (job: ClaimedJob): Promise<JobOutcome> => {
    const conn = db.prepare('SELECT account, secret, status, consent_at FROM mail_connections WHERE user_id = ?').get(job.userId) as Conn | undefined;
    if (!conn) return { status: '실패', errorCode: 'not_connected', result: {} };
    const cursors = new Map((db.prepare('SELECT mailbox, uid_validity, last_uid FROM mail_cursors WHERE user_id = ?').all(job.userId) as { mailbox: string; uid_validity: string; last_uid: number }[])
      .map(r => [r.mailbox, { uidValidity: r.uid_validity, lastUid: r.last_uid } satisfies Cursor]));
    const since = new Date(Date.now() - INITIAL_DAYS * 86_400_000);
    let batches;
    const password = decrypt(secretKey, conn.secret);
    // 이번 실행에서 받은 본문은 해석 단계까지 메모리에만 둔다.
    const bodies = new Map<string, MailBody>();
    try {
      batches = await source(conn.account, password, cursors, since);
    } catch (error) {
      const code = error instanceof MailSourceError ? error.code : 'internal';
      db.prepare('UPDATE mail_connections SET status = ?, last_error = ? WHERE user_id = ?').run(code === 'auth_failed' ? '인증 실패' : conn.status, code, job.userId);
      return { status: '실패', errorCode: code, result: {} };
    }
    const counts: Record<Outcome | 'stored' | 'skipped' | 'ignored' | 'interpreted' | 'aiFailures', number> = { stored: 0, skipped: 0, applied: 0, created: 0, no_change: 0, review: 0, suppressed: 0, unlinked: 0, ignored: 0, interpreted: 0, aiFailures: 0 };
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
          db.prepare("INSERT INTO mail_messages (id, user_id, provider, message_key, received_at, subject, platform, classification, evidence, posting_key, outcome, processed_at, mailbox, uid_validity, uid) VALUES (?, ?, 'naver', ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)")
            .run(id, job.userId, mail.messageKey, mail.receivedAt, mail.subject.slice(0, 80), verdict.platform, verdict.status, verdict.evidence, verdict.postingKeys.join(',') || null, new Date().toISOString(), batch.mailbox, batch.uidValidity, mail.uid);
          bodies.set(bodyKey({ mailbox: batch.mailbox, uid: mail.uid }), { text: mail.text, links: mail.links, fromAddress: mail.fromAddress });
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
    if (ai) await interpretUnlinked(db, job.userId, ai, bodies, counts, conn.account, password);
    // 범위 미달은 최초 조회에서만 알 수 있으므로 한 번 기록하면 재연결 전까지 유지한다.
    db.prepare("UPDATE mail_connections SET status = '정상', last_success_at = ?, last_error = NULL, range_incomplete = max(range_incomplete, ?) WHERE user_id = ?").run(new Date().toISOString(), rangeIncomplete ? 1 : 0, job.userId);
    return { status: '성공', result: { ...counts, rangeIncomplete, more } };
  };
}

type Unlinked = { id: string; message_key: string; subject: string; received_at: string | null; classification: string; platform: string | null; mailbox: string | null; uid_validity: string | null; uid: number | null };

// 규칙으로 대상을 찾지 못한 메일을 AI로 해석해 지원 건 생성·연결·확인 요청으로 넘긴다.
async function interpretUnlinked(db: DatabaseSync, userId: string, ai: { interpret: Interpret; bodies: MailBodySource }, cached: Map<string, MailBody>, counts: Record<string, number>, account: string, password: string) {
  const rows = db.prepare(`SELECT id, message_key, subject, received_at, classification, platform, mailbox, uid_validity, uid FROM mail_messages
    WHERE user_id = ? AND outcome = 'unlinked' AND interpret_attempts < ? ORDER BY received_at DESC LIMIT ?`).all(userId, MAX_INTERPRET_ATTEMPTS, INTERPRET_CAP) as Unlinked[];
  const missing = rows.filter(r => r.mailbox && r.uid !== null && !cached.has(bodyKey({ mailbox: r.mailbox, uid: r.uid })))
    .map(r => ({ mailbox: r.mailbox!, uidValidity: r.uid_validity ?? '', uid: r.uid! }));
  let fetched = new Map<string, MailBody>();
  try { fetched = await ai.bodies(account, password, missing); } catch { /* 본문 재조회 실패는 다음 실행에서 다시 시도 */ }
  for (const row of rows) {
    const key = row.mailbox && row.uid !== null ? bodyKey({ mailbox: row.mailbox, uid: row.uid }) : '';
    const body = cached.get(key) ?? fetched.get(key);
    if (!body) continue;
    let interp: MailInterpretation;
    try {
      interp = await ai.interpret({ subject: row.subject, senderDomain: body.fromAddress.split('@')[1] ?? '', ruleStatus: row.classification, body: body.text });
    } catch (error) {
      counts.aiFailures = (counts.aiFailures ?? 0) + 1;
      // 시도 횟수는 잘못된 출력에만 쓴다. 크레딧·연결 같은 일시 실패는 남은 메일도 실패하므로 멈추고 다음 실행에서 다시 해석한다.
      if ((error as { code?: string }).code !== 'ai_invalid_output') break;
      db.prepare('UPDATE mail_messages SET interpret_attempts = interpret_attempts + 1 WHERE id = ?').run(row.id);
      continue;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      // 해석 중 연결 해제·계정 삭제·이미 처리됐으면 반영하지 않는다.
      const still = db.prepare("SELECT 1 FROM mail_messages m JOIN mail_connections c ON c.user_id = m.user_id WHERE m.id = ? AND m.outcome = 'unlinked'").get(row.id);
      if (!still) { db.exec('ROLLBACK'); continue; }
      const outcome = applyInterpretation(db, { id: row.id, userId, messageKey: row.message_key, subject: row.subject, receivedAt: row.received_at, verdict: { status: row.classification as never, evidence: null, platform: row.platform ?? platformOf(body.fromAddress), postingKeys: [] } }, interp);
      db.prepare('UPDATE mail_messages SET outcome = ?, classification = ?, interpret_attempts = interpret_attempts + 1 WHERE id = ?').run(outcome, interp.status, row.id);
      db.exec('COMMIT');
      counts.interpreted = (counts.interpreted ?? 0) + 1;
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }
}
