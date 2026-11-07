import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// git과 같은 주석 문자를 쓰고, commit -v의 scissors 아래 diff는 본문에서 제외한다.
const configured = spawnSync('git', ['config', 'core.commentChar'], { encoding: 'utf8' }).stdout?.trim();
const comment = configured?.length === 1 ? configured : '#';
const escaped = comment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const message = readFileSync(process.argv[2], 'utf8')
  .split(new RegExp(`^${escaped} -+ >8 -+$`, 'm'))[0]
  .replace(new RegExp(`^${escaped}.*$`, 'gm'), '').trim();
if (!/^(Merge|Revert|fixup!|squash!)/.test(message) && !/^[^\n]+\n\s*\n\S/.test(message)) {
  console.error('커밋 본문에 변경 이유와 검증 결과를 작성하세요.');
  process.exitCode = 1;
}
