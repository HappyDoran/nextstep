'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, BriefcaseBusiness, Check, Inbox, LoaderCircle, Mail, Settings, Star } from 'lucide-react';
import { AppShell, NavItem, PageHeader, Rail, StatusBar } from '@nextstep/design-system';
import { latestRefreshSchema, mailConnectionSchema, reviewSchema, type Me } from '@nextstep/contracts';
import { call, RequestError } from './api-client';
import { Nav } from './nav';

const icon = 'size-icon-md shrink-0 stroke-icon';
const small = 'size-icon-sm shrink-0 stroke-icon';
const ACTIVE: string[] = ['대기', '실행중'];
const time = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 로그인 전 화면은 기존처럼 가운데 단과 위쪽 메뉴를 쓴다. */
export function LegacyLayout({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-content px-6 py-12 md:py-24"><Nav />{children}</main>;
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
    {failed ? <Link href="/settings" className="font-bold text-primary">연결 확인</Link> : null}
  </>;
}
