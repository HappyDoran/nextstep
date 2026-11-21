import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// e2e 서버는 개발 DB·실제 로컬 AI와 분리한다(값은 .env.local보다 우선).
// 설정 파일은 작업자 프로세스에서도 다시 읽히므로 환경 변수로 한 번만 정해 초대 코드 발급과 같은 DB를 쓰게 한다.
process.env.NEXTSTEP_DB_PATH = process.env.NEXTSTEP_E2E_DB ??= join(mkdtempSync(join(tmpdir(), 'nextstep-e2e-')), 'db.sqlite');
// 구글 로그인은 로컬 모의 서버(apps/server/tests/fake-google.mjs)로 바꾼다.
const google = 'http://127.0.0.1:4199';
const serverEnv = {
  NEXTSTEP_DB_PATH: process.env.NEXTSTEP_E2E_DB, NEXTSTEP_OLLAMA_URL: 'http://127.0.0.1:9', NEXTSTEP_OLLAMA_MODEL: 'qwen3:1.7b',
  NEXTSTEP_GOOGLE_CLIENT_ID: 'test-client', NEXTSTEP_GOOGLE_CLIENT_SECRET: 'test-secret', NEXTSTEP_GOOGLE_AUTH_URL: `${google}/auth`, NEXTSTEP_GOOGLE_TOKEN_URL: `${google}/token`,
};
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // 테스트가 같은 로컬 서버·DB를 쓰므로 한 번에 하나씩 실행한다.
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  webServer: [
    { command: 'node apps/server/tests/fake-google.mjs 4199', url: 'http://127.0.0.1:4199/auth', reuseExistingServer: false },
    { command: 'pnpm --filter @nextstep/server start', url: 'http://127.0.0.1:4100/health', reuseExistingServer: false, env: serverEnv },
    { command: 'pnpm --filter @nextstep/web start', url: 'http://127.0.0.1:3100', reuseExistingServer: false },
  ],
});
