import type { DatabaseSync } from 'node:sqlite';

// 보관 기한(기술 설계 부록 E 표): 오류·작업 기록 30일. 끝난 작업·처리한 확인 요청만 지운다.
// 채용 근거(mail_messages)는 지원 건이 있는 동안 유지하고, 같은 메일 재처리 방지를 위해 최소 키는 남긴다.
const DAY = 86_400_000;

export function purgeExpired(db: DatabaseSync, now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * DAY).toISOString();
  const jobs = db.prepare("DELETE FROM jobs WHERE status IN ('성공', '일부 실패', '실패') AND finished_at < ?").run(cutoff).changes;
  const reviews = db.prepare("DELETE FROM review_requests WHERE status IN ('처리', '무시') AND resolved_at < ?").run(cutoff).changes;
  // 만료된 세션·초대 코드도 지운다.
  const sessions = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString()).changes;
  const invites = db.prepare('DELETE FROM invites WHERE expires_at < ? AND used_at IS NULL').run(cutoff).changes;
  return { jobs, reviews, sessions, invites };
}
