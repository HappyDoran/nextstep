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
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { service: 'nextstep', status: 'ok', database: 'ready', schemaVersion: 1 });
      assert.equal((await app.inject('/users')).statusCode, 404);
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
    const db = openDatabase(path);
    db.exec('PRAGMA user_version = 2');
    db.close();
    assert.throws(() => openDatabase(path), /지원하지 않는 DB 버전/);
    const original = new DatabaseSync(path);
    assert.equal(original.prepare('PRAGMA user_version').get().user_version, 2);
    original.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
