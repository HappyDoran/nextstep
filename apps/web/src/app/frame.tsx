'use client';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, BriefcaseBusiness, Check, Inbox, LoaderCircle, LogOut, Mail, Settings, Star, WifiOff } from 'lucide-react';
import { AppShell, Logo, LogoMark, NavItem, PageHeader, Rail, StatusBar } from '@nextstep/design-system';
import { latestRefreshSchema, mailConnectionSchema, reviewSchema, type Me } from '@nextstep/contracts';
import { call, RequestError, useWhen } from './api-client';
import { LAST_PATH_KEY } from './prefs';
import { SettingsDialog, sectionFromHash, type Section } from './settings/settings';
import { useSignOut } from './account';

const icon = 'size-icon-md shrink-0 stroke-icon';
const small = 'size-icon-sm shrink-0 stroke-icon';
const ACTIVE: string[] = ['대기', '실행중'];
type Progress = { done: number; total: number; collected: number; etaSeconds: number | null };
/** 실행 중 갱신 작업의 진행 문구. 서버가 끝낸 출처 묶음 수와 남은 시간 어림을 적어 둔다. */
export function progressText(result: Record<string, unknown> | null) {
  const p = result?.progress as Progress | undefined;
  if (!p) return '공고 가져오는 중';
  const eta = p.etaSeconds === null ? '남은 시간 계산 중' : p.etaSeconds < 60 ? '1분 안에 끝남' : `약 ${Math.round(p.etaSeconds / 60)}분 남음`;
  return `공고 가져오는 중 · 출처 ${p.done}/${p.total} · 공고 ${p.collected}건 확인 · ${eta}`;
}

/** 로그인 전 화면: 왼쪽 인디고 소개 면, 오른쪽 양식. 좁은 창에서는 소개 면을 위로 접는다. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="grid min-h-dvh bg-background text-foreground md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
    <aside className="flex flex-col justify-between gap-10 bg-primary px-10 py-10 text-primary-foreground md:px-16 md:py-16 [[data-ns-theme=dark]_&]:bg-secondary [[data-ns-theme=dark]_&]:text-secondary-foreground">
      <Logo inverse />
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
  // 설정 창: 주소 #settings-<구역>을 따라 열고 닫는다(메뉴·상태바 링크는 해시만 바꾼다).
  const [settings, setSettings] = useState<Section | null>(null);
  useEffect(() => {
    const read = () => setSettings(sectionFromHash(window.location.hash));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const showSettings = (s: Section | null) => { setSettings(s); window.history.replaceState(null, '', s ? `#settings-${s}` : window.location.pathname + window.location.search); };
  const reviews = useQuery({ queryKey: ['reviews', me.id], queryFn: async () => reviewSchema.array().parse(await call('reviews')), retry: false, refetchOnWindowFocus: false });
  const waiting = reviews.data?.filter(r => !r.held).length ?? 0;
  // 창 제목(데스크톱 앱 창·브라우저 탭)에 확인 목록 대기 건수를 붙인다.
  useEffect(() => { document.title = `${waiting ? `(${waiting}) ` : ''}${title} · NextStep`; }, [waiting, title]);
  const online = useOnline();
  // 시작 화면 '마지막으로 본 화면'용. 앱 틀이 있는 화면만 적는다.
  useEffect(() => { try { localStorage.setItem(LAST_PATH_KEY, path); } catch { /* 저장 못 함 */ } }, [path]);
  const items = [
    { href: '/recommendations', label: '추천', icon: <Star className={icon} aria-hidden="true" focusable="false" /> },
    { href: '/', label: '지원 현황', icon: <BriefcaseBusiness className={icon} aria-hidden="true" focusable="false" /> },
    { href: '/reviews', label: '확인 목록', icon: <Inbox className={icon} aria-hidden="true" focusable="false" />, count: waiting },
    { href: '#settings', label: '설정', icon: <Settings className={icon} aria-hidden="true" focusable="false" /> },
  ];
  return <AppShell
    rail={<Rail footer={<AccountMenu me={me} />} brand={<Link href="/recommendations" aria-label="NextStep 추천으로" className="block rounded-control"><LogoMark /></Link>}>
      {items.map(item => <NavItem key={item.href} {...(item.href.startsWith('#') ? {} : { link: Link })} href={item.href} icon={item.icon} label={item.label} current={item.href.startsWith('#') ? settings !== null : settings === null && path === item.href} {...(item.count ? { count: item.count } : {})} />)}
    </Rail>}
    status={<StatusBar start={<MailState me={me} />} end={<RefreshState me={me} />} />}>
    {!online && <p role="status" className="flex items-center gap-2 bg-warning-muted px-7 py-2 text-body-sm font-semibold text-warning"><WifiOff className={small} aria-hidden="true" focusable="false" />인터넷 연결이 끊겼어요. 다시 연결되면 자동으로 이어서 불러와요.</p>}
    <PageHeader title={title} description={description} actions={actions} />
    {settings && <SettingsDialog me={me} section={settings} onSection={showSettings} onClose={() => showSettings(null)} />}
    <div className="min-h-0 flex-1 overflow-auto"><div className="mx-auto max-w-content px-7 py-6">{children}</div></div>
  </AppShell>;
}

// 브라우저의 온라인 상태(이벤트로만 바뀐다, 따로 묻지 않음). 서버 렌더링에서는 온라인으로 본다.
const subscribeOnline = (notify: () => void) => { window.addEventListener('online', notify); window.addEventListener('offline', notify); return () => { window.removeEventListener('online', notify); window.removeEventListener('offline', notify); }; };
const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

/** 왼쪽 메뉴 맨 아래 계정 메뉴: 로그인한 이메일·설정·로그아웃. 브라우저 기본 팝오버라 바깥을 누르거나 Esc로 닫힌다. */
function AccountMenu({ me }: { me: Me }) {
  const signOut = useSignOut();
  const hide = () => document.getElementById('account-menu')?.hidePopover();
  const item = 'flex h-control w-full cursor-pointer items-center gap-2.5 rounded-control px-3 text-left text-body-sm text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-focus focus-visible:outline-ring';
  return <>
    <button type="button" popoverTarget="account-menu" aria-label={`계정 메뉴 (${me.email})`} className="grid size-9 cursor-pointer place-items-center rounded-full bg-secondary text-body-sm font-bold uppercase text-secondary-foreground focus-visible:outline focus-visible:outline-focus focus-visible:outline-ring focus-visible:outline-offset-focus">{me.email[0]}</button>
    <div id="account-menu" popover="auto" className="fixed inset-auto bottom-12 left-[calc(var(--ns-rail-width)+0.5rem)] m-0 w-64 rounded-surface border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
      <p className="truncate px-3 pb-2 pt-1.5 text-caption text-muted-foreground">{me.email}</p>
      <a href="#settings" onClick={hide} className={`${item} no-underline`}><Settings className={small} aria-hidden="true" focusable="false" />설정</a>
      <div className="my-1 border-t border-border" />
      <button type="button" disabled={signOut.isPending} onClick={() => signOut.mutate()} className={item}><LogOut className={small} aria-hidden="true" focusable="false" />로그아웃</button>
      {signOut.isError && <p role="alert" className="px-3 py-1 text-caption text-destructive">{signOut.error.message}</p>}
    </div>
  </>;
}

function MailState({ me }: { me: Me }) {
  const time = useWhen();
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
  const time = useWhen();
  const latest = useQuery({
    queryKey: ['jobs', 'latest', me.id], retry: false,
    queryFn: async () => latestRefreshSchema.parse(await call('jobs/latest')),
    refetchInterval: q => (q.state.data?.job && ACTIVE.includes(q.state.data.job.status) ? 3000 : 60_000),
  });
  const job = latest.data?.job;
  if (latest.isError) return <span className="text-destructive">갱신 결과를 읽지 못함</span>;
  if (!job) return <span>{latest.isPending ? '갱신 결과 확인 중' : '아직 공고를 가져온 적이 없어요'}</span>;
  if (ACTIVE.includes(job.status)) {
    const p = job.result?.progress as Progress | undefined;
    return <><LoaderCircle className={`${small} animate-spin motion-reduce:animate-none`} aria-hidden="true" focusable="false" /><span>{job.status === '대기' ? '공고 가져오기 대기 중' : progressText(job.result)}</span>
      {p && p.total > 0 && <progress value={p.done} max={p.total} aria-label="공고 가져오기 진행" className="h-1.5 w-28 overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary" />}</>;
  }
  const counts = latest.data?.counts;
  const failed = job.status === '실패' || job.status === '일부 실패';
  return <>
    {failed ? <AlertCircle className={`${small} text-destructive`} aria-hidden="true" focusable="false" /> : <Check className={`${small} text-success`} aria-hidden="true" focusable="false" />}
    <span className={failed ? 'text-destructive' : undefined}>공고 가져오기 {job.status === '성공' ? '끝' : job.status}{job.finishedAt ? ` · ${time(job.finishedAt)}` : ''}{counts ? ` · 기본 ${counts.basic} · 도전 ${counts.challenge}` : ''}</span>
    {/* 같은 화면에서도 구역이 바뀌도록 해시 이동은 일반 링크로 한다(Next 링크는 hashchange를 내지 않음). */}
    {failed ? <a href="#settings-status" className="font-bold text-primary">연결 확인</a> : null}
  </>;
}
