'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, buttonClass } from '@nextstep/design-system';
import { meSchema, type Me } from '@nextstep/contracts';
import { call, ME_KEY, useMe } from './api-client';

// 구글 로그인 콜백이 첫 화면 주소(?login_error=)로 알려 주는 실패 이유.
const LOGIN_ERRORS: Record<string, string> = {
  invite: '초대받은 구글 계정이 아닙니다. 초대 링크로 처음 한 번 로그인하세요.',
  failed: '구글 로그인을 마치지 못했습니다. 다시 시도하세요.',
  unavailable: '서버에 구글 로그인 설정이 없습니다. 운영자에게 알려 주세요.',
};
const takeParam = (name: string) => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name);

export function Account() {
  const client = useQueryClient();
  const me = useMe();
  // 초대 링크(/?invite=코드)·로그인 실패(?login_error=)·데스크톱 앱 로그인 코드(?desktop_code=)는 주소에서 읽고 바로 지운다.
  // 서버 렌더링 중에는 계정 확인 문구만 그리므로 값이 서버와 달라도 hydration이 어긋나지 않는다.
  const [invite] = useState(() => takeParam('invite'));
  const [loginError] = useState(() => takeParam('login_error'));
  const [desktopCode] = useState(() => takeParam('desktop_code'));
  useEffect(() => {
    const url = new URL(window.location.href);
    const before = url.search;
    for (const name of ['invite', 'login_error', 'desktop_code']) url.searchParams.delete(name);
    if (url.search !== before) window.history.replaceState(null, '', url);
  }, []);
  // 사용자가 바뀌면 이전 사용자의 캐시를 모두 버린다.
  // 계정 조회 쿼리는 화면 여러 곳이 구독하므로 지우지 않고 값만 바꾼다.
  const reset = (next: Me | null) => {
    client.removeQueries({ predicate: query => query.queryKey[0] !== ME_KEY[0] });
    client.setQueryData(ME_KEY, next);
  };
  // 데스크톱 앱: 기본 브라우저에서 구글 로그인을 마치면 앱이 이 창을 ?desktop_code=로 열고, 여기서 세션으로 바꾼다.
  const exchange = useMutation({
    mutationFn: async (code: string) => meSchema.parse(await call('auth/desktop/exchange', { method: 'POST', body: JSON.stringify({ code }), messages: { 400: '로그인을 다시 시도하세요.', 401: '로그인 시간이 지났습니다. 다시 시도하세요.' } })),
    onSuccess: reset,
  });
  const { mutate: exchangeCode } = exchange;
  useEffect(() => { if (desktopCode) exchangeCode(desktopCode); }, [desktopCode, exchangeCode]);
  const logout = useMutation({ mutationFn: () => call('auth/logout', { method: 'POST' }), onSuccess: () => reset(null) });
  const remove = useMutation({ mutationFn: () => call('account', { method: 'DELETE' }), onSuccess: () => reset(null) });

  if (me.isPending) return <p role="status" className="text-muted-foreground">계정 상태를 확인하고 있습니다.</p>;
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

  const start = `/api/auth/google/start${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`;
  const error = exchange.isError ? exchange.error.message : loginError && (LOGIN_ERRORS[loginError] ?? LOGIN_ERRORS.failed);
  return <div className="flex max-w-md flex-col gap-4">
    <p className="text-body-sm text-muted-foreground">{invite ? '초대 링크로 가입합니다. 앞으로 로그인에 쓸 구글 계정을 고르세요.' : '초대받은 구글 계정으로 로그인합니다.'}</p>
    <a href={start} className={buttonClass('primary', 'md', exchange.isPending ? 'pointer-events-none opacity-60' : undefined)}>{exchange.isPending ? '로그인하는 중' : '구글로 로그인'}</a>
    {error && <p role="alert" className="text-body-sm text-destructive">{error}</p>}
  </div>;
}
