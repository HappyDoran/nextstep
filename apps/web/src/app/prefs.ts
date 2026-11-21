// 이 기기에만 저장하는 화면 설정(기획서 4절 사용 편의). 서버에 보내지 않는다.
// React를 가져오지 않아 서버 컴포넌트(layout의 첫 스크립트)도 키·값을 같이 쓴다. 화면은 usePrefs(api-client)로 읽는다.
export type Prefs = {
  startScreen: 'applications' | 'recommendations' | 'last';
  fontScale: 'sm' | 'md' | 'lg' | 'xl';
  timeFormat: 'absolute' | 'relative';
  /** 데스크톱 앱의 갱신 알림 조건. 데스크톱 앱이 창의 저장소에서 같은 키를 읽는다. */
  notify: 'all' | 'basic' | 'failures' | 'off';
  sound: boolean;
};
export const PREFS_KEY = 'nextstep:prefs';
export const LAST_PATH_KEY = 'nextstep:last-path';
export const FONT_SCALES: Record<Prefs['fontScale'], string> = { sm: '93.75%', md: '100%', lg: '112.5%', xl: '125%' };
const DEFAULTS: Prefs = { startScreen: 'applications', fontScale: 'md', timeFormat: 'absolute', notify: 'all', sound: true };

// 저장소가 막힌 환경(사생활 보호 창 등)에서도 기본값으로 그린다.
let raw: string | null = null;
let cached: Prefs = DEFAULTS;
const listeners = new Set<() => void>();
function load() {
  let next: string | null = null;
  try { next = localStorage.getItem(PREFS_KEY); } catch { /* 기본값 */ }
  if (next !== raw) {
    raw = next;
    try { cached = { ...DEFAULTS, ...(JSON.parse(next ?? '{}') as Partial<Prefs>) }; } catch { cached = DEFAULTS; }
  }
  return cached;
}
export const prefsStore = {
  get: load,
  server: () => DEFAULTS,
  subscribe(listener: () => void) {
    listeners.add(listener);
    // 다른 창(데스크톱 창·브라우저 탭)에서 바꾼 값도 따라간다.
    const onStorage = (e: StorageEvent) => { if (e.key === PREFS_KEY) listener(); };
    window.addEventListener('storage', onStorage);
    return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
  },
};
export function setPrefs(patch: Partial<Prefs>) {
  const next = { ...load(), ...patch };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* 저장 못 해도 이번 화면에는 적용 */ }
  raw = JSON.stringify(next);
  cached = next;
  document.documentElement.style.fontSize = FONT_SCALES[next.fontScale];
  for (const l of listeners) l();
}
/** 이 기기 설정 초기화: NextStep이 이 기기에 둔 값만 지운다(로그인은 서버 쿠키라 유지). */
export function resetDevice() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('nextstep:')) localStorage.removeItem(key);
    sessionStorage.clear();
  } catch { /* 지울 것이 없음 */ }
}

/** 시각 표기. 상대 표기는 7일이 넘으면 절대 표기로 바꾼다. */
export function formatWhen(iso: string, format: Prefs['timeFormat'], now = Date.now()) {
  const at = Date.parse(iso);
  const minutes = Math.round((now - at) / 60_000);
  if (format === 'relative' && minutes >= 0 && minutes < 7 * 24 * 60) {
    if (minutes < 1) return '방금';
    if (minutes < 60) return `${minutes}분 전`;
    if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}시간 전`;
    return `${Math.floor(minutes / 60 / 24)}일 전`;
  }
  return new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// 첫 그리기 전에 글자 크기를 적용하고, 앱을 처음 열 때(창 세션마다 한 번) 고른 시작 화면으로 옮긴다.
export const BOOT_SCRIPT = `try{var d=document.documentElement,p=JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)})||'{}'),f=${JSON.stringify(FONT_SCALES)}[p.fontScale];if(f)d.style.fontSize=f;if(location.pathname==='/'&&!location.search&&!location.hash&&!sessionStorage.getItem('nextstep:started')){sessionStorage.setItem('nextstep:started','1');var t=p.startScreen==='recommendations'?'/recommendations':p.startScreen==='last'?localStorage.getItem(${JSON.stringify(LAST_PATH_KEY)}):null;if(t&&t!=='/'&&t.charAt(0)==='/')location.replace(t)}}catch(e){}`;
