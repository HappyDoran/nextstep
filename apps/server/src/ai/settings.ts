import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { aiModelSchema, aiSettingsSchema, aiSettingsUpdateSchema, AI_MODELS } from '@nextstep/contracts';
import { requireUser } from '../auth.js';
import { decrypt, encrypt } from '../secrets.js';
import { AiError, aiBaseUrl, httpError, ollamaModel, type AiConfig } from './openai.js';

type Row = { key_enc: string; key_hint: string; model: string; verified_at: string };
const DEFAULT_MODEL = AI_MODELS[0].id;

// 작업·요청에서 쓸 사용자 본인 키. 없거나 복호화할 수 없으면 null(운영자 키로 대신하지 않는다).
export function loadUserAi(db: DatabaseSync, secretKey: Buffer, userId: string): AiConfig | null {
  const row = db.prepare('SELECT key_enc, model FROM ai_settings WHERE user_id = ?').get(userId) as Pick<Row, 'key_enc' | 'model'> | undefined;
  if (!row) return null;
  try { return { apiKey: decrypt(secretKey, row.key_enc), model: row.model }; } catch { return null; }
}

// 키와 모델 권한을 함께 확인한다. 모델 조회는 요금이 들지 않는다. 잔액 부족은 실제 호출에서만 드러난다.
async function verify(apiKey: string, model: string) {
  let res: Response;
  try {
    res = await fetch(`${aiBaseUrl()}/models/${encodeURIComponent(model)}`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new AiError('ai_network');
  }
  if (!res.ok) throw await httpError(res);
}

const MESSAGES: Record<string, string> = {
  ai_key_invalid: 'OpenAI가 키를 거부했습니다. 키를 다시 확인하세요.',
  ai_model_unavailable: '이 키로는 선택한 모델을 쓸 수 없습니다. 다른 모델을 고르세요.',
  ai_network: 'OpenAI에 연결하지 못했습니다. 잠시 후 다시 시도하세요.',
};

export function registerAiSettings(app: FastifyInstance, db: DatabaseSync, secretKey: Buffer) {
  const local = process.env.NEXTSTEP_AI_PROVIDER === 'ollama' ? ollamaModel() : null;
  const view = (userId: string) => {
    const row = db.prepare('SELECT key_hint, model, verified_at FROM ai_settings WHERE user_id = ?').get(userId) as Omit<Row, 'key_enc'> | undefined;
    return aiSettingsSchema.parse(row
      ? { configured: true, keyHint: row.key_hint, model: aiModelSchema.safeParse(row.model).data ?? DEFAULT_MODEL, verifiedAt: row.verified_at, local }
      : { configured: false, keyHint: null, model: DEFAULT_MODEL, verifiedAt: null, local });
  };

  app.get('/settings/ai', async (request, reply) => {
    const user = requireUser(db, request, reply);
    return user ? view(user.id) : reply;
  });

  app.put('/settings/ai', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const body = aiSettingsUpdateSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ message: 'OpenAI API 키와 모델을 확인하세요.' });
    const apiKey = body.data.apiKey ?? loadUserAi(db, secretKey, user.id)?.apiKey;
    if (!apiKey) return reply.status(400).send({ message: 'OpenAI API 키를 입력하세요.' });
    try {
      await verify(apiKey, body.data.model);
    } catch (error) {
      if (!(error instanceof AiError)) throw error;
      return reply.status(422).send({ message: MESSAGES[error.code] ?? 'OpenAI에서 키를 확인하지 못했습니다.', code: error.code });
    }
    db.prepare(`INSERT INTO ai_settings (user_id, key_enc, key_hint, model, verified_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET key_enc = excluded.key_enc, key_hint = excluded.key_hint, model = excluded.model, verified_at = excluded.verified_at`)
      .run(user.id, encrypt(secretKey, apiKey), apiKey.slice(-4), body.data.model, new Date().toISOString());
    return view(user.id);
  });

  app.delete('/settings/ai', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    db.prepare('DELETE FROM ai_settings WHERE user_id = ?').run(user.id);
    return reply.status(204).send();
  });
}
