import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { linkRequestSchema, profileDraftSchema, profileSchema, recommendationFeedbackSchema, recommendationListSchema, recommendationSchema, latestRefreshSchema } from '@nextstep/contracts';
import { requireUser } from '../auth.js';
import { suggestProfile } from '../prompts/profile.js';
import { enqueue, getJob, latestJob, runNext, type ClaimedJob, type JobOutcome } from './jobs.js';
import { parsePostingLink, rowFacts } from './pipeline.js';
import { passesFilter } from '../sources/filter.js';

type Row = {
  posting_id: string; source: string; acquired_by: string; url: string; external_apply_url: string | null; title: string; company: string;
  deadline: string | null; always_hire: number; company_type: string | null; employee_count: number | null; checked_at: string;
  classification: string; judgement: string; hidden: number; feedback: string | null; restored: number; evaluated_at: string;
  location: string | null; remote: number | null; careers: string; requirements: string | null;
};

// 마감 근거가 없으면 임의로 종료하지 않고 미확인으로 둔다.
function postingStatus(row: Row, now: string) {
  if (row.always_hire) return '모집중';
  // 읽을 수 없는 마감 값(이전 수집분)도 미확인으로 둔다.
  const at = row.deadline ? Date.parse(row.deadline) : NaN;
  if (Number.isNaN(at)) return '미확인';
  return at < Date.parse(now) ? '마감' : '모집중';
}

/** 프로필 초안 작업: 실행 시점의 사용 중 이력서로 초안을 만들어 작업 결과에 둔다(저장은 사용자가 한다). */
export function createSuggestHandler(db: DatabaseSync) {
  return async (job: ClaimedJob): Promise<JobOutcome> => {
    const resume = db.prepare("SELECT text FROM documents WHERE user_id = ? AND kind = 'resume' AND active = 1").get(job.userId) as { text: string } | undefined;
    if (!resume) return { status: '실패', errorCode: 'no_resume', result: {} };
    return { status: '성공', result: { profile: await suggestProfile(resume.text) } };
  };
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
    const link = body.success ? parsePostingLink(body.data.url) : undefined;
    if (!body.success || !link) return reply.status(400).send({ message: '사람인·잡코리아·자소설닷컴·원티드·점핏 공고 상세 링크를 넣으세요.' });
    // 링크 작업은 사용자당 하나씩 처리한다. 다른 링크를 처리하는 중이면 조용히 버리지 않고 알린다.
    const job = enqueue(db, user.id, 'link', { url: body.data.url });
    const queued = db.prepare('SELECT payload FROM jobs WHERE id = ? AND user_id = ?').get(job.id, user.id) as { payload: string | null } | undefined;
    if (queued?.payload && (JSON.parse(queued.payload) as { url?: string }).url !== body.data.url) return reply.status(409).send({ message: '앞서 넣은 링크를 처리하는 중입니다. 끝난 뒤 다시 넣으세요.', code: 'link_in_progress' });
    return reply.status(202).send(job);
  });

  // 데스크톱 상주 앱이 1분마다 묻는 가벼운 조회(추천 목록 전체를 받지 않게). 건수는 그 작업이 판정한 것만 센다.
  app.get('/jobs/latest', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const job = latestJob(db, user.id, 'refresh');
    const window = job?.finishedAt ? db.prepare('SELECT started_at FROM jobs WHERE id = ?').get(job.id) as { started_at: string | null } : undefined;
    const counts = job?.finishedAt && window?.started_at ? db.prepare(`SELECT COALESCE(SUM(classification = '기본'), 0) AS basic, COALESCE(SUM(classification = '도전'), 0) AS challenge
      FROM recommendations WHERE user_id = ? AND evaluated_at BETWEEN ? AND ?`).get(user.id, window.started_at, job.finishedAt) as { basic: number; challenge: number } : null;
    return latestRefreshSchema.parse({ job, counts: counts ? { basic: Number(counts.basic), challenge: Number(counts.challenge) } : null });
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
    const rows = db.prepare(`SELECT r.posting_id, p.source, p.acquired_by, p.url, p.external_apply_url, p.title, p.company, p.deadline, p.always_hire, p.company_type, p.employee_count, p.checked_at, p.location, p.remote, p.careers, p.requirements,
        r.classification, r.judgement, r.hidden, r.feedback, r.restored, r.evaluated_at
      FROM recommendations r JOIN postings p ON p.id = r.posting_id
      WHERE r.user_id = ? AND p.owner_user_id = ?
      ORDER BY CASE r.classification WHEN '기본' THEN 0 WHEN '도전' THEN 1 WHEN '미확인' THEN 2 ELSE 3 END, r.feedback = 'up' DESC, p.checked_at DESC`).all(user.id, user.id) as Row[];
    // 필터를 바꾸면 다시 가져오기 전에도 기존 결과를 현재 필터로 먼저 거른다(기술 설계 D). 링크 공고는 그대로 둔다.
    const profileRow = db.prepare('SELECT data FROM profiles WHERE user_id = ?').get(user.id) as { data: string } | undefined;
    const profile = profileRow ? profileSchema.parse(JSON.parse(profileRow.data)) : null;
    const items = rows.filter(row => !profile || row.acquired_by === 'link' || passesFilter(rowFacts(row), profile)).map(row => {
      const j = JSON.parse(row.judgement) as { met: string[]; unmet: string[]; unknown: string[]; reason: string };
      return recommendationSchema.parse({
        postingId: row.posting_id, source: row.source, linkOnly: row.acquired_by === 'link', url: row.url, externalApplyUrl: row.external_apply_url,
        title: row.title, company: row.company, deadline: row.deadline, alwaysHire: row.always_hire === 1, postingStatus: postingStatus(row, now),
        companyType: row.company_type, employeeCount: row.employee_count, checkedAt: row.checked_at,
        classification: row.classification, met: j.met, unmet: j.unmet, unknown: j.unknown, reason: j.reason, hidden: row.hidden === 1, feedback: row.feedback, restored: row.restored === 1, evaluatedAt: row.evaluated_at,
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

  // 피드백·제외 복구: 그 사용자 목록에서만 순서·표시를 바꾼다. 별로(down)는 숨김으로도 처리한다. 다시 판정해도 유지된다.
  app.put<{ Params: { id: string } }>('/recommendations/:id/feedback', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const body = recommendationFeedbackSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ message: '요청을 확인하세요.' });
    const current = db.prepare('SELECT feedback, restored, hidden FROM recommendations WHERE user_id = ? AND posting_id = ?').get(user.id, request.params.id) as { feedback: string | null; restored: number; hidden: number } | undefined;
    if (!current) return reply.status(404).send({ message: '찾을 수 없습니다.' });
    const feedback = body.data.feedback === undefined ? current.feedback : body.data.feedback;
    const restored = body.data.restored === undefined ? current.restored : body.data.restored ? 1 : 0;
    const hidden = body.data.feedback === 'down' ? 1 : body.data.feedback !== undefined && current.feedback === 'down' ? 0 : current.hidden;
    db.prepare('UPDATE recommendations SET feedback = ?, restored = ?, hidden = ? WHERE user_id = ? AND posting_id = ?').run(feedback, restored, hidden, user.id, request.params.id);
    return { feedback, restored: restored === 1, hidden: hidden === 1 };
  });

  // 이력서에서 프로필 초안을 만든다. 화면을 떠나도 서버가 끝까지 만들고, 결과는 GET /profile/draft로 읽는다.
  // 작업자 순서(공고 갱신 등 긴 작업)를 기다리지 않고 바로 돌린다. 같은 사용자의 초안 작업은 하나만 둔다.
  const suggest = createSuggestHandler(db);
  app.post('/profile/suggest', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    if (!db.prepare("SELECT 1 FROM documents WHERE user_id = ? AND kind = 'resume' AND active = 1").get(user.id)) return reply.status(409).send({ message: '이력서를 먼저 등록하세요.' });
    const job = enqueue(db, user.id, 'suggest');
    void runNext(db, suggest, job.id).catch(() => {});
    return reply.status(202).send(job);
  });

  // 마지막 초안 작업. 그 뒤에 프로필을 저장했거나 사용자가 버렸으면 없음(null)으로 본다.
  app.get('/profile/draft', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const job = latestJob(db, user.id, 'suggest');
    const saved = db.prepare('SELECT updated_at FROM profiles WHERE user_id = ?').get(user.id) as { updated_at: string } | undefined;
    return profileDraftSchema.parse({ job: job && !(job.finishedAt && saved && job.finishedAt <= saved.updated_at) ? job : null });
  });

  app.delete('/profile/draft', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    db.prepare("DELETE FROM jobs WHERE user_id = ? AND kind = 'suggest' AND status NOT IN ('대기', '실행중')").run(user.id);
    return reply.status(204).send();
  });
}
