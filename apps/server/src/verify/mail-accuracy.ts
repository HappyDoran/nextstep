// 메일로 만든 지원 건을 사용자가 따로 관리하던 지원 현황(정답)과 대조한다. 건수·비율만 출력하고 회사명 등 개별 내용은 출력·저장하지 않는다.
// 정답 CSV는 이 저장소 밖에 두고 경로로만 넘긴다(필수 열: 회사, 상태(지원 완료·이력서 열람·서류 합격·불합격), 플랫폼).
// 실행: pnpm --filter @nextstep/server verify:mail-accuracy -- <정답.csv> <사용자 이메일>
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { normalizeName } from '../mail/apply.js';

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.some(Boolean));
  return body.map(r => Object.fromEntries(head!.map((h, i) => [h.replace(/^﻿/, ''), r[i] ?? '']))) as Record<string, string>[];
}

// 정답 상태 → 우리 상태로 맞다고 볼 값.
const OK: Record<string, string[]> = { '지원 완료': ['지원 완료'], '이력서 열람': ['지원 완료', '전형 진행중'], '서류 합격': ['전형 진행중', '합격'], 불합격: ['불합격'] };

function main() {
  const [csvPath, email] = process.argv.slice(2).filter(a => a !== '--');
  if (!csvPath || !email) { console.log('사용: verify:mail-accuracy -- <정답.csv> <사용자 이메일>'); process.exitCode = 1; return; }
  const truth = parseCsv(readFileSync(csvPath, 'utf8'));
  const db = new DatabaseSync(process.env.NEXTSTEP_DB_PATH ?? resolve('.data/nextstep.sqlite'), { readOnly: true });
  const apps = db.prepare("SELECT a.company, a.status, a.read_status FROM applications a JOIN users u ON u.id = a.user_id WHERE u.email = ? AND a.origin = 'mail'").all(email) as { company: string; status: string; read_status: string }[];
  db.close();
  const group = <T>(xs: T[], key: (x: T) => string) => xs.reduce((m, x) => m.set(key(x), [...(m.get(key(x)) ?? []), x]), new Map<string, T[]>());
  const t = group(truth, r => normalizeName(r['회사'] ?? '')), o = group(apps, a => normalizeName(a.company));
  const found = [...t.keys()].filter(k => o.has(k));
  const pairs = found.filter(k => t.get(k)!.length === 1 && o.get(k)!.length === 1).map(k => ({ want: t.get(k)![0]!['상태'] ?? '', got: o.get(k)![0]! }));
  const read = pairs.filter(p => p.want === '이력서 열람');
  const missed = [...t.keys()].filter(k => !o.has(k)).map(k => t.get(k)![0]!['플랫폼'] ?? '');
  console.log(JSON.stringify({
    truthCompanies: t.size, mailCompanies: o.size, found: found.length, foundRate: +(found.length / Math.max(t.size, 1)).toFixed(3),
    onlyInMail: [...o.keys()].filter(k => !t.has(k)).length,
    statusCompared: pairs.length, statusMatch: pairs.filter(p => (OK[p.want] ?? []).includes(p.got.status)).length,
    readCompared: read.length, readMarked: read.filter(p => p.got.read_status === '열람').length,
    statusConfusion: Object.entries(pairs.reduce<Record<string, number>>((m, p) => ({ ...m, [`${p.want}→${p.got.status}`]: (m[`${p.want}→${p.got.status}`] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]),
    missedByPlatform: Object.entries(missed.reduce<Record<string, number>>((m, p) => ({ ...m, [p]: (m[p] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]),
  }, null, 1));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
