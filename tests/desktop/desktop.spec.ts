import { test, expect, _electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
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
    await expect(page.getByRole('status')).toHaveText('API와 로컬 DB가 준비되었습니다.');
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
