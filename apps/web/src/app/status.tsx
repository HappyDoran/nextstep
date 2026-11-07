'use client';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@nextstep/design-system';
import { healthSchema } from '@nextstep/contracts';
async function fetchHealth(signal: AbortSignal) {
  const response = await fetch('/api/health', {
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
  });
  if (!response.ok) throw new Error('서버 연결 실패');
  return healthSchema.parse(await response.json());
}
export function ConnectionStatus() {
  const query = useQuery({
    queryKey: ['service', 'health'],
    queryFn: ({ signal }) => fetchHealth(signal),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const loading = query.isPending || query.isFetching;
  const status = loading ? '서버 연결을 확인하고 있습니다.'
    : query.isError ? '서버에 연결하지 못했습니다. 잠시 후 다시 확인하세요.'
      : 'API와 로컬 DB가 준비되었습니다.';
  return <div><p role="status" aria-live="polite" className="mb-5 text-muted-foreground">{status}</p><Button disabled={loading} onClick={() => { void query.refetch(); }}>{loading ? <LoaderCircle className="size-icon-md shrink-0 animate-spin stroke-icon motion-reduce:animate-none" aria-hidden="true" focusable="false" /> : <RefreshCw className="size-icon-md shrink-0 stroke-icon" aria-hidden="true" focusable="false" />}{loading ? '확인중' : '다시 확인'}</Button></div>;
}
