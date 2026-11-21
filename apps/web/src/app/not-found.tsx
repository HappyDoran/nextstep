'use client';
import Link from 'next/link';
import { buttonClass, StatePanel } from '@nextstep/design-system';
import { AuthLayout } from './frame';

// 없는 주소. 로그인 여부와 상관없이 첫 화면으로 돌아가게 한다.
export default function NotFound() {
  return <AuthLayout>
    <StatePanel title="찾는 화면이 없어요" description="주소가 바뀌었거나 없는 화면이에요." actions={<Link href="/" className={buttonClass('secondary')}>처음 화면으로</Link>} />
  </AuthLayout>;
}
