'use client';
import Link from 'next/link';
import { Button, buttonClass, StatePanel } from '@nextstep/design-system';

// 화면을 그리다 난 오류. 같은 화면을 다시 그려 보거나 처음 화면으로 돌아간다.
export default function ScreenError({ retry }: { error: Error; retry: () => void }) {
  return <div className="grid min-h-dvh place-items-center bg-background px-6">
    <div className="w-full max-w-md">
      <StatePanel tone="error" title="화면을 보여 주지 못했어요" description="잠시 뒤 다시 시도해 주세요. 계속되면 운영자에게 알려 주세요."
        actions={<><Button onClick={() => retry()}>다시 시도</Button><Link href="/" className={buttonClass('secondary')}>처음 화면으로</Link></>} />
    </div>
  </div>;
}
