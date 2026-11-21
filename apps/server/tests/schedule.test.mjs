import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../dist/app.js';
import { openDatabase } from '../dist/database.js';
import { createInvite } from '../dist/auth.js';
import { signIn } from './fake-google.mjs';
import { runSchedule, seoulParts } from '../dist/schedule.js';

const at = iso => new Date(iso);

test('예약 실행: 공고 갱신은 21시 이후 하루 한 번, 메일은 매시간 한 번. 자동 ON·권한·연결 조건과 OFF 정리', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-sched-'));
  const path = join(dir, 'db.sqlite');
  const app = createApp(path, { mailSource: async () => [] });
  try {
    const signup = async email => {
      const db = openDatabase(path); const inviteCode = createInvite(db); db.close();
      return (await signIn(app, email, inviteCode));
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
      // 20시대: 메일만(매시간). 21시: 공고 갱신 + 21시대 메일.
      assert.equal(runSchedule(db, at('2026-11-07T11:59:00Z'), 21), 1);
      assert.equal(runSchedule(db, at('2026-11-07T12:00:00Z'), 21), 2);
      // 같은 시간대에 다시 검사하거나 서버가 재시작돼도 중복 생성하지 않는다.
      assert.equal(runSchedule(db, at('2026-11-07T12:30:00Z'), 21), 0);
      // 23시대: 메일만 새로 만든다(공고 갱신은 그날 이미 했음).
      assert.equal(runSchedule(db, at('2026-11-07T14:30:00Z'), 21), 1);
      const jobs = db.prepare('SELECT kind, scheduled FROM jobs ORDER BY kind').all().map(r => [r.kind, r.scheduled]);
      assert.deepEqual(jobs, [['mail', 1], ['refresh', 1]]);
      // 대기 중인 같은 종류 작업이 있으면 새로 만들지 않고 그 작업을 쓴다. 다음 날(한국 시간)에는 공고 갱신도 다시 만든다.
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
    assert.equal(settings.lastScheduled.find(r => r.kind === 'refresh').runDate, '2026-11-08');
    assert.equal(settings.lastScheduled.find(r => r.kind === 'mail').runDate, '2026-11-08T21');
    assert.equal((await app.inject({ url: '/settings/automation', headers: { cookie: b } })).json().lastScheduled.length, 0);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
