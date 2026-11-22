import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, Notification, session, shell, Tray } from 'electron';
import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serviceUrl, isServiceNavigation, isExternalUrl, googleLoginUrl, desktopLoginPath } from './security.js';
import { noticeFor, wanted, type LatestRefresh, type NotifyPrefs } from './notify.js';

// 상주 앱: 창은 홈서버 웹을 그대로 열고, 창을 닫아도 메뉴 막대(macOS)·알림 영역(Windows) 아이콘으로 남아
// 서버의 마지막 공고 갱신 결과를 1분마다 확인해 OS 알림을 보낸다. 서버 작업은 서버가 한다(기술 설계 E절).
const POLL_MS = 60_000;
const mac = process.platform === 'darwin';
const PARTITION = 'persist:nextstep';
// 설치 앱의 기본 서비스 주소(홈서버 Tailscale HTTPS). 개발 실행(pnpm dev)은 같은 컴퓨터의 개발 서버가 기본이다.
const HOME_SERVER = 'https://doran-server.tail70f0b3.ts.net';
type Settings = { webUrl?: string; lastNotifiedId?: string };

let service: URL;
let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let status = '확인 전';
let notice: Notification | undefined; // 클릭 처리기가 수거되지 않게 붙잡아 둔다.
let loginNonce: string | undefined; // 진행 중인 구글 로그인의 임의 값(앱을 끄면 사라진다).
let loadFailed = false; // 마지막 화면 불러오기가 실패해 창이 오류 페이지에 있다(오류 페이지에서도 getURL은 원래 주소라 따로 적는다).

const settingsPath = () => join(app.getPath('userData'), 'settings.json');
function readSettings(): Settings | undefined {
  try { return JSON.parse(readFileSync(settingsPath(), 'utf8')) as Settings; } catch { return undefined; }
}
// 쓰는 중에 앱이 꺼져도 파일이 반쯤 남지 않게 임시 파일에 쓴 뒤 바꿔 넣는다(깨지면 서비스 주소를 잃는다).
function writeSettings(next: Settings) { const path = settingsPath(); writeFileSync(`${path}.tmp`, JSON.stringify(next), { mode: 0o600 }); renameSync(`${path}.tmp`, path); }

async function openExternal(target: string) {
  if (!isExternalUrl(target)) {
    if (URL.parse(target)?.protocol === 'http:') await dialog.showMessageBox({ type: 'warning', message: '보안 연결(HTTPS)이 아닌 외부 주소는 열지 않습니다.', detail: new URL(target).hostname });
    return;
  }
  await shell.openExternal(target);
}

function createWindow() {
  // macOS는 제목 막대를 숨기고 창 단추를 웹이 비워 둔 맨 위 띠(2rem) 안에 띄운다. 띠를 끌어 창을 옮긴다(globals.css).
  window = new BrowserWindow({ width: 1280, height: 860, minWidth: 720, minHeight: 540, title: 'NextStep', icon: join(app.getAppPath(), 'assets/icon.png'), show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1e1b' : '#ffffff', // 웹이 그리기 전 맨 위 띠와 같은 색(card)
    ...(mac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 10 } } : {}),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, partition: PARTITION } });
  const contents = window.webContents;
  contents.setWindowOpenHandler(({ url }) => { void openExternal(url); return { action: 'deny' }; });
  contents.on('will-navigate', (event, target) => {
    const nonce = randomBytes(32).toString('base64url');
    const google = googleLoginUrl(target, service, nonce);
    if (google) { event.preventDefault(); loginNonce = nonce; void shell.openExternal(google); return; }
    if (!isServiceNavigation(target, service)) { event.preventDefault(); void openExternal(target); }
  });
  // 창 안 iframe의 이동도 서비스 출처 밖이면 막는다(will-navigate는 주 화면만 본다).
  contents.on('will-frame-navigate', details => { if (!details.isMainFrame && !isServiceNavigation(details.url, service)) details.preventDefault(); });
  contents.on('will-redirect', (event, target) => { if (!isServiceNavigation(target, service)) event.preventDefault(); });
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('did-finish-load', () => { if (loadFailed) return; void poll(); });
  contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
    if (!mainFrame || code === -3) return;
    loadFailed = true;
    status = '서비스에 연결하지 못함';
    updateTray();
    // 빈 창만 남지 않게 이유를 알린다(초대 사용자는 Tailscale 연결이 먼저다).
    // 창에 붙인다: 창 없는 대화상자는 macOS에서 앱 전체를 멈춰 1분 조회(다시 열기)까지 막는다.
    if (window && (window.isVisible() || !app.getLoginItemSettings().wasOpenedAtLogin)) void dialog.showMessageBox(window, { type: 'warning', message: '서비스에 연결하지 못했습니다.', detail: `${service.host}에 연결되지 않습니다. Tailscale 연결을 확인한 뒤 보기 > 새로고침을 누르세요.` });
  });
  // 창 닫기는 숨기기다. 종료는 아이콘 메뉴의 '종료'로만 한다.
  window.on('close', event => { if (!quitting) { event.preventDefault(); window?.hide(); app.dock?.hide(); } });
  void window.loadURL(service.href);
}

// 로드가 실패하면(로그인 직후 Tailscale 연결 전 등) 창은 오류 페이지에 남는다. 불러오는 중이 아니면 다시 연다.
// 성공하면 did-finish-load가 바로 결과를 다시 읽는다.
function reloadIfOffService() {
  if (!loadFailed || window!.webContents.isLoading()) return loadFailed;
  loadFailed = false;
  window!.loadURL(service.href).catch(() => undefined);
  return true;
}

function showWindow(path?: string) {
  if (!window) createWindow();
  if (path) void window!.loadURL(new URL(path, service).href);
  else reloadIfOffService();
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

// 마지막 갱신 결과는 창의 웹 페이지에서 같은 출처로 읽는다. 화면이 보는 로그인 쿠키(SameSite=Lax)를 그대로 써서
// 창에서 로그인했는데 아이콘 메뉴만 '로그인 필요'로 남는 일이 없게 한다.
let pollSeq = 0;
async function poll() {
  if (!window) createWindow();
  // 로그아웃 직후 조회와 1분 주기 조회가 겹치면 늦게 끝난 옛 결과가 새 상태를 덮지 않게 마지막 조회만 반영한다.
  const seq = ++pollSeq;
  if (reloadIfOffService()) { status = '서비스에 연결하지 못함'; updateTray(); return; }
  try {
    // 알림 조건·소리는 웹 설정 일반 구역이 같은 창의 저장소(nextstep:prefs)에 둔다.
    const { code, body, prefs } = await window!.webContents.executeJavaScript("fetch('/api/jobs/latest', { cache: 'no-store' }).then(async r => ({ code: r.status, body: r.ok ? await r.json() : null, prefs: localStorage.getItem('nextstep:prefs') }))") as { code: number; body: LatestRefresh | null; prefs: string | null };
    if (seq !== pollSeq) return;
    if (code === 401) { status = '로그인 필요'; return; }
    if (!body) { status = '서비스 응답 오류'; return; }
    const job = body.job;
    status = !job ? '아직 가져온 적 없음' : !job.finishedAt ? '가져오는 중' : `마지막: ${job.status} · ${new Date(job.finishedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    const settings = readSettings();
    // 처음 설치한 직후에는 지난 결과를 알리지 않고 기준만 잡는다. 그 뒤로는 꺼져 있던 동안 끝난 결과도 한 번 알린다.
    if (!settings) { writeSettings(job?.finishedAt ? { lastNotifiedId: job.id } : {}); return; }
    const next = noticeFor(body, settings.lastNotifiedId);
    if (!next) return;
    writeSettings({ ...settings, lastNotifiedId: next.id });
    let chosen: NotifyPrefs = {};
    try { const saved = JSON.parse(prefs ?? '{}') as unknown; if (saved && typeof saved === 'object') chosen = saved as NotifyPrefs; } catch { /* 기본값: 모두 알림 */ }
    if (!wanted(next, chosen) || !Notification.isSupported()) return;
    notice = new Notification({ title: next.title, body: next.body, silent: chosen.sound === false });
    notice.on('click', () => showWindow('/recommendations'));
    notice.show();
  } catch { if (seq === pollSeq) status = '서비스에 연결하지 못함'; } finally { updateTray(); }
}

function testNotice() {
  notice = new Notification({ title: 'NextStep 알림 확인', body: '이 알림이 보이면 갱신 알림을 받을 수 있어요.' });
  notice.show();
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(`NextStep · ${status}`);
  // 로그인 전이면 가져오기 대신 로그인으로 안내하고, 상태 줄은 쓸 수 있는 결과가 있을 때만 보여 준다.
  const signedOut = status === '로그인 필요';
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: signedOut ? 'NextStep에 로그인' : 'NextStep 열기', click: () => showWindow() },
    ...(signedOut ? [] : [
      { label: '지금 공고 가져오기', enabled: status !== '가져오는 중', click: () => void refreshNow() },
      { label: status, enabled: false },
    ]),
    { type: 'separator' },
    // OS 알림 권한은 앱이 읽을 수 없어, 직접 보내 보고 꺼져 있으면 시스템 설정의 이 앱 알림 화면으로 바로 간다.
    { label: '테스트 알림 보내기', click: testNotice },
    { label: '알림 설정 열기', click: () => void shell.openExternal(mac ? 'x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=com.nextstep.desktop' : 'ms-settings:notifications') },
    { type: 'separator' },
    { label: '로그인 시 자동 실행', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: item => { app.setLoginItemSettings({ openAtLogin: item.checked }); updateTray(); } },
    { label: 'NextStep 종료', role: 'quit' },
  ]));
}

function createTray() {
  const image = nativeImage.createFromPath(join(app.getAppPath(), mac ? 'assets/trayTemplate.png' : 'assets/tray.png'));
  if (mac) image.setTemplateImage(true);
  tray = new Tray(image);
  // Windows는 아이콘 클릭으로 창을 연다(메뉴는 오른쪽 클릭). macOS는 클릭하면 메뉴가 열린다.
  if (!mac) tray.on('click', () => showWindow());
  updateTray();
}

// 기본 브라우저의 구글 로그인이 끝나면 nextstep:// 주소로 앱이 열린다. 준비 전에 오면 준비된 뒤 처리한다.
// 이 앱이 시작한 로그인의 임의 값(메모리에만, 1회)이 없으면 무시한다: 남이 보낸 코드로 이 앱이 남의 계정에 로그인되지 않게 한다.
let pendingLogin: string | undefined;
function openLoginLink(link: string | undefined) {
  const path = link && loginNonce && desktopLoginPath(link, loginNonce);
  if (!path) return;
  loginNonce = undefined;
  if (service) showWindow(path); else pendingLogin = path;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setAsDefaultProtocolClient('nextstep');
  app.on('open-url', (event, link) => { event.preventDefault(); openLoginLink(link); });
  // Windows는 이미 실행 중인 앱에 두 번째 실행의 인자로 주소가 온다.
  app.on('second-instance', (_event, argv) => { const link = argv.find(arg => arg.startsWith('nextstep://')); if (link) openLoginLink(link); else showWindow(); });
  void app.whenReady().then(() => {
    try { service = serviceUrl(process.env.NEXTSTEP_WEB_URL ?? readSettings()?.webUrl ?? (app.isPackaged ? HOME_SERVER : undefined)); } catch {
      dialog.showErrorBox('NextStep을 시작하지 못했습니다.', '서비스 주소를 확인하세요. 원격 주소는 HTTPS여야 합니다.');
      app.quit();
      return;
    }
    if (process.platform === 'win32') app.setAppUserModelId('com.nextstep.desktop');
    const partition = session.fromPartition(PARTITION);
    partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    partition.setPermissionCheckHandler(() => false);
    // 로그인·로그아웃·계정 삭제는 페이지를 다시 불러오지 않는 화면 안 전환이다. 그 요청이 끝나면 아이콘 메뉴 상태를 바로 다시 읽는다
    // (macOS에서 아이콘을 눌러도 창이 포커스를 잃지 않아 창 이벤트로는 알 수 없다). 포트는 패턴에서 생략하면 모두 맞는다.
    const api = `${service.protocol}//${service.hostname}/api`;
    partition.webRequest.onCompleted({ urls: [`${api}/auth/*`, `${api}/account`] }, details => {
      if (details.method !== 'GET' && !loadFailed) void poll();
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'NextStep', submenu: [{ label: '창 닫기', role: 'close' }, { label: 'NextStep 종료', role: 'quit' }] },
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
    // 첫 조회는 창 화면을 다 불러온 뒤(did-finish-load) 한다. 두 조회가 겹쳐 같은 결과를 두 번 알리지 않게.
    setInterval(() => void poll(), POLL_MS);
  });
  app.on('activate', () => showWindow());
  app.on('before-quit', () => { quitting = true; });
  // 창이 모두 닫혀도(숨김) 아이콘으로 남는다.
  app.on('window-all-closed', () => undefined);
}
