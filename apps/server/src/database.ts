import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(filename: string) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  try {
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    db.exec('BEGIN IMMEDIATE');
    const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
    if (version > 1) throw new Error('지원하지 않는 DB 버전입니다.');
    if (version < 1) {
      db.exec(`CREATE TABLE service_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        INSERT INTO service_metadata VALUES ('service', 'nextstep');
        PRAGMA user_version = 1;`);
    }
    db.exec('COMMIT');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
