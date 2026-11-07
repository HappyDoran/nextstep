import { test, expect, _electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const desktopRequire = createRequire(resolve('apps/desktop/package.json'));
test('macOS 창·격리·창 닫기·완전 종료', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 실행 검증');
  const profile = mkdtempSync(join(tmpdir(), 'nextstep-electron-'));
  const app = await _electron.launch({
    executablePath: desktopRequire('electron') as string,
    args: [resolve('apps/desktop/dist/main.js'), `--user-data-dir=${profile}`],
    env: { ...process.env, NEXTSTEP_WEB_URL: 'http://127.0.0.1:3100' },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('status').filter({ hasText: /서버|API/ })).toHaveText('API와 로컬 DB가 준비되었습니다.');
    expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]!.webContents as unknown as { getLastWebPreferences(): { nodeIntegration: boolean; sandbox: boolean; contextIsolation: boolean; webSecurity: boolean } };
      const preferences = contents.getLastWebPreferences();
      return { nodeIntegration: preferences.nodeIntegration, sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, webSecurity: preferences.webSecurity };
    });
    expect(preferences).toEqual({ nodeIntegration: false, sandbox: true, contextIsolation: true, webSecurity: true });
    await page.screenshot({ path: '/tmp/nextstep-desktop.png' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
    // macOS의 창 닫기는 프로세스를 유지하고, 종료 메뉴는 완전히 종료한다.
    const closed = app.waitForEvent('close');
    await app.evaluate(({ Menu }) => {
      const quit = Menu.getApplicationMenu()!.items[0]!.submenu!.items.find(item => item.label === 'NextStep 종료')!;
      setTimeout(() => quit.click(), 0);
    });
    await closed;
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test('Electron에서 로그인·지원 건이 앱 완전 종료 후 재실행에도 유지된다', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 실행 검증');
  const profile = mkdtempSync(join(tmpdir(), 'nextstep-electron-'));
  const launch = () => _electron.launch({
    executablePath: desktopRequire('electron') as string,
    args: [resolve('apps/desktop/dist/main.js'), `--user-data-dir=${profile}`],
    env: { ...process.env, NEXTSTEP_WEB_URL: 'http://127.0.0.1:3100' },
  });
  const email = `desktop-${Date.now()}@example.com`;
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.getByRole('tab', { name: '초대 코드로 가입' }).click();
    await page.getByLabel('초대 코드').fill(execFileSync('pnpm', ['--silent', '--filter', '@nextstep/server', 'invite'], { encoding: 'utf8' }).trim());
    await page.getByLabel('이메일').fill(email);
    await page.getByLabel('비밀번호').fill('correct horse battery');
    await page.getByRole('button', { name: '가입' }).click();
    await page.getByLabel('회사').first().fill('가상데스크톱');
    await page.getByLabel('직무').first().fill('프론트엔드');
    await page.getByRole('button', { name: '등록' }).click();
    await expect(page.getByText('가상데스크톱')).toBeVisible();
    await app.close();

    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByText('가상데스크톱')).toBeVisible();
    // 정리: 테스트 계정 삭제.
    await page.getByRole('link', { name: '설정' }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '계정 삭제' }).click();
    await expect(page.getByRole('tab', { name: '로그인' })).toBeVisible();
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
