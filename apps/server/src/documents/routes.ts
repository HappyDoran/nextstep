import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { resumeSchema } from '@nextstep/contracts';
import { requireUser } from '../auth.js';
import { extractResumeText, RESUME_MAX_BYTES } from './extract-resume.js';

type Row = { id: string; filename: string; size: number; storage_key: string; text: string; empty_pages: string; created_at: string };
const toResume = (r: Row) => resumeSchema.parse({ id: r.id, filename: r.filename, size: r.size, createdAt: r.created_at, text: r.text, emptyPages: JSON.parse(r.empty_pages) });

// 원본 파일은 사용자별 비공개 디렉터리에 둔다. 경로는 서버가 만든 ID로만 구성해 임의 경로 접근을 막는다.
export function registerDocuments(app: FastifyInstance, db: DatabaseSync, filesDir: string) {
  const pathOf = (key: string) => join(filesDir, key);
  const removeFile = (key: string) => rmSync(pathOf(key), { force: true });

  app.addContentTypeParser(['application/pdf', 'text/markdown', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: RESUME_MAX_BYTES + 1 }, (_req, body, done) => done(null, body));

  app.get('/documents/resume', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const row = db.prepare("SELECT * FROM documents WHERE user_id = ? AND kind = 'resume'").get(user.id) as Row | undefined;
    return row ? toResume(row) : reply.status(404).send({ message: '등록한 이력서가 없습니다.' });
  });

  // 교체: 새 문서 추출이 성공해야 대표를 바꾸고 기존 원본·본문을 지운다. 실패하면 기존 문서를 그대로 둔다.
  app.put('/documents/resume', { bodyLimit: RESUME_MAX_BYTES + 1 }, async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    if (!Buffer.isBuffer(request.body)) return reply.status(415).send({ message: 'PDF 또는 MD 파일을 올리세요.', code: 'unsupported_type' });
    const rawName = request.headers['x-filename'];
    let filename = '';
    try { filename = typeof rawName === 'string' ? decodeURIComponent(rawName).slice(0, 200) : ''; } catch { /* 빈 이름 */ }
    if (!filename) return reply.status(400).send({ message: '파일 이름을 확인하세요.' });
    const result = await extractResumeText(new Uint8Array(request.body), filename);
    if (!result.ok) return reply.status(422).send({ message: '이력서를 읽지 못했습니다.', code: result.code });

    const id = randomUUID();
    const key = `${user.id}/${id}.${result.kind}`;
    mkdirSync(join(filesDir, user.id), { recursive: true, mode: 0o700 });
    writeFileSync(pathOf(key), request.body, { mode: 0o600 });
    chmodSync(pathOf(key), 0o600);
    let previous: Row | undefined;
    db.exec('BEGIN IMMEDIATE');
    try {
      // 계정이 그 사이 삭제됐으면 사용자 행이 없으므로 새 문서를 만들지 않는다.
      if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(user.id)) {
        db.exec('ROLLBACK');
        removeFile(key);
        return reply.status(401).send({ message: '로그인이 필요합니다.' });
      }
      previous = db.prepare("SELECT * FROM documents WHERE user_id = ? AND kind = 'resume'").get(user.id) as Row | undefined;
      if (previous) db.prepare('DELETE FROM documents WHERE id = ?').run(previous.id);
      db.prepare("INSERT INTO documents (id, user_id, kind, filename, size, storage_key, text, empty_pages, created_at) VALUES (?, ?, 'resume', ?, ?, ?, ?, ?, ?)")
        .run(id, user.id, filename, request.body.length, key, result.text, JSON.stringify(result.emptyPages ?? []), new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      removeFile(key);
      throw error;
    }
    if (previous) removeFile(previous.storage_key);
    return toResume(db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as Row);
  });

  app.delete('/documents/resume', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const row = db.prepare("SELECT * FROM documents WHERE user_id = ? AND kind = 'resume'").get(user.id) as Row | undefined;
    if (!row) return reply.status(404).send({ message: '등록한 이력서가 없습니다.' });
    db.prepare('DELETE FROM documents WHERE id = ?').run(row.id);
    removeFile(row.storage_key);
    return reply.status(204).send();
  });
}

// 계정 삭제 시 DB 행은 외래키로 지워지므로 사용자 파일 디렉터리도 함께 지운다.
export function removeUserFiles(filesDir: string, userId: string) {
  rmSync(join(filesDir, userId), { recursive: true, force: true });
}
