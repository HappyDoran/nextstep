import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

// 홈서버 로컬 LLM(Ollama) 호출. 각 사용자가 연결한 내 AI(Codex 등, ai/remote.ts)가 없거나 늦을 때의 폴백이다(기획서 3절).
// 서버는 사용자 자료를 외부 AI로 직접 보내지 않는다. 내 AI 분석은 사용자 기기의 실행기가 그 사람 계정으로 한다.
// SDK 없이 fetch로 JSON Schema 구조화 출력을 받고 zod로 다시 검증한다. 요청 본문(이력서·공고·메일)은 로그에 남기지 않는다.
export type AiFailure = 'ai_model_unavailable' | 'ai_http' | 'ai_invalid_output' | 'ai_network' | 'ai_timeout';
export class AiError extends Error {
  constructor(readonly code: AiFailure) { super(code); }
}

// 호출 사용량 누계(평가·속도 추정용). 요청 본문은 남기지 않는다.
export const usageTotals = { calls: 0, inputTokens: 0, outputTokens: 0 };

// 개발·테스트용(운영에서는 켜지 않는다).
// NEXTSTEP_AI_FAKE=1: 네트워크 없이 스키마에 맞는 고정 응답. NEXTSTEP_AI_CACHE_DIR: 같은 모델·지시·입력의 응답을 파일로 재사용.
const fake = () => process.env.NEXTSTEP_AI_FAKE === '1';
const think = () => process.env.NEXTSTEP_OLLAMA_THINK === '1';
// 주소는 127.0.0.1에만 연다. 기본 모델은 정답 사례 비교로 정한 qwen3:1.7b(검증 기록).
const ollamaUrl = () => process.env.NEXTSTEP_OLLAMA_URL ?? 'http://127.0.0.1:11434';
export const ollamaModel = () => process.env.NEXTSTEP_OLLAMA_MODEL ?? 'qwen3:1.7b';

// 연결 상태 확인: 모델 목록을 짧게 묻는다(본문 없음).
export async function ollamaStatus(): Promise<'정상' | '모델 없음' | '연결 실패'> {
  if (fake()) return '정상';
  try {
    const response = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return '연결 실패';
    const { models } = await response.json() as { models?: { name?: string; model?: string }[] };
    return models?.some(m => m.name === ollamaModel() || m.model === ollamaModel()) ? '정상' : '모델 없음';
  } catch { return '연결 실패'; }
}

// 공고 분석 전용 학습 모델(사용자 결정 2026-11-28): Mac에서 Codex·Claude 결과로 학습해 평가를 통과하면 이 이름으로 홈서버 Ollama에 올린다.
// 있으면 공고 조건 추출에 쓰고, 지우면(`ollama rm nextstep-posting`) 기본 모델로 돌아간다. 10분마다 다시 확인한다.
export const POSTING_MODEL = 'nextstep-posting';
let postingCheck = { at: 0, model: '' };
export async function postingModel(): Promise<string> {
  if (fake()) return ollamaModel();
  if (Date.now() - postingCheck.at < 10 * 60_000 && postingCheck.model) return postingCheck.model;
  let model = ollamaModel();
  try {
    const response = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const { models } = await response.json() as { models?: { name?: string }[] };
    if (models?.some(m => m.name === POSTING_MODEL || m.name === `${POSTING_MODEL}:latest`)) model = POSTING_MODEL;
  } catch { /* 연결 실패면 기본 모델(호출에서 다시 실패를 알린다) */ }
  postingCheck = { at: Date.now(), model };
  return model;
}

export async function structured<T extends z.ZodType>(name: string, schema: T, instructions: string, input: string, model = ollamaModel()): Promise<z.infer<T>> {
  if (fake()) {
    try { return schema.parse(fakeValue(jsonSchema(schema))); } catch { throw new AiError('ai_invalid_output'); }
  }
  const dir = process.env.NEXTSTEP_AI_CACHE_DIR;
  const file = dir && join(dir, `${createHash('sha256').update(JSON.stringify([`ollama:${model}${think() ? ':think' : ''}`, name, instructions, input])).digest('hex')}.json`);
  if (file) {
    try { return schema.parse(JSON.parse(readFileSync(file, 'utf8'))); } catch { /* 없거나 스키마가 바뀌면 새로 요청 */ }
  }
  const value = await requestOllama(schema, instructions, input, model);
  if (file) {
    // 응답에 개인 자료(회사명 등)가 있을 수 있어 소유자만 읽게 둔다.
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  }
  return value;
}

// JSON Schema에서 가장 단순한 유효값을 만든다(열거형은 첫 값, 배열은 최소 길이).
function fakeValue(s: Record<string, unknown>): unknown {
  const type = Array.isArray(s.type) ? (s.type as string[]).find(t => t !== 'null') : s.type as string | undefined;
  if (Array.isArray(s.enum)) return s.enum[0];
  if (Array.isArray(s.anyOf)) return fakeValue((s.anyOf as Record<string, unknown>[]).find(x => x.type !== 'null') ?? {});
  if (type === 'object') return Object.fromEntries(Object.entries((s.properties ?? {}) as Record<string, Record<string, unknown>>).map(([k, v]) => [k, fakeValue(v)]));
  if (type === 'array') return Array.from({ length: Number(s.minItems ?? 0) }, () => fakeValue((s.items ?? {}) as Record<string, unknown>));
  if (type === 'string') return '가짜 AI 응답';
  if (type === 'number' || type === 'integer') return Number(s.minimum ?? 0);
  if (type === 'boolean') return false;
  return null;
}

// 한 번에 보내는 자료 본문 상한(글자). 한국어 약 0.58토큰/글자라 지시문·출력(1,536토큰)과 함께 문맥 8,192토큰 안에 든다.
// 문맥을 넘으면 Ollama가 앞쪽(지시문 포함)을 잘라 버리므로 보내기 전에 자른다(2026-11-21 지원자 추출에서 확인).
export const MAX_INPUT_CHARS = 7000;

// Ollama 구조화 출력: JSON Schema를 format으로 넘기고 Qwen3 생각 모드는 끈다. 온도 0, 문맥 8,192 토큰.
// 형식이 틀리면 한 번 다시 묻고, 그래도 틀리면 ai_invalid_output(호출한 쪽이 미확인으로 처리).
async function requestOllama<T extends z.ZodType>(schema: T, instructions: string, input: string, model: string): Promise<z.infer<T>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${ollamaUrl()}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // 생각 모드는 기본으로 끈다(느림). NEXTSTEP_OLLAMA_THINK=1은 품질 비교용.
          model, stream: false, think: think(), format: jsonSchema(schema),
          // 출력 상한: 작은 모델이 JSON을 끝없이 이어 쓰는 경우를 막는다(구조화 출력은 보통 수백 토큰, 생각 모드면 더 길게).
          options: { temperature: 0, num_ctx: 8192, num_predict: think() ? 6144 : 1536 },
          messages: [{ role: 'system', content: instructions }, { role: 'user', content: input }],
        }),
        // 홈서버 실측(2026-11-21): 입력 읽기 약 20~30토큰/초(길수록 느려져 6,600토큰에 375초), 출력 약 5~8토큰/초.
        // 입력 상한(MAX_INPUT_CHARS)과 출력 상한(1,536토큰)을 다 채워도 끝나게 10분을 준다.
        signal: AbortSignal.timeout(600_000),
      });
    } catch (error) {
      throw new AiError((error as Error).name === 'TimeoutError' ? 'ai_timeout' : 'ai_network');
    }
    if (res.status === 404) throw new AiError('ai_model_unavailable');
    // 5xx는 생성 중 일시 실패(구조화 출력 실패 등)가 많아 한 번 더 묻고, 그래도 실패하면 그 항목만 잘못된 출력으로 넘긴다.
    if (res.status >= 500) continue;
    if (!res.ok) throw new AiError('ai_http');
    const body = await res.json() as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    usageTotals.calls++;
    usageTotals.inputTokens += body.prompt_eval_count ?? 0;
    usageTotals.outputTokens += body.eval_count ?? 0;
    try { return schema.parse(JSON.parse(body.message?.content ?? '')); } catch { /* 한 번 더 */ }
  }
  throw new AiError('ai_invalid_output');
}

export function jsonSchema(schema: z.ZodType) {
  const out = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

/** OpenAI 구조화 출력(codex exec --output-schema)이 요구하는 엄격한 형태: 객체마다 모든 속성 required, 추가 속성 금지(2026-11-26 실측). */
export function strictJsonSchema(schema: z.ZodType) {
  const fix = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (o.type === 'object' && o.properties) { o.required = Object.keys(o.properties as object); o.additionalProperties = false; }
    for (const v of Object.values(o)) fix(v);
  };
  const out = jsonSchema(schema);
  fix(out);
  return out;
}

// 외부 자료는 구분자 안의 데이터로만 전달한다. 구분자 위조를 막으려고 닫는 태그를 무력화한다.
export function dataBlock(tag: string, value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
  return `<${tag}>\n${text.replaceAll(`</${tag}>`, `<\\/${tag}>`)}\n</${tag}>`;
}
