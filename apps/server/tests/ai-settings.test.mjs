import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../dist/app.js';
import { openDatabase } from '../dist/database.js';
import { createInvite } from '../dist/auth.js';

// 로컬 모의 OpenAI로 키 확인·저장·격리만 검증한다(실제 OpenAI 연동 검증이 아님).
test('사용자 OpenAI 키는 확인 후 암호화 저장하고, 본인 요청에만 쓰며 운영자 키로 대신하지 않는다', async () => {
  const seen = [];
  const openai = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; }).on('end', () => {
      seen.push({ path: req.url, auth: req.headers.authorization, model: body ? JSON.parse(body).model : undefined });
      const ok = req.headers.authorization === 'Bearer sk-user-a-0000000000001234';
      res.writeHead(!ok ? 401 : req.url === '/models/gpt-5.4-mini' ? 404 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.url === '/responses'
        ? { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ jobFamilies: ['프론트엔드'], experiences: [], skills: [], summary: '' }) }] }] }
        : { error: { code: ok ? 'model_not_found' : 'invalid_api_key' } }));
    });
  });
  await new Promise(resolve => openai.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env };
  // 운영자 키가 환경 변수에 있어도 사용자 요청에는 쓰이지 않아야 한다.
  Object.assign(process.env, { NEXTSTEP_OPENAI_BASE_URL: `http://127.0.0.1:${openai.address().port}`, OPENAI_API_KEY: 'sk-operator', NEXTSTEP_OPENAI_MODEL: 'gpt-5.5' });
  const dir = mkdtempSync(join(tmpdir(), 'nextstep-ai-'));
  const path = join(dir, 'db.sqlite');
  const app = createApp(path);
  const signup = async email => {
    const db = openDatabase(path); const inviteCode = createInvite(db); db.close();
    const cookie = (await app.inject({ method: 'POST', url: '/auth/signup', payload: { inviteCode, email, password: 'correct horse battery' } })).headers['set-cookie'].split(';')[0];
    await app.inject({ method: 'PUT', url: '/documents/resume', headers: { cookie, 'content-type': 'application/pdf', 'x-filename': 'r.pdf' }, payload: readFileSync(new URL('./fixtures/resume-text.pdf', import.meta.url)) });
    return cookie;
  };
  try {
    const a = await signup('a@example.com');
    const b = await signup('b@example.com');
    const put = (cookie, payload) => app.inject({ method: 'PUT', url: '/settings/ai', headers: { cookie }, payload });
    assert.deepEqual((await app.inject({ url: '/settings/ai', headers: { cookie: a } })).json(), { configured: false, keyHint: null, model: 'gpt-5.5', verifiedAt: null });

    // 키 없는 사용자는 운영자 키가 있어도 AI를 쓸 수 없다.
    const noKey = await app.inject({ method: 'POST', url: '/profile/suggest', headers: { cookie: a } });
    assert.equal(noKey.statusCode, 503);
    assert.equal(noKey.json().code, 'ai_unconfigured');
    assert.equal(seen.length, 0);

    // 거부된 키·쓸 수 없는 모델·잘못된 형식은 저장하지 않는다.
    assert.equal((await put(a, { apiKey: 'sk-wrong-000000000000000', model: 'gpt-5.5' })).json().code, 'ai_key_invalid');
    assert.equal((await put(a, { apiKey: 'sk-user-a-0000000000001234', model: 'gpt-5.4-mini' })).json().code, 'ai_model_unavailable');
    assert.equal((await put(a, { apiKey: 'short', model: 'gpt-5.5' })).statusCode, 400);
    assert.equal((await put(a, { apiKey: 'sk-user-a-0000000000001234', model: 'gpt-4' })).statusCode, 400);
    assert.equal((await app.inject({ url: '/settings/ai', headers: { cookie: a } })).json().configured, false);

    const saved = await put(a, { apiKey: 'sk-user-a-0000000000001234', model: 'gpt-5.5' });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().keyHint, '1234');
    assert.equal(JSON.stringify(saved.json()).includes('sk-user'), false);
    const raw = new DatabaseSync(path);
    assert.equal(JSON.stringify(raw.prepare('SELECT * FROM ai_settings').all()).includes('sk-user-a'), false);
    raw.close();

    seen.length = 0;
    assert.equal((await app.inject({ method: 'POST', url: '/profile/suggest', headers: { cookie: a } })).statusCode, 200);
    assert.deepEqual(seen, [{ path: '/responses', auth: 'Bearer sk-user-a-0000000000001234', model: 'gpt-5.5' }]);
    // B는 A의 키를 보거나 쓰지 못한다.
    assert.equal((await app.inject({ url: '/settings/ai', headers: { cookie: b } })).json().configured, false);
    assert.equal((await app.inject({ method: 'POST', url: '/profile/suggest', headers: { cookie: b } })).statusCode, 503);

    // 키 삭제 후에는 다시 미설정이다. 계정 삭제는 키 행도 지운다.
    assert.equal((await app.inject({ method: 'DELETE', url: '/settings/ai', headers: { cookie: a } })).statusCode, 204);
    assert.equal((await app.inject({ method: 'POST', url: '/profile/suggest', headers: { cookie: a } })).statusCode, 503);
    await put(a, { apiKey: 'sk-user-a-0000000000001234', model: 'gpt-5.5' });
    await app.inject({ method: 'DELETE', url: '/account', headers: { cookie: a } });
    const after = new DatabaseSync(path);
    assert.equal(after.prepare('SELECT count(*) n FROM ai_settings').get().n, 0);
    after.close();
  } finally {
    process.env = env;
    await app.close();
    openai.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
