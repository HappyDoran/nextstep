import type { Metadata } from 'next';
import { Providers } from './providers';
import './globals.css';
import { BOOT_SCRIPT } from './prefs';
export const metadata: Metadata = { title: 'NextStep', description: '나의 다음 커리어를 준비하는 공간' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 첫 스크립트(prefs.ts)가 테마·글자 크기·데스크톱 표시를 html에 붙이므로 속성 차이 경고를 끈다.
  return <html lang="ko" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} /></head><body><Providers>{children}</Providers></body></html>;
}
