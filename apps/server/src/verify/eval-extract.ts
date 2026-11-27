// 공고 조건 추출의 직무 분류 정확도를 실제 공고 평가 세트로 경로별 비교한다(P1-19 ②).
// 평가 세트(공고 본문)와 참고 라벨은 커밋하지 않는 apps/server/.data/eval/에만 둔다(postings.json, labels.json).
// local: 이 기기 Ollama(서버와 같은 모델). codex: 이 기기 사용자의 Codex 계정으로 실행기와 같은 지시문·스키마·10건 묶음을 쓴다
// (개발자 기기 평가 전용. 서버는 외부 AI를 부르지 않는다).
// 실행: EVAL_PROVIDER=local|codex pnpm --filter @nextstep/server eval:extract
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractRequirements } from '../prompts/requirements.js';
import { batchSchema, postingBatchPrompt, postingTaskInput } from '../ai/remote.js';
import { strictJsonSchema } from '../ai/llm.js';
import { withTitleFamilies } from '../recommend/classify.js';

type Posting = { id: string; title: string; company: string; body: string };
type Label = { id: string; must: string[]; allow: string[] };
const dir = new URL('../../.data/eval/', import.meta.url);
const postings = JSON.parse(readFileSync(new URL('postings.json', dir), 'utf8')) as Posting[];
const { labels } = JSON.parse(readFileSync(new URL('labels.json', dir), 'utf8')) as { labels: Label[] };
const provider = process.env.EVAL_PROVIDER === 'codex' ? 'codex' : 'local';

async function runLocal() {
  const out = new Map<string, { families: string[]; required: number } | null>();
  for (const p of postings) {
    try { const r = await extractRequirements(p); out.set(p.id, { families: r.jobFamilies, required: r.required.length }); } catch { out.set(p.id, null); }
  }
  return out;
}

function runCodex() {
  const out = new Map<string, { families: string[]; required: number } | null>();
  for (let i = 0; i < postings.length; i += 10) {
    const batch = postings.slice(i, i + 10);
    const work = mkdtempSync(join(tmpdir(), 'nextstep-eval-'));
    try {
      writeFileSync(join(work, 'schema.json'), JSON.stringify(strictJsonSchema(batchSchema)));
      const run = spawnSync('codex', ['exec', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '-s', 'read-only', '--output-schema', 'schema.json', '-o', 'out.json', '-'],
        { cwd: work, input: postingBatchPrompt(batch.map(postingTaskInput)), encoding: 'utf8', timeout: 10 * 60_000 });
      const parsed = run.status === 0 ? batchSchema.safeParse(JSON.parse(readFileSync(join(work, 'out.json'), 'utf8'))) : null;
      for (const p of batch) {
        const item = parsed?.success ? parsed.data.items.find(x => x.id === p.id) : undefined;
        out.set(p.id, item ? { families: item.result.jobFamilies, required: item.result.required.length } : null);
      }
    } finally { rmSync(work, { recursive: true, force: true }); }
  }
  return out;
}

const started = Date.now();
const results = provider === 'codex' ? runCodex() : await runLocal();
const seconds = Math.round((Date.now() - started) / 1000);
// 맞음: 꼭 있어야 할 직무를 모두 넣고, 허용 범위 밖 직무를 넣지 않음(기타 포함).
const correct = (label: Label, families: string[] | null) => {
  if (!families?.length) return false;
  const ok = new Set([...label.must, ...label.allow]);
  return label.must.every(f => families.includes(f)) && families.every(f => ok.has(f));
};
let raw = 0, ruled = 0, failed = 0;
const misses: string[] = [];
for (const label of labels) {
  const r = results.get(label.id);
  const p = postings.find(x => x.id === label.id)!;
  if (!r) { failed++; misses.push(`${label.id} 실패`); continue; }
  const fixed = withTitleFamilies(p.title, r.families);
  if (correct(label, r.families)) raw++;
  if (correct(label, fixed)) ruled++;
  else misses.push(`${label.id} ${p.title.slice(0, 30)} → 모델 ${r.families.join('·')} / 보정 ${fixed?.join('·')} (정답 ${label.must.join('·') || '-'}${label.allow.length ? ` 허용 ${label.allow.join('·')}` : ''})`);
}
console.log(`경로 ${provider} · ${labels.length}건 · ${seconds}초 · 실패 ${failed}`);
console.log(`직무 분류 정확도: 모델 그대로 ${raw}/${labels.length}, 제목 보정 후 ${ruled}/${labels.length}`);
console.log(`필수 조건 평균 ${(([...results.values()].filter(Boolean) as { required: number }[]).reduce((a, r) => a + r.required, 0) / Math.max(1, labels.length - failed)).toFixed(1)}개`);
for (const m of misses) console.log(`  - ${m}`);
writeFileSync(new URL(`result-${provider}.json`, dir), JSON.stringify(Object.fromEntries(results), null, 1), { mode: 0o600 });
