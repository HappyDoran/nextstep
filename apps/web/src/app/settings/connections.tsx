'use client';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button, Tag } from '@nextstep/design-system';
import { connectionStatusSchema, healthSchema, type Me } from '@nextstep/contracts';
import { buttonIcon, call, SOURCE_NAMES, useWhen } from '../api-client';

const CODES: Record<string, string> = { network: '연결 실패', blocked: '접속 차단', http_error: '응답 오류', parse_failed: '페이지 형식 바뀜', not_found: '공고 없음', body_missing: '본문 없음' };
const tone = (ok: boolean | null | 'partial') => (ok === 'partial' ? '도전' : ok === null ? '미확인' : ok ? '기본' : '제외') as '미확인' | '기본' | '도전' | '제외';

// 연결 상태(기획서 4절): 홈서버·분석 기능은 지금 확인하고, 메일·공고 출처는 마지막 실행 결과를 보여 준다.
export function ConnectionPanel({ me }: { me: Me }) {
  const when = useWhen();
  const health = useQuery({ queryKey: ['service', 'health'], retry: false, refetchOnWindowFocus: false, queryFn: async () => healthSchema.parse(await call('health', { timeout: 5000 })) });
  const conn = useQuery({ queryKey: ['settings', 'connections', me.id], retry: false, refetchOnWindowFocus: false, queryFn: async () => connectionStatusSchema.parse(await call('settings/connections')) });
  const loading = health.isFetching || conn.isFetching;
  const rows: { name: string; ok: boolean | null | 'partial'; label: string; detail: string }[] = [
    { name: '홈서버·DB', ok: health.isError ? false : health.data ? true : null, label: health.isError ? '연결 실패' : health.data ? '정상' : '확인 중', detail: health.isError ? '서버에 연결하지 못했습니다. 홈서버가 켜져 있는지 확인하세요.' : 'API와 로컬 DB' },
  ];
  if (conn.data) {
    const c = conn.data;
    rows.push({ name: '공고·메일 분석', ok: c.ai.status === '정상', label: c.ai.status === '정상' ? '정상' : '사용 불가', detail: c.ai.status === '정상' ? '준비됨' : '지금은 분석할 수 없어요. 운영자에게 알려 주세요' });
    rows.push(c.mail
      ? { name: '네이버 메일', ok: c.mail.status === '정상', label: c.mail.status, detail: c.mail.status === '정상' ? `마지막 확인 ${c.mail.lastSuccessAt ? when(c.mail.lastSuccessAt) : '없음'}` : '설정의 네이버 메일에서 다시 연결하세요' }
      : { name: '네이버 메일', ok: null, label: '연결 안 됨', detail: '연결하지 않아도 지원 건을 직접 관리할 수 있습니다' });
    for (const s of c.sources) {
      const failed = Object.entries(s.failures).map(([code, n]) => `${CODES[code] ?? code} ${n}`).join(', ');
      const got = s.collected === null ? '' : `공고 ${s.collected}건 받음`;
      const detail = s.status === '확인 전' ? '아직 공고를 가져온 적이 없거나 마지막 갱신이 시작 전에 실패했습니다'
        : s.status === '정상' ? got || '마지막 갱신에서 문제 없음' : s.status === '일부 실패' ? `${got} · 일부 상세 못 읽음(${failed})` : `공고를 받지 못함(${failed})`;
      rows.push({ name: SOURCE_NAMES[s.source], ok: s.status === '확인 전' ? null : s.status === '일부 실패' ? 'partial' : s.status === '정상', label: s.status, detail: `${detail}${s.finishedAt ? ` · ${when(s.finishedAt)}` : ''}` });
    }
  }
  return <div className="grid gap-4">
    <ul className="divide-y divide-border overflow-hidden rounded-surface border border-border">
      {rows.map(r => <li key={r.name} className="grid grid-cols-[7rem_6.5rem_1fr] items-center gap-3 px-4 py-3 text-body-sm">
        <span className="font-semibold">{r.name}</span><span><Tag classification={tone(r.ok)}>{r.label}</Tag></span><span className="text-muted-foreground">{r.detail}</span>
      </li>)}
    </ul>
    {conn.isError && <p role="alert" className="text-body-sm text-destructive">{conn.error.message}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" disabled={loading} onClick={() => { void health.refetch(); void conn.refetch(); }}>{loading ? <LoaderCircle className={`${buttonIcon} animate-spin motion-reduce:animate-none`} aria-hidden="true" focusable="false" /> : <RefreshCw className={buttonIcon} aria-hidden="true" focusable="false" />}다시 확인</Button>
      {conn.data && <span className="text-caption text-muted-foreground">확인 {when(conn.data.checkedAt)} · 메일·공고 출처는 마지막 실행 결과예요</span>}
    </div>
  </div>;
}
