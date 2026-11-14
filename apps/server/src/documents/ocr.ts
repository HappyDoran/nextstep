import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
// 스캔 쪽을 이미지로 바꿔(pdftoppm) 글자를 읽는다(tesseract, 한국어+영어). 시스템 도구가 없으면 null을 돌려 기존처럼 경고만 한다.
// 홈서버: apt install poppler-utils tesseract-ocr tesseract-ocr-kor / macOS: brew install poppler tesseract tesseract-lang
export async function ocrPdfPages(pdf: Uint8Array, pages: number[], timeoutMs: number): Promise<Map<number, string> | null> {
  if (!pages.length) return new Map();
  // leptonica(tesseract)는 '/tmp'로 시작하는 경로를 자체 임시 폴더로 바꿔 읽으므로 실제 경로를 넘긴다(macOS /tmp → /private/tmp).
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'nextstep-ocr-')));
  const deadline = Date.now() + timeoutMs;
  const left = () => Math.max(1000, deadline - Date.now());
  try {
    writeFileSync(join(dir, 'in.pdf'), pdf, { mode: 0o600 });
    const out = new Map<number, string>();
    for (const page of pages) {
      await run('pdftoppm', ['-r', '200', '-gray', '-png', '-f', String(page), '-l', String(page), join(dir, 'in.pdf'), join(dir, `p${page}`)], { timeout: left() });
      const image = readdirSync(dir).find(f => f.startsWith(`p${page}-`) || f === `p${page}.png`);
      if (!image) continue;
      const { stdout } = await run('tesseract', [join(dir, image), '-', '-l', 'kor+eng'], { timeout: left(), maxBuffer: 10 * 1024 * 1024 });
      out.set(page, stdout.trim());
    }
    return out;
  } catch {
    // 도구가 없거나(ENOENT) 시간이 초과되면 OCR 없이 진행한다.
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
