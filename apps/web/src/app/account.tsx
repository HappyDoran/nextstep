'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, buttonClass, Field, GoogleMark, Input } from '@nextstep/design-system';
import { pendingSchema, type Me, type Pending } from '@nextstep/contracts';
import { call, ME_KEY, RequestError, useMe } from './api-client';
import { clearViews } from './prefs';

const PENDING_KEY = ['auth', 'pending'];
const START = '/api/auth/google/start';
// 구글 로그인 콜백이 첫 화면 주소(?login_error=)로 알려 주는 실패 이유.
const LOGIN_ERRORS: Record<string, string> = {
  failed: '구글 로그인을 마치지 못했습니다. 다시 시도하세요.',
  unavailable: '서버에 구글 로그인 설정이 없습니다. 운영자에게 알려 주세요.',
};
const takeParam = (name: string) => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name);

/** 로그아웃: 서버 세션을 끝내고 이전 사용자의 캐시를 버린다(계정 화면·계정 메뉴 공용). */
export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => call('auth/logout', { method: 'POST' }),
    onSuccess: () => {
      clearViews();
      client.removeQueries({ predicate: query => query.queryKey[0] !== ME_KEY[0] });
      client.setQueryData(ME_KEY, null);
      client.setQueryData(PENDING_KEY, null);
    },
  });
}

async function fetchPending(): Promise<Pending | null> {
  try {
    return pendingSchema.parse(await call('auth/pending'));
  } catch (error) {
    if (error instanceof RequestError && error.status === 401) return null;
    throw error;
  }
}

// 로그인 흐름(기획서 0.2.13): 구글 로그인 → 등록 계정은 바로 로그인, 미등록 계정은 운영자에게 초대 코드 요청이 가고
// 이 화면이 코드 입력 화면이 된다. 대기 상태는 서버 쿠키라 앱을 다시 열어도 입력 화면부터 이어진다.
export function Account() {
  const client = useQueryClient();
  const me = useMe();
  const pending = useQuery({ queryKey: PENDING_KEY, queryFn: fetchPending, enabled: me.data === null, retry: false, refetchOnWindowFocus: false });
  // 로그인 실패(?login_error=)·데스크톱 앱 로그인 코드(?desktop_code=)는 주소에서 읽고 바로 지운다.
  // 서버 렌더링 중에는 계정 확인 문구만 그리므로 값이 서버와 달라도 hydration이 어긋나지 않는다.
  const [loginError] = useState(() => takeParam('login_error'));
  const [desktopCode] = useState(() => takeParam('desktop_code'));
  useEffect(() => {
    const url = new URL(window.location.href);
    const before = url.search;
    for (const name of ['login_error', 'desktop_code']) url.searchParams.delete(name);
    if (url.search !== before) window.history.replaceState(null, '', url);
  }, []);
  // 사용자가 바뀌면 이전 사용자의 캐시를 모두 버린다.
  // 계정 조회 쿼리는 화면 여러 곳이 구독하므로 지우지 않고 값만 바꾼다.
  // 계정 조회·대기 조회는 'auth' 아래 두어 지우지 않는다(구독 중인 쿼리를 지우면 화면이 옛 값을 계속 보여 준다).
  const dropUserData = () => client.removeQueries({ predicate: query => query.queryKey[0] !== ME_KEY[0] });
  const reset = (next: Me | null) => {
    dropUserData();
    client.setQueryData(ME_KEY, next);
    client.setQueryData(PENDING_KEY, null);
  };
  const reload = () => { dropUserData(); void client.invalidateQueries({ queryKey: ['auth'] }); };
  // 데스크톱 앱: 기본 브라우저에서 구글 로그인을 마치면 앱이 이 창을 ?desktop_code=로 열고, 여기서 세션 또는 코드 입력 대기로 바꾼다.
  const exchange = useMutation({
    mutationFn: (code: string) => call('auth/desktop/exchange', { method: 'POST', body: JSON.stringify({ code }), messages: { 400: '로그인을 다시 시도하세요.', 401: '로그인 시간이 지났습니다. 다시 시도하세요.' } }),
    onSuccess: reload,
  });
  const { mutate: exchangeCode } = exchange;
  useEffect(() => { if (desktopCode) exchangeCode(desktopCode); }, [desktopCode, exchangeCode]);
  const join = useMutation({
    mutationFn: (code: string) => call('auth/invite', { method: 'POST', body: JSON.stringify({ code }), messages: { 400: '초대 코드를 확인하세요.', 401: '구글 로그인부터 다시 하세요.', 403: '초대 코드를 확인하세요.', 409: '이미 가입한 구글 계정입니다. 다시 로그인하세요.' } }),
    onSuccess: reload,
  });
  const logout = useSignOut();
  const remove = useMutation({ mutationFn: () => call('account', { method: 'DELETE' }), onSuccess: () => { clearViews(); reset(null); } });

  if (me.isPending || (me.data === null && pending.isPending)) return <p role="status" className="text-muted-foreground">계정 상태를 확인하고 있습니다.</p>;
  if (me.isError) return <p role="status" className="text-muted-foreground">계정 상태를 확인하지 못했습니다. 서버 연결을 확인하세요.</p>;

  if (me.data) {
    const busy = logout.isPending || remove.isPending;
    return <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-4 rounded-surface border border-border bg-card p-5">
        <div className="min-w-0 flex-1"><p className="text-caption text-muted-foreground">로그인한 Google 계정</p><p role="status" className="truncate text-body font-semibold">{me.data.email}</p></div>
        <Button variant="secondary" disabled={busy} onClick={() => logout.mutate()}>로그아웃</Button>
      </div>
      <section aria-labelledby="account-delete" className="grid gap-3 border-t border-border pt-6">
        <div><h4 id="account-delete" className="text-body-sm font-extrabold">계정 삭제</h4><p className="mt-1 text-body-sm text-muted-foreground">계정과 서류·프로필·지원 현황을 모두 지웁니다. 되돌릴 수 없어요.</p></div>
        <div><Button disabled={busy} variant="danger" onClick={() => {
          if (window.confirm('계정과 저장한 자료를 모두 삭제합니다. 되돌릴 수 없습니다.')) remove.mutate();
        }}>계정 삭제</Button></div>
      </section>
      {(logout.isError || remove.isError) && <p role="alert" className="text-body-sm text-destructive">{(logout.error ?? remove.error)?.message}</p>}
    </div>;
  }

  if (pending.data) {
    const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); join.mutate(String(new FormData(event.currentTarget).get('code') ?? '')); };
    return <form onSubmit={submit} className="grid gap-5">
      <div role="status" className="rounded-surface bg-muted px-4 py-3 text-body-sm">
        <p className="font-semibold">{pending.data.email}</p>
        <p className="mt-1 text-muted-foreground">{pending.data.requested
          ? '아직 등록되지 않은 계정이에요. 운영자에게 초대 코드를 요청했으니 받은 코드를 입력하세요.'
          : '아직 등록되지 않은 계정이에요. 초대 코드 요청을 보내지 못했으니 다시 로그인하거나 운영자에게 직접 알려 주세요.'}</p>
      </div>
      <Field label="초대 코드" error={join.isError ? join.error.message : undefined}>
        <Input name="code" required minLength={8} maxLength={64} autoComplete="off" autoFocus placeholder="받은 코드를 붙여 넣으세요" />
      </Field>
      <Button type="submit" disabled={join.isPending} className="w-full">{join.isPending ? '가입하는 중' : '가입하기'}</Button>
      <div className="flex items-center justify-center gap-3 text-body-sm">
        <a href={START} className="text-muted-foreground hover:text-foreground">다른 Google 계정으로 로그인</a>
        <span aria-hidden="true" className="text-border-strong">|</span>
        <button type="button" disabled={logout.isPending} onClick={() => logout.mutate()} className="cursor-pointer text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-focus focus-visible:outline-ring">처음으로</button>
      </div>
    </form>;
  }

  const error = exchange.isError ? exchange.error.message : pending.isError ? '계정 상태를 확인하지 못했습니다. 서버 연결을 확인하세요.' : loginError && (LOGIN_ERRORS[loginError] ?? LOGIN_ERRORS.failed);
  return <div className="grid gap-4">
    <a href={START} aria-busy={exchange.isPending} className={buttonClass('secondary', 'md', `w-full ${exchange.isPending ? 'pointer-events-none opacity-60' : ''}`)}><GoogleMark />{exchange.isPending ? '로그인하는 중' : 'Google로 계속하기'}</a>
    <p className="text-center text-caption text-muted-foreground">처음이면 운영자에게 초대 코드를 요청해요.</p>
    {error && <p role="alert" className="text-body-sm text-destructive">{error}</p>}
    <a href="/privacy" className="justify-self-center text-caption text-muted-foreground underline">개인정보처리방침</a>
  </div>;
}
