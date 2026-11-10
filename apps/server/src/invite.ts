// 운영자용 초대 링크 발급. 서버와 같은 DB에 코드 해시를 쓰고 링크(코드 원문 포함)는 이 출력에서만 보인다.
// 실행: pnpm --filter @nextstep/server invite. 링크 주소는 NEXTSTEP_WEB_URL(기본 http://127.0.0.1:3100).
import { resolve } from 'node:path';
import { openDatabase } from './database.js';
import { createInvite } from './auth.js';

const db = openDatabase(process.env.NEXTSTEP_DB_PATH ?? resolve('.data/nextstep.sqlite'));
try {
  const link = new URL('/', process.env.NEXTSTEP_WEB_URL ?? 'http://127.0.0.1:3100');
  link.searchParams.set('invite', createInvite(db));
  console.log(link.href);
} finally {
  db.close();
}
