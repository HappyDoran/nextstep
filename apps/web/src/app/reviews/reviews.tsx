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
          : <GroupedReviews reviews={reviews.data} me={me} apps={apps.data ?? []} />}
  </div>;
}

type AppOption = { id: string; company: string; roleTitle: string; status: string };

// AI가 읽은 회사별로 묶는다. 같은 회사 지원 건이 하나뿐인 메일은 그 건을 제안하고, 묶음 확정은 제안이 있는 메일에만 적용한다.
function GroupedReviews({ reviews, me, apps }: { reviews: Review[]; me: Me; apps: AppOption[] }) {
  const groups = [...reviews.reduce((m, r) => m.set(r.company ?? '회사 미확인', [...(m.get(r.company ?? '회사 미확인') ?? []), r]), new Map<string, Review[]>())]
    .sort((a, b) => b[1].length - a[1].length);
  return <div className="flex flex-col gap-6">
    <p className="text-body-sm text-muted-foreground">{reviews.length}건 · 회사 {groups.length}곳</p>
    {groups.map(([company, items]) => <ReviewGroup key={company} company={company} items={items} me={me} apps={apps} />)}
  </div>;
}

function ReviewGroup({ company, items, me, apps }: { company: string; items: Review[]; me: Me; apps: AppOption[] }) {
  const client = useQueryClient();
  // 묶음 연결은 지원 건 상태가 바뀌지 않는 메일(더 앞 단계이거나 같은 결과)만 대상으로 하고 현재 상태를 그대로 보낸다.
  // 확인 목록 확정은 고른 상태로 덮어쓰므로, 메일 상태를 보내면 불합격이 지원 완료로 되돌아갈 수 있다.
  const linkable = items.filter(r => !r.held && keepsStatus(r, apps.find(a => a.id === r.suggestedApplicationId)));
  const target = apps.find(a => a.id === linkable[0]?.suggestedApplicationId);
  // 한 건씩 차례로 보낸다. 중간에 실패하면 멈추고 남은 항목은 목록에 그대로 둔다.
  const bulk = useMutation({
    mutationFn: async ({ list, body }: { list: Review[]; body: (r: Review) => object }) => { for (const r of list) await call(`reviews/${r.id}`, { method: 'POST', body: JSON.stringify(body(r)) }); },
    onSettled: () => { void client.invalidateQueries({ queryKey: ['reviews', me.id] }); void client.invalidateQueries({ queryKey: ['applications', me.id] }); },
  });
  return <section aria-label={`${company} 확인 요청`} className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-title">{company} <span className="text-body-sm text-muted-foreground">{items.length}건</span></h2>
      {target && linkable.length > 0 && <Button disabled={bulk.isPending} onClick={() => bulk.mutate({ list: linkable, body: r => ({ action: 'link', applicationId: r.suggestedApplicationId, status: apps.find(a => a.id === r.suggestedApplicationId)!.status }) })}>제안대로 {linkable.length}건 연결 ({target.company} · {target.roleTitle})</Button>}
      {items.length > 1 && <Button disabled={bulk.isPending} className="!bg-transparent !text-foreground border-border"
        onClick={() => { if (window.confirm(`${company} ${items.length}건을 모두 무시할까요? 무시한 메일은 다시 묻지 않습니다.`)) bulk.mutate({ list: items, body: ignoreBody }); }}>모두 무시</Button>}
    </div>
    {bulk.isError && <p role="alert" className="text-body-sm text-destructive">{bulk.error.message}</p>}
    <ul className="flex flex-col gap-3">{items.map(r => <ReviewItem key={r.id} review={r} me={me} apps={apps} />)}</ul>
  </section>;
}
const RANK: Record<string, number> = { 미지원: 0, '지원 완료': 1, '전형 진행중': 2, 합격: 3, 불합격: 3 };
// 메일 상태가 지원 건 상태보다 앞 단계이거나 같으면 연결해도 상태가 바뀌지 않는다. 최종 결과끼리 다르면 충돌이라 제외한다.
const keepsStatus = (r: Review, app?: AppOption) => !!app && r.classification !== '모호'
  && (r.classification === app.status || RANK[r.classification]! < RANK[app.status]! || (r.classification === '열람'));
const ignoreBody = () => ({ action: 'ignore' });

function ReviewItem({ review, me, apps }: { review: Review; me: Me; apps: AppOption[] }) {
  const client = useQueryClient();
  const [mode, setMode] = useState<'link' | 'create'>('link');
  // 제안된 지원 건이 이미 더 뒤 단계면 그 상태를 기본값으로 둬 오래된 메일로 되돌리지 않게 한다.
  const suggested = apps.find(a => a.id === review.suggestedApplicationId);
  const [status, setStatus] = useState<string>(review.classification === '모호' ? '' : suggested && keepsStatus(review, suggested) && review.classification !== '열람' ? suggested.status : review.classification);
  const [target, setTarget] = useState(review.suggestedApplicationId ?? '');
  const [company, setCompany] = useState(review.company ?? '');
  const [role, setRole] = useState(review.roleTitle ?? '');
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
    {(review.company || review.roleTitle) && <p className="mt-1 text-body-sm text-muted-foreground">AI 해석: {review.company ?? '회사 미확인'} · {review.roleTitle ?? '직무 미확인'}{review.suggestedApplicationId ? ' · 같은 회사 지원 건 제안' : ''}</p>}
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
