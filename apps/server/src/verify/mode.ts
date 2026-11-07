import { resolve } from 'node:path';
import type { SourceId } from '@nextstep/contracts';
import { openDatabase } from '../database.js';
import { readCollectionMode, sourceAccess } from '../sources/policy.js';

// 검증 명령도 서버와 같은 DB의 수집 모드를 따른다. 자동 수집이 허용되지 않으면 요청하지 않는다.
export function requireAutoCollect(source: SourceId) {
  const db = openDatabase(process.env.NEXTSTEP_DB_PATH ?? resolve('.data/nextstep.sqlite'));
  try {
    if (sourceAccess(db, source) === 'auto') return true;
    console.log(JSON.stringify({ ok: false, code: 'not_allowed_in_mode', mode: readCollectionMode(db), source }));
    process.exitCode = 1;
    return false;
  } finally {
    db.close();
  }
}
