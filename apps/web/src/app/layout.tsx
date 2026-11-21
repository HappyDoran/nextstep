import type { Metadata } from 'next';
import { Providers } from './providers';
import './globals.css';
import { BOOT_SCRIPT } from './prefs';
export const metadata: Metadata = { title: 'NextStep', description: '나의 다음 커리어를 준비하는 공간' };

// 테마는 운영체제 설정을 따른다(2026-11-19 결정). 첫 그리기 전에 정하고, 설정이 바뀌면 바로 따라간다.
// macOS 데스크톱 앱(Electron)은 제목 막대를 숨기고 창 단추를 화면 위에 띄우므로 그 자리를 비운다(globals.css).
const THEME = "(()=>{const d=document.documentElement,m=matchMedia('(prefers-color-scheme: dark)');const s=()=>{d.dataset.nsTheme=m.matches?'dark':'light'};s();m.addEventListener('change',s);if(/Electron/.test(navigator.userAgent)&&/Mac/.test(navigator.platform))d.dataset.nsDesktop='mac'})()";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 스크립트가 data-ns-theme를 바꾸므로 html 속성 차이 경고를 끈다.
  return <html lang="ko" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: `${THEME};${BOOT_SCRIPT}` }} /></head><body><Providers>{children}</Providers></body></html>;
}
