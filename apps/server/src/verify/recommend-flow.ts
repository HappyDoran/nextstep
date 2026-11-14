// P1-04 실제 흐름 검증: 임시 DB·임시 사용자·합성 이력서로 실제 출처 수집과 로컬 LLM 추출·규칙 분류를 한 번 실행하고 지운다.
// 출력은 공개 공고의 제목·회사·분류·근거 요약과 건수뿐이다. 실행 시 출처 요청이 발생한다.
// 실행: pnpm --filter @nextstep/server verify:recommend-flow -- [링크 URL...]
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../database.js';
import { extractResumeText } from '../documents/extract-resume.js';
import { enqueue, runNext } from '../recommend/jobs.js';
import { createHandler } from '../recommend/pipeline.js';
import { usageTotals } from '../ai/llm.js';

async function main() {
  const links = process.argv.slice(2).filter(a => a.startsWith('https://'));
  // --all-families: 네 직무 전체로 실행한다(기본은 프론트엔드·앱 개발).
  const personal = process.argv.includes('--all-families');
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-rec-verify-'));
  try {
    const db = openDatabase(join(dir, 'db.sqlite'));
    const userId = randomUUID();
    const at = new Date().toISOString();
    db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(userId, 'verify@example.com', 'x', at);
    // 합성 이력서(테스트 픽스처)와 프론트엔드·앱 개발 프로필.
    const resume = await extractResumeText(new Uint8Array(readFileSync(new URL('../../tests/fixtures/resume-text.pdf', import.meta.url))), 'resume.pdf');
    if (!resume.ok) throw new Error('fixture');
    db.prepare("INSERT INTO documents (id, user_id, kind, filename, size, storage_key, text, created_at) VALUES (?, ?, 'resume', 'resume.pdf', 0, 'none', ?, ?)").run(randomUUID(), userId, resume.text, at);
    db.prepare('INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, ?)').run(userId, JSON.stringify({ jobFamilies: personal ? ['프론트엔드', '앱 개발', '디자인', '기획'] : ['프론트엔드', '앱 개발'], experiences: [{ jobFamily: '프론트엔드', years: 3 }], regions: ['서울'], remoteOk: true, employmentTypes: ['정규직'], skills: ['React', 'TypeScript', 'Next.js'], summary: '프론트엔드 개발 3년' }), at);
    const handler = createHandler(db);
    const started = Date.now();
    const jobs = [];
    enqueue(db, userId, 'refresh');
    await runNext(db, handler);
    jobs.push(db.prepare("SELECT kind, status, error_code, result FROM jobs WHERE kind = 'refresh'").get());
    for (const url of links) {
      enqueue(db, userId, 'link', { url });
      await runNext(db, handler);
      jobs.push(db.prepare("SELECT kind, status, error_code, result FROM jobs WHERE kind = 'link' ORDER BY created_at DESC LIMIT 1").get());
    }
    const recs = db.prepare(`SELECT p.source, p.acquired_by = 'link' AS link_only, p.title, p.company, p.deadline, p.always_hire, p.company_type, p.employee_count, p.requirements IS NOT NULL AS has_req, r.classification, r.judgement
      FROM recommendations r JOIN postings p ON p.id = r.posting_id ORDER BY r.classification`).all() as { source: string; link_only: number; title: string; company: string; deadline: string | null; always_hire: number; company_type: string | null; employee_count: number | null; has_req: number; classification: string; judgement: string }[];
    const bodyStored = (db.prepare("SELECT count(*) AS n FROM postings WHERE requirements LIKE '%[주요업무]%'").get() as { n: number }).n;
    console.log(JSON.stringify({
      ok: true,
      seconds: Math.round((Date.now() - started) / 1000),
      usage: usageTotals,
      jobs: jobs.map(j => { const r = j as { kind: string; status: string; error_code: string | null; result: string }; return { kind: r.kind, status: r.status, error: r.error_code, result: JSON.parse(r.result) }; }),
      byClass: recs.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.classification]: (acc[r.classification] ?? 0) + 1 }), {}),
      bodyStored,
      samples: recs.map(r => { const j = JSON.parse(r.judgement) as { reason: string; unmet: string[]; unknown: string[] }; return { source: r.source, linkOnly: r.link_only === 1, title: r.title.slice(0, 40), company: r.company, deadline: r.always_hire ? '상시' : r.deadline, size: r.company_type ?? '미확인', reqExtracted: r.has_req === 1, class: r.classification, reason: j.reason.slice(0, 80), unmet: j.unmet.slice(0, 2), unknown: j.unknown.slice(0, 2) }; }),
    }, null, 1));
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
