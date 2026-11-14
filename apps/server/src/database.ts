import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export const SCHEMA_VERSION = 12;

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
    if (version < 4) {
      // P1-04: 사용자당 활성 이력서 한 개(원본은 비공개 파일, 추출 본문은 DB)와 사용자가 확인한 프로필·필터.
      db.exec(`CREATE TABLE documents (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          filename TEXT NOT NULL,
          size INTEGER NOT NULL,
          storage_key TEXT NOT NULL,
          text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (user_id, kind)
        ) STRICT;
        CREATE TABLE profiles (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          data TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        PRAGMA user_version = 4;`);
    }
    if (version < 5) {
      // P1-04: 공고 사실(원문 없음)·작업 기록·사용자별 추천. owner_user_id가 있으면 사용자가 넣은 링크로 가져온 개인 공고다.
      db.exec(`CREATE TABLE postings (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_id TEXT NOT NULL,
          owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          title TEXT NOT NULL,
          company TEXT NOT NULL,
          deadline TEXT,
          always_hire INTEGER NOT NULL,
          location TEXT,
          remote INTEGER,
          careers TEXT NOT NULL,
          company_type TEXT,
          employee_count INTEGER,
          external_apply_url TEXT,
          requirements TEXT,
          body_failure TEXT,
          collected_mode TEXT NOT NULL,
          checked_at TEXT NOT NULL
        ) STRICT;
        CREATE UNIQUE INDEX postings_key ON postings(source, source_id, ifnull(owner_user_id, ''));
        CREATE TABLE jobs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          payload TEXT,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          error_code TEXT,
          result TEXT,
          created_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          lease_until TEXT
        ) STRICT;
        CREATE UNIQUE INDEX jobs_active ON jobs(user_id, kind) WHERE status IN ('대기', '실행중');
        CREATE INDEX jobs_queue ON jobs(status, created_at);
        CREATE TABLE recommendations (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          posting_id TEXT NOT NULL REFERENCES postings(id) ON DELETE CASCADE,
          basis TEXT NOT NULL,
          classification TEXT NOT NULL,
          judgement TEXT NOT NULL,
          hidden INTEGER NOT NULL DEFAULT 0,
          evaluated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, posting_id)
        ) STRICT;
        PRAGMA user_version = 5;`);
    }
    if (version < 6) {
      // P1-05: 네이버 연결(비밀번호는 암호화), 편지함별 확보 위치, 채용 메일 최소 근거, 확인 요청, 정정 재적용 억제.
      db.exec(`CREATE TABLE mail_connections (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          account TEXT NOT NULL,
          secret TEXT NOT NULL,
          status TEXT NOT NULL,
          consent_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_success_at TEXT,
          last_error TEXT,
          range_incomplete INTEGER NOT NULL DEFAULT 0
        ) STRICT;
        CREATE TABLE mail_cursors (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          mailbox TEXT NOT NULL,
          uid_validity TEXT NOT NULL,
          last_uid INTEGER NOT NULL,
          PRIMARY KEY (user_id, mailbox)
        ) STRICT;
        CREATE TABLE mail_messages (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          message_key TEXT NOT NULL,
          received_at TEXT,
          subject TEXT NOT NULL,
          platform TEXT,
          classification TEXT NOT NULL,
          evidence TEXT,
          posting_key TEXT,
          application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
          outcome TEXT NOT NULL,
          processed_at TEXT NOT NULL,
          UNIQUE (user_id, provider, message_key)
        ) STRICT;
        CREATE TABLE review_requests (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          message_id TEXT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
          reason TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          resolved_at TEXT,
          UNIQUE (message_id)
        ) STRICT;
        CREATE TABLE evidence_suppressions (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          message_key TEXT NOT NULL,
          application_id TEXT,
          created_at TEXT NOT NULL,
          PRIMARY KEY (user_id, message_key)
        ) STRICT;
        ALTER TABLE applications ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
        ALTER TABLE application_events ADD COLUMN message_id TEXT;
        PRAGMA user_version = 6;`);
    }
    if (version < 7) {
      // P1-05: 보관한 메일을 나중에 해석할 때 본문을 다시 조회할 위치(편지함·UIDVALIDITY·UID). 본문은 저장하지 않는다.
      db.exec(`ALTER TABLE mail_messages ADD COLUMN mailbox TEXT;
        ALTER TABLE mail_messages ADD COLUMN uid_validity TEXT;
        ALTER TABLE mail_messages ADD COLUMN uid INTEGER;
        ALTER TABLE mail_messages ADD COLUMN interpret_attempts INTEGER NOT NULL DEFAULT 0;
        PRAGMA user_version = 7;`);
    }
    if (version < 8) {
      // P1-06: 1차 자동화 권한은 초대 테스트 권한(가입 시 부여). 예약 실행은 사용자·날짜·종류별 한 번만 만든다.
      db.exec(`ALTER TABLE users ADD COLUMN test_permission INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE jobs ADD COLUMN scheduled INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE schedule_runs (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          run_date TEXT NOT NULL,
          kind TEXT NOT NULL,
          job_id TEXT,
          created_at TEXT NOT NULL,
          PRIMARY KEY (user_id, run_date, kind)
        ) STRICT;
        PRAGMA user_version = 8;`);
    }
    if (version < 9) {
      // P1-04: 텍스트가 없는 PDF 쪽 번호(JSON 배열). 이미지 쪽이 섞인 이력서를 사용자에게 경고한다.
      db.exec(`ALTER TABLE documents ADD COLUMN empty_pages TEXT NOT NULL DEFAULT '[]';
        PRAGMA user_version = 9;`);
    }
    if (version < 10) {
      // 공고는 사용자별 갱신으로 그 사용자 자료로만 저장한다(사용자 결정 2026-11-10). 공용 공고와 그 추천은 지우고 다음 갱신에서 다시 모은다.
      // acquired_by: auto(자동 수집)·link(사용자가 넣은 링크).
      db.exec(`DELETE FROM postings WHERE owner_user_id IS NULL;
        ALTER TABLE postings RENAME COLUMN collected_mode TO acquired_by;
        UPDATE postings SET acquired_by = 'link';
        PRAGMA user_version = 10;`);
    }
    if (version < 11) {
      // P1-08: 사용자 본인 OpenAI 키(DB와 다른 키로 암호화)·끝 4자리·선택 모델.
      db.exec(`CREATE TABLE ai_settings (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          key_enc TEXT NOT NULL,
          key_hint TEXT NOT NULL,
          model TEXT NOT NULL,
          verified_at TEXT NOT NULL
        ) STRICT;
        PRAGMA user_version = 11;`);
    }
    if (version < 12) {
      // P1-11: 포트폴리오·경력기술서 kind, OCR로 읽은 쪽 번호, 사용자가 MD를 고쳤는지.
      db.exec(`ALTER TABLE documents ADD COLUMN ocr_pages TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE documents ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;
        PRAGMA user_version = 12;`);
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
