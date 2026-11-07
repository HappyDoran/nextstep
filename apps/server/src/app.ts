import Fastify, { type FastifyError } from 'fastify';
import { healthSchema, collectionModeUpdateSchema, collectionSettingsSchema, SOURCE_POLICY, type CollectionMode } from '@nextstep/contracts';
import { openDatabase } from './database.js';
import { readCollectionMode, writeCollectionMode } from './sources/policy.js';
import { registerAuth } from './auth.js';
import { registerApplications } from './applications.js';
import { registerUserSettings } from './user-settings.js';
import { registerProfile } from './profile.js';
import { registerDocuments, removeUserFiles } from './documents/routes.js';
import { dirname, join } from 'node:path';
import { registerRecommendations } from './recommend/routes.js';
import { createHandler, type PipelineDeps } from './recommend/pipeline.js';
import { startWorker, type ClaimedJob } from './recommend/jobs.js';
import { loadSecretKey } from './secrets.js';
import { registerMail } from './mail/routes.js';
import { createMailHandler } from './mail/sync.js';
import { naverBodies, naverSource, type MailSource } from './mail/naver.js';
import { aiConfigured } from './ai/openai.js';
import { interpretMail } from './prompts/mail.js';

export function createApp(databasePath: string, options: { secureCookie?: boolean; filesDir?: string; worker?: boolean; deps?: PipelineDeps; mailSource?: MailSource } = {}) {
  const db = openDatabase(databasePath);
  // 원본 파일은 DB 옆 비공개 디렉터리에 둔다(Git 제외 경로).
  const filesDir = options.filesDir ?? join(dirname(databasePath), 'files');
  // 개인 자료를 로그에 남기지 않는다. 관측 이벤트는 별도 허용 목록으로 추가한다.
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  app.get('/health', async () => {
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
    return healthSchema.parse({ service: 'nextstep', status: 'ok', database: 'ready', schemaVersion: version.user_version });
  });
  // 수집 모드는 서버 전체 설정이다. ponytail: 인증이 없어 누구나 바꿀 수 있다. P1-02에서 관리자 전용으로 제한한다.
  const settings = (mode: CollectionMode) => collectionSettingsSchema.parse({ mode, sources: SOURCE_POLICY[mode] });
  app.get('/settings/collection', async () => settings(readCollectionMode(db)));
  app.put('/settings/collection', async (request, reply) => {
    const body = collectionModeUpdateSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ message: '요청을 확인하세요.' });
    writeCollectionMode(db, body.data.mode);
    return settings(body.data.mode);
  });
  registerAuth(app, db, { secureCookie: options.secureCookie ?? false, onAccountDeleted: userId => removeUserFiles(filesDir, userId) });
  registerApplications(app, db);
  registerUserSettings(app, db);
  registerProfile(app, db);
  registerDocuments(app, db, filesDir);
  registerRecommendations(app, db);
  // 연결 비밀정보 키는 DB와 다른 파일(또는 환경 변수)에 둔다.
  const secretKey = loadSecretKey(join(dirname(databasePath), 'secret.key'));
  const mailSource = options.mailSource ?? naverSource;
  registerMail(app, db, secretKey, mailSource);
  // 수집·추천 작업은 요청 경로 밖의 작업자가 처리한다. 테스트는 worker:false로 끄고 직접 실행한다.
  if (options.worker) {
    const recommend = createHandler(db, options.deps);
    // AI가 설정된 경우에만 보관 메일 해석 단계를 켠다.
    const mail = createMailHandler(db, secretKey, mailSource, aiConfigured() ? { interpret: interpretMail, bodies: naverBodies } : undefined);
    const stop = startWorker(db, (job: ClaimedJob) => (job.kind === 'mail' ? mail(job) : recommend(job)));
    app.addHook('onClose', async () => { stop(); });
  }
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    // 4xx는 Fastify가 판정한 클라이언트 오류이므로 상태를 유지한다. 내부 메시지는 노출하지 않는다.
    const status = error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    void reply.status(status).send({ message: status === 500 ? '요청을 처리하지 못했습니다.' : '요청을 확인하세요.' });
  });
  // 작업자를 먼저 멈춘 뒤 DB를 닫는다(onClose는 등록 순서대로 실행).
  app.addHook('onClose', async () => { db.close(); });
  return app;
}
