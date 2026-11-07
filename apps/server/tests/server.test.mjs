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
      assert.deepEqual(res.json(), { service: 'nextstep', status: 'ok', database: 'ready', schemaVersion: 3 });
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
test('수집 모드는 기본 서비스, 변경 후 재시작에도 유지되고 잘못된 값을 거부한다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-mode-'));
  try {
    const path = join(dir, 'service.sqlite');
    let app = createApp(path);
    try {
      const initial = await app.inject('/settings/collection');
      assert.deepEqual(initial.json(), { mode: 'service', sources: { jobkorea: 'auto', wanted: 'link_only', jasoseol: 'link_only' } });
      for (const payload of [{ mode: 'admin' }, { mode: 'personal', sources: { wanted: 'auto' } }, {}]) {
        assert.equal((await app.inject({ method: 'PUT', url: '/settings/collection', payload })).statusCode, 400);
      }
      const changed = await app.inject({ method: 'PUT', url: '/settings/collection', payload: { mode: 'personal' } });
      assert.equal(changed.json().sources.wanted, 'auto');
    } finally { await app.close(); }
    app = createApp(path);
    try {
      assert.equal((await app.inject('/settings/collection')).json().mode, 'personal');
    } finally { await app.close(); }
    const db = new DatabaseSync(path);
    db.prepare("UPDATE service_metadata SET value = 'broken' WHERE key = 'collection_mode'").run();
    db.close();
    app = createApp(path);
    try {
      assert.equal((await app.inject('/settings/collection')).json().mode, 'service');
    } finally { await app.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
