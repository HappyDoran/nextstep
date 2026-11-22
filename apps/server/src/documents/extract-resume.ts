import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { getDocument, PasswordException } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ocrPdfPages } from './ocr.js';
import { readZipMarkdown } from './zip.js';

// 기술 설계 D: 서류는 모두 MD 텍스트로 바꿔 저장·분석한다. PDF·MD 20MB, Notion ZIP 50MB.
export const RESUME_MAX_BYTES = 20 * 1024 * 1024;
export const ZIP_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
// 글자 없는 쪽 OCR에 쓰는 시간 상한(쪽당 약 4초). 남은 쪽은 경고로 알린다.
const OCR_TIMEOUT_MS = 40_000;
// ponytail: 글자 수 기준 스캔본 판정. 문서 전체가 기준 미만이면 실패, 일부 쪽만 미만이면 emptyPages로 경고한다.
const MIN_TEXT_CHARS = 20;

export type ResumeFailure = 'unsupported_type' | 'too_large' | 'encrypted' | 'damaged' | 'scanned_or_empty' | 'timeout';
export type ResumeExtraction =
  | { ok: true; kind: 'pdf' | 'md' | 'zip'; text: string; pages?: number; emptyPages?: number[]; ocrPages?: number[] }
  | { ok: false; code: ResumeFailure };

const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

export async function extractResumeText(bytes: Uint8Array, filename: string, timeoutMs = DEFAULT_TIMEOUT_MS, ocrTimeoutMs = OCR_TIMEOUT_MS): Promise<ResumeExtraction> {
  const ext = extname(filename).toLowerCase();
  if (ext === '.zip') return bytes.byteLength > ZIP_MAX_BYTES ? { ok: false, code: 'too_large' } : extractZip(bytes);
  if (bytes.byteLength > RESUME_MAX_BYTES) return { ok: false, code: 'too_large' };
  if (ext === '.md' || ext === '.markdown') return extractMarkdown(bytes);
  if (ext === '.pdf') return extractPdf(bytes, timeoutMs, ocrTimeoutMs);
  return { ok: false, code: 'unsupported_type' };
}

// Notion 내보내기: 안의 MD를 경로 순으로 합친다. 이미지·첨부는 읽지 않는다.
function extractZip(bytes: Uint8Array): ResumeExtraction {
  const zip = readZipMarkdown(Buffer.from(bytes));
  if (!zip.ok) return zip;
  const text = zip.files.map(f => `<!-- ${f.name} -->\n${f.text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()}`).join('\n\n').trim();
  return countText(text.replace(/<!--[^>]*-->/g, '')) < MIN_TEXT_CHARS ? { ok: false, code: 'scanned_or_empty' } : { ok: true, kind: 'zip', text };
}

function extractMarkdown(bytes: Uint8Array): ResumeExtraction {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: 'damaged' };
  }
  // 바이너리를 .md로 올린 경우를 거부한다.
  if (text.includes('\u0000')) return { ok: false, code: 'unsupported_type' };
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  return countText(text) < MIN_TEXT_CHARS ? { ok: false, code: 'scanned_or_empty' } : { ok: true, kind: 'md', text };
}

async function extractPdf(bytes: Uint8Array, timeoutMs: number, ocrTimeoutMs: number): Promise<ResumeExtraction> {
  if (new TextDecoder().decode(bytes.subarray(0, 1024)).indexOf('%PDF-') === -1) return { ok: false, code: 'damaged' };
  const task = getDocument({
    // pdfjs가 버퍼를 worker로 넘기며 비우므로 사본을 준다.
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    cMapUrl: join(pdfjsRoot, 'cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: join(pdfjsRoot, 'standard_fonts/'),
    verbosity: 0,
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), timeoutMs); });
  try {
    const pages = await Promise.race([readPdf(task.promise), timeout]);
    if (pages === 'timeout') return { ok: false, code: 'timeout' };
    // 글자가 없는 쪽(이미지)은 OCR로 읽어 채운다. OCR 도구가 없거나 못 읽은 쪽은 emptyPages로 남겨 경고한다.
    const blank = pages.flatMap((page, i) => (countText(page) < MIN_TEXT_CHARS ? [i + 1] : []));
    const ocr = await ocrPdfPages(bytes, blank, ocrTimeoutMs) ?? new Map<number, string>();
    const ocrPages = blank.filter(n => countText(ocr.get(n) ?? '') >= MIN_TEXT_CHARS);
    for (const n of ocrPages) pages[n - 1] = ocr.get(n)!;
    const text = pages.join('\n\n').replace(/[ \t]+\n/g, '\n').trim();
    if (countText(text) < MIN_TEXT_CHARS) return { ok: false, code: 'scanned_or_empty' };
    return { ok: true, kind: 'pdf', text, pages: pages.length, emptyPages: blank.filter(n => !ocrPages.includes(n)), ocrPages };
  } catch (error) {
    if (error instanceof PasswordException) return { ok: false, code: 'encrypted' };
    return { ok: false, code: 'damaged' };
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}

type PdfDocument = Awaited<ReturnType<typeof getDocument>['promise']>;

async function readPdf(loading: Promise<PdfDocument>): Promise<string[]> {
  const doc = await loading;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''));
  }
  return pages;
}

function countText(text: string) {
  return text.replace(/\s/g, '').length;
}
