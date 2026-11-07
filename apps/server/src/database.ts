import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export const SCHEMA_VERSION = 3;

export function openDatabase(filename: string) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  try {
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    db.exec('BEGIN IMMEDIATE');
    const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
    if (version > SCHEMA_VERSION) throw new Error('지원하지 않는 DB 버전입니다.');
    if (version < 1) {
      db.exec(`CREATE TABLE service_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        INSERT INTO service_metadata VALUES ('service', 'nextstep');
        PRAGMA user_version = 1;`);
    }
    if (version < 2) {
      // P1-02: 초대 계정·세션과 사용자 소유 자료(지원 건). 사용자 삭제 시 소유 자료는 외래키로 함께 지운다.
      db.exec(`CREATE TABLE users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE invites (
          code_hash TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          used_at TEXT
        ) STRICT;
        CREATE TABLE sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX sessions_user ON sessions(user_id);
        CREATE TABLE applications (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          company TEXT NOT NULL,
          role_title TEXT NOT NULL,
          posting_url TEXT,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX applications_user ON applications(user_id, created_at);
        PRAGMA user_version = 2;`);
    }
    if (version < 3) {
      // P1-03: 열람은 개인 상태와 별도 속성이다. 상태·열람 변경은 최소 이력으로 남긴다. 자동 ON/OFF는 사용자 설정이다.
      db.exec(`ALTER TABLE applications ADD COLUMN read_status TEXT NOT NULL DEFAULT '정보 없음';
        ALTER TABLE users ADD COLUMN auto_enabled INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE application_events (
          id TEXT PRIMARY KEY,
          application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
          field TEXT NOT NULL,
          from_value TEXT,
          to_value TEXT NOT NULL,
          source TEXT NOT NULL,
          at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX application_events_app ON application_events(application_id, at);
        PRAGMA user_version = 3;`);
    }
    db.exec('COMMIT');
    // 버전 확인 뒤에 설정해 거부한 미래 DB의 저널 모드를 바꾸지 않는다.
    db.exec('PRAGMA journal_mode = WAL');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
