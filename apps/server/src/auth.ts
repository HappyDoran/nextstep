import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { desktopExchangeSchema, inviteCodeSchema, meSchema, pendingSchema } from '@nextstep/contracts';

export const SESSION_COOKIE = 'ns_session';
const SESSION_DAYS = 14;
const INVITE_DAYS = 14;
// 구글 로그인(OpenID Connect 인가 코드 + PKCE). 진행 상태는 10분짜리 HttpOnly 쿠키에 둔다.
const STATE_COOKIE = 'ns_oauth';
// 초대 코드 입력을 기다리는 구글 계정(14일). 세션과 따로 둔다.
const PENDING_COOKIE = 'ns_pending';
const STATE_MAX_AGE = 600;
const LOGIN_CODE_MS = 120_000;
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

const now = () => new Date().toISOString();
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

// 초대 코드는 운영자가 서버에서 발급한다. 원문은 한 번만 보여 주고 해시만 저장한다.
// googleSub가 있으면 그 구글 계정만 쓸 수 있는 코드다(가입 요청). 없으면 누구나 한 번 쓰는 코드(운영자 명령).
export function createInvite(db: DatabaseSync, googleSub?: string) {
  const code = randomBytes(12).toString('base64url');
  db.prepare('INSERT INTO invites (code_hash, created_at, expires_at, google_sub) VALUES (?, ?, ?, ?)').run(sha256(code), now(), days(INVITE_DAYS), googleSub ?? null);
  return code;
}

export function parseCookies(header: string | undefined) {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    // 잘못 인코딩된 쿠키 값은 무시한다(서버 오류로 만들지 않는다).
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* skip */ }
  }
  return out;
}

function cookie(name: string, value: string, maxAge: number, secure: boolean) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
const sessionCookie = (token: string, maxAge: number, secure: boolean) => cookie(SESSION_COOKIE, token, maxAge, secure);

type Google = { clientId: string; clientSecret: string; redirectUri: string; authUrl: string; tokenUrl: string };
// 요청마다 환경 변수를 읽는다(테스트·e2e는 주소를 로컬 모의 서버로 바꾼다). 클라이언트 값이 없으면 로그인을 막는다.
function googleConfig(): Google | undefined {
  const clientId = process.env.NEXTSTEP_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.NEXTSTEP_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return undefined;
  return {
    clientId, clientSecret,
    redirectUri: new URL('/api/auth/google/callback', process.env.NEXTSTEP_WEB_URL ?? 'http://127.0.0.1:3100').href,
    authUrl: process.env.NEXTSTEP_GOOGLE_AUTH_URL ?? 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: process.env.NEXTSTEP_GOOGLE_TOKEN_URL ?? 'https://oauth2.googleapis.com/token',
  };
}

// 인가 코드를 구글 토큰 주소에서 직접(TLS) 바꾼 응답의 ID 토큰은 서명 검증 없이 내용을 믿어도 된다(OpenID Connect Core 3.1.3.7).
// 대상(aud)·발급자·만료·이메일 확인 여부는 확인한다.
async function googleIdentity(google: Google, code: string, verifier: string): Promise<{ sub: string; email: string } | undefined> {
  try {
    const response = await fetch(google.tokenUrl, {
      method: 'POST',
      body: new URLSearchParams({ code, code_verifier: verifier, client_id: google.clientId, client_secret: google.clientSecret, redirect_uri: google.redirectUri, grant_type: 'authorization_code' }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    const { id_token: idToken } = await response.json() as { id_token?: string };
    const claims = JSON.parse(Buffer.from(idToken?.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
    const ok = claims.aud === google.clientId && GOOGLE_ISSUERS.has(String(claims.iss)) && Number(claims.exp) * 1000 > Date.now()
      && (claims.email_verified === true || claims.email_verified === 'true') && typeof claims.sub === 'string' && typeof claims.email === 'string';
    return ok ? { sub: claims.sub as string, email: claims.email as string } : undefined;
  } catch {
    return undefined;
  }
}

// 구글 sub로 계정을 찾고, 없으면 같은 이메일의 아직 연결 안 된 계정(비밀번호 시절 계정)을 연결한다. 없으면 미등록이다.
function findUser(db: DatabaseSync, identity: Identity) {
  const bySub = db.prepare('SELECT id FROM users WHERE google_sub = ?').get(identity.sub) as { id: string } | undefined;
  if (bySub) return bySub.id;
  const byEmail = db.prepare('UPDATE users SET google_sub = ? WHERE email = ? AND google_sub IS NULL RETURNING id').get(identity.sub, identity.email) as { id: string } | undefined;
  return byEmail?.id;
}
type Identity = { sub: string; email: string };

const hasRequest = (db: DatabaseSync, sub: string) => Boolean(db.prepare('SELECT 1 FROM invites WHERE google_sub = ? AND used_at IS NULL AND expires_at > ?').get(sub, now()));

// 미등록 계정의 가입 요청: 그 계정 전용 초대 코드를 만들어 운영자 Discord로 보낸다. 유효한 요청이 이미 있으면 다시 보내지 않는다.
// 알림을 보내지 못하면 코드를 지워 다음 로그인에서 다시 요청한다(코드 원문은 알림에만 있다).
async function requestInvite(db: DatabaseSync, identity: Identity) {
  if (hasRequest(db, identity.sub)) return;
  const code = createInvite(db, identity.sub);
  if (!await notifyOperator(identity.email, code)) db.prepare('DELETE FROM invites WHERE code_hash = ?').run(sha256(code));
}

async function notifyOperator(email: string, code: string) {
  const webhook = process.env.NEXTSTEP_DISCORD_WEBHOOK_URL;
  if (!webhook) return false;
  const content = `**NextStep 초대 코드 요청**\n구글 계정: ${email.replace(/[`*_~|>]/g, '')}\n초대 코드: \`${code}\`\n이 구글 계정만 쓸 수 있고 ${INVITE_DAYS}일 동안 유효합니다. 메일이나 메신저로 전달하세요.`;
  try {
    const response = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'NextStep', content, allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(10_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function startPending(db: DatabaseSync, identity: Identity) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO pending_logins (token_hash, google_sub, email, expires_at) VALUES (?, ?, ?, ?)').run(sha256(token), identity.sub, identity.email, days(INVITE_DAYS));
  return token;
}

function pendingIdentity(db: DatabaseSync, request: FastifyRequest): Identity | undefined {
  const token = parseCookies(request.headers.cookie)[PENDING_COOKIE];
  if (!token) return undefined;
  const row = db.prepare('SELECT google_sub AS sub, email FROM pending_logins WHERE token_hash = ? AND expires_at > ?').get(sha256(token), now()) as Identity | undefined;
  return row ? { sub: row.sub, email: row.email } : undefined;
}

function startSession(db: DatabaseSync, userId: string) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha256(token), userId, now(), days(SESSION_DAYS));
  return token;
}

// 요청의 사용자 ID는 세션 쿠키에서만 얻는다. 본문·경로의 사용자 ID는 신뢰하지 않는다.
export function sessionUser(db: DatabaseSync, request: FastifyRequest): { id: string; email: string } | undefined {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!token) return undefined;
  const row = db.prepare(`SELECT u.id, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha256(token)) as { id: string; email: string; expires_at: string } | undefined;
  if (!row) return undefined;
  if (row.expires_at <= now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    return undefined;
  }
  return { id: row.id, email: row.email };
}

export function requireUser(db: DatabaseSync, request: FastifyRequest, reply: FastifyReply) {
  const user = sessionUser(db, request);
  if (!user) void reply.status(401).send({ message: '로그인이 필요합니다.' });
  return user;
}

export function registerAuth(app: FastifyInstance, db: DatabaseSync, options: { secureCookie: boolean; onAccountDeleted?: (userId: string) => void }) {
  const invalid = (reply: FastifyReply) => reply.status(400).send({ message: '요청을 확인하세요.' });

  const pendingCookie = (token: string, maxAge: number) => cookie(PENDING_COOKIE, token, maxAge, options.secureCookie);
  const clearPending = pendingCookie('', 0);
  const pendingMaxAge = INVITE_DAYS * 86_400;

  // 웹: /api/auth/google/start. 데스크톱 앱은 같은 주소를 기본 브라우저로 열며 client=desktop을 붙인다.
  app.get('/auth/google/start', async (request, reply) => {
    const google = googleConfig();
    if (!google) return reply.redirect('/?login_error=unavailable');
    const query = request.query as Record<string, string | undefined>;
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const url = new URL(google.authUrl);
    url.search = new URLSearchParams({
      client_id: google.clientId, redirect_uri: google.redirectUri, response_type: 'code', scope: 'openid email',
      state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'select_account',
    }).toString();
    reply.header('set-cookie', cookie(STATE_COOKIE, [state, verifier, query.client === 'desktop' ? 'd' : 'w'].join('.'), STATE_MAX_AGE, options.secureCookie));
    return reply.redirect(url.href);
  });

  // 등록 계정은 바로 세션, 미등록 계정은 가입 요청(초대 코드 알림)과 코드 입력 대기 상태로 첫 화면에 돌려보낸다.
  app.get('/auth/google/callback', async (request, reply) => {
    const fail = (reason: 'failed' | 'unavailable') => reply.redirect(`/?login_error=${reason}`);
    const clearState = cookie(STATE_COOKIE, '', 0, options.secureCookie);
    reply.header('set-cookie', clearState);
    const google = googleConfig();
    if (!google) return fail('unavailable');
    const query = request.query as Record<string, string | undefined>;
    const [state, verifier, client] = (parseCookies(request.headers.cookie)[STATE_COOKIE] ?? '').split('.');
    if (!state || !verifier || !query.code || query.state !== state) return fail('failed');
    const identity = await googleIdentity(google, query.code, verifier);
    if (!identity) return fail('failed');
    const userId = findUser(db, identity);
    if (!userId) await requestInvite(db, identity);
    if (client === 'd') {
      // 데스크톱 앱: 세션·대기 토큰 대신 2분짜리 1회용 코드를 앱 주소로 넘기고 앱이 자기 창에서 바꾼다.
      const code = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO login_codes (code_hash, user_id, google_sub, email, expires_at) VALUES (?, ?, ?, ?, ?)')
        .run(sha256(code), userId ?? null, userId ? null : identity.sub, userId ? null : identity.email, new Date(Date.now() + LOGIN_CODE_MS).toISOString());
      return reply.redirect(`nextstep://auth?code=${code}`);
    }
    reply.header('set-cookie', userId
      ? [clearState, clearPending, sessionCookie(startSession(db, userId), SESSION_DAYS * 86_400, options.secureCookie)]
      : [clearState, pendingCookie(startPending(db, identity), pendingMaxAge)]);
    return reply.redirect('/');
  });

  // 응답: 등록 계정이면 200(계정), 코드 입력 대기면 202(대기 계정).
  app.post('/auth/desktop/exchange', async (request, reply) => {
    const body = desktopExchangeSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    const row = db.prepare('DELETE FROM login_codes WHERE code_hash = ? RETURNING user_id, google_sub, email, expires_at').get(sha256(body.data.code)) as { user_id: string | null; google_sub: string | null; email: string | null; expires_at: string } | undefined;
    if (!row || row.expires_at <= now()) return reply.status(401).send({ message: '로그인을 다시 시도하세요.' });
    if (!row.user_id) {
      const identity = { sub: row.google_sub!, email: row.email! };
      reply.header('set-cookie', pendingCookie(startPending(db, identity), pendingMaxAge));
      return reply.status(202).send(pendingSchema.parse({ email: identity.email, requested: hasRequest(db, identity.sub) }));
    }
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(row.user_id) as { id: string; email: string };
    reply.header('set-cookie', [clearPending, sessionCookie(startSession(db, user.id), SESSION_DAYS * 86_400, options.secureCookie)]);
    return meSchema.parse(user);
  });

  app.get('/auth/pending', async (request, reply) => {
    const identity = pendingIdentity(db, request);
    if (!identity) return reply.status(401).send({ message: '구글 로그인이 필요합니다.' });
    return pendingSchema.parse({ email: identity.email, requested: hasRequest(db, identity.sub) });
  });

  // 초대 코드 입력: 코드 사용과 계정 생성은 한 트랜잭션이라 같은 코드로 두 계정을 만들 수 없다.
  // 요청으로 만든 코드는 요청한 구글 계정만, 운영자 명령으로 만든 코드는 누구나 쓴다.
  app.post('/auth/invite', async (request, reply) => {
    const identity = pendingIdentity(db, request);
    if (!identity) return reply.status(401).send({ message: '구글 로그인부터 다시 하세요.' });
    const body = inviteCodeSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    db.exec('BEGIN IMMEDIATE');
    try {
      const used = db.prepare('UPDATE invites SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ? AND (google_sub IS NULL OR google_sub = ?)').run(now(), sha256(body.data.code), now(), identity.sub);
      if (used.changes !== 1) { db.exec('ROLLBACK'); return reply.status(403).send({ message: '초대 코드를 확인하세요.' }); }
      if (db.prepare('SELECT 1 FROM users WHERE email = ? OR google_sub = ?').get(identity.email, identity.sub)) { db.exec('ROLLBACK'); return reply.status(409).send({ message: '이미 가입한 구글 계정입니다. 다시 로그인하세요.' }); }
      const userId = randomUUID();
      db.prepare("INSERT INTO users (id, email, password_hash, google_sub, created_at) VALUES (?, ?, '', ?, ?)").run(userId, identity.email, identity.sub, now());
      db.prepare('DELETE FROM pending_logins WHERE google_sub = ?').run(identity.sub);
      const token = startSession(db, userId);
      db.exec('COMMIT');
      reply.header('set-cookie', [clearPending, sessionCookie(token, SESSION_DAYS * 86_400, options.secureCookie)]);
      return reply.status(201).send(meSchema.parse({ id: userId, email: identity.email }));
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  });

  // 로그아웃은 세션과 코드 입력 대기를 함께 끝낸다(다시 구글 로그인부터).
  app.post('/auth/logout', async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    if (cookies[SESSION_COOKIE]) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(cookies[SESSION_COOKIE]));
    if (cookies[PENDING_COOKIE]) db.prepare('DELETE FROM pending_logins WHERE token_hash = ?').run(sha256(cookies[PENDING_COOKIE]));
    reply.header('set-cookie', [sessionCookie('', 0, options.secureCookie), clearPending]);
    return reply.status(204).send();
  });

  app.get('/auth/me', async (request, reply) => {
    const user = requireUser(db, request, reply);
    return user ? meSchema.parse(user) : reply;
  });

  // 계정 삭제: 사용자 행을 지우면 세션·지원 건이 외래키로 함께 삭제된다. 이후 같은 쿠키는 즉시 무효다.
  app.delete('/account', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    options.onAccountDeleted?.(user.id);
    reply.header('set-cookie', sessionCookie('', 0, options.secureCookie));
    return reply.status(204).send();
  });
}

