import { spawnSync } from 'node:child_process';
if (process.env.CI !== 'true') {
  const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}
