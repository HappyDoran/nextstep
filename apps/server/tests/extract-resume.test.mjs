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

test('일부 쪽만 이미지인 PDF는 성공하되 글자 없는 쪽 번호를 알린다', async () => {
  // resume-partial.pdf = resume-text.pdf 1쪽 + resume-scanned.pdf 1쪽(PDFKit으로 합침)
  const result = await extractResumeText(fixture('resume-partial.pdf'), 'a.pdf');
  assert.equal(result.ok, true);
  assert.equal(result.pages, 2);
  assert.deepEqual(result.emptyPages, [2]);
  assert.deepEqual((await extractResumeText(fixture('resume-text.pdf'), 'a.pdf')).emptyPages, []);
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

// 합성 ZIP을 만든다(로컬 헤더 + 중앙 디렉터리 + 끝 레코드). deflate=false면 무압축, plain은 선언 해제 크기를 바꿀 때만 쓴다.
import { deflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { ocrPdfPages } from '../dist/documents/ocr.js';
function zip(entries, { encrypted = false } = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, text, plain } of entries) {
    const data = Buffer.from(text, 'utf8'), packed = deflateRawSync(data), n = Buffer.from(name, 'utf8');
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(encrypted ? 1 : 0, 6); head.writeUInt16LE(8, 8); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(plain ?? data.length, 22); head.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(encrypted ? 1 : 0, 8); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(plain ?? data.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(offset, 42);
    locals.push(head, n, packed); centrals.push(cen, n);
    offset += 30 + n.length + packed.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

test('Notion ZIP은 안의 MD만 경로 순으로 합치고 위험한 ZIP은 거부한다', async () => {
  const ok = await extractResumeText(zip([{ name: '경력/2 프로젝트.md', text: '## 결제 시스템\n주문 API 개발' }, { name: '1 소개.md', text: '# 가상 지원자\n백엔드 3년' }, { name: 'img/a.png', text: 'PNG' }, { name: '../밖.md', text: '경로 이탈' }]), 'notion.zip');
  assert.equal(ok.ok, true);
  assert.equal(ok.kind, 'zip');
  assert.ok(ok.text.indexOf('백엔드 3년') < ok.text.indexOf('주문 API 개발'));
  assert.equal(ok.text.includes('경로 이탈') || ok.text.includes('PNG'), false);
  assert.deepEqual(await extractResumeText(zip([{ name: 'a.md', text: '가상 지원자 소개 글입니다 충분히 깁니다' }], { encrypted: true }), 'a.zip'), { ok: false, code: 'damaged' });
  // 선언한 해제 크기가 200MB를 넘으면 풀기 전에 거부한다(압축 폭탄).
  assert.deepEqual(await extractResumeText(zip([{ name: 'a.md', text: 'x', plain: 201 * 1024 * 1024 }]), 'a.zip'), { ok: false, code: 'too_large' });
  assert.deepEqual(await extractResumeText(zip(Array.from({ length: 501 }, (_, i) => ({ name: `${i}.md`, text: 'x' }))), 'a.zip'), { ok: false, code: 'too_large' });
  assert.deepEqual(await extractResumeText(zip([{ name: 'a.png', text: 'x' }]), 'a.zip'), { ok: false, code: 'scanned_or_empty' });
  assert.deepEqual(await extractResumeText(md('PK 아님'), 'a.zip'), { ok: false, code: 'damaged' });
});

const hasOcr = (() => { try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); execFileSync('tesseract', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
test('이미지 쪽은 글자 인식(OCR)으로 읽는다', { skip: !hasOcr && 'pdftoppm·tesseract 미설치' }, async () => {
  const pages = await ocrPdfPages(fixture('resume-scanned.pdf'), [1], 30_000);
  assert.match(pages.get(1), /스캔/);
});
