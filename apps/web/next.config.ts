import { execSync } from 'node:child_process';

// 설정 일반 구역의 웹 버전 표시: 빌드한 커밋(홈서버 배포는 git 체크아웃에서 빌드한다).
const build = (() => { try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { return undefined; } })();
const config = { transpilePackages: ['@nextstep/design-system', '@nextstep/contracts'], poweredByHeader: false, ...(build ? { env: { NEXT_PUBLIC_BUILD: build } } : {}) };

export default config;
