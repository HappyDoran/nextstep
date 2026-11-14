import type { DatabaseSync } from 'node:sqlite';
import { enqueue } from './recommend/jobs.js';
import { purgeExpired } from './retention.js';

// 서버 예약 실행: 브라우저가 꺼져 있어도 서버 프로세스가 공고 갱신은 하루 한 번(지정 시각 이후), 메일 조회는 매시간 작업을 만든다(기획서 6절).
// 조건: 자동화 권한(1차는 초대 테스트 권한) AND 자동 ON AND 필요한 연결 정상. 수동 요청과 같은 작업 경로를 쓴다.
const TIME_ZONE = 'Asia/Seoul';

export function seoulParts(at: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(at).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

type Eligible = { id: string; has_basis: number; mail_ok: number };

export function runSchedule(db: DatabaseSync, at: Date, hour: number) {
  const { date, hour: current } = seoulParts(at);
  const users = db.prepare(`SELECT u.id,
      (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = u.id) AND EXISTS (SELECT 1 FROM documents d WHERE d.user_id = u.id AND d.kind = 'resume')) AS has_basis,
      EXISTS (SELECT 1 FROM mail_connections c WHERE c.user_id = u.id AND c.status = '정상') AS mail_ok
    FROM users u WHERE u.auto_enabled = 1 AND u.test_permission = 1`).all() as Eligible[];
  let created = 0;
  for (const user of users) {
    // 실행 키: 공고 갱신은 날짜(지정 시각 이후 하루 한 번), 메일은 날짜+시(매시간 한 번).
    const runs = [...(user.has_basis && current >= hour ? [{ kind: 'refresh' as const, key: date }] : []), ...(user.mail_ok ? [{ kind: 'mail' as const, key: `${date}T${String(current).padStart(2, '0')}` }] : [])];
    for (const { kind, key } of runs) {
      db.exec('BEGIN IMMEDIATE');
      try {
        // 같은 날 같은 종류는 한 번만 만든다(서버 재시작·여러 번 검사해도 중복 없음).
        const claimed = db.prepare('INSERT OR IGNORE INTO schedule_runs (user_id, run_date, kind, created_at) VALUES (?, ?, ?, ?)').run(user.id, key, kind, at.toISOString());
        if (claimed.changes === 1) {
          const job = enqueue(db, user.id, kind, undefined, true);
          db.prepare('UPDATE schedule_runs SET job_id = ? WHERE user_id = ? AND run_date = ? AND kind = ?').run(job.id, user.id, key, kind);
          created++;
        }
        db.exec('COMMIT');
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    }
  }
  return created;
}

export function startScheduler(db: DatabaseSync, hour: number, intervalMs = 60_000) {
  const tick = () => {
    try { runSchedule(db, new Date(), hour); } catch { /* 다음 검사에서 다시 시도 */ }
    try { purgeExpired(db); } catch { /* 다음 검사에서 다시 시도 */ }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}

// 자동 OFF·연결 해제 시 아직 시작하지 않은 예약 작업을 정리한다. 실행 중 작업은 끝까지 안전하게 마친다.
export function cancelQueuedScheduled(db: DatabaseSync, userId: string, kind?: 'refresh' | 'mail') {
  db.prepare(`DELETE FROM jobs WHERE user_id = ? AND scheduled = 1 AND status = '대기' ${kind ? 'AND kind = ?' : ''}`).run(...(kind ? [userId, kind] : [userId]));
}
