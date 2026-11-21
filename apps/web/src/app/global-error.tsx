'use client';
import Link from 'next/link';
import { Button, buttonClass } from '@nextstep/design-system';
import { BOOT_SCRIPT } from './prefs';
import './globals.css';

// 최상위 틀(layout)에서 난 오류. 자기 html·body를 그리므로 테마·데스크톱 띠·글자 크기 스크립트를 다시 넣는다.
export default function GlobalError({ retry }: { error: Error; retry: () => void }) {
  return <html lang="ko" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} /></head>
    <body className="grid min-h-dvh place-items-center bg-background px-6 font-sans text-foreground">
      <title>NextStep</title>
      <div className="grid max-w-md gap-4 text-center">
        <h1 className="text-title font-extrabold">앱을 열지 못했어요</h1>
        <p className="text-body-sm text-muted-foreground">잠시 뒤 다시 시도해 주세요. 계속되면 운영자에게 알려 주세요.</p>
        <div className="flex justify-center gap-2"><Button onClick={() => retry()}>다시 시도</Button><Link href="/" className={buttonClass('secondary')}>처음 화면으로</Link></div>
      </div>
    </body>
  </html>;
}
