'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, BriefcaseBusiness, Check, Inbox, LoaderCircle, Mail, Settings, Star } from 'lucide-react';
import { AppShell, NavItem, PageHeader, Rail, StatusBar } from '@nextstep/design-system';
import { latestRefreshSchema, mailConnectionSchema, reviewSchema, type Me } from '@nextstep/contracts';
import { call, RequestError } from './api-client';

const icon = 'size-icon-md shrink-0 stroke-icon';
const small = 'size-icon-sm shrink-0 stroke-icon';
const ACTIVE: string[] = ['대기', '실행중'];
const time = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 로그인 전 화면: 왼쪽 인디고 소개 면, 오른쪽 양식. 좁은 창에서는 소개 면을 위로 접는다. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="grid min-h-dvh bg-background text-foreground md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
    <aside className="flex flex-col justify-between gap-10 bg-primary px-10 py-10 text-primary-foreground md:px-16 md:py-16">
      <p className="flex items-center gap-2 text-title font-extrabold"><span aria-hidden="true" className="size-2.5 rotate-45 rounded-xs bg-primary-foreground" />NextStep</p>
      <div className="hidden md:block">
        <p className="text-display">마감 전에,<br />맞는 공고부터.</p>
        <p className="mt-3 text-body opacity-80">서류로 고르고, 메일로 따라가는 개인 지원 관리</p>
      </div>
      <p className="hidden text-body-sm opacity-80 md:block">초대받은 사람만 쓸 수 있어요</p>
    </aside>
    <main className="flex items-center justify-center px-6 py-12"><div className="grid w-full max-w-md gap-8">{children}</div></main>
  </div>;
}

/** 로그인 후 앱 틀: 왼쪽 아이콘 메뉴 · 화면 머리 · 하단 상태바(메일 확인과 공고 갱신 결과). */
export function Frame({ me, title, description, actions, children }: { me: Me; title: string; description: string; actions?: ReactNode; children: ReactNode }) {
  const path = usePathname();
  const reviews = useQuery({ queryKey: ['reviews', me.id], queryFn: async () => reviewSchema.array().parse(await call('reviews')), retry: false, refetchOnWindowFocus: false });
  const waiting = reviews.data?.filter(r => !r.held).length ?? 0;
  const items = [
    { href: '/recommendations', label: '추천', icon: <Star className={icon} aria-hidden="true" focusable="false" /> },
    { href: '/', label: '지원 현황', icon: <BriefcaseBusiness className={icon} aria-hidden="true" focusable="false" /> },
    { href: '/reviews', label: '확인 목록', icon: <Inbox className={icon} aria-hidden="true" focusable="false" />, count: waiting },
    { href: '/settings', label: '설정', icon: <Settings className={icon} aria-hidden="true" focusable="false" /> },
  ];
  return <AppShell
    rail={<Rail brand={<Link href="/recommendations" aria-label="NextStep 추천으로" className="grid size-9 place-items-center rounded-control bg-primary font-extrabold text-primary-foreground">N</Link>}>
      {items.map(item => <NavItem key={item.href} link={Link} href={item.href} icon={item.icon} label={item.label} current={path === item.href} {...(item.count ? { count: item.count } : {})} />)}
    </Rail>}
    status={<StatusBar start={<MailState me={me} />} end={<RefreshState me={me} />} />}>
    <PageHeader title={title} description={description} actions={actions} />
    <div className="min-h-0 flex-1 overflow-auto"><div className="mx-auto max-w-content px-7 py-6">{children}</div></div>
  </AppShell>;
}

function MailState({ me }: { me: Me }) {
  const mail = useQuery({
    queryKey: ['mail', 'connection', me.id], retry: false, refetchOnWindowFocus: false,
    queryFn: async () => { try { return mailConnectionSchema.parse(await call('mail/connection')); } catch (e) { if (e instanceof RequestError && e.status === 404) return null; throw e; } },
  });
  const text = mail.isPending ? '메일 확인 중' : mail.isError ? '메일 상태를 읽지 못함' : !mail.data ? '메일 연결 안 됨'
    : mail.data.status === '인증 실패' ? '네이버 메일 인증 실패' : `네이버 메일 · 마지막 확인 ${mail.data.lastSuccessAt ? time(mail.data.lastSuccessAt) : '없음'}`;
  return <><Mail className={small} aria-hidden="true" focusable="false" /><span className={mail.data?.status === '인증 실패' ? 'text-destructive' : undefined}>{text}</span></>;
}

/** 공고 갱신 결과. 처리 중이면 자주, 아니면 1분마다 다시 읽는다. 실패하면 설정의 연결 확인으로 안내한다. */
function RefreshState({ me }: { me: Me }) {
  const latest = useQuery({
    queryKey: ['jobs', 'latest', me.id], retry: false,
    queryFn: async () => latestRefreshSchema.parse(await call('jobs/latest')),
    refetchInterval: q => (q.state.data?.job && ACTIVE.includes(q.state.data.job.status) ? 3000 : 60_000),
  });
  const job = latest.data?.job;
  if (latest.isError) return <span className="text-destructive">갱신 결과를 읽지 못함</span>;
  if (!job) return <span>{latest.isPending ? '갱신 결과 확인 중' : '아직 공고를 가져온 적이 없어요'}</span>;
  if (ACTIVE.includes(job.status)) return <><LoaderCircle className={`${small} animate-spin motion-reduce:animate-none`} aria-hidden="true" focusable="false" /><span>공고 가져오는 중</span></>;
  const counts = latest.data?.counts;
  const failed = job.status === '실패' || job.status === '일부 실패';
  return <>
    {failed ? <AlertCircle className={`${small} text-destructive`} aria-hidden="true" focusable="false" /> : <Check className={`${small} text-success`} aria-hidden="true" focusable="false" />}
    <span className={failed ? 'text-destructive' : undefined}>공고 가져오기 {job.status === '성공' ? '끝' : job.status}{job.finishedAt ? ` · ${time(job.finishedAt)}` : ''}{counts ? ` · 기본 ${counts.basic} · 도전 ${counts.challenge}` : ''}</span>
    {/* 같은 화면에서도 구역이 바뀌도록 해시 이동은 일반 링크로 한다(Next 링크는 hashchange를 내지 않음). */}
    {failed ? <a href="/settings#status" className="font-bold text-primary">연결 확인</a> : null}
  </>;
}
