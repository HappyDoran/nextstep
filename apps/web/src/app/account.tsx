'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, buttonClass, Field, Input } from '@nextstep/design-system';
import { pendingSchema, type Me, type Pending } from '@nextstep/contracts';
import { call, ME_KEY, RequestError, useMe } from './api-client';

const PENDING_KEY = ['auth', 'pending'];
const START = '/api/auth/google/start';
// 구글 로그인 콜백이 첫 화면 주소(?login_error=)로 알려 주는 실패 이유.
const LOGIN_ERRORS: Record<string, string> = {
  failed: '구글 로그인을 마치지 못했습니다. 다시 시도하세요.',
  unavailable: '서버에 구글 로그인 설정이 없습니다. 운영자에게 알려 주세요.',
};
const takeParam = (name: string) => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name);

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
  const logout = useMutation({ mutationFn: () => call('auth/logout', { method: 'POST' }), onSuccess: () => reset(null) });
  const remove = useMutation({ mutationFn: () => call('account', { method: 'DELETE' }), onSuccess: () => reset(null) });

  if (me.isPending || (me.data === null && pending.isPending)) return <p role="status" className="text-muted-foreground">계정 상태를 확인하고 있습니다.</p>;
  if (me.isError) return <p role="status" className="text-muted-foreground">계정 상태를 확인하지 못했습니다. 서버 연결을 확인하세요.</p>;

  if (me.data) {
    const busy = logout.isPending || remove.isPending;
    return <div>
      <p role="status" className="mb-5 text-muted-foreground">{me.data.email} 계정으로 로그인했습니다.</p>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" disabled={busy} onClick={() => logout.mutate()}>로그아웃</Button>
        <Button disabled={busy} variant="danger" onClick={() => {
          if (window.confirm('계정과 저장한 지원 건을 모두 삭제합니다. 되돌릴 수 없습니다.')) remove.mutate();
        }}>계정 삭제</Button>
      </div>
      {(logout.isError || remove.isError) && <p role="alert" className="mt-4 text-body-sm text-destructive">{(logout.error ?? remove.error)?.message}</p>}
    </div>;
  }

  if (pending.data) {
    const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); join.mutate(String(new FormData(event.currentTarget).get('code') ?? '')); };
    return <form onSubmit={submit} className="flex max-w-md flex-col gap-4">
      <p role="status" className="text-body-sm text-muted-foreground">
        {pending.data.email} 계정은 아직 등록되지 않았습니다. {pending.data.requested
          ? '운영자에게 초대 코드를 요청했습니다. 메일이나 메신저로 받은 코드를 입력하세요.'
          : '운영자에게 요청을 보내지 못했습니다. 다시 구글로 로그인해 요청하거나 운영자에게 직접 알려 주세요.'}
      </p>
      <Field label="초대 코드" error={join.isError ? join.error.message : undefined}>
        <Input name="code" required minLength={8} maxLength={64} autoComplete="off" />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={join.isPending}>가입</Button>
        <a href={START} className={buttonClass('secondary')}>다른 구글 계정으로 로그인</a>
        <Button variant="quiet" disabled={logout.isPending} onClick={() => logout.mutate()}>취소</Button>
      </div>
    </form>;
  }

  const error = exchange.isError ? exchange.error.message : pending.isError ? '계정 상태를 확인하지 못했습니다. 서버 연결을 확인하세요.' : loginError && (LOGIN_ERRORS[loginError] ?? LOGIN_ERRORS.failed);
  return <div className="flex max-w-md flex-col gap-4">
    <p className="text-body-sm text-muted-foreground">구글 계정으로 로그인합니다. 처음이면 운영자에게 초대 코드를 요청합니다.</p>
    <a href={START} className={buttonClass('primary', 'md', exchange.isPending ? 'pointer-events-none opacity-60' : undefined)}>{exchange.isPending ? '로그인하는 중' : '구글로 로그인'}</a>
    {error && <p role="alert" className="text-body-sm text-destructive">{error}</p>}
    <a href="/privacy" className="text-caption text-muted-foreground underline">개인정보처리방침</a>
  </div>;
}
