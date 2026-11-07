import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { credentialsSchema, signupSchema, meSchema } from '@nextstep/contracts';

export const SESSION_COOKIE = 'ns_session';
const SESSION_DAYS = 14;
const INVITE_DAYS = 14;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
// ponytail: 프로세스 메모리의 로그인 실패 제한. 서버가 여러 대가 되면 DB로 옮긴다.
const FAILURE_LIMIT = 5;
const FAILURE_WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; until: number }>();

const now = () => new Date().toISOString();
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => scrypt(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key))));
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}

// 초대 코드는 운영자가 서버에서 발급한다. 원문은 한 번만 보여 주고 해시만 저장한다.
export function createInvite(db: DatabaseSync) {
  const code = randomBytes(12).toString('base64url');
  db.prepare('INSERT INTO invites (code_hash, created_at, expires_at) VALUES (?, ?, ?)').run(sha256(code), now(), days(INVITE_DAYS));
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

function sessionCookie(token: string, maxAge: number, secure: boolean) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
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
  const setSession = (reply: FastifyReply, token: string) => reply.header('set-cookie', sessionCookie(token, SESSION_DAYS * 86_400, options.secureCookie));

  app.post('/auth/signup', async (request, reply) => {
    const body = signupSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    const passwordHash = await hashPassword(body.data.password);
    const userId = randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      // 초대 코드 사용과 계정 생성을 한 트랜잭션에서 확인해 같은 코드의 중복 가입을 막는다.
      const used = db.prepare('UPDATE invites SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?').run(now(), sha256(body.data.inviteCode), now());
      if (used.changes !== 1) {
        db.exec('ROLLBACK');
        return reply.status(403).send({ message: '초대 코드를 확인하세요.' });
      }
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(body.data.email)) {
        db.exec('ROLLBACK');
        return reply.status(409).send({ message: '이미 가입한 이메일입니다.' });
      }
      db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(userId, body.data.email, passwordHash, now());
      const token = startSession(db, userId);
      db.exec('COMMIT');
      setSession(reply, token);
      return reply.status(201).send(meSchema.parse({ id: userId, email: body.data.email }));
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  });

  app.post('/auth/login', async (request, reply) => {
    const body = credentialsSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    const key = body.data.email.toLowerCase();
    const failure = failures.get(key);
    if (failure && failure.count >= FAILURE_LIMIT && failure.until > Date.now()) return reply.status(429).send({ message: '잠시 후 다시 시도하세요.' });
    const row = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(body.data.email) as { id: string; email: string; password_hash: string } | undefined;
    // 계정이 없어도 같은 비용으로 비교해 가입 여부를 응답 시간으로 드러내지 않는다.
    const ok = await verifyPassword(body.data.password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) {
      const current = failure && failure.until > Date.now() ? failure.count : 0;
      failures.set(key, { count: current + 1, until: Date.now() + FAILURE_WINDOW_MS });
      return reply.status(401).send({ message: '이메일 또는 비밀번호를 확인하세요.' });
    }
    failures.delete(key);
    setSession(reply, startSession(db, row.id));
    return meSchema.parse({ id: row.id, email: row.email });
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    reply.header('set-cookie', sessionCookie('', 0, options.secureCookie));
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

const DUMMY_HASH = `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(64).toString('base64')}`;
