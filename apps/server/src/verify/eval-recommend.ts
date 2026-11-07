// 추천 판정 프롬프트를 정답 사례로 평가한다. 실제 OpenAI 호출(요금 발생)이며 합성 사례만 보낸다.
// 실행: OPENAI_API_KEY=... NEXTSTEP_OPENAI_MODEL=... pnpm --filter @nextstep/server eval:recommend
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { judge, RECOMMEND_PROMPT_VERSION } from '../prompts/recommend.js';
import { usageTotals } from '../ai/openai.js';

type Case = { id: string; jobFamily: string; profileId: string; tags: string[]; posting: unknown; expected: { classification: string } };
const data = JSON.parse(readFileSync(new URL('../../tests/prompts/recommendation-cases.json', import.meta.url), 'utf8')) as { evaluatedAt: string; profiles: { id: string }[]; cases: Case[] };

async function main() {
  const started = Date.now();
  const profiles = new Map(data.profiles.map(p => [p.id, p]));
  const results: { id: string; family: string; expected: string; got: string; tags: string[] }[] = [];
  const queue = [...data.cases];
  // 동시 3건으로 제한한다.
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      try {
        const out = await judge(data.evaluatedAt, profiles.get(c.profileId), c.posting);
        results.push({ id: c.id, family: c.jobFamily, expected: c.expected.classification, got: out.classification, tags: c.tags });
      } catch (error) {
        results.push({ id: c.id, family: c.jobFamily, expected: c.expected.classification, got: `오류:${(error as Error).message}`, tags: c.tags });
      }
    }
  }));
  const byFamily: Record<string, { total: number; correct: number }> = {};
  for (const r of results) {
    const f = (byFamily[r.family] ??= { total: 0, correct: 0 });
    f.total++;
    if (r.expected === r.got) f.correct++;
  }
  const correct = results.filter(r => r.expected === r.got).length;
  console.log(JSON.stringify({
    prompt: RECOMMEND_PROMPT_VERSION,
    model: process.env.NEXTSTEP_OPENAI_MODEL,
    seconds: Math.round((Date.now() - started) / 1000),
    usage: usageTotals,
    total: results.length,
    correct,
    byFamily,
    injectionCorrect: results.filter(r => r.tags.includes('주입') && r.expected === r.got).length + '/' + results.filter(r => r.tags.includes('주입')).length,
    mismatches: results.filter(r => r.expected !== r.got).sort((a, b) => a.id.localeCompare(b.id)).map(({ id, expected, got }) => ({ id, expected, got })),
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
