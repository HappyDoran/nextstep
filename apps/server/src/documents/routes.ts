import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DOCUMENT_TEXT_MAX, documentKindSchema, resumeSchema, type DocumentKind } from '@nextstep/contracts';
import { requireUser } from '../auth.js';
import { extractResumeText, ZIP_MAX_BYTES } from './extract-resume.js';

type Row = { id: string; kind: DocumentKind; filename: string; size: number; storage_key: string; text: string; empty_pages: string; ocr_pages: string; edited: number; created_at: string };
const toDocument = (r: Row) => resumeSchema.parse({ id: r.id, kind: r.kind, filename: r.filename, size: r.size, createdAt: r.created_at, text: r.text, emptyPages: JSON.parse(r.empty_pages), ocrPages: JSON.parse(r.ocr_pages), edited: r.edited === 1 });
const NAMES: Record<DocumentKind, string> = { resume: '이력서', portfolio: '포트폴리오', career: '경력기술서' };

// 원본 파일은 사용자별 비공개 디렉터리에 둔다. 경로는 서버가 만든 ID로만 구성해 임의 경로 접근을 막는다.
export function registerDocuments(app: FastifyInstance, db: DatabaseSync, filesDir: string) {
  const pathOf = (key: string) => join(filesDir, key);
  const removeFile = (key: string) => rmSync(pathOf(key), { force: true });
  const kindOf = (params: unknown) => documentKindSchema.safeParse((params as { kind?: string }).kind).data;
  const find = (userId: string, kind: DocumentKind) => db.prepare('SELECT * FROM documents WHERE user_id = ? AND kind = ?').get(userId, kind) as Row | undefined;

  app.addContentTypeParser(['application/pdf', 'text/markdown', 'application/zip', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: ZIP_MAX_BYTES + 1 }, (_req, body, done) => done(null, body));

  app.get('/documents/:kind', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const kind = kindOf(request.params);
    if (!kind) return reply.status(404).send({ message: '없는 서류 종류입니다.' });
    const row = find(user.id, kind);
    return row ? toDocument(row) : reply.status(404).send({ message: `등록한 ${NAMES[kind]}가 없습니다.` });
  });

  // 교체: 새 문서 변환이 성공해야 대표를 바꾸고 기존 원본·본문을 지운다. 실패하면 기존 문서를 그대로 둔다.
  app.put('/documents/:kind', { bodyLimit: ZIP_MAX_BYTES + 1 }, async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const kind = kindOf(request.params);
    if (!kind) return reply.status(404).send({ message: '없는 서류 종류입니다.' });
    if (!Buffer.isBuffer(request.body)) return reply.status(415).send({ message: 'PDF·MD·ZIP 파일을 올리세요.', code: 'unsupported_type' });
    const rawName = request.headers['x-filename'];
    let filename = '';
    try { filename = typeof rawName === 'string' ? decodeURIComponent(rawName).slice(0, 200) : ''; } catch { /* 빈 이름 */ }
    if (!filename) return reply.status(400).send({ message: '파일 이름을 확인하세요.' });
    const result = await extractResumeText(new Uint8Array(request.body), filename);
    if (!result.ok) return reply.status(422).send({ message: `${NAMES[kind]}를 읽지 못했습니다.`, code: result.code });

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
      previous = find(user.id, kind);
      if (previous) db.prepare('DELETE FROM documents WHERE id = ?').run(previous.id);
      db.prepare('INSERT INTO documents (id, user_id, kind, filename, size, storage_key, text, empty_pages, ocr_pages, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, user.id, kind, filename, request.body.length, key, result.text, JSON.stringify(result.emptyPages ?? []), JSON.stringify(result.ocrPages ?? []), new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      removeFile(key);
      throw error;
    }
    if (previous) removeFile(previous.storage_key);
    return toDocument(db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as Row);
  });

  // 변환된 MD를 사용자가 고친다(OCR 오인식 등). 고친 본문이 추천에 쓰인다.
  app.put('/documents/:kind/text', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const kind = kindOf(request.params);
    const body = z.object({ text: z.string().trim().min(1).max(DOCUMENT_TEXT_MAX) }).safeParse(request.body);
    if (!kind || !body.success) return reply.status(400).send({ message: '본문을 확인하세요.' });
    const done = db.prepare('UPDATE documents SET text = ?, edited = 1 WHERE user_id = ? AND kind = ?').run(body.data.text, user.id, kind);
    if (!done.changes) return reply.status(404).send({ message: `등록한 ${NAMES[kind]}가 없습니다.` });
    return toDocument(find(user.id, kind)!);
  });

  app.delete('/documents/:kind', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const kind = kindOf(request.params);
    if (!kind) return reply.status(404).send({ message: '없는 서류 종류입니다.' });
    const row = find(user.id, kind);
    if (!row) return reply.status(404).send({ message: `등록한 ${NAMES[kind]}가 없습니다.` });
    db.prepare('DELETE FROM documents WHERE id = ?').run(row.id);
    removeFile(row.storage_key);
    return reply.status(204).send();
  });
}

// 계정 삭제 시 DB 행은 외래키로 지워지므로 사용자 파일 디렉터리도 함께 지운다.
export function removeUserFiles(filesDir: string, userId: string) {
  rmSync(join(filesDir, userId), { recursive: true, force: true });
}
