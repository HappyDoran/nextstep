import { readFileSync } from 'node:fs';
const message = readFileSync(process.argv[2], 'utf8').replace(/^#.*$/gm, '').trim();
if (!/^(Merge|Revert|fixup!|squash!)/.test(message) && !/^[^\n]+\n\s*\n\S/.test(message)) {
  console.error('커밋 본문에 변경 이유와 검증 결과를 작성하세요.');
  process.exitCode = 1;
}
