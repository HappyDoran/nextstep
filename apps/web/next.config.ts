import { execSync } from 'node:child_process';

// 설정 일반 구역의 웹 버전: 배포 스크립트가 NEXTSTEP_BUILD(커밋, turbo 캐시 키)로 넘긴다. 없으면 지금 커밋, git이 없으면 표시하지 않는다.
const build = process.env.NEXTSTEP_BUILD ?? (() => { try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return undefined; } })();
const config = { transpilePackages: ['@nextstep/design-system', '@nextstep/contracts'], poweredByHeader: false, ...(build ? { env: { NEXT_PUBLIC_BUILD: build } } : {}) };

export default config;
