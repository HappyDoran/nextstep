'use client';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@nextstep/design-system';
import { jobSchema, mailConnectionSchema, type Me } from '@nextstep/contracts';
import { call, fieldClass, RequestError } from '../api-client';

const ERRORS: Record<string, string> = { auth_failed: '인증 실패: 네이버 애플리케이션 비밀번호와 IMAP 사용 설정을 확인하세요.', network: '네트워크 오류', tls: '보안 연결 오류', protocol: '메일 서버 응답 오류', not_connected: '연결 정보 없음', disconnected: '조회 중 연결이 해제됨' };
const ACTIVE = ['대기', '실행중'];

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
    mutationFn: async (form: FormData) => jobSchema.parse(await call('mail/connection', { method: 'PUT', body: JSON.stringify({ account: form.get('account'), appPassword: form.get('appPassword'), consent: form.get('consent') === 'on' }), messages: { 422: ERRORS.auth_failed!, 400: '네이버 주소·비밀번호와 조회 동의를 확인하세요.', 502: '네이버 메일에 연결하지 못했습니다. 잠시 후 다시 시도하세요.' } })),
    onSuccess: refresh,
  });
  const sync = useMutation({ mutationFn: async () => jobSchema.parse(await call('mail/sync', { method: 'POST' })), onSuccess: refresh });
  const [keep, setKeep] = useState(true);
  const disconnect = useMutation({ mutationFn: () => call(`mail/connection?keepApplications=${keep}`, { method: 'DELETE' }), onSuccess: () => { client.setQueryData(key, null); void client.invalidateQueries({ queryKey: ['applications', me.id] }); } });

  if (query.isPending) return <p role="status" className="text-muted-foreground">메일 연결을 확인하고 있습니다.</p>;
  if (query.isError) return <p role="alert" className="text-destructive">{query.error.message}</p>;
  const conn = query.data;
  if (!conn) {
    const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); connect.mutate(new FormData(e.currentTarget)); };
    return <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-body-sm text-muted-foreground">네이버 메일 환경설정에서 IMAP을 켜고 애플리케이션 비밀번호를 만들어 넣으세요. 메일을 읽음 처리·이동·삭제하지 않으며, 채용 메일의 제목 앞부분·짧은 근거·수신 시각만 저장합니다. 비밀번호는 암호화해 서버에만 둡니다. 연결하지 않아도 지원 건을 직접 관리할 수 있습니다.</p>
      <label className="flex flex-col gap-2 text-body-sm">네이버 메일 주소<input name="account" type="email" required autoComplete="off" className={fieldClass} /></label>
      <label className="flex flex-col gap-2 text-body-sm">애플리케이션 비밀번호<input name="appPassword" type="password" required autoComplete="off" className={fieldClass} /></label>
      <label className="flex items-start gap-2 text-body-sm"><input name="consent" type="checkbox" required className="mt-1 size-icon-md accent-primary" />최근 3개월 받은 메일(보낸·임시·휴지통·스팸 제외)을 읽기 전용으로 조회하는 데 동의합니다.</label>
      <div><Button type="submit" disabled={connect.isPending}>연결 검사 후 연결</Button></div>
      {connect.isError && <p role="alert" className="text-body-sm text-destructive">{connect.error.message}</p>}
    </form>;
  }
  const job = conn.lastJob;
  const result = job?.result as { stored?: number; applied?: number; created?: number; review?: number; more?: boolean } | null | undefined;
  return <div className="flex flex-col gap-4">
    <p role="status" className="text-muted-foreground">
      {conn.account} · {conn.status}{conn.lastSuccessAt ? ` · 최근 성공 ${new Date(conn.lastSuccessAt).toLocaleString('ko-KR')}` : ''}
      {job ? ` · ${ACTIVE.includes(job.status) ? '메일을 확인하고 있습니다' : `${job.status}${job.errorCode ? `(${ERRORS[job.errorCode] ?? job.errorCode})` : ''}: 채용 메일 ${result?.stored ?? 0}건, 반영 ${(result?.applied ?? 0) + (result?.created ?? 0)}건, 확인 필요 ${result?.review ?? 0}건${result?.more ? ', 남은 메일은 다음 조회에서 이어서 처리' : ''}`}` : ''}
    </p>
    {conn.rangeIncomplete && <p className="text-body-sm text-destructive">네이버가 IMAP으로 보여 주는 메일이 최근 3개월보다 짧습니다. 네이버 메일 환경설정 &gt; POP3/IMAP 설정 &gt; IMAP/SMTP 설정의 &lsquo;IMAP 동기화 메일 제한&rsquo;(기본 1,000통, 최대 5,000통)을 늘린 뒤 다시 연결하면 더 오래된 메일까지 확인합니다.</p>}
    <div className="flex flex-wrap gap-3">
      <Button disabled={sync.isPending || Boolean(job && ACTIVE.includes(job.status))} onClick={() => sync.mutate()}>지금 메일 확인</Button>
    </div>
    <fieldset className="flex flex-col gap-2 text-body-sm"><legend className="mb-1">연결 해제 시 메일로 만든 지원 건</legend>
      <label className="flex items-center gap-2"><input type="radio" checked={keep} onChange={() => setKeep(true)} className="accent-primary" />유지</label>
      <label className="flex items-center gap-2"><input type="radio" checked={!keep} onChange={() => setKeep(false)} className="accent-primary" />삭제</label>
    </fieldset>
    <div><Button disabled={disconnect.isPending} className="border-destructive !bg-transparent !text-destructive" onClick={() => { if (window.confirm('메일 조회를 멈추고 저장한 비밀번호를 삭제합니다.')) disconnect.mutate(); }}>연결 해제</Button></div>
    {(sync.isError || disconnect.isError) && <p role="alert" className="text-body-sm text-destructive">{(sync.error ?? disconnect.error)?.message}</p>}
  </div>;
}
