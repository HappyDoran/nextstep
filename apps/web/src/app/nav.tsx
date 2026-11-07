'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMe } from './api-client';

export function Nav() {
  const me = useMe();
  const path = usePathname();
  const items = [{ href: '/', label: me.data ? '지원 현황' : '로그인' }, ...(me.data ? [{ href: '/recommendations', label: '추천' }, { href: '/reviews', label: '확인 목록' }] : []), { href: '/settings', label: '설정' }];
  return <header className="mb-12 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
    <strong className="text-title-lg">NextStep<span className="text-primary">.</span></strong>
    <nav aria-label="주 메뉴" className="flex gap-2">
      {items.map(item => <Link key={item.href} href={item.href} aria-current={path === item.href ? 'page' : undefined}
        className={`min-h-control inline-flex items-center rounded-control px-4 text-body ${path === item.href ? 'bg-muted font-semibold' : 'text-muted-foreground'}`}>{item.label}</Link>)}
    </nav>
  </header>;
}
