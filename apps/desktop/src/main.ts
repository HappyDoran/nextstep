import { app, BrowserWindow, dialog, Menu, nativeImage, Notification, session, shell, Tray } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serviceUrl, isServiceNavigation, isExternalUrl, googleLoginUrl, desktopLoginPath } from './security.js';
import { noticeFor, type LatestRefresh } from './notify.js';

// 상주 앱: 창은 홈서버 웹을 그대로 열고, 창을 닫아도 메뉴 막대(macOS)·알림 영역(Windows) 아이콘으로 남아
// 서버의 마지막 공고 갱신 결과를 1분마다 확인해 OS 알림을 보낸다. 서버 작업은 서버가 한다(기술 설계 E절).
const POLL_MS = 60_000;
const PARTITION = 'persist:nextstep';
type Settings = { webUrl?: string; lastNotifiedId?: string };

let service: URL;
let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let status = '확인 전';
let notice: Notification | undefined; // 클릭 처리기가 수거되지 않게 붙잡아 둔다.

const settingsPath = () => join(app.getPath('userData'), 'settings.json');
function readSettings(): Settings | undefined {
  try { return JSON.parse(readFileSync(settingsPath(), 'utf8')) as Settings; } catch { return undefined; }
}
function writeSettings(next: Settings) { writeFileSync(settingsPath(), JSON.stringify(next), { mode: 0o600 }); }

async function openExternal(target: string) {
  if (!isExternalUrl(target)) {
    if (URL.parse(target)?.protocol === 'http:') await dialog.showMessageBox({ type: 'warning', message: '보안 연결(HTTPS)이 아닌 외부 주소는 열지 않습니다.', detail: new URL(target).hostname });
    return;
  }
  await shell.openExternal(target);
}

function createWindow() {
  window = new BrowserWindow({ width: 1280, height: 860, minWidth: 720, minHeight: 540, title: 'NextStep', icon: join(app.getAppPath(), 'assets/icon.png'), show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, partition: PARTITION } });
  const contents = window.webContents;
  contents.setWindowOpenHandler(({ url }) => { void openExternal(url); return { action: 'deny' }; });
  contents.on('will-navigate', (event, target) => {
    const google = googleLoginUrl(target, service);
    if (google) { event.preventDefault(); void shell.openExternal(google); return; }
    if (!isServiceNavigation(target, service)) { event.preventDefault(); void openExternal(target); }
  });
  contents.on('will-redirect', (event, target) => { if (!isServiceNavigation(target, service)) event.preventDefault(); });
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
    if (mainFrame && code !== -3) { status = '서비스에 연결하지 못함'; updateTray(); }
  });
  // 창 닫기는 숨기기다. 종료는 아이콘 메뉴의 '종료'로만 한다.
  window.on('close', event => { if (!quitting) { event.preventDefault(); window?.hide(); app.dock?.hide(); } });
  void window.loadURL(service.href);
}

function showWindow(path?: string) {
  if (!window) createWindow();
  if (path) void window!.loadURL(new URL(path, service).href);
  void app.dock?.show();
  window!.show();
  window!.focus();
}

async function refreshNow() {
  // 웹 화면과 같은 출처에서 요청해야 웹의 교차 출처 변경 차단을 통과한다.
  if (!window) createWindow();
  try {
    const code = await window!.webContents.executeJavaScript("fetch('/api/postings/refresh', { method: 'POST' }).then(r => r.status)") as number;
    status = code === 202 ? '가져오는 중' : code === 401 ? '로그인 필요' : `요청 실패(${code})`;
  } catch { status = '서비스에 연결하지 못함'; }
  updateTray();
}

async function poll() {
  try {
    const response = await session.fromPartition(PARTITION).fetch(new URL('/api/jobs/latest', service).href, { credentials: 'include', cache: 'no-store' });
    if (response.status === 401) { status = '로그인 필요'; return; }
    if (!response.ok) { status = '서비스 응답 오류'; return; }
    const latest = await response.json() as LatestRefresh;
    const job = latest.job;
    status = !job ? '아직 가져온 적 없음' : !job.finishedAt ? '가져오는 중' : `마지막: ${job.status} · ${new Date(job.finishedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    const settings = readSettings();
    // 처음 설치한 직후에는 지난 결과를 알리지 않고 기준만 잡는다. 그 뒤로는 꺼져 있던 동안 끝난 결과도 한 번 알린다.
    if (!settings) { writeSettings(job?.finishedAt ? { lastNotifiedId: job.id } : {}); return; }
    const next = noticeFor(latest, settings.lastNotifiedId);
    if (!next) return;
    writeSettings({ ...settings, lastNotifiedId: next.id });
    if (!Notification.isSupported()) return;
    notice = new Notification({ title: next.title, body: next.body, silent: false });
    notice.on('click', () => showWindow('/recommendations'));
    notice.show();
  } catch { status = '서비스에 연결하지 못함'; } finally { updateTray(); }
}

function updateTray() {
  if (!tray) return;
  const autoLaunch = app.getLoginItemSettings().openAtLogin;
  tray.setToolTip(`NextStep · ${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'NextStep 열기', click: () => showWindow() },
    { label: '지금 공고 가져오기', enabled: status !== '가져오는 중', click: () => void refreshNow() },
    { label: status, enabled: false },
    { type: 'separator' },
    { label: '로그인 시 자동 실행', type: 'checkbox', checked: autoLaunch, click: item => { app.setLoginItemSettings({ openAtLogin: item.checked }); updateTray(); } },
    { label: 'NextStep 종료', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  const mac = process.platform === 'darwin';
  const image = nativeImage.createFromPath(join(app.getAppPath(), mac ? 'assets/trayTemplate.png' : 'assets/tray.png'));
  if (mac) image.setTemplateImage(true);
  tray = new Tray(image);
  // Windows는 아이콘 클릭으로 창을 연다(메뉴는 오른쪽 클릭). macOS는 클릭하면 메뉴가 열린다.
  if (!mac) tray.on('click', () => showWindow());
  updateTray();
}

// 기본 브라우저의 구글 로그인이 끝나면 nextstep:// 주소로 앱이 열린다. 준비 전에 오면 준비된 뒤 처리한다.
let pendingLogin: string | undefined;
function openLoginLink(link: string | undefined) {
  const path = link && desktopLoginPath(link);
  if (!path) return;
  if (service) showWindow(path); else pendingLogin = path;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setAsDefaultProtocolClient('nextstep');
  app.on('open-url', (event, link) => { event.preventDefault(); openLoginLink(link); });
  // Windows는 이미 실행 중인 앱에 두 번째 실행의 인자로 주소가 온다.
  app.on('second-instance', (_event, argv) => { const link = argv.find(arg => arg.startsWith('nextstep://')); if (link) openLoginLink(link); else showWindow(); });
  void app.whenReady().then(() => {
    try { service = serviceUrl(process.env.NEXTSTEP_WEB_URL ?? readSettings()?.webUrl); } catch {
      dialog.showErrorBox('NextStep을 시작하지 못했습니다.', '서비스 주소를 확인하세요. 원격 주소는 HTTPS여야 합니다.');
      app.quit();
      return;
    }
    if (process.platform === 'win32') app.setAppUserModelId('com.nextstep.desktop');
    const partition = session.fromPartition(PARTITION);
    partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    partition.setPermissionCheckHandler(() => false);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'NextStep', submenu: [{ label: '창 닫기', role: 'close' }, { label: 'NextStep 종료', click: () => { quitting = true; app.quit(); } }] },
      { label: '편집', submenu: [{ role: 'undo', label: '실행 취소' }, { role: 'redo', label: '다시 실행' }, { type: 'separator' }, { role: 'cut', label: '잘라내기' }, { role: 'copy', label: '복사' }, { role: 'paste', label: '붙여넣기' }, { role: 'selectAll', label: '전체 선택' }] },
      { label: '보기', submenu: [{ role: 'reload', label: '새로고침' }] },
    ]));
    createTray();
    createWindow();
    // 로그인 시 자동 실행으로 켜졌으면 창 없이 아이콘만 둔다.
    openLoginLink(process.argv.find(arg => arg.startsWith('nextstep://')));
    if (pendingLogin) showWindow(pendingLogin);
    else if (!app.getLoginItemSettings().wasOpenedAtLogin) window!.once('ready-to-show', () => showWindow());
    else app.dock?.hide();
    void poll();
    setInterval(() => void poll(), POLL_MS);
  });
  app.on('activate', () => showWindow());
  app.on('before-quit', () => { quitting = true; });
  // 창이 모두 닫혀도(숨김) 아이콘으로 남는다.
  app.on('window-all-closed', () => undefined);
}
