import Fastify, { type FastifyError } from 'fastify';
import { healthSchema, collectionModeSchema, collectionModeUpdateSchema, collectionSettingsSchema, SOURCE_POLICY, type CollectionMode } from '@nextstep/contracts';
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
  // 수집 모드는 서버 전체 설정이다. ponytail: 인증이 없어 누구나 바꿀 수 있다. P1-02에서 관리자 전용으로 제한한다.
  const readMode = (): CollectionMode => {
    const row = db.prepare("SELECT value FROM service_metadata WHERE key = 'collection_mode'").get() as { value: string } | undefined;
    // 값이 없거나 손상되면 약관 위험이 낮은 서비스 모드로 둔다.
    return collectionModeSchema.safeParse(row?.value).data ?? 'service';
  };
  const settings = (mode: CollectionMode) => collectionSettingsSchema.parse({ mode, sources: SOURCE_POLICY[mode] });
  app.get('/settings/collection', async () => settings(readMode()));
  app.put('/settings/collection', async (request, reply) => {
    const body = collectionModeUpdateSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ message: '요청을 확인하세요.' });
    db.prepare("INSERT INTO service_metadata VALUES ('collection_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(body.data.mode);
    return settings(body.data.mode);
  });
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    // 4xx는 Fastify가 판정한 클라이언트 오류이므로 상태를 유지한다. 내부 메시지는 노출하지 않는다.
    const status = error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    void reply.status(status).send({ message: status === 500 ? '요청을 처리하지 못했습니다.' : '요청을 확인하세요.' });
  });
  return app;
}
