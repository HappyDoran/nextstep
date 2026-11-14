// 추천 판정(모델 추출 + 규칙 분류)을 정답 사례로 평가한다. 실제 AI 호출(요금 발생)이며 합성 사례만 보낸다.
// 호출: 공고 사례마다 추출 1회 + 지원자 프로필마다 1회.
// 실행: [NEXTSTEP_OLLAMA_MODEL=...] [EVAL_SET=holdout] pnpm --filter @nextstep/server eval:recommend
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { extractRequirements, REQUIREMENTS_PROMPT_VERSION } from '../prompts/requirements.js';
import { extractCandidate, CANDIDATE_PROMPT_VERSION, type Candidate } from '../prompts/candidate.js';
import { classify, RULES_VERSION } from '../recommend/classify.js';
import { ollamaModel, usageTotals } from '../ai/llm.js';
import type { Career } from '../sources/types.js';

type Posting = { title: string; company: string; deadline: string | null; alwaysHire: boolean; workFields: string[]; careers: Career[]; conditions: { required: string[]; preferred: string[] }; location: string | null; remote: '전면' | '부분' | '없음' | null; companyType: string | null; body?: string };
type Profile = { id: string; desiredFamilies: string[]; locations: string[]; [key: string]: unknown };
type Case = { id: string; jobFamily: string; profileId: string; tags: string[]; posting: Posting; expected: { classification: string } };
// EVAL_SET=holdout이면 규칙 조정에 쓰지 않은 검증용 사례로 평가한다.
const data = JSON.parse(readFileSync(new URL(`../../tests/prompts/recommendation-${process.env.EVAL_SET === 'holdout' ? 'holdout' : 'cases'}.json`, import.meta.url), 'utf8')) as { evaluatedAt: string; profiles: Profile[]; cases: Case[] };

// 사례의 구조화 공고를 수집기가 넘기는 본문처럼 글로 만든다(출처가 주는 마감·근무지·경력 필드는 그대로 쓴다).
const bodyOf = (p: Posting) => [`직무 분야: ${p.workFields.join(', ')}`, '[자격요건]', ...p.conditions.required.map(t => `- ${t}`), '[우대사항]', ...p.conditions.preferred.map(t => `- ${t}`), p.body ?? ''].join('\n');

async function pool<T, R>(items: T[], fn: (item: T) => Promise<R>) {
  const out = new Map<T, R | Error>();
  const queue = [...items];
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let x = queue.shift(); x !== undefined; x = queue.shift()) out.set(x, await fn(x).catch(e => e as Error));
  }));
  return out;
}

async function main() {
  const started = Date.now();
  // 희망 직무·지역은 규칙 입력(프로필)으로 따로 넘기고, 서류 사실만 추출에 보낸다.
  const candidates = await pool(data.profiles, p => extractCandidate(JSON.stringify(p, (k, v) => (['id', 'desiredFamilies', 'locations'].includes(k) ? undefined : v))));
  const extracted = await pool(data.cases, c => extractRequirements({ title: c.posting.title, company: c.posting.company, body: bodyOf(c.posting) }));
  const results = data.cases.map(c => {
    const profile = data.profiles.find(p => p.id === c.profileId)!;
    const cand = candidates.get(profile);
    const req = extracted.get(c);
    if (!cand || cand instanceof Error || !req || req instanceof Error) return { id: c.id, family: c.jobFamily, expected: c.expected.classification, got: `오류:${((cand instanceof Error && cand) || (req as Error)).message}`, tags: c.tags, why: '' };
    const j = classify(data.evaluatedAt, { jobFamilies: profile.desiredFamilies, regions: profile.locations.filter(l => l !== '원격'), remoteOk: profile.locations.includes('원격') }, { ...(cand as Candidate), text: JSON.stringify(profile, (k, v) => (['id', 'desiredFamilies', 'locations'].includes(k) ? undefined : v)) }, {
      title: c.posting.title,
      families: req.jobFamilies, required: req.required, preferred: req.preferred, careers: c.posting.careers, location: c.posting.location,
      remote: c.posting.remote ?? (req.remote === '미기재' ? null : req.remote), deadline: c.posting.deadline, alwaysHire: c.posting.alwaysHire, companyType: c.posting.companyType, bodyNote: null,
    });
    return { id: c.id, family: c.jobFamily, expected: c.expected.classification, got: j.classification, tags: c.tags, why: j.classification === '미확인' ? j.unknown.join(' / ') : j.unmet.join(' / ') };
  });
  const byFamily: Record<string, { total: number; correct: number }> = {};
  for (const r of results) {
    const f = (byFamily[r.family] ??= { total: 0, correct: 0 });
    f.total++;
    if (r.expected === r.got) f.correct++;
  }
  console.log(JSON.stringify({
    versions: [REQUIREMENTS_PROMPT_VERSION, CANDIDATE_PROMPT_VERSION, RULES_VERSION],
    model: ollamaModel(),
    seconds: Math.round((Date.now() - started) / 1000),
    usage: usageTotals,
    total: results.length,
    correct: results.filter(r => r.expected === r.got).length,
    byFamily,
    injectionCorrect: results.filter(r => r.tags.includes('주입') && r.expected === r.got).length + '/' + results.filter(r => r.tags.includes('주입')).length,
    mismatches: results.filter(r => r.expected !== r.got).sort((a, b) => a.id.localeCompare(b.id)).map(({ id, expected, got, why }) => ({ id, expected, got, why })),
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
