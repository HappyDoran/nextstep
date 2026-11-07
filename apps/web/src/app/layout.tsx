import type { Metadata } from 'next';
import { Providers } from './providers';
import './globals.css';
export const metadata: Metadata = { title: 'NextStep', description: '나의 다음 커리어를 준비하는 공간' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body><Providers>{children}</Providers></body></html>;
}
