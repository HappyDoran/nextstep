import Fastify, { type FastifyError } from 'fastify';
import { healthSchema } from '@nextstep/contracts';
import { openDatabase } from './database.js';
import { registerAuth } from './auth.js';
import { registerApplications } from './applications.js';
import { registerUserSettings } from './user-settings.js';
import { registerProfile } from './profile.js';
import { registerDocuments, removeUserFiles } from './documents/routes.js';
import { dirname, join } from 'node:path';
import { registerRecommendations } from './recommend/routes.js';
import { createHandler, type PipelineDeps } from './recommend/pipeline.js';
import { startWorker, type ClaimedJob } from './recommend/jobs.js';
import { startScheduler } from './schedule.js';
import { loadSecretKey } from './secrets.js';
import { registerMail } from './mail/routes.js';
import { createMailHandler } from './mail/sync.js';
import { naverBackfill, naverBodies, naverSource, type BackfillSource, type MailBodySource, type MailSource } from './mail/naver.js';
import { interpretMail } from './prompts/mail.js';

export function createApp(databasePath: string, options: { secureCookie?: boolean; filesDir?: string; worker?: boolean; scheduleHour?: number; deps?: PipelineDeps; mailSource?: MailSource; mailBackfill?: BackfillSource; mailBodies?: MailBodySource } = {}) {
  const db = openDatabase(databasePath);
  // 원본 파일은 DB 옆 비공개 디렉터리에 둔다(Git 제외 경로).
  const filesDir = options.filesDir ?? join(dirname(databasePath), 'files');
  // 개인 자료를 로그에 남기지 않는다. 관측 이벤트는 별도 허용 목록으로 추가한다.
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  app.get('/health', async () => {
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
    return healthSchema.parse({ service: 'nextstep', status: 'ok', database: 'ready', schemaVersion: version.user_version });
  });
  registerAuth(app, db, { secureCookie: options.secureCookie ?? false, onAccountDeleted: userId => removeUserFiles(filesDir, userId) });
  registerApplications(app, db);
  registerUserSettings(app, db);
  registerProfile(app, db);
  registerDocuments(app, db, filesDir);
  // 연결 비밀정보 키는 DB와 다른 파일(또는 환경 변수)에 둔다.
  const secretKey = loadSecretKey(join(dirname(databasePath), 'secret.key'));
  registerRecommendations(app, db);
  // AI는 서버의 로컬 LLM 하나로 처리한다. 설정 화면에는 모델 이름만 보여 준다.
  const mailSource = options.mailSource ?? naverSource;
  registerMail(app, db, secretKey, mailSource, options.mailBodies ?? naverBodies);
  // 수집·추천 작업은 요청 경로 밖의 작업자가 처리한다. 테스트는 worker:false로 끄고 직접 실행한다.
  if (options.worker) {
    const recommend = createHandler(db, options.deps);
    const mail = createMailHandler(db, secretKey, mailSource, { interpret: interpretMail, bodies: options.mailBodies ?? naverBodies }, options.mailBackfill ?? naverBackfill);
    const stop = startWorker(db, (job: ClaimedJob) => (job.kind === 'mail' ? mail(job) : recommend(job)));
    // 예약 실행은 작업자와 같은 서버 프로세스에서 돈다. 브라우저를 닫아도 계속된다.
    const stopSchedule = startScheduler(db, options.scheduleHour ?? 21);
    app.addHook('onClose', async () => { stop(); stopSchedule(); });
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
