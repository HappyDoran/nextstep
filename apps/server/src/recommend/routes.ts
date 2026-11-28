import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { type Profile, linkRequestSchema, profileDraftSchema, profileSchema, recommendationFeedbackSchema, recommendationListSchema, recommendationSchema, latestRefreshSchema } from '@nextstep/contracts';
import { requireUser } from '../auth.js';
import { profileFromCandidate } from '../prompts/profile.js';
import { extractCandidate } from '../prompts/candidate.js';
import { candidateFor } from '../ai/remote.js';
import { enqueue, getJob, latestJob, runNext, type ClaimedJob, type JobOutcome } from './jobs.js';
import { documentsText, parsePostingLink, rowFacts } from './pipeline.js';
import { companyMatches, passesFilter, postingKey } from '../sources/filter.js';
import { norm } from './classify.js';

type Row = {
  posting_id: string; source: string; acquired_by: string; url: string; external_apply_url: string | null; title: string; company: string;
  deadline: string | null; always_hire: number; company_type: string | null; employee_count: number | null; checked_at: string;
  classification: string; judgement: string; hidden: number; feedback: string | null; feedback_reason: string | null; restored: number; evaluated_at: string;
  location: string | null; remote: number | null; careers: string; requirements: string | null; closed_at: string | null; first_seen_at: string | null;
};

// 선호로 목록 순서만 조금 바꾼다(판정은 그대로, P1-19 ④): 관심 회사 +3, 선호 회사 유형 +1, 공고 조건에 든 선호 기술 하나당 +1(최대 3),
// 필수 조건에 든 피하는 기술 하나당 -2. 근거는 목록에 표시한다.
// 선호 입력은 모두 선택(2026-11-28): 비워 두면 사용자가 이미 남긴 것으로 대신한다.
// 관심 회사 → 지원 현황에 넣었거나 좋아요한 회사, 선호 기술 → 프로필 기술, 별로(회사 이유)를 고른 회사는 같은 회사 다른 공고도 내린다.
type Learned = { likedCompanies: string[]; dislikedCompanies: string[] };
function learned(db: DatabaseSync, userId: string): Learned {
  const liked = db.prepare(`SELECT company FROM applications WHERE user_id = ?
    UNION SELECT p.company FROM recommendations r JOIN postings p ON p.id = r.posting_id WHERE r.user_id = ? AND p.owner_user_id = ? AND r.feedback = 'up'`).all(userId, userId, userId) as { company: string }[];
  const disliked = db.prepare(`SELECT DISTINCT p.company FROM recommendations r JOIN postings p ON p.id = r.posting_id
    WHERE r.user_id = ? AND p.owner_user_id = ? AND r.feedback = 'down' AND r.feedback_reason = '회사(규모·분야)'`).all(userId, userId) as { company: string }[];
  return { likedCompanies: liked.map(r => r.company), dislikedCompanies: disliked.map(r => r.company) };
}

function preference(row: Row, profile: Profile | null, past: Learned) {
  if (!profile) return { boost: 0, signals: [] as string[] };
  const signals: string[] = [];
  let boost = 0;
  if (profile.favoriteCompanies.length && companyMatches(row.company, profile.favoriteCompanies)) { boost += 3; signals.push('관심 회사'); }
  else if (companyMatches(row.company, past.likedCompanies)) { boost += 2; signals.push('전에 관심 보인 회사'); }
  if (row.feedback !== 'down' && companyMatches(row.company, past.dislikedCompanies)) { boost -= 3; signals.push('별로라고 한 회사'); }
  const type = row.company_type ?? '';
  if (type && profile.companyTypes.some(t => (t === '벤처·스타트업' ? /벤처|스타트업/.test(type) : type.startsWith(t)))) { boost += 1; signals.push('선호 회사 유형'); }
  const req = row.requirements ? JSON.parse(row.requirements) as { required?: { keys?: string[] }[]; preferred?: { keys?: string[] }[] } : null;
  const keys = (list?: { keys?: string[] }[]) => new Set((list ?? []).flatMap(r => r.keys ?? []).map(norm));
  const required = keys(req?.required);
  const any = new Set([...required, ...keys(req?.preferred)]);
  const own = !profile.preferredSkills.length;
  const liked = [...new Set(own ? profile.skills : profile.preferredSkills)].filter(s => any.has(norm(s)));
  const avoided = profile.avoidSkills.filter(s => required.has(norm(s)));
  if (liked.length) { boost += Math.min(own ? 2 : 3, liked.length); signals.push(`${own ? '내 기술' : '선호 기술'}: ${liked.slice(0, 3).join('·')}`); }
  if (avoided.length) { boost -= 2 * avoided.length; signals.push(`피하는 기술: ${avoided.slice(0, 3).join('·')}`); }
  return { boost, signals };
}

// 마감 근거가 없으면 임의로 종료하지 않고 미확인으로 둔다.
function postingStatus(row: Row, now: string) {
  if (row.closed_at) return '마감';
  if (row.always_hire) return '모집중';
  // 읽을 수 없는 마감 값(이전 수집분)도 미확인으로 둔다.
  const at = row.deadline ? Date.parse(row.deadline) : NaN;
  if (Number.isNaN(at)) return '미확인';
  return at < Date.parse(now) ? '마감' : '모집중';
}

/** 프로필 초안 작업: 실행 시점의 사용 중 이력서로 초안을 만들어 작업 결과에 둔다(저장은 사용자가 한다). */
export function createSuggestHandler(db: DatabaseSync) {
  return async (job: ClaimedJob): Promise<JobOutcome> => {
    const docs = documentsText(db, job.userId);
    if (!docs) return { status: '실패', errorCode: 'no_resume', result: {} };
    // 추천과 같은 저장된 지원자 사실(내 AI 결과 우선)을 쓴다. 없으면 로컬로 뽑아 저장한다.
    return { status: '성공', result: { profile: profileFromCandidate((await candidateFor(db, job.userId, docs.text, extractCandidate)).facts) } };
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
    if (!body.success || !link) return reply.status(400).send({ message: '사람인·잡코리아·원티드·점핏 공고 상세 링크를 넣으세요.' });
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
    const window = job?.finishedAt ? db.prepare('SELECT started_at FROM jobs WHERE id = ? AND user_id = ?').get(job.id, user.id) as { started_at: string | null } : undefined;
    const counts = job?.finishedAt && window?.started_at ? db.prepare(`SELECT COALESCE(SUM(classification = '기본'), 0) AS basic, COALESCE(SUM(classification = '도전'), 0) AS challenge
      FROM recommendations WHERE user_id = ? AND evaluated_at BETWEEN ? AND ?`).get(user.id, window.started_at, job.finishedAt) as { basic: number; challenge: number } : null;
    // 상단 막대: 마지막 갱신으로 새로 들어온 공고 수와, 지금 목록에 보이는 기본 추천 수(숨김·마감 제외).
    const now = Date.now();
    const basicNow = new Set((db.prepare(`SELECT p.company, p.title, p.deadline, p.always_hire FROM recommendations r JOIN postings p ON p.id = r.posting_id
      WHERE r.user_id = ? AND p.owner_user_id = ? AND r.classification = '기본' AND r.hidden = 0 AND p.closed_at IS NULL`).all(user.id, user.id) as { company: string; title: string; deadline: string | null; always_hire: number }[])
      .filter(p => p.always_hire === 1 || !p.deadline || !(Date.parse(p.deadline) <= now)).map(p => postingKey(p.company, p.title))).size;
    const collected = job?.finishedAt ? Number((job.result as { collected?: number } | null)?.collected ?? 0) : 0;
    return latestRefreshSchema.parse({ job, counts: counts ? { basic: Number(counts.basic), challenge: Number(counts.challenge) } : null, overview: job?.finishedAt ? { newPostings: collected, basicNow } : null });
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
    const rows = db.prepare(`SELECT r.posting_id, p.source, p.acquired_by, p.url, p.external_apply_url, p.title, p.company, p.deadline, p.always_hire, p.company_type, p.employee_count, p.checked_at, p.location, p.remote, p.careers, p.requirements, p.closed_at, p.first_seen_at,
        r.classification, r.judgement, r.hidden, r.feedback, r.feedback_reason, r.restored, r.evaluated_at
      FROM recommendations r JOIN postings p ON p.id = r.posting_id
      WHERE r.user_id = ? AND p.owner_user_id = ?
      ORDER BY CASE r.classification WHEN '기본' THEN 0 WHEN '도전' THEN 1 WHEN '미확인' THEN 2 ELSE 3 END, r.feedback = 'up' DESC, p.checked_at DESC`).all(user.id, user.id) as Row[];
    // 필터를 바꾸면 다시 가져오기 전에도 기존 결과를 현재 필터로 먼저 거른다(기술 설계 D). 링크 공고는 그대로 둔다.
    const profileRow = db.prepare('SELECT data FROM profiles WHERE user_id = ?').get(user.id) as { data: string } | undefined;
    const profile = profileRow ? profileSchema.parse(JSON.parse(profileRow.data)) : null;
    // 여러 출처의 같은 공고는 하나만 보인다. 사용자가 표시(숨김·피드백)한 쪽을, 없으면 더 좋은 분류(정렬 앞)를 남긴다.
    const past = learned(db, user.id);
    const keep = new Map<string, Row>();
    const marked = (row: Row) => row.acquired_by === 'link' || row.hidden === 1 || row.feedback !== null;
    for (const row of rows) { const k = postingKey(row.company, row.title); const cur = keep.get(k); if (!cur || (!marked(cur) && marked(row))) keep.set(k, row); }
    const items = rows.filter(row => keep.get(postingKey(row.company, row.title)) === row && (!profile || row.acquired_by === 'link' || passesFilter(rowFacts(row), profile))).map(row => {
      const j = JSON.parse(row.judgement) as { met: string[]; unmet: string[]; unknown: string[]; reason: string };
      const pref = preference(row, profile, past);
      return recommendationSchema.parse({
        postingId: row.posting_id, source: row.source, linkOnly: row.acquired_by === 'link', url: row.url, externalApplyUrl: row.external_apply_url,
        title: row.title, company: row.company, deadline: row.deadline, alwaysHire: row.always_hire === 1, postingStatus: postingStatus(row, now), closedAt: row.closed_at,
        companyType: row.company_type, employeeCount: row.employee_count, checkedAt: row.checked_at,
        classification: row.classification, met: j.met, unmet: j.unmet, unknown: j.unknown, reason: j.reason, hidden: row.hidden === 1, feedback: row.feedback, feedbackReason: row.feedback_reason, restored: row.restored === 1, evaluatedAt: row.evaluated_at,
        boost: pref.boost, signals: pref.signals, firstSeenAt: row.first_seen_at,
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

  // 마감 확인: 사용자가 원문에서 마감을 보면 표시한다. 다시 수집해도 지우지 않고, 다음 판정에서 마감으로 제외된다. 잘못 누르면 취소한다.
  app.put<{ Params: { id: string } }>('/recommendations/:id/closed', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const closed = (request.body as { closed?: unknown } | undefined)?.closed;
    if (typeof closed !== 'boolean') return reply.status(400).send({ message: '요청을 확인하세요.' });
    const closedAt = closed ? new Date().toISOString() : null;
    const r = db.prepare('UPDATE postings SET closed_at = ? WHERE id = ? AND owner_user_id = ? AND EXISTS (SELECT 1 FROM recommendations WHERE user_id = ? AND posting_id = ?)')
      .run(closedAt, request.params.id, user.id, user.id, request.params.id);
    return r.changes === 1 ? { closedAt } : reply.status(404).send({ message: '찾을 수 없습니다.' });
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
    // 이유는 별로일 때만 남긴다(별로를 지우거나 좋아요로 바꾸면 지움). 이유 없이 다른 값만 바꾸면 기존 이유를 둔다.
    const reason = feedback !== 'down' ? null : body.data.reason !== undefined ? body.data.reason : (db.prepare('SELECT feedback_reason FROM recommendations WHERE user_id = ? AND posting_id = ?').get(user.id, request.params.id) as { feedback_reason: string | null }).feedback_reason;
    db.prepare('UPDATE recommendations SET feedback = ?, feedback_reason = ?, restored = ?, hidden = ? WHERE user_id = ? AND posting_id = ?').run(feedback, reason, restored, hidden, user.id, request.params.id);
    return { feedback, reason, restored: restored === 1, hidden: hidden === 1 };
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

  // 마지막 초안 작업. 받아들였거나(화면이 저장 뒤 지움) 버렸으면 행이 없어 null이다. 필터만 저장해서는 사라지지 않는다.
  app.get('/profile/draft', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    return profileDraftSchema.parse({ job: latestJob(db, user.id, 'suggest') });
  });

  app.delete('/profile/draft', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    db.prepare("DELETE FROM jobs WHERE user_id = ? AND kind = 'suggest' AND status NOT IN ('대기', '실행중')").run(user.id);
    return reply.status(204).send();
  });
}
