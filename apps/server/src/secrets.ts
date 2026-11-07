import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// 연결 비밀정보는 DB와 다른 경로의 키로 AES-256-GCM 암호화한다.
// 키는 NEXTSTEP_SECRET_KEY(base64 32바이트) 또는 키 파일(0600, 없으면 생성)에서 읽는다.
// ponytail: 로컬 키 파일. 배포 시 운영 비밀 저장소(KMS 등)로 옮긴다.
export function loadSecretKey(keyPath: string) {
  const fromEnv = process.env.NEXTSTEP_SECRET_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, 'base64');
    if (key.length !== 32) throw new Error('NEXTSTEP_SECRET_KEY는 base64로 인코딩한 32바이트여야 합니다.');
    return key;
  }
  if (!existsSync(keyPath)) {
    mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
    writeFileSync(keyPath, randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' });
  }
  chmodSync(keyPath, 0o600);
  return Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64');
}

export function encrypt(key: Buffer, plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}

export function decrypt(key: Buffer, sealed: string) {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('secret_format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
}
