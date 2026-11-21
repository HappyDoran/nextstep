'use client';
import { useState } from 'react';
import { Check, Mail } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, Segmented, Select, StatePanel, Tag } from '@nextstep/design-system';
import { applicationSchema, mailStatusSchema, reviewBodySchema, reviewSchema, type Me, type Review } from '@nextstep/contracts';
import { buttonIcon as icon, call, useMe, useWhen } from '../api-client';
import { Account } from '../account';
import { Frame, AuthLayout } from '../frame';

const STATUSES = mailStatusSchema.exclude(['모호']).options;
const NO_COMPANY = '회사 미확인';

export function Reviews() {
  const me = useMe();
  if (me.isPending) return <AuthLayout><p role="status" className="text-muted-foreground">계정 상태를 확인하고 있습니다.</p></AuthLayout>;
  if (!me.data) return <AuthLayout><div className="flex flex-col gap-4"><h1 className="text-title-lg">확인 목록</h1><Account /></div></AuthLayout>;
  return <ReviewList me={me.data} />;
}

type AppOption = { id: string; company: string; roleTitle: string; status: string };
const RANK: Record<string, number> = { 미지원: 0, '지원 완료': 1, '전형 진행중': 2, 합격: 3, 불합격: 3 };
// 메일 상태가 지원 건 상태보다 앞 단계이거나 같으면 연결해도 상태가 바뀌지 않는다. 최종 결과끼리 다르면 충돌이라 제외한다.
const keepsStatus = (r: Review, app?: AppOption) => !!app && r.classification !== '모호'
  && (r.classification === app.status || RANK[r.classification]! < RANK[app.status]! || (r.classification === '열람'));

// 사용자 행동이 필요한 메일만 남긴다. 처리하지 않아도 재촉하지 않고 목록에 그대로 둔다.
// 왼쪽은 회사별 대기열, 오른쪽은 고른 메일의 근거와 처리. 처리하면 다음 항목으로 넘어간다(2026-11-18 결정).
function ReviewList({ me }: { me: Me }) {
  const client = useQueryClient();
  const reviews = useQuery({ queryKey: ['reviews', me.id], queryFn: async () => reviewSchema.array().parse(await call('reviews')), retry: false });
  const apps = useQuery({ queryKey: ['applications', me.id], queryFn: async () => applicationSchema.array().parse(await call('applications')), retry: false });
  const [selected, setSelected] = useState<string | null>(null);
  const list = reviews.data ?? [];
  // 보류하지 않은 것을 먼저, 회사별로 묶는다(건수 많은 회사 먼저).
  const groups = [...list.reduce((m, r) => m.set(r.company ?? NO_COMPANY, [...(m.get(r.company ?? NO_COMPANY) ?? []), r]), new Map<string, Review[]>())]
    .sort((a, b) => b[1].filter(r => !r.held).length - a[1].filter(r => !r.held).length || b[1].length - a[1].length);
  const ordered = groups.flatMap(([, items]) => [...items].sort((a, b) => Number(a.held) - Number(b.held)));
  const current = ordered.find(r => r.id === selected) ?? ordered[0] ?? null;
  // 처리한 항목 다음 것을 고른다. 마지막이면 앞의 것.
  const advance = (id: string) => { const i = ordered.findIndex(r => r.id === id); setSelected((ordered[i + 1] ?? ordered[i - 1])?.id ?? null); };
  const refresh = () => { void client.invalidateQueries({ queryKey: ['reviews', me.id] }); void client.invalidateQueries({ queryKey: ['applications', me.id] }); };
  const waiting = list.filter(r => !r.held).length;

  return <Frame me={me} title="확인 목록" description="메일에서 애매하게 읽힌 것만 모았어요"
    actions={reviews.data ? <span className="text-body-sm text-muted-foreground">대기 <b className="tabular-nums text-foreground">{waiting}</b> · 보류 <b className="tabular-nums text-foreground">{list.length - waiting}</b></span> : null}>
    {reviews.isPending ? <p role="status" className="text-muted-foreground">불러오고 있습니다.</p>
      : reviews.isError ? <StatePanel tone="error" title="확인 목록을 불러오지 못했어요" description={reviews.error.message} actions={<Button variant="secondary" onClick={() => { void reviews.refetch(); }}>다시 시도</Button>} />
        : !current ? <StatePanel title="확인할 메일이 없어요" description="확인할 항목이 없습니다. 메일에서 읽은 내용이 애매하면 여기에 모여요." />
          : <div className="grid min-h-[36rem] grid-cols-[22rem_minmax(0,1fr)] overflow-hidden rounded-surface border border-border bg-card">
            <nav aria-label="확인할 메일" className="flex max-h-[calc(100dvh-12rem)] flex-col gap-5 overflow-auto border-r border-border p-4">
              {groups.map(([company, items]) => <QueueGroup key={company} company={company} items={items} apps={apps.data ?? []} currentId={current.id} onSelect={setSelected} onDone={refresh} />)}
            </nav>
            <ReviewDetail key={current.id} review={current} apps={apps.data ?? []} onDone={() => { advance(current.id); refresh(); }} />
          </div>}
  </Frame>;
}

function QueueGroup({ company, items, apps, currentId, onSelect, onDone }: { company: string; items: Review[]; apps: AppOption[]; currentId: string; onSelect: (id: string) => void; onDone: () => void }) {
  // 묶음 연결은 지원 건 상태가 바뀌지 않는 메일(더 앞 단계이거나 같은 결과)만 대상으로 하고 현재 상태를 그대로 보낸다.
  // 확인 목록 확정은 고른 상태로 덮어쓰므로, 메일 상태를 보내면 불합격이 지원 완료로 되돌아갈 수 있다.
  const linkable = items.filter(r => !r.held && keepsStatus(r, apps.find(a => a.id === r.suggestedApplicationId)));
  const target = apps.find(a => a.id === linkable[0]?.suggestedApplicationId);
  // 한 건씩 차례로 보낸다. 중간에 실패하면 멈추고 남은 항목은 목록에 그대로 둔다.
  const bulk = useMutation({
    mutationFn: async ({ list, body }: { list: Review[]; body: (r: Review) => object }) => { for (const r of list) await call(`reviews/${r.id}`, { method: 'POST', body: JSON.stringify(body(r)) }); },
    onSettled: onDone,
  });
  return <section aria-label={`${company} 확인 요청`}>
    <div className="mb-1.5 flex flex-wrap items-center gap-2">
      <h2 className="text-body-sm font-extrabold">{company}</h2><span className="text-caption tabular-nums text-muted-foreground">{items.length}</span>
      <div className="ml-auto flex gap-1">
        {target && linkable.length > 0 && <Button size="sm" variant="quiet" className="text-primary" disabled={bulk.isPending} title={`${target.company} · ${target.roleTitle}`}
          onClick={() => bulk.mutate({ list: linkable, body: r => ({ action: 'link', applicationId: r.suggestedApplicationId, status: apps.find(a => a.id === r.suggestedApplicationId)!.status }) })}>제안대로 {linkable.length}건 연결</Button>}
        {items.length > 1 && <Button size="sm" variant="quiet" disabled={bulk.isPending}
          onClick={() => { if (window.confirm(`${company} ${items.length}건을 모두 무시할까요? 무시한 메일은 다시 묻지 않습니다.`)) bulk.mutate({ list: items, body: () => ({ action: 'ignore' }) }); }}>모두 무시</Button>}
      </div>
    </div>
    {bulk.isError && <p role="alert" className="mb-1 text-caption text-destructive">{bulk.error.message}</p>}
    <ul className="grid gap-1">{items.map(r => <li key={r.id}>
      <button type="button" aria-current={r.id === currentId ? 'true' : undefined} onClick={() => onSelect(r.id)}
        className={`w-full cursor-pointer rounded-control border px-3 py-2.5 text-left focus-visible:outline focus-visible:outline-focus focus-visible:outline-ring ${r.id === currentId ? 'border-primary bg-secondary' : 'border-transparent hover:bg-muted'}`}>
        <span className="flex items-center gap-1.5 text-caption font-bold text-muted-foreground">{r.reason}{r.held && <Tag>보류</Tag>}</span>
        <span className="block truncate text-body-sm font-semibold">{r.subject}</span>
      </button>
    </li>)}</ul>
  </section>;
}

function ReviewDetail({ review, apps, onDone }: { review: Review; apps: AppOption[]; onDone: () => void }) {
  const when = useWhen();
  const [mode, setMode] = useState<'link' | 'create'>('link');
  // 제안된 지원 건이 이미 더 뒤 단계면 그 상태를 기본값으로 둬 오래된 메일로 되돌리지 않게 한다.
  const suggested = apps.find(a => a.id === review.suggestedApplicationId);
  const [status, setStatus] = useState<string>(review.classification === '모호' ? '' : suggested && keepsStatus(review, suggested) && review.classification !== '열람' ? suggested.status : review.classification);
  const [target, setTarget] = useState(review.suggestedApplicationId ?? '');
  const [company, setCompany] = useState(review.company ?? '');
  const [role, setRole] = useState(review.roleTitle ?? '');
  const [fullOpen, setFullOpen] = useState(false);
  // 전체 본문은 열 때만 메일함에서 읽고 화면을 닫으면 버린다(서버도 저장하지 않음).
  const full = useQuery({ queryKey: ['review-body', review.id], enabled: fullOpen, retry: false, gcTime: 0, staleTime: Infinity, queryFn: async () => reviewBodySchema.parse(await call(`reviews/${review.id}/body`)) });
  const act = useMutation({ mutationFn: (body: object) => call(`reviews/${review.id}`, { method: 'POST', body: JSON.stringify(body) }), onSuccess: onDone });
  const canConfirm = !!status && (mode === 'link' ? !!target : !!company.trim() && !!role.trim() && status !== '열람');

  return <section aria-label="선택한 메일" className="flex min-w-0 flex-col">
    <div className="flex max-h-[calc(100dvh-17rem)] flex-col gap-5 overflow-auto px-8 py-7">
      <div>
        <p className="text-caption text-muted-foreground">{review.platform ?? '직접 메일'}{review.receivedAt ? ` · ${when(review.receivedAt)}` : ''}</p>
        <h2 className="mt-1 text-title font-extrabold text-balance">{review.subject}</h2>
      </div>
      <dl className="grid grid-cols-3 gap-2.5 text-body-sm">
        {[['읽은 회사', review.company ?? '읽지 못함'], ['읽은 내용', review.classification], ['확인할 이유', review.reason]].map(([k, v]) => <div key={k} className="rounded-control border border-border px-3.5 py-2.5"><dt className="text-caption text-muted-foreground">{k}</dt><dd className={`mt-0.5 font-bold ${v === '읽지 못함' || v === '모호' ? 'text-warning' : ''}`}>{v}</dd></div>)}
      </dl>
      <div className="rounded-surface border border-border px-5 py-4 text-body-sm">
        <div className="mb-2 flex items-center gap-2 text-caption text-muted-foreground">
          <span>{fullOpen ? '네이버 메일에서 방금 읽어 온 전체 본문 · 저장하지 않아요' : '저장된 근거'}</span>
          <button type="button" onClick={() => setFullOpen(!fullOpen)} className="ml-auto inline-flex cursor-pointer items-center gap-1 font-bold text-primary"><Mail className="size-icon-sm shrink-0 stroke-icon" aria-hidden="true" focusable="false" />{fullOpen ? '접기' : '메일 전체 보기'}</button>
        </div>
        {!fullOpen ? <p className="text-muted-foreground">{review.evidence ? `근거: ${review.evidence}` : '저장된 근거 구절이 없습니다.'}</p>
          : full.isPending ? <p role="status" className="text-muted-foreground">메일함에서 읽고 있습니다.</p>
            : full.isError ? <p role="alert" className="text-destructive">{full.error.message}</p>
              : <p className="max-h-72 overflow-auto whitespace-pre-wrap leading-relaxed">{full.data.text || '본문이 비어 있습니다.'}</p>}
      </div>
      {(review.company || review.roleTitle) && <p className="text-caption text-muted-foreground">메일에서 읽은 내용: {review.company ?? '회사 미확인'} · {review.roleTitle ?? '직무 미확인'}</p>}

      <Segmented label="처리 방법" value={mode} onChange={setMode} options={[{ value: 'link', label: '기존 지원 건에 연결' }, { value: 'create', label: '새 지원 건으로 확정' }]} />
      {mode === 'link' && suggested && target === suggested.id && <div className="flex items-center gap-3 rounded-surface border-2 border-primary bg-secondary px-4 py-3">
        <div className="min-w-0 flex-1"><p className="text-caption font-bold text-secondary-foreground">연결 제안 · 같은 회사 지원 건</p><p className="truncate text-body-sm font-bold">{suggested.company} · {suggested.roleTitle} ({suggested.status})</p></div>
      </div>}
      <div className="grid gap-3 md:grid-cols-2">
        {mode === 'link'
          ? <Field label="지원 건"><Select value={target} onChange={e => setTarget(e.target.value)}><option value="">선택</option>{apps.map(a => <option key={a.id} value={a.id}>{a.company} · {a.roleTitle} ({a.status})</option>)}</Select></Field>
          : <><Field label="회사"><Input value={company} onChange={e => setCompany(e.target.value)} /></Field><Field label="직무"><Input value={role} onChange={e => setRole(e.target.value)} /></Field></>}
        <Field label="반영할 상태"><Select value={status} onChange={e => setStatus(e.target.value)}><option value="">선택</option>{STATUSES.map(s => <option key={s}>{s}</option>)}</Select></Field>
      </div>
      {act.isError && <p role="alert" className="text-body-sm text-destructive">{act.error.message}</p>}
    </div>
    <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border px-8 py-4">
      <Button disabled={act.isPending || !canConfirm} onClick={() => act.mutate(mode === 'link' ? { action: 'link', applicationId: target, status } : { action: 'create', company, roleTitle: role, status })}><Check className={icon} aria-hidden="true" focusable="false" />확정</Button>
      <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ action: 'hold', held: !review.held })}>{review.held ? '보류 해제' : '보류'}</Button>
      <Button variant="quiet" disabled={act.isPending} onClick={() => act.mutate({ action: 'ignore' })}>무시</Button>
      <span className="ml-auto text-caption text-muted-foreground">처리하면 다음 항목으로 넘어가요</span>
    </div>
  </section>;
}
