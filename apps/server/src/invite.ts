// 운영자용 초대 코드 발급(누구나 한 번 쓰는 코드, 14일). 보통은 미등록 계정이 구글 로그인할 때 그 계정 전용 코드가 Discord로 온다.
// 서버와 같은 DB에 코드 해시만 쓰고 코드 원문은 이 출력에서만 보인다. 실행: pnpm --filter @nextstep/server invite
import { resolve } from 'node:path';
import { openDatabase } from './database.js';
import { createInvite } from './auth.js';

const db = openDatabase(process.env.NEXTSTEP_DB_PATH ?? resolve('.data/nextstep.sqlite'));
try {
  console.log(createInvite(db));
} finally {
  db.close();
}
