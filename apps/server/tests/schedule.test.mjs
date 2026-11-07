import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../dist/app.js';
import { openDatabase } from '../dist/database.js';
import { createInvite } from '../dist/auth.js';
import { runSchedule, seoulParts } from '../dist/schedule.js';

const at = iso => new Date(iso);

test('예약 실행: 21시 이후 자동 ON·권한·연결 조건을 만족하는 사용자만 하루 한 번, OFF는 대기 작업을 정리한다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-sched-'));
  const path = join(dir, 'db.sqlite');
  const app = createApp(path, { mailSource: async () => [] });
  try {
    const signup = async email => {
      const db = openDatabase(path); const inviteCode = createInvite(db); db.close();
      return (await app.inject({ method: 'POST', url: '/auth/signup', payload: { inviteCode, email, password: 'correct horse battery' } })).headers['set-cookie'].split(';')[0];
    };
    const a = await signup('a@example.com');
    const b = await signup('b@example.com');
    const c = await signup('c@example.com');
    // a: 자동 ON + 이력서·프로필 + 메일 연결. b: 자동 OFF. c: 자동 ON이지만 연결·이력서 없음.
    await app.inject({ method: 'PUT', url: '/documents/resume', headers: { cookie: a, 'content-type': 'application/pdf', 'x-filename': 'r.pdf' }, payload: readFileSync(new URL('./fixtures/resume-text.pdf', import.meta.url)) });
    await app.inject({ method: 'PUT', url: '/profile', headers: { cookie: a }, payload: { jobFamilies: ['프론트엔드'], experiences: [], regions: ['서울'], remoteOk: true, employmentTypes: ['정규직'], skills: [], summary: '' } });
    await app.inject({ method: 'PUT', url: '/mail/connection', headers: { cookie: a }, payload: { account: 't@naver.com', appPassword: 'x', consent: true } });
    for (const cookie of [a, c]) await app.inject({ method: 'PUT', url: '/settings/automation', headers: { cookie }, payload: { enabled: true } });
    const db = openDatabase(path);
    try {
      db.exec("DELETE FROM jobs"); // 연결 시 만든 수동 작업을 지워 예약 작업만 본다.
      assert.equal(seoulParts(at('2026-11-07T11:59:00Z')).hour, 20);
      assert.equal(runSchedule(db, at('2026-11-07T11:59:00Z'), 21), 0);
      assert.equal(runSchedule(db, at('2026-11-07T12:00:00Z'), 21), 2);
      // 같은 날 다시 검사하거나 서버가 재시작돼도 중복 생성하지 않는다.
      assert.equal(runSchedule(db, at('2026-11-07T14:30:00Z'), 21), 0);
      const jobs = db.prepare('SELECT kind, scheduled FROM jobs ORDER BY kind').all().map(r => [r.kind, r.scheduled]);
      assert.deepEqual(jobs, [['mail', 1], ['refresh', 1]]);
      // 다음 날(한국 시간)에는 새로 만든다. 단, 아직 대기 중인 같은 종류 작업이 있으면 그 작업을 쓴다.
      db.exec("UPDATE jobs SET status = '성공'");
      assert.equal(runSchedule(db, at('2026-11-08T12:00:00Z'), 21), 2);
    } finally { db.close(); }
    // 자동 OFF는 대기 중 예약 작업을 정리하고 이후 예약을 만들지 않는다.
    await app.inject({ method: 'PUT', url: '/settings/automation', headers: { cookie: a }, payload: { enabled: false } });
    const db2 = openDatabase(path);
    try {
      assert.equal(db2.prepare("SELECT count(*) n FROM jobs WHERE status = '대기'").get().n, 0);
      assert.equal(runSchedule(db2, at('2026-11-09T12:00:00Z'), 21), 0);
    } finally { db2.close(); }
    const settings = (await app.inject({ url: '/settings/automation', headers: { cookie: a } })).json();
    assert.equal(settings.enabled, false);
    assert.equal(settings.lastScheduled[0].runDate, '2026-11-08');
    assert.equal((await app.inject({ url: '/settings/automation', headers: { cookie: b } })).json().lastScheduled.length, 0);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
