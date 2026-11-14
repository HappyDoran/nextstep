import { inflateRawSync } from 'node:zlib';

// Notion 내보내기 ZIP에서 MD 파일만 메모리로 읽는다. 디스크에 풀지 않으므로 경로 이탈이 생기지 않는다.
// 제한(기술 설계 G절): ZIP 50MB(호출 쪽), 항목 500개, 해제 합계 200MB. 암호화·ZIP64·알 수 없는 압축은 거부한다.
export const ZIP_LIMITS = { entries: 500, totalBytes: 200 * 1024 * 1024 };
export type ZipFailure = 'damaged' | 'too_large';

export function readZipMarkdown(buf: Buffer): { ok: true; files: { name: string; text: string }[] } | { ok: false; code: ZipFailure } {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > buf.length) return { ok: false, code: 'damaged' };
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  if (count > ZIP_LIMITS.entries) return { ok: false, code: 'too_large' };
  let total = 0;
  const files: { name: string; text: string }[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) return { ok: false, code: 'damaged' };
    const flags = buf.readUInt16LE(at + 8), method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20), plain = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    at += 46 + nameLen + extraLen + commentLen;
    if (flags & 1 || size === 0xffffffff || plain === 0xffffffff) return { ok: false, code: 'damaged' };
    // 선언한 해제 크기 합계로 압축 폭탄을 먼저 막는다(실제 해제도 선언 크기를 넘지 못하게 한다).
    total += plain;
    if (total > ZIP_LIMITS.totalBytes) return { ok: false, code: 'too_large' };
    if (!/\.(md|markdown)$/i.test(name) || name.startsWith('__MACOSX/') || name.split('/').includes('..')) continue;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) return { ok: false, code: 'damaged' };
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    let out: Buffer;
    try {
      if (method === 0) out = data;
      else if (method === 8) out = inflateRawSync(data, { maxOutputLength: Math.max(plain, 1) });
      else return { ok: false, code: 'damaged' };
    } catch {
      return { ok: false, code: 'damaged' };
    }
    if (out.length !== plain) return { ok: false, code: 'damaged' };
    files.push({ name, text: out.toString('utf8') });
  }
  return { ok: true, files: files.sort((a, b) => a.name.localeCompare(b.name)) };
}
