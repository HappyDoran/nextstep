import { app, BrowserWindow, dialog, Menu, session, shell } from 'electron';
import { serviceUrl, isServiceNavigation, isExternalUrl } from './security.js';
const service = serviceUrl(process.env.NEXTSTEP_WEB_URL, !app.isPackaged);
async function openExternal(target: string) {
  if (!isExternalUrl(target)) return;
  const answer = await dialog.showMessageBox({ type: 'question', buttons: ['취소', '브라우저로 열기'], defaultId: 0, cancelId: 0, message: '외부 페이지를 기본 브라우저로 엽니다.', detail: new URL(target).hostname });
  if (answer.response === 1) await shell.openExternal(target);
}
function createWindow() {
  const window = new BrowserWindow({ width: 1120, height: 800, minWidth: 640, minHeight: 500, title: 'NextStep', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, partition: 'persist:nextstep' } });
  window.webContents.setWindowOpenHandler(({ url }) => { void openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, target) => {
    if (!isServiceNavigation(target, service)) { event.preventDefault(); void openExternal(target); }
  });
  window.webContents.on('will-redirect', (event, target) => { if (!isServiceNavigation(target, service)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', (event) => { event.preventDefault(); });
  window.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
    if (mainFrame && code !== -3) void dialog.showMessageBox(window, { type: 'error', message: '서비스에 연결하지 못했습니다. 서버 실행 상태를 확인하고 다시 열어 주세요.' });
  });
  void window.loadURL(service.href);
}
void app.whenReady().then(() => {
session.fromPartition('persist:nextstep').setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
session.fromPartition('persist:nextstep').setPermissionCheckHandler(() => false);
Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'NextStep', submenu: [{ label: 'NextStep 종료', click: () => app.quit() }] }, { label: '편집', submenu: [{ role: 'copy', label: '복사' }, { role: 'paste', label: '붙여넣기' }, { role: 'selectAll', label: '전체 선택' }] }]));
createWindow();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
