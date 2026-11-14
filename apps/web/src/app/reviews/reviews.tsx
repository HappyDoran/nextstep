'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@nextstep/design-system';
import { applicationSchema, reviewSchema, type Me, type Review } from '@nextstep/contracts';
import { call, fieldClass, useMe } from '../api-client';
import { Account } from '../account';

const STATUSES = ['지원 완료', '전형 진행중', '합격', '불합격', '열람'] as const;
const label = 'flex flex-col gap-2 text-body-sm';

export function Reviews() {
  const me = useMe();
  if (me.isPending) return <p role="status" className="text-muted-foreground">계정 상태를 확인하고 있습니다.</p>;
  if (!me.data) return <div className="flex flex-col gap-4"><h1 className="text-title-lg">확인 목록</h1><Account /></div>;
  return <ReviewList me={me.data} />;
}

// 사용자 행동이 필요한 메일만 남긴다. 처리하지 않아도 재촉하지 않고 목록에 그대로 둔다.
function ReviewList({ me }: { me: Me }) {
  const reviews = useQuery({ queryKey: ['reviews', me.id], queryFn: async () => reviewSchema.array().parse(await call('reviews')), retry: false });
  const apps = useQuery({ queryKey: ['applications', me.id], queryFn: async () => applicationSchema.array().parse(await call('applications')), retry: false });
  return <div className="flex flex-col gap-6">
    <h1 className="text-title-lg">확인 목록</h1>
    <p className="text-body-sm text-muted-foreground">메일만으로 대상이나 결과를 확정할 수 없는 항목입니다. 지원 건에 연결하거나, 새 지원 건으로 확정하거나, 나중에 보려면 보류하거나, 무시하세요. 보류한 항목은 목록 아래에 남고, 무시한 메일은 다시 묻지 않습니다.</p>
    {reviews.isPending ? <p role="status" className="text-muted-foreground">불러오고 있습니다.</p>
      : reviews.isError ? <div><p role="alert" className="mb-3 text-destructive">{reviews.error.message}</p><Button onClick={() => { void reviews.refetch(); }}>다시 시도</Button></div>
        : reviews.data.length === 0 ? <p role="status" className="text-muted-foreground">확인할 항목이 없습니다.</p>
          : <ul className="flex flex-col gap-3">{reviews.data.map(r => <ReviewItem key={r.id} review={r} me={me} apps={apps.data ?? []} />)}</ul>}
  </div>;
}

function ReviewItem({ review, me, apps }: { review: Review; me: Me; apps: { id: string; company: string; roleTitle: string; status: string }[] }) {
  const client = useQueryClient();
  const [mode, setMode] = useState<'link' | 'create'>('link');
  const [status, setStatus] = useState<string>(review.classification === '모호' ? '' : review.classification);
  const [target, setTarget] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const act = useMutation({
    mutationFn: (body: object) => call(`reviews/${review.id}`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['reviews', me.id] }); void client.invalidateQueries({ queryKey: ['applications', me.id] }); },
  });
  const statusField = <label className={label}>반영할 상태<select value={status} onChange={e => setStatus(e.target.value)} className={fieldClass}>
    <option value="">선택</option>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>;
  return <li className="rounded-control border border-border p-4">
    <div className="mb-2 flex flex-wrap gap-2 text-body-sm"><span className="rounded-control bg-muted px-3 py-1 font-semibold">{review.reason}</span>{review.held && <span className="rounded-control border border-border px-3 py-1">보류</span>}
      <span className="text-muted-foreground">{review.platform ?? '직접 메일'} · 판정 {review.classification}{review.receivedAt ? ` · ${new Date(review.receivedAt).toLocaleString('ko-KR')}` : ''}</span></div>
    <strong className="block text-body">{review.subject}</strong>
    {review.evidence && <p className="mt-1 text-body-sm text-muted-foreground">근거: {review.evidence}</p>}
    <div className="mt-4 flex gap-2" role="group" aria-label="처리 방법">
      {(['link', 'create'] as const).map(m => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`min-h-control rounded-control px-4 text-body-sm ${mode === m ? 'bg-muted font-semibold' : 'text-muted-foreground'}`}>{m === 'link' ? '기존 지원 건에 연결' : '새 지원 건으로 확정'}</button>)}
    </div>
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      {mode === 'link' ? <label className={label}>지원 건<select value={target} onChange={e => setTarget(e.target.value)} className={fieldClass}><option value="">선택</option>{apps.map(a => <option key={a.id} value={a.id}>{a.company} · {a.roleTitle} ({a.status})</option>)}</select></label>
        : <><label className={label}>회사<input value={company} onChange={e => setCompany(e.target.value)} className={fieldClass} /></label><label className={label}>직무<input value={role} onChange={e => setRole(e.target.value)} className={fieldClass} /></label></>}
      {statusField}
    </div>
    <div className="mt-3 flex flex-wrap gap-3">
      <Button disabled={act.isPending || !status || (mode === 'link' ? !target : !company.trim() || !role.trim() || status === '열람')}
        onClick={() => act.mutate(mode === 'link' ? { action: 'link', applicationId: target, status } : { action: 'create', company, roleTitle: role, status })}>확정</Button>
      <Button disabled={act.isPending} className="!bg-transparent !text-foreground border-border" onClick={() => act.mutate({ action: 'hold', held: !review.held })}>{review.held ? '보류 해제' : '보류'}</Button>
      <Button disabled={act.isPending} className="!bg-transparent !text-foreground border-border" onClick={() => act.mutate({ action: 'ignore' })}>무시</Button>
    </div>
    {act.isError && <p role="alert" className="mt-2 text-body-sm text-destructive">{act.error.message}</p>}
  </li>;
}
