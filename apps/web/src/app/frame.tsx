'use client';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, BriefcaseBusiness, Check, Inbox, LoaderCircle, LogOut, Mail, Settings, Star, WifiOff } from 'lucide-react';
import { AppShell, Button, Logo, LogoMark, NavItem, PageHeader, Rail, RowList, Row, Skeleton, StatusBar, Toast, ToastRegion, toastAction } from '@nextstep/design-system';
import { latestRefreshSchema, reviewSchema, type Me } from '@nextstep/contracts';
import { ACTIVE_JOB, call, noticeKey, useDraftNotice, useMailConnection, useProfileDraft, useWhen } from './api-client';
import { LAST_PATH_KEY } from './prefs';
import { SettingsDialog, sectionFromHash, type Section } from './settings/settings';
import { useSignOut } from './account';

const icon = 'size-icon-md shrink-0 stroke-icon';
const small = 'size-icon-sm shrink-0 stroke-icon';
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

/**
 * 로그인 확인을 기다리는 화면. 지난번에 로그인해 있었으면(첫 그리기 전 data-ns-signed-in) 앱 틀 모양, 아니면 로그인 양식 모양의 스켈레톤을 보인다.
 * 서버 렌더링과 같은 마크업을 두고 CSS로만 고르므로 hydration이 어긋나지 않는다.
 */
export function LoadingScreen() {
  const bar = (w: string) => <Skeleton className={`h-3 ${w}`} />;
  return <>
    <p role="status" className="sr-only">불러오고 있습니다.</p>
    <div className="hidden [[data-ns-signed-in]_&]:block">
      <AppShell
        rail={<Rail brand={<LogoMark />}>{[0, 1, 2, 3].map(i => <div key={i} className="grid w-16 justify-items-center gap-1.5 pb-1.5 pt-2"><Skeleton className="size-5 rounded-md" />{bar('w-9')}</div>)}</Rail>}
        status={<StatusBar start={bar('w-40')} end={bar('w-56')} />}>
        <PageHeader title={<Skeleton className="h-5 w-24" />} />
        <div className="mx-auto w-full max-w-content px-7 py-6">
          <RowList>{[0, 1, 2, 3, 4].map(i => <Row key={i} className="grid-cols-[1fr_10rem]"><div className="grid gap-2">{bar('w-1/3')}{bar('w-1/2')}</div>{bar('w-full')}</Row>)}</RowList>
        </div>
      </AppShell>
    </div>
    <div className="[[data-ns-signed-in]_&]:hidden">
      <AuthLayout><div className="grid gap-3">{bar('h-7 w-48')}{bar('w-full')}</div><Skeleton className="h-control w-full rounded-control" /></AuthLayout>
    </div>
  </>;
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
  const reviews = useQuery({ queryKey: ['reviews', me.id], queryFn: async () => reviewSchema.array().parse(await call('reviews')), retry: false, refetchOnWindowFocus: false, refetchInterval: 60_000 });
  const waiting = reviews.data?.filter(r => !r.held).length ?? 0;
  // 창 제목(데스크톱 앱 창·브라우저 탭)에 확인 목록 대기 건수를 붙인다.
  useEffect(() => {
    document.title = `${waiting ? `(${waiting}) ` : ''}${title} · NextStep`;
    return () => { document.title = 'NextStep'; };
  }, [waiting, title]);
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
    <LoadBar />
    {!online && <p role="status" className="flex items-center gap-2 bg-warning-muted px-7 py-2 text-body-sm font-semibold text-warning"><WifiOff className={small} aria-hidden="true" focusable="false" />인터넷 연결이 끊겼어요. 다시 연결되면 자동으로 이어서 불러와요.</p>}
    <PageHeader title={title} description={description} actions={actions} />
    {settings && <SettingsDialog me={me} section={settings} onSection={showSettings} onClose={() => showSettings(null)} />}
    <DraftNotice me={me} hidden={settings === 'profile'} onOpen={() => showSettings('profile')} />
    <div className="min-h-0 flex-1 overflow-auto"><div className="mx-auto max-w-content animate-rise px-7 py-6 motion-reduce:animate-none">{children}</div></div>
  </AppShell>;
}

// 프로필 초안이 끝나면 어느 화면에서든 아래에 알린다. 프로필 구역을 보고 있으면 거기서 바로 보이므로 띄우지 않는다.
function DraftNotice({ me, hidden, onOpen }: { me: Me; hidden: boolean; onOpen: () => void }) {
  const client = useQueryClient();
  const draft = useProfileDraft(me).data;
  const notice = useDraftNotice(me).data;
  // 알림 영역(role=status)은 늘 두고 안의 내용만 바꿔야 화면 낭독기가 새 알림을 읽는다.
  if (hidden || !notice || draft?.id !== notice) return <ToastRegion className="bottom-24" />;
  const close = () => client.setQueryData(noticeKey(me), null);
  // 지원 현황의 되돌리기 알림과 겹치지 않게 한 줄 위에 둔다.
  return <ToastRegion className="bottom-24">
    <Toast action={<span className="flex">
      <Button size="sm" variant="quiet" className={toastAction} onClick={() => { close(); onOpen(); }}>{draft.status === '성공' ? '확인하고 저장' : '확인하기'}</Button>
      <Button size="sm" variant="quiet" className={`${toastAction} opacity-70`} aria-label="알림 닫기" onClick={close}>닫기</Button>
    </span>}>{draft.status === '성공' ? '프로필 초안이 준비됐어요' : '프로필 초안을 만들지 못했어요'}</Toast>
  </ToastRegion>;
}

// 처음 불러오는 자료가 있으면 화면 맨 위에 가는 진행 막대를 보인다. 주기 조회·다시 읽기(이미 값이 있음)에는 보이지 않는다.
function LoadBar() {
  const loading = useIsFetching({ predicate: query => query.state.status === 'pending' }) > 0;
  if (!loading) return null;
  return <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 animate-fade-late overflow-hidden">
    <div className="h-full w-2/5 animate-sweep bg-primary motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40" />
  </div>;
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
    <div id="account-menu" popover="auto" className="fixed inset-auto bottom-12 left-[calc(var(--ns-rail-width)+0.5rem)] m-0 w-64 origin-bottom-left [&:popover-open]:animate-pop motion-reduce:[&:popover-open]:animate-fade rounded-surface border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
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
  const mail = useMailConnection(me);
  const text = mail.isPending ? '메일 확인 중' : mail.isError ? '메일 상태를 읽지 못함' : !mail.data ? '메일 연결 안 됨'
    : mail.data.status === '인증 실패' ? '네이버 메일 인증 실패' : `네이버 메일 · 마지막 확인 ${mail.data.lastSuccessAt ? time(mail.data.lastSuccessAt) : '없음'}`;
  return <><Mail className={small} aria-hidden="true" focusable="false" /><span className={mail.data?.status === '인증 실패' ? 'text-destructive' : undefined}>{text}</span></>;
}

/** 마지막 공고 갱신 작업. 처리 중이면 자주, 아니면 1분마다 다시 읽는다(상태바·추천 화면이 같은 캐시를 쓴다). */
export const useLatestRefresh = (me: Me) => useQuery({
  queryKey: ['jobs', 'latest', me.id], retry: false,
  queryFn: async () => latestRefreshSchema.parse(await call('jobs/latest')),
  refetchInterval: q => (q.state.data?.job && ACTIVE_JOB.includes(q.state.data.job.status) ? 3000 : 60_000),
});

/** 공고 갱신 결과. 실패하면 설정의 연결 확인으로 안내한다. */
function RefreshState({ me }: { me: Me }) {
  const time = useWhen();
  const latest = useLatestRefresh(me);
  const job = latest.data?.job;
  if (latest.isError) return <span className="text-destructive">갱신 결과를 읽지 못함</span>;
  if (!job) return <span>{latest.isPending ? '갱신 결과 확인 중' : '아직 공고를 가져온 적이 없어요'}</span>;
  if (ACTIVE_JOB.includes(job.status)) {
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
