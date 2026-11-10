import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../dist/app.js';
import { openDatabase } from '../dist/database.js';
test('HTTP 준비 응답과 파일 DB 재시작·마이그레이션 재실행', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-test-'));
  try {
    const path = join(dir, 'service.sqlite');
    let db = openDatabase(path);
    db.prepare('INSERT INTO service_metadata VALUES (?, ?)').run('검증', '재시작 유지');
    db.close();
    const app = createApp(path);
    app.post('/echo', async () => ({}));
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { service: 'nextstep', status: 'ok', database: 'ready', schemaVersion: 10 });
      assert.equal((await app.inject('/users')).statusCode, 404);
      const malformed = await app.inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'application/json' }, payload: '{' });
      assert.equal(malformed.statusCode, 400);
      assert.deepEqual(malformed.json(), { message: '요청을 확인하세요.' });
    } finally { await app.close(); }
    db = openDatabase(path);
    assert.equal(db.prepare('SELECT value FROM service_metadata WHERE key = ?').get('검증').value, '재시작 유지');
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('알 수 없는 미래 DB를 변경하지 않는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-future-'));
  try {
    const path = join(dir, 'future.sqlite');
    const db = new DatabaseSync(path);
    db.exec('PRAGMA user_version = 99');
    db.close();
    assert.throws(() => openDatabase(path), /지원하지 않는 DB 버전/);
    const original = new DatabaseSync(path);
    assert.equal(original.prepare('PRAGMA user_version').get().user_version, 99);
    assert.equal(original.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
    original.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('DB 버전 10은 공용 공고를 지우고 링크 공고를 사용자 자료로 남긴다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-v10-'));
  try {
    const path = join(dir, 'db.sqlite');
    openDatabase(path).close();
    // 버전 9 상태(공용 공고 owner NULL·collected_mode)를 재현한다.
    const raw = new DatabaseSync(path);
    raw.exec("ALTER TABLE postings RENAME COLUMN acquired_by TO collected_mode; PRAGMA user_version = 9;");
    raw.exec("INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'a@example.com', 'x', '2026-01-01')");
    const insert = raw.prepare("INSERT INTO postings (id, source, source_id, owner_user_id, url, title, company, always_hire, careers, collected_mode, checked_at) VALUES (?, 'wanted', ?, ?, 'https://x', 't', 'c', 0, '[]', 'personal', '2026-01-01')");
    insert.run('shared', '1', null);
    insert.run('mine', '2', 'u1');
    raw.close();
    const db = openDatabase(path);
    try {
      assert.deepEqual(db.prepare('SELECT id, acquired_by FROM postings').all().map(r => ({ ...r })), [{ id: 'mine', acquired_by: 'link' }]);
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
