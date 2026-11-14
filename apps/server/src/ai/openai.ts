import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

// OpenAI Responses API 호출. SDK 없이 fetch로 JSON Schema 구조화 출력을 받고 zod로 다시 검증한다.
// 요청 본문(이력서·공고·메일)은 로그에 남기지 않는다.
export type AiFailure = 'ai_unconfigured' | 'ai_key_invalid' | 'ai_quota' | 'ai_model_unavailable' | 'ai_http' | 'ai_invalid_output' | 'ai_network' | 'ai_timeout';
export class AiError extends Error {
  constructor(readonly code: AiFailure, readonly status?: number) { super(code); }
}

// 호출 사용량 누계(평가·비용 추정용). 요청 본문은 남기지 않는다.
export const usageTotals = { calls: 0, inputTokens: 0, outputTokens: 0 };

// 개발용 요금 절감(운영에서는 켜지 않는다).
// NEXTSTEP_AI_FAKE=1: 네트워크 없이 스키마에 맞는 고정 응답. NEXTSTEP_AI_CACHE_DIR: 같은 모델·지시·입력의 응답을 파일로 재사용.
const fake = () => process.env.NEXTSTEP_AI_FAKE === '1';

// 서버 요청·작업은 사용자 본인 키·모델로만 AI를 부른다(기획서 3절). runWithAi로 감싼 안에서는 환경 변수 키로 대신하지 않는다.
// 감싸지 않은 호출(평가·검증 명령)만 OPENAI_API_KEY·NEXTSTEP_OPENAI_MODEL을 쓴다.
export type AiConfig = { apiKey: string; model: string };
const userAi = new AsyncLocalStorage<AiConfig | null>();
export const runWithAi = <T>(config: AiConfig | null, fn: () => T) => userAi.run(config, fn);
function currentAi(): AiConfig | null {
  const scoped = userAi.getStore();
  if (scoped !== undefined) return scoped;
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.NEXTSTEP_OPENAI_MODEL;
  return apiKey && model ? { apiKey, model } : null;
}
export const aiBaseUrl = () => process.env.NEXTSTEP_OPENAI_BASE_URL ?? 'https://api.openai.com/v1';

// 홈서버 로컬 LLM(Ollama). NEXTSTEP_AI_PROVIDER=ollama이면 사용자 키 대신 이 모델 하나로 모든 AI 처리를 한다(기획서 3절, P1-10).
// 외부로 나가지 않으므로 사용자별 키가 필요 없다. 기본 모델 qwen3:4b, 주소는 127.0.0.1에만 연다.
const ollama = () => process.env.NEXTSTEP_AI_PROVIDER === 'ollama';
const ollamaUrl = () => process.env.NEXTSTEP_OLLAMA_URL ?? 'http://127.0.0.1:11434';
export const ollamaModel = () => process.env.NEXTSTEP_OLLAMA_MODEL ?? 'qwen3:4b';

export function aiConfigured() {
  return fake() || ollama() || currentAi() !== null;
}

export async function structured<T extends z.ZodType>(name: string, schema: T, instructions: string, input: string): Promise<z.infer<T>> {
  if (fake()) {
    try { return schema.parse(fakeValue(jsonSchema(schema))); } catch { throw new AiError('ai_invalid_output'); }
  }
  const ai = ollama() ? { apiKey: '', model: `ollama:${ollamaModel()}${process.env.NEXTSTEP_OLLAMA_THINK === '1' ? ':think' : ''}` } : currentAi();
  if (!ai) throw new AiError('ai_unconfigured');
  const dir = process.env.NEXTSTEP_AI_CACHE_DIR;
  const file = dir && join(dir, `${createHash('sha256').update(JSON.stringify([ai.model, name, instructions, input])).digest('hex')}.json`);
  if (file) {
    try { return schema.parse(JSON.parse(readFileSync(file, 'utf8'))); } catch { /* 없거나 스키마가 바뀌면 새로 요청 */ }
  }
  const value = ollama() ? await requestOllama(schema, instructions, input) : await request(ai, name, schema, instructions, input);
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

async function request<T extends z.ZodType>({ apiKey, model }: AiConfig, name: string, schema: T, instructions: string, input: string): Promise<z.infer<T>> {
  let res: Response;
  try {
    res = await fetch(`${aiBaseUrl()}/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        instructions,
        input,
        // 학습·보관 옵션은 계정 기본값을 따른다. 응답 저장은 요청하지 않는다.
        store: false,
        text: { format: { type: 'json_schema', name, strict: true, schema: jsonSchema(schema) } },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    // 응답 시간 초과(60초)와 연결 실패를 나눠 기록한다. 컴퓨터 잠자기·느린 모델을 구분하는 근거다.
    throw new AiError((error as Error).name === 'TimeoutError' ? 'ai_timeout' : 'ai_network');
  }
  if (!res.ok) throw await httpError(res);
  const body = await res.json() as { output?: { type?: string; content?: { type?: string; text?: string }[] }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  usageTotals.calls++;
  usageTotals.inputTokens += body.usage?.input_tokens ?? 0;
  usageTotals.outputTokens += body.usage?.output_tokens ?? 0;
  const text = body.output?.flatMap(item => item.content ?? []).find(part => part.type === 'output_text')?.text;
  try {
    return schema.parse(JSON.parse(text ?? ''));
  } catch {
    throw new AiError('ai_invalid_output');
  }
}

// Ollama 구조화 출력: JSON Schema를 format으로 넘기고 Qwen3 생각 모드는 끈다. 온도 0, 문맥 8,192 토큰.
// 형식이 틀리면 한 번 다시 묻고, 그래도 틀리면 ai_invalid_output(호출한 쪽이 미확인으로 처리).
async function requestOllama<T extends z.ZodType>(schema: T, instructions: string, input: string): Promise<z.infer<T>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${ollamaUrl()}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // 생각 모드는 기본으로 끈다(느림). NEXTSTEP_OLLAMA_THINK=1은 품질 비교용.
          model: ollamaModel(), stream: false, think: process.env.NEXTSTEP_OLLAMA_THINK === '1', format: jsonSchema(schema),
          // 출력 상한: 작은 모델이 JSON을 끝없이 이어 쓰는 경우를 막는다(구조화 출력은 보통 수백 토큰, 생각 모드면 더 길게).
          options: { temperature: 0, num_ctx: 8192, num_predict: process.env.NEXTSTEP_OLLAMA_THINK === '1' ? 6144 : 1536 },
          messages: [{ role: 'system', content: instructions }, { role: 'user', content: input }],
        }),
        // 로컬 CPU·작은 장비는 느리다. 홈서버에서 실측 후 조정한다.
        signal: AbortSignal.timeout(300_000),
      });
    } catch (error) {
      throw new AiError((error as Error).name === 'TimeoutError' ? 'ai_timeout' : 'ai_network');
    }
    if (res.status === 404) throw new AiError('ai_model_unavailable', 404);
    // 5xx는 생성 중 일시 실패(구조화 출력 실패 등)가 많아 한 번 더 묻고, 그래도 실패하면 그 항목만 잘못된 출력으로 넘긴다.
    if (res.status >= 500) continue;
    if (!res.ok) throw new AiError('ai_http', res.status);
    const body = await res.json() as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    usageTotals.calls++;
    usageTotals.inputTokens += body.prompt_eval_count ?? 0;
    usageTotals.outputTokens += body.eval_count ?? 0;
    try { return schema.parse(JSON.parse(body.message?.content ?? '')); } catch { /* 한 번 더 */ }
  }
  throw new AiError('ai_invalid_output');
}

// 사용자가 고칠 수 있는 원인(키·잔액·모델 권한)을 일반 HTTP 오류와 구분한다.
export async function httpError(res: Response) {
  if (res.status === 401) return new AiError('ai_key_invalid', 401);
  const error = await res.json().then(b => (b as { error?: { code?: string; type?: string } }).error, () => undefined);
  const code = error?.code;
  // 잔액 부족은 code가 insufficient_quota이거나, type이 insufficient_quota·code가 credit_balance_exhausted로 온다(2026-11-14 확인).
  if (res.status === 429 && (code === 'insufficient_quota' || code === 'credit_balance_exhausted' || error?.type === 'insufficient_quota')) return new AiError('ai_quota', 429);
  if (res.status === 404 || code === 'model_not_found') return new AiError('ai_model_unavailable', res.status);
  return new AiError('ai_http', res.status);
}

function jsonSchema(schema: z.ZodType) {
  const out = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

// 외부 자료는 구분자 안의 데이터로만 전달한다. 구분자 위조를 막으려고 닫는 태그를 무력화한다.
export function dataBlock(tag: string, value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
  return `<${tag}>\n${text.replaceAll(`</${tag}>`, `<\\/${tag}>`)}\n</${tag}>`;
}
