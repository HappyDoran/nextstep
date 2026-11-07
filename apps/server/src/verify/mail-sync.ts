// P1-05 실제 네이버 증분 동기화 검증. 임시 DB에 임시 사용자로 실행하고 끝나면 지운다.
// 출력은 건수·분류 분포뿐이며 제목·주소·본문은 출력하지 않는다.
// 실행: NAVER_IMAP_USER=... NAVER_IMAP_PASSWORD=... pnpm --filter @nextstep/server verify:mail-sync
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../database.js';
import { encrypt, loadSecretKey } from '../secrets.js';
import { enqueue, runNext } from '../recommend/jobs.js';
import { createMailHandler } from '../mail/sync.js';
import { naverBodies, naverSource } from '../mail/naver.js';
import { aiConfigured, usageTotals } from '../ai/openai.js';
import { interpretMail } from '../prompts/mail.js';

async function main() {
  const user = process.env.NAVER_IMAP_USER;
  const pass = process.env.NAVER_IMAP_PASSWORD;
  if (!user || !pass) { console.log(JSON.stringify({ ok: false, code: 'missing_credentials' })); process.exitCode = 1; return; }
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-mail-verify-'));
  try {
    const db = openDatabase(join(dir, 'db.sqlite'));
    const key = loadSecretKey(join(dir, 'secret.key'));
    const userId = randomUUID();
    const at = new Date().toISOString();
    db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(userId, 'verify@example.com', 'x', at);
    db.prepare("INSERT INTO mail_connections (user_id, provider, account, secret, status, consent_at, created_at) VALUES (?, 'naver', ?, ?, '정상', ?, ?)").run(userId, user, encrypt(key, pass), at, at);
    // AI가 설정되면 해석 단계까지 실행한다(실제 메일 본문이 OpenAI로 전달됨). 요금을 줄이려고 1회만 돈다.
    const ai = aiConfigured() ? { interpret: interpretMail, bodies: naverBodies } : undefined;
    const handler = createMailHandler(db, key, naverSource, ai);
    const runs = [];
    for (let i = 0; i < (ai ? 1 : 3); i++) {
      enqueue(db, userId, 'mail');
      const started = Date.now();
      await runNext(db, handler);
      const job = db.prepare("SELECT status, error_code, result FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(userId) as { status: string; error_code: string | null; result: string };
      runs.push({ status: job.status, error: job.error_code, seconds: Math.round((Date.now() - started) / 1000), ...JSON.parse(job.result) });
    }
    const distribution = db.prepare('SELECT classification, outcome, count(*) AS n FROM mail_messages GROUP BY classification, outcome ORDER BY n DESC').all();
    const duplicates = (db.prepare('SELECT count(*) AS n FROM (SELECT message_key FROM mail_messages GROUP BY message_key HAVING count(*) > 1)').get() as { n: number }).n;
    const cursors = db.prepare('SELECT count(*) AS n FROM mail_cursors').get();
    const reviews = db.prepare('SELECT reason, count(*) AS n FROM review_requests GROUP BY reason').all();
    const apps = db.prepare('SELECT status, count(*) AS n FROM applications GROUP BY status').all();
    console.log(JSON.stringify({ ok: true, ai: Boolean(ai), usage: usageTotals, runs, distribution, duplicates, cursors, reviews, createdApplications: apps }, null, 2));
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
