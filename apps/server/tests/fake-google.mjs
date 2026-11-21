// 테스트용 구글 로그인 모의 서버. 실제 구글 대신 인가 화면(이메일 입력)과 토큰 주소를 흉내 낸다.
// 서버 테스트는 signIn()으로 쓰고, e2e는 `node apps/server/tests/fake-google.mjs <포트>`로 띄운다.
import { createServer } from 'node:http';
import { URLSearchParams } from 'node:url';

const b64 = value => Buffer.from(value).toString('base64url');
export const CLIENT_ID = 'test-client';

export function startFakeGoogle(port = 0) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://x');
    if (url.pathname === '/auth') {
      // 인가 화면: 이메일을 고르면 redirect_uri로 코드(이메일을 담은 값)와 state를 돌려보낸다.
      const hidden = ['redirect_uri', 'state'].map(name => `<input type="hidden" name="${name}" value="${url.searchParams.get(name) ?? ''}">`).join('');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return response.end(`<form action="/approve">${hidden}<label>구글 이메일<input name="email" type="email"></label><button>계속</button></form>`);
    }
    if (url.pathname === '/approve') {
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('code', b64(url.searchParams.get('email') ?? ''));
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      response.writeHead(302, { location: back.href });
      return response.end();
    }
    if (url.pathname === '/token' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const form = new URLSearchParams(body);
      const email = Buffer.from(form.get('code') ?? '', 'base64url').toString();
      if (!email.includes('@') || !form.get('code_verifier')) { response.writeHead(400); return response.end(); }
      const claims = { iss: 'https://accounts.google.com', aud: form.get('client_id'), sub: `sub-${email.toLowerCase()}`, email, email_verified: !email.startsWith('unverified'), exp: Math.floor(Date.now() / 1000) + 3600 };
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ id_token: `${b64('{"alg":"none"}')}.${b64(JSON.stringify(claims))}.` }));
    }
    response.writeHead(404);
    response.end();
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

export function useFakeGoogle(server) {
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.NEXTSTEP_GOOGLE_CLIENT_ID = CLIENT_ID;
  process.env.NEXTSTEP_GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.NEXTSTEP_GOOGLE_AUTH_URL = `${base}/auth`;
  process.env.NEXTSTEP_GOOGLE_TOKEN_URL = `${base}/token`;
}

let fake;
// 구글 로그인 흐름(시작 → 콜백)을 거쳐 세션 쿠키('ns_session=…')를 돌려준다. 실패하면 콜백 응답을 던진다.
export async function signIn(app, email, inviteCode) {
  if (!fake) { fake = await startFakeGoogle(); fake.unref(); useFakeGoogle(fake); }
  const start = await app.inject({ method: 'GET', url: `/auth/google/start${inviteCode ? `?invite=${inviteCode}` : ''}` });
  const state = new URL(start.headers.location).searchParams.get('state');
  const cookie = String(start.headers['set-cookie']).split(';')[0];
  const callback = await app.inject({ method: 'GET', url: `/auth/google/callback?code=${b64(email)}&state=${state}`, headers: { cookie } });
  const session = [callback.headers['set-cookie']].flat().map(String).find(value => value.startsWith('ns_session=') && !value.startsWith('ns_session=;'));
  if (!session) throw Object.assign(new Error(`로그인 실패: ${callback.headers.location}`), { response: callback });
  return session.split(';')[0];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await startFakeGoogle(Number(process.argv[2] ?? 4199));
  console.log(`fake google: http://127.0.0.1:${server.address().port}`);
}
