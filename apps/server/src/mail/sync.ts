import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { decrypt } from '../secrets.js';
import type { ClaimedJob, JobOutcome } from '../recommend/jobs.js';
import { classifyMail, mainBody, platformOf, subjectHint, type MailStatus } from './classify.js';
import { applyInterpretation, applyMessage, requestReview, type Outcome } from './apply.js';
import { bodyKey, MailSourceError, type BackfillSource, type Cursor, type MailboxBatch, type MailBody, type MailBodySource, type MailSource } from './naver.js';
import type { MailInterpretation } from '../prompts/mail.js';

export type Interpret = (mail: { subject: string; senderDomain: string; ruleStatus: string; body: string }) => Promise<MailInterpretation>;
// 실행당 AI 해석 상한(요금·처리 시간). 남은 메일은 다음 실행에서 이어서 해석한다.
const INTERPRET_CAP = 60;
const MAX_INTERPRET_ATTEMPTS = 3;

// 최초 조회 기간은 연결 때 사용자가 고른 값이다(covered_since). 이전 연결은 동의 시각 기준 90일로 채웠다(DB 버전 13).
export const INITIAL_DAYS = 90;

type Conn = { account: string; secret: string; status: string; consent_at: string; covered_since: string | null; backfill_since: string | null };
type Counts = Record<Outcome | 'stored' | 'skipped' | 'ignored' | 'interpreted' | 'aiFailures', number>;

// 받은 메일을 저장·판정한다. 채용과 무관하거나 이미 처리한 메일은 저장하지 않는다. 연결이 사라졌으면 false.
function storeBatch(db: DatabaseSync, userId: string, batch: MailboxBatch, counts: Counts, bodies: Map<string, MailBody>) {
  for (const mail of batch.messages) {
    db.exec('BEGIN IMMEDIATE');
    try {
      // 연결 해제·계정 삭제가 겹치면 연결 행이 없으므로 더 반영하지 않는다.
      if (!db.prepare('SELECT 1 FROM mail_connections WHERE user_id = ?').get(userId)) { db.exec('ROLLBACK'); return false; }
      const verdict = classifyMail(mail);
      const exists = db.prepare("SELECT 1 FROM mail_messages WHERE user_id = ? AND provider = 'naver' AND message_key = ?").get(userId, mail.messageKey);
      if (!verdict || exists) { counts.skipped++; db.exec('COMMIT'); continue; }
      const id = randomUUID();
      // 최소 근거만 저장한다: 메시지 키·수신 시각·제목 앞부분·짧은 발췌·공고 키. 본문·주소는 저장하지 않는다.
      db.prepare("INSERT INTO mail_messages (id, user_id, provider, message_key, received_at, subject, platform, classification, evidence, posting_key, outcome, processed_at, mailbox, uid_validity, uid) VALUES (?, ?, 'naver', ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)")
        .run(id, userId, mail.messageKey, mail.receivedAt, mail.subject.slice(0, 80), verdict.platform, verdict.status, verdict.evidence, verdict.postingKeys.join(',') || null, new Date().toISOString(), batch.mailbox, batch.uidValidity, mail.uid);
      bodies.set(bodyKey({ mailbox: batch.mailbox, uid: mail.uid }), { text: mail.text, links: mail.links, fromAddress: mail.fromAddress });
      const outcome = applyMessage(db, { id, userId, messageKey: mail.messageKey, verdict, subject: mail.subject, receivedAt: mail.receivedAt });
      db.prepare('UPDATE mail_messages SET outcome = ? WHERE id = ? AND user_id = ?').run(outcome, id, userId);
      db.exec('COMMIT');
      counts.stored++;
      counts[outcome]++;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }
  return true;
}

export function createMailHandler(db: DatabaseSync, secretKey: Buffer, source: MailSource, ai?: { interpret: Interpret; bodies: MailBodySource }, backfill?: BackfillSource) {
  return async (job: ClaimedJob): Promise<JobOutcome> => {
    const conn = db.prepare('SELECT account, secret, status, consent_at, covered_since, backfill_since FROM mail_connections WHERE user_id = ?').get(job.userId) as Conn | undefined;
    if (!conn) return { status: '실패', errorCode: 'not_connected', result: {} };
    const cursors = new Map((db.prepare('SELECT mailbox, uid_validity, last_uid FROM mail_cursors WHERE user_id = ?').all(job.userId) as { mailbox: string; uid_validity: string; last_uid: number }[])
      .map(r => [r.mailbox, { uidValidity: r.uid_validity, lastUid: r.last_uid } satisfies Cursor]));
    const since = conn.covered_since ? new Date(conn.covered_since) : new Date(Date.now() - INITIAL_DAYS * 86_400_000);
    let batches;
    let password: string;
    // 비밀 키가 바뀌었거나 저장값이 손상되면 다시 연결해야 하므로 인증 실패로 표시한다.
    try { password = decrypt(secretKey, conn.secret); } catch {
      db.prepare("UPDATE mail_connections SET status = '인증 실패', last_error = 'secret_invalid' WHERE user_id = ?").run(job.userId);
      return { status: '실패', errorCode: 'secret_invalid', result: {} };
    }
    // 이번 실행에서 받은 본문은 해석 단계까지 메모리에만 둔다.
    const bodies = new Map<string, MailBody>();
    try {
      batches = await source(conn.account, password, cursors, since);
    } catch (error) {
      const code = error instanceof MailSourceError ? error.code : 'internal';
      db.prepare('UPDATE mail_connections SET status = ?, last_error = ? WHERE user_id = ?').run(code === 'auth_failed' ? '인증 실패' : conn.status, code, job.userId);
      return { status: '실패', errorCode: code, result: {} };
    }
    const counts: Counts = { stored: 0, skipped: 0, applied: 0, created: 0, no_change: 0, review: 0, suppressed: 0, unlinked: 0, ignored: 0, interpreted: 0, aiFailures: 0 };
    let rangeIncomplete = false;
    let more = false;
    for (const batch of batches) {
      if (batch.oldestDate && batch.oldestDate > since.toISOString()) rangeIncomplete = true;
      if (!batch.complete) more = true;
      if (!storeBatch(db, job.userId, batch, counts, bodies)) return { status: '실패', errorCode: 'disconnected', result: counts };
      // 메일 처리를 모두 저장한 뒤 위치를 전진시킨다. 받은 메일이 없으면 위치를 바꾸지 않는다
      // (처음 조회에서 0을 저장하면 다음 실행이 UID 1부터, 즉 조회 기간보다 오래된 메일까지 가져온다).
      if (!batch.messages.length) continue;
      const lastUid = Math.max(...batch.messages.map(m => m.uid));
      db.prepare(`INSERT INTO mail_cursors (user_id, mailbox, uid_validity, last_uid) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, mailbox) DO UPDATE SET uid_validity = excluded.uid_validity, last_uid = excluded.last_uid`).run(job.userId, batch.mailbox, batch.uidValidity, lastUid);
    }
    // 과거 범위 넓히기: 현재 조회 위치는 그대로 두고 [목표 시작, 조회 범위 시작) 기간을 따로 진행한다.
    let backfillMore = false;
    if (backfill && conn.backfill_since && conn.covered_since) {
      const progress = new Map((db.prepare('SELECT mailbox, uid_validity, below_uid FROM mail_backfill WHERE user_id = ?').all(job.userId) as { mailbox: string; uid_validity: string; below_uid: number }[])
        .map(r => [r.mailbox, { uidValidity: r.uid_validity, belowUid: r.below_uid }]));
      let past;
      try { past = await backfill(conn.account, password, progress, new Date(conn.backfill_since), new Date(conn.covered_since)); }
      catch (error) { return { status: '일부 실패', errorCode: error instanceof MailSourceError ? error.code : 'internal', result: { ...counts, rangeIncomplete, more } }; }
      for (const batch of past) {
        if (!storeBatch(db, job.userId, batch, counts, bodies)) return { status: '실패', errorCode: 'disconnected', result: counts };
        if (batch.lowestUid !== null) db.prepare(`INSERT INTO mail_backfill (user_id, mailbox, uid_validity, below_uid) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, mailbox) DO UPDATE SET uid_validity = excluded.uid_validity, below_uid = excluded.below_uid`).run(job.userId, batch.mailbox, batch.uidValidity, batch.lowestUid);
        if (!batch.complete) backfillMore = true;
      }
      // 모든 편지함을 다 가져오면 조회 범위 시작을 목표로 옮기고 진행 위치를 지운다.
      if (!backfillMore) {
        db.prepare('UPDATE mail_connections SET covered_since = backfill_since, backfill_since = NULL WHERE user_id = ? AND backfill_since = ?').run(job.userId, conn.backfill_since);
        db.prepare('DELETE FROM mail_backfill WHERE user_id = ?').run(job.userId);
      }
    }
    const aiFailureCodes: Record<string, number> = {};
    if (ai) await interpretUnlinked(db, job.userId, ai, bodies, counts, conn.account, password, aiFailureCodes);
    // 범위 미달은 최초 조회에서만 알 수 있으므로 한 번 기록하면 재연결 전까지 유지한다.
    db.prepare("UPDATE mail_connections SET status = '정상', last_success_at = ?, last_error = NULL, range_incomplete = max(range_incomplete, ?) WHERE user_id = ?").run(new Date().toISOString(), rangeIncomplete ? 1 : 0, job.userId);
    return { status: counts.aiFailures ? '일부 실패' : '성공', result: { ...counts, aiFailureCodes, rangeIncomplete, more: more || backfillMore } };
  };
}

// 상태는 규칙이 명확하면 규칙을 따르고, AI 상태는 규칙이 모호하거나 판정하지 못했을 때만 쓴다.
// 합격은 규칙 근거(결과 통보 문구)가 있을 때만 인정하고 AI만 합격이라 하면 확인받는다(2026-11-15 실측: qwen3:1.7b가 열람·접수 메일 10건을 합격으로 봄).
export function mergeMailStatus(rule: MailStatus | null, ai: MailStatus): MailStatus {
  if (rule && rule !== '모호') return rule;
  return ai === '합격' ? '모호' : ai;
}

function unreadable(db: DatabaseSync, userId: string, row: Unlinked) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = db.prepare(`UPDATE mail_messages SET interpret_attempts = interpret_attempts + 1 WHERE id = ? AND user_id = ? AND outcome = 'unlinked'
      AND EXISTS (SELECT 1 FROM mail_connections c WHERE c.user_id = ?) RETURNING interpret_attempts`).get(row.id, userId, userId) as { interpret_attempts: number } | undefined;
    if (r && r.interpret_attempts >= MAX_INTERPRET_ATTEMPTS) {
      const outcome = requestReview(db, { id: row.id, userId, messageKey: row.message_key, subject: row.subject, receivedAt: row.received_at, verdict: { status: row.classification as MailStatus, evidence: null, platform: row.platform, postingKeys: [] } }, '연결 불명', subjectHint(row.subject) ?? {});
      db.prepare('UPDATE mail_messages SET outcome = ? WHERE id = ? AND user_id = ?').run(outcome, row.id, userId);
    }
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

type Unlinked = { id: string; message_key: string; subject: string; received_at: string | null; classification: string; platform: string | null; mailbox: string | null; uid_validity: string | null; uid: number | null };

// 규칙으로 대상을 찾지 못한 메일을 AI로 해석해 지원 건 생성·연결·확인 요청으로 넘긴다.
// 오래된 메일부터 해석한다: 지원 완료 메일로 지원 건이 먼저 생겨야 뒤의 열람·결과 메일이 그 건에 붙는다(2026-11-14 실측: 최신순이면 열람 0%).
async function interpretUnlinked(db: DatabaseSync, userId: string, ai: { interpret: Interpret; bodies: MailBodySource }, cached: Map<string, MailBody>, counts: Record<string, number>, account: string, password: string, aiFailureCodes: Record<string, number>) {
  const rows = db.prepare(`SELECT id, message_key, subject, received_at, classification, platform, mailbox, uid_validity, uid FROM mail_messages
    WHERE user_id = ? AND outcome = 'unlinked' AND interpret_attempts < ? ORDER BY received_at ASC LIMIT ?`).all(userId, MAX_INTERPRET_ATTEMPTS, INTERPRET_CAP) as Unlinked[];
  const missing = rows.filter(r => r.mailbox && r.uid !== null && !cached.has(bodyKey({ mailbox: r.mailbox, uid: r.uid })))
    .map(r => ({ mailbox: r.mailbox!, uidValidity: r.uid_validity ?? '', uid: r.uid! }));
  let fetched = new Map<string, MailBody>();
  let fetchFailed = false;
  try { fetched = await ai.bodies(account, password, missing); } catch { fetchFailed = true; /* 본문 재조회 실패는 다음 실행에서 다시 시도 */ }
  for (const row of rows) {
    const key = row.mailbox && row.uid !== null ? bodyKey({ mailbox: row.mailbox, uid: row.uid }) : '';
    const body = cached.get(key) ?? fetched.get(key);
    if (!body) {
      // 재조회 자체가 실패했으면 다음 실행에서 다시 본다. 메일함에서 찾지 못한 메일(삭제·이동·위치 없음)은
      // 시도 횟수를 쓰고 한도에 이르면 확인 요청으로 넘긴다(대기열 앞을 계속 차지하지 않게).
      if (!fetchFailed || !key) unreadable(db, userId, row);
      continue;
    }
    let interp: MailInterpretation;
    // 저장된 분류는 이전 해석 결과일 수 있어 규칙 판정을 본문으로 다시 한다.
    const rule = classifyMail({ fromAddress: body.fromAddress, subject: row.subject, text: body.text, links: body.links })?.status ?? null;
    try {
      // 추천 공고·하단 안내 영역은 AI에 넘기지 않는다(그 안의 회사를 지원으로 오인).
      interp = await ai.interpret({ subject: row.subject, senderDomain: body.fromAddress.split('@')[1] ?? '', ruleStatus: rule ?? row.classification, body: mainBody(body.text) });
      // 플랫폼 알림 제목에서 회사(·직무)를 읽을 수 있으면 AI 값보다 우선한다. 회사·직무가 모두 제목에 있으면 확신으로 본다.
      const hint = platformOf(body.fromAddress) ? subjectHint(row.subject) : null;
      interp = { ...interp, status: mergeMailStatus(rule, interp.status),
        ...(hint ? { company: hint.company, roleTitle: hint.roleTitle ?? interp.roleTitle, ...(hint.roleTitle ? { confidence: 'high' as const } : {}) } : {}) };
    } catch (error) {
      counts.aiFailures = (counts.aiFailures ?? 0) + 1;
      // 원인 코드별 건수를 남겨 화면·운영자가 키·잔액·연결 문제를 구분하게 한다(본문은 남기지 않음).
      const code = (error as { code?: string }).code ?? 'internal';
      aiFailureCodes[code] = (aiFailureCodes[code] ?? 0) + 1;
      // 잘못된 출력·응답 시간 초과는 그 메일만의 문제일 수 있어 시도 횟수를 쓰고 다음 메일로 넘어간다(3회면 더 해석하지 않음).
      // 키·잔액·연결 같은 일시 실패는 남은 메일도 실패하므로 멈추고 다음 실행에서 다시 해석한다.
      if (code !== 'ai_invalid_output' && code !== 'ai_timeout') break;
      db.prepare('UPDATE mail_messages SET interpret_attempts = interpret_attempts + 1 WHERE id = ? AND user_id = ?').run(row.id, userId);
      continue;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      // 해석 중 연결 해제·계정 삭제·이미 처리됐으면 반영하지 않는다.
      const still = db.prepare("SELECT 1 FROM mail_messages m JOIN mail_connections c ON c.user_id = m.user_id WHERE m.id = ? AND m.user_id = ? AND m.outcome = 'unlinked'").get(row.id, userId);
      if (!still) { db.exec('ROLLBACK'); continue; }
      const outcome = applyInterpretation(db, { id: row.id, userId, messageKey: row.message_key, subject: row.subject, receivedAt: row.received_at, verdict: { status: row.classification as never, evidence: null, platform: row.platform ?? platformOf(body.fromAddress), postingKeys: [] } }, interp);
      db.prepare('UPDATE mail_messages SET outcome = ?, classification = ?, interpret_attempts = interpret_attempts + 1 WHERE id = ? AND user_id = ?').run(outcome, interp.status, row.id, userId);
      db.exec('COMMIT');
      counts.interpreted = (counts.interpreted ?? 0) + 1;
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }
}
