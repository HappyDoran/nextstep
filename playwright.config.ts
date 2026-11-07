import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // 테스트가 같은 로컬 서버·DB를 쓰므로 한 번에 하나씩 실행한다.
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  webServer: [
    { command: 'pnpm --filter @nextstep/server start', url: 'http://127.0.0.1:4100/health', reuseExistingServer: false },
    { command: 'pnpm --filter @nextstep/web start', url: 'http://127.0.0.1:3100', reuseExistingServer: false },
  ],
});
