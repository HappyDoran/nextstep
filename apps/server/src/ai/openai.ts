import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

// OpenAI Responses API 호출. SDK 없이 fetch로 JSON Schema 구조화 출력을 받고 zod로 다시 검증한다.
// 키·모델은 환경 변수로만 받는다. 요청 본문(이력서·공고·메일)은 로그에 남기지 않는다.
export type AiFailure = 'ai_unconfigured' | 'ai_http' | 'ai_invalid_output' | 'ai_network';
export class AiError extends Error {
  constructor(readonly code: AiFailure, readonly status?: number) { super(code); }
}

// 호출 사용량 누계(평가·비용 추정용). 요청 본문은 남기지 않는다.
export const usageTotals = { calls: 0, inputTokens: 0, outputTokens: 0 };

// 개발용 요금 절감(운영에서는 켜지 않는다).
// NEXTSTEP_AI_FAKE=1: 네트워크 없이 스키마에 맞는 고정 응답. NEXTSTEP_AI_CACHE_DIR: 같은 모델·지시·입력의 응답을 파일로 재사용.
const fake = () => process.env.NEXTSTEP_AI_FAKE === '1';

export function aiConfigured() {
  return fake() || Boolean(process.env.OPENAI_API_KEY && process.env.NEXTSTEP_OPENAI_MODEL);
}

export async function structured<T extends z.ZodType>(name: string, schema: T, instructions: string, input: string): Promise<z.infer<T>> {
  if (fake()) {
    try { return schema.parse(fakeValue(jsonSchema(schema))); } catch { throw new AiError('ai_invalid_output'); }
  }
  const dir = process.env.NEXTSTEP_AI_CACHE_DIR;
  const file = dir && join(dir, `${createHash('sha256').update(JSON.stringify([process.env.NEXTSTEP_OPENAI_MODEL, name, instructions, input])).digest('hex')}.json`);
  if (file) {
    try { return schema.parse(JSON.parse(readFileSync(file, 'utf8'))); } catch { /* 없거나 스키마가 바뀌면 새로 요청 */ }
  }
  const value = await request(name, schema, instructions, input);
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

async function request<T extends z.ZodType>(name: string, schema: T, instructions: string, input: string): Promise<z.infer<T>> {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.NEXTSTEP_OPENAI_MODEL;
  if (!key || !model) throw new AiError('ai_unconfigured');
  const base = process.env.NEXTSTEP_OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  let res: Response;
  try {
    res = await fetch(`${base}/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
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
  } catch {
    throw new AiError('ai_network');
  }
  if (!res.ok) throw new AiError('ai_http', res.status);
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
