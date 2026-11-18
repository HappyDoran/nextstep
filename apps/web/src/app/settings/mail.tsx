'use client';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@nextstep/design-system';
import { jobSchema, mailConnectionSchema, type Me } from '@nextstep/contracts';
import { call, fieldClass, RequestError } from '../api-client';
import { AI_CAUSES } from './ai';

const ERRORS: Record<string, string> = { auth_failed: '인증 실패: 네이버 애플리케이션 비밀번호와 IMAP 사용 설정을 확인하세요.', network: '네트워크 오류', tls: '보안 연결 오류', protocol: '메일 서버 응답 오류', not_connected: '연결 정보 없음', disconnected: '조회 중 연결이 해제됨' };
const ACTIVE = ['대기', '실행중'];
const PERIODS: [number, string][] = [[30, '최근 1개월'], [90, '최근 3개월'], [180, '최근 6개월'], [365, '최근 1년']];
const PAST: [number, string][] = [[90, '최근 3개월까지'], [180, '최근 6개월까지'], [365, '최근 1년까지'], [730, '최근 2년까지']];
const CONNECT_ERRORS: Record<number, string> = {
  400: '네이버 주소·비밀번호와 조회 동의를 확인하세요.',
  422: '로그인하지 못했습니다. ① IMAP/SMTP 사용이 켜져 있는지 ② 네이버 비밀번호가 아니라 애플리케이션 비밀번호를 넣었는지 ③ 주소가 맞는지 확인하세요. 해외 로그인 차단을 켜 두었다면 국외에서 실행되는 서버는 접속할 수 없습니다.',
  503: '네이버 메일 서버에 닿지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.',
  502: '네이버 메일 서버와 보안 연결 또는 응답 처리에 실패했습니다. 잠시 후 다시 시도하세요.',
};

export function MailSetting({ me }: { me: Me }) {
  const client = useQueryClient();
  const key = ['mail', 'connection', me.id];
  const query = useQuery({
    queryKey: key, retry: false,
    queryFn: async () => { try { return mailConnectionSchema.parse(await call('mail/connection')); } catch (e) { if (e instanceof RequestError && e.status === 404) return null; throw e; } },
    // 동기화 작업이 진행 중일 때만 상태를 다시 읽는다.
    refetchInterval: q => (q.state.data?.lastJob && ACTIVE.includes(q.state.data.lastJob.status) ? 3000 : false),
  });
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const connect = useMutation({
    mutationFn: async (form: FormData) => jobSchema.parse(await call('mail/connection', { method: 'PUT', body: JSON.stringify({ account: form.get('account'), appPassword: form.get('appPassword'), consent: form.get('consent') === 'on', days: Number(form.get('days')) }), messages: CONNECT_ERRORS })),
    onSuccess: refresh,
  });
  const sync = useMutation({ mutationFn: async () => jobSchema.parse(await call('mail/sync', { method: 'POST' })), onSuccess: refresh });
  const [pastDays, setPastDays] = useState(180);
  const backfill = useMutation({ mutationFn: async () => jobSchema.parse(await call('mail/backfill', { method: 'POST', body: JSON.stringify({ days: pastDays }), messages: { 400: '이미 조회한 범위입니다. 더 긴 기간을 고르세요.' } })), onSuccess: refresh });
  const [keep, setKeep] = useState(true);
  const disconnect = useMutation({ mutationFn: () => call(`mail/connection?keepApplications=${keep}`, { method: 'DELETE' }), onSuccess: () => { client.setQueryData(key, null); void client.invalidateQueries({ queryKey: ['applications', me.id] }); } });

  if (query.isPending) return <p role="status" className="text-muted-foreground">메일 연결을 확인하고 있습니다.</p>;
  if (query.isError) return <p role="alert" className="text-destructive">{query.error.message}</p>;
  const conn = query.data;
  if (!conn) {
    const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); connect.mutate(new FormData(e.currentTarget)); };
    return <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-body-sm text-muted-foreground">채용 메일로 지원 상태를 자동으로 반영합니다. 연결하지 않아도 지원 건을 직접 관리할 수 있습니다.</p>
      <section aria-labelledby="mail-steps" className="rounded-surface border border-border bg-background p-5">
        <h3 id="mail-steps" className="mb-2 text-body-sm font-extrabold">연결 준비 (네이버에서 한 번만)</h3>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-body-sm">
          <li>네이버 메일 &gt; 환경설정 &gt; POP3/IMAP 설정 &gt; IMAP/SMTP 설정에서 &lsquo;IMAP/SMTP 사용&rsquo;을 사용함으로 저장합니다.</li>
          <li>네이버 내정보 &gt; 보안설정에서 2단계 인증을 켭니다.</li>
          <li>2단계 인증 관리 &gt; 애플리케이션 비밀번호 관리에서 새 비밀번호를 만들어 아래에 붙여 넣습니다. 네이버 로그인 비밀번호는 넣지 마세요.</li>
        </ol>
      </section>
      <section aria-labelledby="mail-scope" className="rounded-surface border border-border bg-background p-5">
        <h3 id="mail-scope" className="mb-2 text-body-sm font-extrabold">NextStep이 하는 일과 하지 않는 일</h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body-sm">
          <li>받은 메일을 읽기만 합니다. 읽음 처리·이동·삭제·발송을 하지 않습니다.</li>
          <li>채용 메일의 제목 앞부분·짧은 근거·수신 시각만 저장하고 본문은 저장하지 않습니다.</li>
          <li>규칙으로 지원 건을 찾지 못한 채용 메일은 AI로 회사·직무·결과를 해석합니다. 본문은 서버의 로컬 AI로만 처리하고 서버 밖으로 보내지 않습니다.</li>
          <li>애플리케이션 비밀번호는 암호화해 서버에만 둡니다. 연결 해제 시 비밀번호와 조회 위치를 지웁니다.</li>
          <li>네이버에서 애플리케이션 비밀번호를 삭제하면 그 즉시 NextStep의 접근도 끊깁니다.</li>
        </ul>
      </section>
      <label className="flex flex-col gap-1.5 text-body-sm font-semibold">네이버 메일 주소<input name="account" type="email" required autoComplete="off" className={fieldClass} /></label>
      <label className="flex flex-col gap-1.5 text-body-sm font-semibold">애플리케이션 비밀번호<input name="appPassword" type="password" required autoComplete="off" className={fieldClass} /></label>
      <label className="flex flex-col gap-1.5 text-body-sm font-semibold">처음 조회할 기간
        <select name="days" defaultValue="90" className={fieldClass}>{PERIODS.map(([d, t]) => <option key={d} value={d}>{t}</option>)}</select>
      </label>
      <label className="flex items-start gap-2 text-body-sm"><input name="consent" type="checkbox" required className="mt-1 size-icon-md accent-primary" />고른 기간의 받은 메일(보낸·임시·휴지통·스팸 제외)을 읽기 전용으로 조회하고, 이후 새 메일을 1시간마다 확인하는 데 동의합니다.</label>
      <div><Button type="submit" disabled={connect.isPending}>연결 검사 후 연결</Button></div>
      {connect.isError && <p role="alert" className="text-body-sm text-destructive">{connect.error.message}</p>}
    </form>;
  }
  const job = conn.lastJob;
  const result = job?.result as { stored?: number; applied?: number; created?: number; review?: number; more?: boolean; aiFailures?: number; aiFailureCodes?: Record<string, number> } | null | undefined;
  const aiCause = Object.keys(result?.aiFailureCodes ?? {}).map(c => AI_CAUSES[c] ?? c).join(', ');
  return <div className="flex flex-col gap-4">
    <p role="status" className="text-body-sm font-semibold">
      {conn.account} · {conn.status}{conn.lastSuccessAt ? ` · 최근 성공 ${new Date(conn.lastSuccessAt).toLocaleString('ko-KR')}` : ''}
      {job ? ` · ${ACTIVE.includes(job.status) ? '메일을 확인하고 있습니다' : `${job.status}${job.errorCode ? `(${ERRORS[job.errorCode] ?? job.errorCode})` : ''}: 채용 메일 ${result?.stored ?? 0}건, 반영 ${(result?.applied ?? 0) + (result?.created ?? 0)}건, 확인 필요 ${result?.review ?? 0}건${result?.aiFailures ? `, AI 해석 실패(${aiCause}) — 해결 후 다시 확인하면 이어서 해석` : ''}${result?.more ? ', 남은 메일은 다음 조회에서 이어서 처리' : ''}`}` : ''}
    </p>
    {conn.coveredSince && <p className="text-body-sm text-muted-foreground">조회 범위: {new Date(conn.coveredSince).toLocaleDateString('ko-KR')} 이후 받은 메일{conn.backfillSince ? ` · ${new Date(conn.backfillSince).toLocaleDateString('ko-KR')}까지 과거 범위를 넓히는 중(메일 확인 때마다 이어서 가져옴)` : ''}. 자동 갱신을 켜 두면 1시간마다 새 메일을 확인합니다.</p>}
    {conn.rangeIncomplete && <p className="text-body-sm text-destructive">네이버가 IMAP으로 보여 주는 메일이 고른 조회 기간보다 짧습니다. 네이버 메일 환경설정 &gt; POP3/IMAP 설정 &gt; IMAP/SMTP 설정의 &lsquo;IMAP 동기화 메일 제한&rsquo;(기본 1,000통, 최대 5,000통)을 늘린 뒤 다시 연결하면 더 오래된 메일까지 확인합니다.</p>}
    <div className="flex flex-wrap gap-3">
      <Button disabled={sync.isPending || Boolean(job && ACTIVE.includes(job.status))} onClick={() => sync.mutate()}>지금 메일 확인</Button>
    </div>
    {!conn.backfillSince && <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1.5 text-body-sm font-semibold">과거 범위 넓히기
        <select value={pastDays} onChange={e => setPastDays(Number(e.target.value))} className={fieldClass}>{PAST.map(([d, t]) => <option key={d} value={d}>{t}</option>)}</select>
      </label>
      <Button variant="secondary" disabled={backfill.isPending || Boolean(job && ACTIVE.includes(job.status))} onClick={() => backfill.mutate()}>더 오래된 메일 가져오기</Button>
    </div>}
    <fieldset className="flex flex-col gap-1.5 text-body-sm font-semibold"><legend className="mb-1">연결 해제 시 메일로 만든 지원 건</legend>
      <label className="flex items-center gap-2"><input type="radio" checked={keep} onChange={() => setKeep(true)} className="accent-primary" />유지</label>
      <label className="flex items-center gap-2"><input type="radio" checked={!keep} onChange={() => setKeep(false)} className="accent-primary" />삭제</label>
    </fieldset>
    <div><Button disabled={disconnect.isPending} variant="danger" onClick={() => { if (window.confirm('메일 조회를 멈추고 저장한 비밀번호를 삭제합니다.')) disconnect.mutate(); }}>연결 해제</Button></div>
    {(sync.isError || backfill.isError || disconnect.isError) && <p role="alert" className="text-body-sm text-destructive">{(sync.error ?? backfill.error ?? disconnect.error)?.message}</p>}
  </div>;
}
