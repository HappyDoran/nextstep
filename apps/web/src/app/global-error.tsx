'use client';
import Link from 'next/link';
import './globals.css';

// 최상위 틀(layout)에서 난 오류. 자기 html·body를 그리며, 테마는 운영체제 설정을 따른다(globals의 기본 토큰).
export default function GlobalError({ retry }: { error: Error; retry: () => void }) {
  return <html lang="ko"><body className="grid min-h-dvh place-items-center bg-background px-6 font-sans text-foreground">
    <title>NextStep</title>
    <div className="grid max-w-md gap-4 text-center">
      <h1 className="text-title font-extrabold">앱을 열지 못했어요</h1>
      <p className="text-body-sm text-muted-foreground">잠시 뒤 다시 시도해 주세요. 계속되면 운영자에게 알려 주세요.</p>
      <div className="flex justify-center gap-2">
        <button type="button" onClick={() => retry()} className="h-control cursor-pointer rounded-control bg-primary px-4 text-body-sm font-semibold text-primary-foreground">다시 시도</button>
        <Link href="/" className="inline-flex h-control items-center rounded-control border border-border-strong px-4 text-body-sm font-semibold text-foreground no-underline">처음 화면으로</Link>
      </div>
    </div>
  </body></html>;
}
