import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  webServer: [
    { command: 'pnpm --filter @nextstep/server start', url: 'http://127.0.0.1:4100/health', reuseExistingServer: false },
    { command: 'pnpm --filter @nextstep/web start', url: 'http://127.0.0.1:3100', reuseExistingServer: false },
  ],
});
