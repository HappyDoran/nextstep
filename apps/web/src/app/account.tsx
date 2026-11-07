'use client';
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@nextstep/design-system';
import { meSchema, type Me } from '@nextstep/contracts';
import { call, fieldClass as field, ME_KEY, useMe } from './api-client';

const AUTH_MESSAGES: Record<number, string> = {
  400: '입력값을 확인하세요. 비밀번호는 10자 이상입니다.',
  401: '이메일 또는 비밀번호를 확인하세요.',
  403: '초대 코드를 확인하세요.',
  409: '이미 가입한 이메일입니다.',
  429: '로그인 실패가 반복되었습니다. 잠시 후 다시 시도하세요.',
};

export function Account() {
  const client = useQueryClient();
  const me = useMe();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  // 사용자가 바뀌면 이전 사용자의 캐시를 모두 버린다.
  // 계정 조회 쿼리는 화면 여러 곳이 구독하므로 지우지 않고 값만 바꾼다.
  const reset = (next: Me | null) => {
    client.removeQueries({ predicate: query => query.queryKey[0] !== ME_KEY[0] });
    client.setQueryData(ME_KEY, next);
  };
  const auth = useMutation({
    mutationFn: async (form: FormData) => meSchema.parse(await call(mode === 'login' ? 'auth/login' : 'auth/signup', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries([...form.entries()].filter(([key]) => mode === 'signup' || key !== 'inviteCode'))),
      messages: AUTH_MESSAGES,
    })),
    onSuccess: reset,
  });
  const logout = useMutation({ mutationFn: () => call('auth/logout', { method: 'POST' }), onSuccess: () => reset(null) });
  const remove = useMutation({ mutationFn: () => call('account', { method: 'DELETE' }), onSuccess: () => reset(null) });

  if (me.isPending) return <p role="status" className="text-muted-foreground">계정 상태를 확인하고 있습니다.</p>;
  if (me.isError) return <p role="status" className="text-muted-foreground">계정 상태를 확인하지 못했습니다. 서버 연결을 확인하세요.</p>;

  if (me.data) {
    const busy = logout.isPending || remove.isPending;
    return <div>
      <p role="status" className="mb-5 text-muted-foreground">{me.data.email} 계정으로 로그인했습니다.</p>
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy} onClick={() => logout.mutate()}>로그아웃</Button>
        <Button disabled={busy} className="!bg-transparent !text-destructive border-destructive" onClick={() => {
          if (window.confirm('계정과 저장한 지원 건을 모두 삭제합니다. 되돌릴 수 없습니다.')) remove.mutate();
        }}>계정 삭제</Button>
      </div>
      {(logout.isError || remove.isError) && <p role="alert" className="mt-4 text-body-sm text-destructive">{(logout.error ?? remove.error)?.message}</p>}
    </div>;
  }

  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); auth.mutate(new FormData(event.currentTarget)); };
  return <div>
    <div role="tablist" aria-label="계정" className="mb-5 flex gap-2">
      {(['login', 'signup'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={mode === value}
        className={`min-h-control rounded-control px-4 text-body ${mode === value ? 'bg-muted font-semibold' : 'text-muted-foreground'}`}
        onClick={() => { setMode(value); auth.reset(); }}>{value === 'login' ? '로그인' : '초대 코드로 가입'}</button>)}
    </div>
    <form onSubmit={submit} className="flex max-w-md flex-col gap-4">
      {mode === 'signup' && <label className="flex flex-col gap-2 text-body-sm">초대 코드<input name="inviteCode" required autoComplete="off" className={field} /></label>}
      <label className="flex flex-col gap-2 text-body-sm">이메일<input name="email" type="email" required autoComplete="email" className={field} /></label>
      <label className="flex flex-col gap-2 text-body-sm">비밀번호<input name="password" type="password" required minLength={10} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className={field} /></label>
      <Button type="submit" disabled={auth.isPending}>{mode === 'login' ? '로그인' : '가입'}</Button>
      {auth.isError && <p role="alert" className="text-body-sm text-destructive">{auth.error.message}</p>}
    </form>
  </div>;
}
