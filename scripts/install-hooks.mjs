import { spawnSync } from 'node:child_process';
// CI·git 작업 트리가 없는 설치(tarball·Docker)에서는 조용히 건너뛴다.
const inWorkTree = spawnSync('git', ['rev-parse', '--is-inside-work-tree']).status === 0;
if (!process.env.CI && inWorkTree) {
  const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}
