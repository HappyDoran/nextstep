import type { DatabaseSync } from 'node:sqlite';
import { collectionModeSchema, SOURCE_POLICY, type CollectionMode, type SourceAccess, type SourceId } from '@nextstep/contracts';

export function readCollectionMode(db: DatabaseSync): CollectionMode {
  const row = db.prepare("SELECT value FROM service_metadata WHERE key = 'collection_mode'").get() as { value: string } | undefined;
  // 값이 없거나 손상되면 약관 위험이 낮은 서비스 모드로 둔다.
  return collectionModeSchema.safeParse(row?.value).data ?? 'service';
}

export function writeCollectionMode(db: DatabaseSync, mode: CollectionMode) {
  db.prepare("INSERT INTO service_metadata VALUES ('collection_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(mode);
}

// 수집기는 자동 수집 전에 반드시 이 값을 확인한다. link_only 출처는 사용자가 넣은 링크 한 건만 조회한다.
export function sourceAccess(db: DatabaseSync, source: SourceId): SourceAccess {
  return SOURCE_POLICY[readCollectionMode(db)][source];
}
