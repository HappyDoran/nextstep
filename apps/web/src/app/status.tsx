'use client';
import { useEffect, useState } from 'react';
import { Button } from '@nextstep/design-system';
import { healthSchema } from '@nextstep/contracts';
async function connectionMessage(signal: AbortSignal) {
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal });
    if (!response.ok) throw new Error('연결 실패');
    healthSchema.parse(await response.json());
    return 'API와 로컬 DB가 준비되었습니다.';
  } catch { return '서버에 연결하지 못했습니다. 잠시 후 다시 확인하세요.'; }
}
export function ConnectionStatus() {
  const [status, setStatus] = useState('서버 연결을 확인하고 있습니다.');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void connectionMessage(AbortSignal.any([controller.signal, AbortSignal.timeout(5000)])).then(message => {
      if (!controller.signal.aborted) { setStatus(message); setLoading(false); }
    });
    return () => controller.abort();
  }, []);
  async function check() {
    setLoading(true);
    setStatus(await connectionMessage(AbortSignal.timeout(5000)));
    setLoading(false);
  }
  return <div><p role="status" aria-live="polite" className="mb-5 text-[var(--ns-muted)]">{status}</p><Button disabled={loading} onClick={() => { void check(); }}>{loading ? '확인중' : '다시 확인'}</Button></div>;
}
