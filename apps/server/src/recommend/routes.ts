import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { linkRequestSchema, recommendationListSchema, recommendationSchema } from '@nextstep/contracts';
import { requireUser } from '../auth.js';
import { readCollectionMode } from '../sources/policy.js';
import { suggestProfile } from '../prompts/profile.js';
import { AiError } from '../ai/openai.js';
import { enqueue, getJob, latestJob } from './jobs.js';
import { parsePostingLink, visiblePostingsSql } from './pipeline.js';

type Row = {
  posting_id: string; source: string; owner_user_id: string | null; url: string; external_apply_url: string | null; title: string; company: string;
  deadline: string | null; always_hire: number; company_type: string | null; employee_count: number | null; checked_at: string;
  classification: string; judgement: string; hidden: number; evaluated_at: string;
};

// 마감 근거가 없으면 임의로 종료하지 않고 미확인으로 둔다.
function postingStatus(row: Row, now: string) {
  if (row.always_hire) return '모집중';
  if (!row.deadline) return '미확인';
  return new Date(row.deadline).toISOString() < now ? '마감' : '모집중';
}

export function registerRecommendations(app: FastifyInstance, db: DatabaseSync) {
  app.post('/postings/refresh', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    return reply.status(202).send(enqueue(db, user.id, 'refresh'));
  });

  app.post('/postings/link', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const body = linkRequestSchema.safeParse(request.body);
    if (!body.success || !parsePostingLink(body.data.url)) return reply.status(400).send({ message: '잡코리아·원티드·자소설닷컴 공고 상세 링크를 넣으세요.' });
    return reply.status(202).send(enqueue(db, user.id, 'link', { url: body.data.url }));
  });

  app.get<{ Params: { id: string } }>('/jobs/:id', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    return getJob(db, user.id, request.params.id) ?? reply.status(404).send({ message: '찾을 수 없습니다.' });
  });

  app.get('/recommendations', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const now = new Date().toISOString();
    const rows = db.prepare(`SELECT r.posting_id, p.source, p.owner_user_id, p.url, p.external_apply_url, p.title, p.company, p.deadline, p.always_hire, p.company_type, p.employee_count, p.checked_at,
        r.classification, r.judgement, r.hidden, r.evaluated_at
      FROM recommendations r JOIN postings p ON p.id = r.posting_id
      WHERE r.user_id = ? AND (p.owner_user_id IS NULL OR p.owner_user_id = ?) ${visiblePostingsSql(readCollectionMode(db))}
      ORDER BY CASE r.classification WHEN '기본' THEN 0 WHEN '도전' THEN 1 WHEN '미확인' THEN 2 ELSE 3 END, p.checked_at DESC`).all(user.id, user.id) as Row[];
    const items = rows.map(row => {
      const j = JSON.parse(row.judgement) as { met: string[]; unmet: string[]; unknown: string[]; reason: string };
      return recommendationSchema.parse({
        postingId: row.posting_id, source: row.source, linkOnly: row.owner_user_id !== null, url: row.url, externalApplyUrl: row.external_apply_url,
        title: row.title, company: row.company, deadline: row.deadline, alwaysHire: row.always_hire === 1, postingStatus: postingStatus(row, now),
        companyType: row.company_type, employeeCount: row.employee_count, checkedAt: row.checked_at,
        classification: row.classification, met: j.met, unmet: j.unmet, unknown: j.unknown, reason: j.reason, hidden: row.hidden === 1, evaluatedAt: row.evaluated_at,
      });
    });
    return recommendationListSchema.parse({ items, lastJob: latestJob(db, user.id, 'refresh') });
  });

  // 관심 없음: 해당 공고만 숨기고 해제할 수 있다.
  app.put<{ Params: { id: string } }>('/recommendations/:id/hide', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const hidden = (request.body as { hidden?: unknown } | undefined)?.hidden;
    if (typeof hidden !== 'boolean') return reply.status(400).send({ message: '요청을 확인하세요.' });
    const r = db.prepare('UPDATE recommendations SET hidden = ? WHERE user_id = ? AND posting_id = ?').run(hidden ? 1 : 0, user.id, request.params.id);
    return r.changes === 1 ? { hidden } : reply.status(404).send({ message: '찾을 수 없습니다.' });
  });

  // 이력서에서 프로필 초안을 만든다. 저장하지 않고 사용자가 확인한 뒤 PUT /profile로 저장한다.
  app.post('/profile/suggest', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const resume = db.prepare("SELECT text FROM documents WHERE user_id = ? AND kind = 'resume'").get(user.id) as { text: string } | undefined;
    if (!resume) return reply.status(409).send({ message: '이력서를 먼저 등록하세요.' });
    try {
      return { profile: await suggestProfile(resume.text) };
    } catch (error) {
      if (error instanceof AiError) return reply.status(error.code === 'ai_unconfigured' ? 503 : 502).send({ message: error.code === 'ai_unconfigured' ? 'AI 처리가 설정되지 않았습니다.' : 'AI 처리에 실패했습니다. 잠시 후 다시 시도하세요.', code: error.code });
      throw error;
    }
  });
}
