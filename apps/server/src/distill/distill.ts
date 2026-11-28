// 로컬 공고 모델 학습(사용자 결정 2026-11-28): 홈서버에 모인 같은 공고의 Codex·Claude·로컬 결과(ai_samples)로
// 로컬 모델(Qwen3 1.7B)을 Codex 결과에 맞춰 학습하고, 학습에 쓰지 않은 공고로 평가해 지금 모델보다 나을 때만 홈서버에 올린다.
// 사람 검토는 없다. 정답은 Codex와 Claude가 직무를 같게 본 공고의 Codex 결과이고(둘이 다르면 쓰지 않음), 서류·메일은 쓰지 않는다.
// 이 Mac(Apple Silicon)에서 돈다: 학습 mlx-lm, 변환 llama.cpp, 평가 Mac Ollama. 준비·명령은 docs/DEVELOPMENT.md.
//   pnpm distill               지금 실행(자료가 모자라면 건너뜀)
//   pnpm distill --scheduled   매주 예약 실행(6일 안에 실행했으면 건너뜀)
//   pnpm distill --force       자료 수 조건 없이 학습
//   pnpm distill --no-deploy   평가까지만
//   pnpm distill --from-eval --force --no-deploy   홈서버 대신 평가 세트(.data/eval, eval:extract 결과)로 파이프라인 시험
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REQUIREMENTS_INSTRUCTIONS, REQUIREMENTS_PROMPT_VERSION, extractRequirements, requirementsInput, requirementsSchema, type Requirements } from '../prompts/requirements.js';
import { hintsFrom } from '../ai/remote.js';

const SERVER = 'doran-server';
const REMOTE_DB = '/srv/nextstep/data/nextstep.sqlite';
const REMOTE_ENV = '/srv/nextstep/nextstep.env';
const REMOTE_MODELS = '/data/nextstep-models';
const BASE_HF = 'Qwen/Qwen3-1.7B';
const BASE_OLLAMA = 'qwen3:1.7b';
const CANDIDATE = 'nextstep-posting:candidate';
const CURRENT = 'nextstep-posting:current'; // 홈서버에 올린 학습 모델의 이 Mac 사본(다음 평가의 비교 대상)
// 학습 조건: 학습용 일치 공고 100건·평가용 20건 이상, 지난 학습보다 일치 공고 30건 이상 늘었을 때.
const MIN_TRAIN = 100;
const MIN_TEST = 20;
const MIN_GROWTH = 30;
// 교체 조건: 직무 일치율이 비교 대상(기본 모델+참고 문구, 지금 학습 모델)보다 2%p 이상 높고, 조건 키 일치(F1)가 2%p 넘게 낮아지지 않고, 실패가 늘지 않음.
const GAIN = 0.02;

const DIR = fileURLToPath(new URL('../../.data/distill/', import.meta.url));
const WORK = `${DIR}work/`;
const PY = `${DIR}venv/bin/python`;
const args = new Set(process.argv.slice(2));
// 평가는 매번 실제로 모델을 부른다(개발용 응답 재사용·가짜 응답을 끈다).
delete process.env.NEXTSTEP_AI_CACHE_DIR;
delete process.env.NEXTSTEP_AI_FAKE;
delete process.env.NEXTSTEP_OLLAMA_URL;
const now = new Date();
const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');

type Sample = { key: string; posting: { title: string; company: string; body: string }; codex: Requirements | null; claude: Requirements | null; local: Requirements | null; localModel: string | null };
type State = { lastRunAt?: string; trainedAgreed?: number; deployedAt?: string; deployed?: string };
type Score = { model: string; family: number; keysF1: number; failures: number; seconds: number; n: number };

const statePath = `${DIR}state.json`;
const state: State = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) as State : {};
const saveState = () => writeFileSync(statePath, JSON.stringify(state, null, 1));
const log = (line: string) => console.log(`[${new Date().toLocaleTimeString('sv-SE')}] ${line}`);

function sh(command: string, argv: string[], options: { input?: string | undefined; quiet?: boolean; show?: boolean } = {}) {
  // show: 학습처럼 오래 걸리는 단계는 진행 출력(반복 횟수·손실)을 그대로 기록에 흘린다.
  const r = spawnSync(command, argv, { input: options.input, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: [options.input === undefined ? 'ignore' : 'pipe', options.show ? 'inherit' : 'pipe', options.quiet ? 'pipe' : 'inherit'] });
  if (r.status !== 0) throw new Error(`${command} ${argv.slice(0, 3).join(' ')} 실패(${r.status ?? r.signal}): ${(r.stderr ?? '').slice(-400)}`);
  return r.stdout;
}
const ssh = (script: string, input?: string) => sh('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', SERVER, script], { input, quiet: true });

/** 홈서버 Discord(nextstep 채널)로 알린다. 웹훅 주소는 서버 환경 파일에서만 읽고 이 Mac에 두지 않는다. */
function notify(content: string) {
  if (args.has('--from-eval')) return log(`(시험이라 알리지 않음) ${content.split('\n')[0]}`);
  try {
    ssh(`url=$(grep '^NEXTSTEP_DISCORD_WEBHOOK_URL=' ${REMOTE_ENV} | cut -d= -f2-); [ -n "$url" ] && curl -s -o /dev/null -H 'content-type: application/json' -d @- "$url"`,
      JSON.stringify({ username: 'NextStep', content: content.slice(0, 1900), allowed_mentions: { parse: [] } }));
  } catch (error) { log(`알림 실패: ${(error as Error).message}`); }
}

const parse = (text: string | null) => {
  if (!text) return null;
  const r = requirementsSchema.safeParse(JSON.parse(text));
  return r.success ? r.data : null;
};
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
const keySet = (r: Requirements) => new Set(r.required.flatMap(q => q.keys.map(k => k.toLowerCase())));
function f1(a: Set<string>, b: Set<string>) {
  if (!a.size && !b.size) return 1;
  const hit = [...a].filter(k => b.has(k)).length;
  return hit ? 2 * hit / (a.size + b.size) : 0;
}
// 공고 하나는 늘 같은 쪽(학습·검증·평가)에 둔다(자료가 늘어도 평가 공고가 학습에 섞이지 않음).
const bucket = (key: string) => parseInt(createHash('sha256').update(key).digest('hex').slice(0, 8), 16) % 6;

/** 1. 홈서버 표본 내려받기. 같은 공고(입력 같음)를 여러 사용자가 받았으면 하나로 합친다. */
function exportSamples(): Sample[] {
  const out = ssh(`sqlite3 -readonly -json ${REMOTE_DB} "SELECT input, codex, claude, local, local_model FROM ai_samples WHERE version = '${REQUIREMENTS_PROMPT_VERSION}' ORDER BY updated_at"`);
  const rows = (out.trim() ? JSON.parse(out) : []) as { input: string; codex: string | null; claude: string | null; local: string | null; local_model: string | null }[];
  const byKey = new Map<string, Sample>();
  for (const r of rows) {
    const p = JSON.parse(r.input) as { title: string; company: string; body: string };
    const key = createHash('sha256').update(`${p.title}\n${p.company}\n${p.body}`).digest('hex');
    const prev = byKey.get(key);
    byKey.set(key, { key, posting: { title: p.title, company: p.company, body: p.body }, codex: parse(r.codex) ?? prev?.codex ?? null, claude: parse(r.claude) ?? prev?.claude ?? null, local: parse(r.local) ?? prev?.local ?? null, localModel: r.local_model ?? prev?.localModel ?? null });
  }
  return [...byKey.values()];
}

/** 시험용: 평가 세트 공고와 eval:extract 결과(result-codex·claude·local.json)를 표본으로 쓴다. */
function evalSamples(): Sample[] {
  const dir = new URL('../../.data/eval/', import.meta.url);
  const read = (name: string) => existsSync(new URL(name, dir)) ? JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as Record<string, unknown> : {};
  const postings = JSON.parse(readFileSync(new URL('postings.json', dir), 'utf8')) as { id: string; title: string; company: string; body: string }[];
  const [codex, claude, local] = ['result-codex.json', 'result-claude.json', 'result-local.json'].map(read);
  const one = (r: Record<string, unknown>, id: string) => { const v = requirementsSchema.safeParse(r[id]); return v.success ? v.data : null; };
  return postings.map(p => ({ key: p.id, posting: { title: p.title, company: p.company, body: p.body }, codex: one(codex!, p.id), claude: one(claude!, p.id), local: one(local!, p.id), localModel: BASE_OLLAMA }));
}

/** 3. 평가: 같은 공고·같은 지시문으로 모델을 돌려 Codex 결과와 비교한다. hints: 기본 모델에만(실제 서버와 같게). */
async function evaluate(model: string, test: Sample[], hintRows: { title: string; out: Requirements }[], withHints: boolean): Promise<Score> {
  let family = 0, keys = 0, failures = 0;
  const started = Date.now();
  for (const s of test) {
    try {
      const r = await extractRequirements(s.posting, withHints ? hintsFrom(hintRows, s.posting.title) : '', model);
      if (sameSet(r.jobFamilies, s.codex!.jobFamilies)) family++;
      keys += f1(keySet(r), keySet(s.codex!));
    } catch { failures++; }
  }
  return { model: withHints ? `${model}+참고` : model, family: family / test.length, keysF1: keys / test.length, failures, seconds: Math.round((Date.now() - started) / 1000 / test.length * 10) / 10, n: test.length };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const line = (s: Score) => `${s.model}: 직무 ${pct(s.family)} · 조건 키 F1 ${pct(s.keysF1)} · 실패 ${s.failures} · 건당 ${s.seconds}초`;
const ollamaHas = (name: string) => sh('ollama', ['list'], { quiet: true }).split('\n').some(l => l.split(/\s+/)[0] === name);
/** 이 Mac Ollama에 GGUF로 모델을 만든다(기본 모델의 대화 형식·멈춤 단어를 그대로 쓴다). */
function createLocal(name: string, gguf: string) {
  const modelfile = sh('ollama', ['show', BASE_OLLAMA, '--modelfile'], { quiet: true }).replace(/^FROM .*$/m, `FROM ${gguf}`);
  writeFileSync(`${WORK}Modelfile`, modelfile);
  sh('ollama', ['create', name, '-f', `${WORK}Modelfile`], { quiet: true });
}

async function main() {
  if (args.has('--scheduled') && state.lastRunAt && now.getTime() - Date.parse(state.lastRunAt) < 6 * 86_400_000) return log('이번 주에 이미 실행해 건너뜀');
  for (const need of [PY, `${DIR}llama.cpp/convert_hf_to_gguf.py`]) if (!existsSync(need)) throw new Error(`준비되지 않음: ${need} (docs/DEVELOPMENT.md 로컬 모델 학습)`);
  mkdirSync(WORK, { recursive: true });
  mkdirSync(`${DIR}runs`, { recursive: true });

  log('표본 내려받기');
  const samples = args.has('--from-eval') ? evalSamples() : exportSamples();
  const both = samples.filter(s => s.codex && s.claude);
  const agreed = both.filter(s => sameSet(s.codex!.jobFamilies, s.claude!.jobFamilies));
  const withLocal = samples.filter(s => s.codex && s.local);
  // 세 경로 비교(같은 공고): Codex·Claude 직무 일치, 서버 로컬 결과의 Codex 대비 직무 일치.
  const comparison = {
    samples: samples.length, codex: samples.filter(s => s.codex).length, claude: samples.filter(s => s.claude).length, local: samples.filter(s => s.local).length,
    codexClaudeFamily: both.length ? agreed.length / both.length : null,
    codexClaudeKeysF1: both.length ? both.reduce((a, s) => a + f1(keySet(s.codex!), keySet(s.claude!)), 0) / both.length : null,
    localCodexFamily: withLocal.length ? withLocal.filter(s => sameSet(s.local!.jobFamilies, s.codex!.jobFamilies)).length / withLocal.length : null,
  };
  const train = agreed.filter(s => bucket(s.key) >= 2);
  const valid = agreed.filter(s => bucket(s.key) === 1);
  const test = agreed.filter(s => bucket(s.key) === 0);
  const summary = `표본 ${samples.length}(Codex ${comparison.codex}·Claude ${comparison.claude}·로컬 ${comparison.local}), 둘 다 ${both.length}·직무 일치 ${agreed.length}` +
    `${comparison.codexClaudeFamily === null ? '' : ` (Codex·Claude 직무 일치 ${pct(comparison.codexClaudeFamily)})`}` +
    `${comparison.localCodexFamily === null ? '' : `, 서버 로컬의 Codex 대비 직무 일치 ${pct(comparison.localCodexFamily)}(${withLocal.length}건)`}`;
  log(summary);
  const record: Record<string, unknown> = { at: now.toISOString(), version: REQUIREMENTS_PROMPT_VERSION, comparison, train: train.length, valid: valid.length, test: test.length };
  const finish = (result: string, extra: Record<string, unknown> = {}) => {
    Object.assign(record, { result }, extra);
    writeFileSync(`${DIR}runs/${stamp}.json`, JSON.stringify(record, null, 1));
    state.lastRunAt = now.toISOString();
    saveState();
  };

  const growth = agreed.length - (state.trainedAgreed ?? 0);
  if (!args.has('--force') && (train.length < MIN_TRAIN || test.length < MIN_TEST || growth < MIN_GROWTH)) {
    const why = `학습 건너뜀: 학습용 ${train.length}/${MIN_TRAIN}, 평가용 ${test.length}/${MIN_TEST}, 지난 학습 뒤 늘어난 일치 공고 ${growth}/${MIN_GROWTH}`;
    log(why);
    finish('skipped');
    if (args.has('--scheduled')) notify(`**NextStep 로컬 모델 학습(주간)**\n${summary}\n${why}`);
    return;
  }
  if (!train.length || !valid.length || !test.length) throw new Error('학습·검증·평가 공고가 각각 1건 이상 있어야 합니다.');

  log(`학습 자료 쓰기: 학습 ${train.length}·검증 ${valid.length}·평가 ${test.length}`);
  mkdirSync(`${WORK}data`, { recursive: true });
  // 실제 서버 호출과 같은 지시문·입력. 정답은 스키마 순서로 다시 만든 Codex 결과.
  const chat = (s: Sample) => JSON.stringify({ messages: [{ role: 'system', content: REQUIREMENTS_INSTRUCTIONS }, { role: 'user', content: requirementsInput(s.posting) }, { role: 'assistant', content: JSON.stringify(requirementsSchema.parse(s.codex)) }] });
  writeFileSync(`${WORK}data/train.jsonl`, `${train.map(chat).join('\n')}\n`);
  writeFileSync(`${WORK}data/valid.jsonl`, `${valid.map(chat).join('\n')}\n`);

  log('학습(mlx-lm LoRA)');
  rmSync(`${WORK}adapters`, { recursive: true, force: true });
  const iters = Math.min(1200, Math.ceil(train.length * 3 / 2)); // 약 3바퀴(묶음 2)
  sh(PY, ['-m', 'mlx_lm', 'lora', '--model', BASE_HF, '--train', '--data', `${WORK}data`, '--adapter-path', `${WORK}adapters`, '--iters', String(iters), '--batch-size', '2',
    '--learning-rate', '1e-4', '--num-layers', '16', '--max-seq-length', '6144', '--mask-prompt', '--grad-checkpoint', '--steps-per-eval', '200', '--seed', '0'], { show: true });
  log('합치기·변환(GGUF Q4_K_M)');
  rmSync(`${WORK}fused`, { recursive: true, force: true });
  sh(PY, ['-m', 'mlx_lm', 'fuse', '--model', BASE_HF, '--adapter-path', `${WORK}adapters`, '--save-path', `${WORK}fused`]);
  sh(PY, [`${DIR}llama.cpp/convert_hf_to_gguf.py`, `${WORK}fused`, '--outtype', 'f16', '--outfile', `${WORK}candidate-f16.gguf`], { quiet: true });
  sh('llama-quantize', [`${WORK}candidate-f16.gguf`, `${WORK}candidate.gguf`, 'Q4_K_M'], { quiet: true });
  rmSync(`${WORK}candidate-f16.gguf`, { force: true });
  rmSync(`${WORK}fused`, { recursive: true, force: true });
  createLocal(CANDIDATE, `${WORK}candidate.gguf`);

  log(`평가(${test.length}건)`);
  // 서버의 참고 문구와 같게: 평가 공고를 뺀 Codex 결과에서 비슷한 제목을 찾는다.
  const hintRows = samples.filter(s => s.codex && bucket(s.key) !== 0).map(s => ({ title: s.posting.title, out: s.codex! }));
  const scores = [await evaluate(BASE_OLLAMA, test, hintRows, true)];
  if (ollamaHas(CURRENT)) scores.push(await evaluate(CURRENT, test, hintRows, false));
  const candidate = await evaluate(CANDIDATE, test, hintRows, false);
  const best = scores.reduce((a, b) => (b.family > a.family ? b : a));
  const pass = candidate.family >= best.family + GAIN && candidate.keysF1 >= best.keysF1 - GAIN && candidate.failures <= best.failures;
  const report = [...scores, candidate].map(line).join('\n');
  log(`\n${report}\n교체 ${pass ? '통과' : '안 함'}`);
  state.trainedAgreed = agreed.length;

  let deployed = false;
  if (pass && !args.has('--no-deploy')) {
    log('홈서버에 올리기');
    const file = `${REMOTE_MODELS}/nextstep-posting-${stamp}.gguf`;
    ssh(`mkdir -p ${REMOTE_MODELS}`);
    sh('scp', ['-q', '-o', 'BatchMode=yes', `${WORK}candidate.gguf`, `${SERVER}:${file}`]);
    // 서버 기본 모델의 대화 형식으로 만들고, 되돌리기용으로 최근 파일 2개만 남긴다. 서버는 10분 안에 새 모델을 쓴다.
    ssh(`set -e; ollama show ${BASE_OLLAMA} --modelfile | sed 's#^FROM .*#FROM ${file}#' > ${REMOTE_MODELS}/Modelfile; ollama create nextstep-posting -f ${REMOTE_MODELS}/Modelfile >/dev/null; ls -t ${REMOTE_MODELS}/nextstep-posting-*.gguf | tail -n +3 | xargs -r rm -f`);
    sh('ollama', ['cp', CANDIDATE, CURRENT], { quiet: true });
    state.deployedAt = now.toISOString();
    state.deployed = file;
    deployed = true;
  }
  finish(deployed ? 'deployed' : pass ? 'passed' : 'rejected', { scores: [...scores, candidate], iters });
  notify(`**NextStep 로컬 모델 학습**\n${summary}\n학습 ${train.length}건·평가 ${test.length}건\n${report}\n${deployed ? '평가를 통과해 홈서버 공고 분석 모델을 바꿨습니다(되돌리기: `ollama rm nextstep-posting`).' : pass ? '평가는 통과했지만 올리지 않았습니다(--no-deploy).' : '평가 기준을 넘지 못해 지금 모델을 유지합니다.'}`);
}

main().catch(error => {
  log(`실패: ${(error as Error).message}`);
  notify(`**NextStep 로컬 모델 학습 실패**\n${(error as Error).message.slice(0, 500)}`);
  process.exitCode = 1;
});
