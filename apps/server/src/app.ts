import Fastify from 'fastify';
import { healthSchema } from '@nextstep/contracts';
import { openDatabase } from './database.js';

export function createApp(databasePath: string) {
  const db = openDatabase(databasePath);
  // 개인 자료를 로그에 남기지 않는다. 관측 이벤트는 별도 허용 목록으로 추가한다.
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  app.addHook('onClose', async () => { db.close(); });
  app.get('/health', async () => {
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
    return healthSchema.parse({ service: 'nextstep', status: 'ok', database: 'ready', schemaVersion: version.user_version });
  });
  app.setErrorHandler((_error, _request, reply) => { void reply.status(500).send({ message: '요청을 처리하지 못했습니다.' }); });
  return app;
}
