import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { getDocument, PasswordException, InvalidPDFException } from 'pdfjs-dist/legacy/build/pdf.mjs';

// 기술 설계 부록 D: 텍스트 PDF·MD 한 개, 파일당 20MB 초기값.
export const RESUME_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
// ponytail: 글자 수 기준 스캔본 판정. 텍스트 레이어가 일부만 있는 PDF는 사용자 확인 단계에서 걸러낸다.
const MIN_TEXT_CHARS = 20;

export type ResumeFailure = 'unsupported_type' | 'too_large' | 'encrypted' | 'damaged' | 'scanned_or_empty' | 'timeout';
export type ResumeExtraction =
  | { ok: true; kind: 'pdf' | 'md'; text: string; pages?: number }
  | { ok: false; code: ResumeFailure };

const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

export async function extractResumeText(bytes: Uint8Array, filename: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ResumeExtraction> {
  if (bytes.byteLength > RESUME_MAX_BYTES) return { ok: false, code: 'too_large' };
  const ext = extname(filename).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return extractMarkdown(bytes);
  if (ext === '.pdf') return extractPdf(bytes, timeoutMs);
  return { ok: false, code: 'unsupported_type' };
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

async function extractPdf(bytes: Uint8Array, timeoutMs: number): Promise<ResumeExtraction> {
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
    const result = await Promise.race([readPdf(task.promise), timeout]);
    return result === 'timeout' ? { ok: false, code: 'timeout' } : result;
  } catch (error) {
    if (error instanceof PasswordException) return { ok: false, code: 'encrypted' };
    if (error instanceof InvalidPDFException) return { ok: false, code: 'damaged' };
    return { ok: false, code: 'damaged' };
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}

type PdfDocument = Awaited<ReturnType<typeof getDocument>['promise']>;

async function readPdf(loading: Promise<PdfDocument>): Promise<ResumeExtraction> {
  const doc = await loading;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''));
  }
  const text = pages.join('\n\n').replace(/[ \t]+\n/g, '\n').trim();
  return countText(text) < MIN_TEXT_CHARS ? { ok: false, code: 'scanned_or_empty' } : { ok: true, kind: 'pdf', text, pages: doc.numPages };
}

function countText(text: string) {
  return text.replace(/\s/g, '').length;
}
