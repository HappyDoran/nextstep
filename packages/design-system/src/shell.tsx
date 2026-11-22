import type { ComponentType, PropsWithChildren, ReactNode } from 'react';

import { focus } from './controls.js';

/** 앱 틀: 왼쪽 아이콘 메뉴 · 화면(머리+본문) · 하단 상태바. */
export function AppShell({ rail, status, children }: PropsWithChildren<{ rail: ReactNode; status: ReactNode }>) {
  return <div className="grid h-dvh grid-cols-[var(--ns-rail-width)_1fr] grid-rows-[1fr_var(--ns-statusbar-height)] bg-background text-foreground">
    {rail}
    <main className="flex min-h-0 min-w-0 flex-col">{children}</main>
    {status}
  </div>;
}
export function Rail({ brand, footer, children }: PropsWithChildren<{ brand: ReactNode; footer?: ReactNode }>) {
  return <nav aria-label="주 메뉴" className="flex w-rail flex-col items-center gap-1 border-r border-border bg-card py-4">
    <div className="mb-4">{brand}</div>
    {children}
    <div className="flex-1" />
    {footer}
  </nav>;
}
type LinkLike = ComponentType<{ href: string; className: string; 'aria-current'?: 'page'; children: ReactNode }>;
/** 메뉴 항목. Next.js Link 같은 링크 컴포넌트를 link로 넘길 수 있다. count는 대기 건수 표시. */
export function NavItem({ href, icon, label, count, current, link: Link = 'a' as unknown as LinkLike }: { href: string; icon: ReactNode; label: string; count?: number; current?: boolean; link?: LinkLike }) {
  return <Link href={href} {...(current ? { 'aria-current': 'page' as const } : {})} className={`relative flex w-16 flex-col items-center gap-1 rounded-xl pb-1.5 pt-2 text-micro transition-colors duration-fast motion-reduce:transition-none ${current ? 'bg-secondary font-bold text-secondary-foreground' : 'text-muted-foreground hover:bg-muted'} ${focus}`}>
    {icon}{label}
    {count ? <span className="absolute right-2 top-0.5 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-primary px-1 text-micro font-bold tabular-nums text-primary-foreground" aria-label={`대기 ${count}건`}>{count}</span> : null}
  </Link>;
}
/** 화면 머리: 제목 | 한 줄 설명, 오른쪽에 주 버튼. */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <header className="flex h-header shrink-0 items-center gap-3.5 border-b border-border bg-card px-7">
    <h1 className="text-body-lg font-extrabold">{title}</h1>
    {description ? <p className="border-l border-border-strong pl-3.5 text-body-sm text-muted-foreground">{description}</p> : null}
    {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
  </header>;
}
/** 하단 상태바. 왼쪽은 메일 확인, 오른쪽은 공고 갱신 결과·연결 문제를 둔다. */
export function StatusBar({ start, end }: { start?: ReactNode; end?: ReactNode }) {
  return <footer className="col-span-full flex items-center gap-2.5 border-t border-border bg-card px-5 text-caption text-muted-foreground">
    {start}
    {/* 1분마다 바뀌는 요약이라 role="status"로 읽어 주지 않는다. 화면의 처리 결과는 각 화면이 알린다. */}
    <div className="ml-auto flex items-center gap-2.5">{end}</div>
  </footer>;
}
