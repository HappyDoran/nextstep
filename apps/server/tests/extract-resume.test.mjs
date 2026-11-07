import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractResumeText, RESUME_MAX_BYTES } from '../dist/documents/extract-resume.js';

// 픽스처는 macOS cupsfilter·PDFKit으로 만든 합성 이력서다. 실제 사용자 문서가 아니다.
const fixture = name => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const md = text => new Uint8Array(Buffer.from(text, 'utf8'));

test('텍스트 PDF의 한글·영문 본문을 추출한다', async () => {
  const result = await extractResumeText(fixture('resume-text.pdf'), '이력서.PDF');
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'pdf');
  assert.match(result.text, /프론트엔드 개발자 경력 3년/);
  assert.match(result.text, /React, TypeScript, Next\.js/);
});

test('암호화·스캔·손상 PDF를 지원 불가 사유로 구분한다', async () => {
  assert.deepEqual(await extractResumeText(fixture('resume-encrypted.pdf'), 'a.pdf'), { ok: false, code: 'encrypted' });
  assert.deepEqual(await extractResumeText(fixture('resume-scanned.pdf'), 'a.pdf'), { ok: false, code: 'scanned_or_empty' });
  const truncated = fixture('resume-text.pdf').subarray(0, 600);
  assert.deepEqual(await extractResumeText(truncated, 'a.pdf'), { ok: false, code: 'damaged' });
  assert.deepEqual(await extractResumeText(md('그냥 텍스트'), 'a.pdf'), { ok: false, code: 'damaged' });
});

test('MD는 UTF-8 본문을 정규화하고 잘못된 입력을 거부한다', async () => {
  const ok = await extractResumeText(md('\uFEFF# 가상 지원자\r\n\r\n기획 3년, Figma·Jira 사용\r\n'), 'resume.md');
  assert.deepEqual(ok, { ok: true, kind: 'md', text: '# 가상 지원자\n\n기획 3년, Figma·Jira 사용' });
  assert.deepEqual(await extractResumeText(new Uint8Array([0xff, 0xfe, 0x00]), 'a.md'), { ok: false, code: 'damaged' });
  assert.deepEqual(await extractResumeText(md('# \n'), 'a.md'), { ok: false, code: 'scanned_or_empty' });
});

test('형식·크기 제한을 본문 해석 전에 적용한다', async () => {
  assert.deepEqual(await extractResumeText(md('MZ\u0090'), 'run.exe'), { ok: false, code: 'unsupported_type' });
  assert.deepEqual(await extractResumeText(md('가'.repeat(30)), 'a.docx'), { ok: false, code: 'unsupported_type' });
  assert.deepEqual(await extractResumeText(new Uint8Array(RESUME_MAX_BYTES + 1), 'a.pdf'), { ok: false, code: 'too_large' });
});
