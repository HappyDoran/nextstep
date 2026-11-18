'use client';
import { useState, type FormEvent } from 'react';
import { ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@nextstep/design-system';
import {
  applicationDetailSchema, applicationImportResultSchema, applicationSchema, applicationStatusSchema, readStatusSchema,
  type Application, type ApplicationStatus, type Me,
} from '@nextstep/contracts';
import { call, fieldClass } from './api-client';

const STATUSES = applicationStatusSchema.options;
const READ_STATUSES = readStatusSchema.options;
const listKey = (userId: string) => ['applications', userId];
const label = 'flex flex-col gap-2 text-body-sm';

// 폼 값 중 빈 공고 URL은 보내지 않는다(등록) 또는 null로 지운다(수정).
function formBody(form: FormData, forUpdate: boolean) {
  const body: Record<string, unknown> = Object.fromEntries(form.entries());
  if (body.postingUrl === '') { if (forUpdate) body.postingUrl = null; else delete body.postingUrl; }
  // 잠금 체크 상자는 여러 값이므로 배열로 보낸다(수정 때만).
  delete body.lock;
  if (forUpdate) body.lockedFields = form.getAll('lock');
  return JSON.stringify(body);
}

export function Applications({ me }: { me: Me }) {
  const client = useQueryClient();
  const key = listKey(me.id);
  const list = useQuery({ queryKey: key, queryFn: async () => applicationSchema.array().parse(await call('applications')), retry: false, refetchOnWindowFocus: false });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ApplicationStatus | '전체'>('전체');
  const [openId, setOpenId] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: async (form: FormData) => applicationSchema.parse(await call('applications', { method: 'POST', body: formBody(form, false) })),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    create.mutate(new FormData(form), { onSuccess: () => form.reset() });
  };

  const needle = query.trim().toLowerCase();
  const items = (list.data ?? []).filter(item => (status === '전체' || item.status === status)
    && (!needle || `${item.company} ${item.roleTitle}`.toLowerCase().includes(needle)));

  return <div className="flex flex-col gap-8">
    <section aria-labelledby="new-application">
      <h2 id="new-application" className="mb-4 text-title">지원 직접 등록</h2>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <label className={label}>회사<input name="company" required maxLength={200} className={fieldClass} /></label>
        <label className={label}>직무<input name="roleTitle" required maxLength={200} className={fieldClass} /></label>
        <label className={label}>공고 URL (선택)<input name="postingUrl" type="url" pattern="https://.*" placeholder="https://" className={fieldClass} /></label>
        <label className={label}>상태<select name="status" defaultValue="미지원" className={fieldClass}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
        <div className="md:col-span-2"><Button type="submit" disabled={create.isPending}>등록</Button></div>
        {create.isError && <p role="alert" className="text-body-sm text-destructive md:col-span-2">{create.error.message}</p>}
      </form>
    </section>

    <ImportCsv userKey={key} />
    <section aria-labelledby="application-list">
      <h2 id="application-list" className="mb-4 text-title">지원 목록</h2>
      <div className="mb-4 grid gap-4 md:grid-cols-[1fr_auto]">
        <label className={label}>검색 (회사·직무)<input type="search" value={query} onChange={e => setQuery(e.target.value)} className={fieldClass} /></label>
        <label className={label}>상태 필터<select value={status} onChange={e => setStatus(e.target.value as ApplicationStatus | '전체')} className={fieldClass}>
          <option>전체</option>{STATUSES.map(s => <option key={s}>{s}</option>)}
        </select></label>
      </div>
      <p className="mb-4 text-body-sm text-muted-foreground">공고 열기는 기본 브라우저로 이동만 합니다. 지원을 마친 뒤 상태를 직접 &lsquo;지원 완료&rsquo;로 바꾸세요.</p>
      {list.isPending ? <p role="status" className="text-muted-foreground">지원 현황을 불러오고 있습니다.</p>
        : list.isError ? <div><p role="alert" className="mb-4 text-destructive">{list.error.message}</p>
          <Button onClick={() => { void list.refetch(); }} disabled={list.isFetching}>{list.isFetching ? <LoaderCircle className="size-icon-md shrink-0 animate-spin stroke-icon motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw className="size-icon-md shrink-0 stroke-icon" aria-hidden="true" />}다시 시도</Button></div>
          : items.length === 0 ? <p role="status" className="text-muted-foreground">{list.data.length === 0 ? '등록한 지원 건이 없습니다.' : '조건에 맞는 지원 건이 없습니다.'}</p>
            : <ul className="flex flex-col gap-3">{items.map(item => <ApplicationItem key={item.id} item={item} userKey={key} open={openId === item.id} onToggle={() => setOpenId(openId === item.id ? null : item.id)} />)}</ul>}
    </section>
  </div>;
}

// 엑셀·Notion에서 내보낸 지원 현황 CSV를 한 번에 옮긴다. 파일은 서버에 남기지 않고 지원 건만 저장한다.
function ImportCsv({ userKey }: { userKey: string[] }) {
  const client = useQueryClient();
  const run = useMutation({
    mutationFn: async (file: File) => applicationImportResultSchema.parse(await call('applications/import', { method: 'POST', body: JSON.stringify({ csv: await file.text() }) })),
    onSuccess: () => { void client.invalidateQueries({ queryKey: userKey }); void client.invalidateQueries({ queryKey: ['reviews', userKey[1]] }); },
  });
  return <section aria-labelledby="import-applications">
    <h2 id="import-applications" className="mb-2 text-title">CSV로 한 번에 등록</h2>
    <p className="mb-4 text-body-sm text-muted-foreground">엑셀·Notion에서 내보낸 CSV를 올리면 지원 건을 한 번에 등록합니다. 필요한 열은 회사·직무·상태(지원 완료·이력서 열람·서류 합격·불합격 등)이고 공고URL은 선택입니다. 이미 있는 회사·직무는 건너뛰고, 확인 목록의 연결 불명 메일은 가져온 지원 건으로 다시 연결해 봅니다.</p>
    <label className={label}>CSV 파일<input type="file" accept=".csv,text/csv" disabled={run.isPending}
      onChange={e => { const file = e.target.files?.[0]; if (file) run.mutate(file); e.target.value = ''; }} className="text-body-sm" /></label>
    {run.isPending && <p role="status" className="mt-2 text-body-sm text-muted-foreground">가져오고 있습니다.</p>}
    {run.data && <p role="status" className="mt-2 text-body-sm">등록 {run.data.imported}건 · 이미 있음 {run.data.duplicates}건 · 형식 오류 {run.data.invalid}건{run.data.requeued ? ` · 확인 요청 ${run.data.requeued}건을 다시 연결하는 중` : ''}</p>}
    {run.isError && <p role="alert" className="mt-2 text-body-sm text-destructive">{run.error.message}</p>}
  </section>;
}

function ApplicationItem({ item, userKey, open, onToggle }: { item: Application; userKey: string[]; open: boolean; onToggle: () => void }) {
  return <li className="rounded-control border border-border p-4">
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <strong className="block text-body font-semibold">{item.company}</strong>
        <span className="text-body-sm text-muted-foreground">{item.roleTitle}</span>
      </div>
      <span className="rounded-control bg-muted px-3 py-1 text-body-sm">{item.status}</span>
      <span className="text-body-sm text-muted-foreground">열람: {item.readStatus}</span>
      {item.postingUrl && <a href={item.postingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-body-sm text-primary underline">
        공고 열기<ExternalLink className="size-icon-sm shrink-0 stroke-icon" aria-hidden="true" /></a>}
      <button type="button" aria-expanded={open} onClick={onToggle} className="min-h-control rounded-control px-3 text-body-sm underline">{open ? '닫기' : '상세·수정'}</button>
    </div>
    {open && <ApplicationDetail id={item.id} userKey={userKey} />}
  </li>;
}

function ApplicationDetail({ id, userKey }: { id: string; userKey: string[] }) {
  const client = useQueryClient();
  const detailKey = [...userKey, id];
  const detail = useQuery({ queryKey: detailKey, queryFn: async () => applicationDetailSchema.parse(await call(`applications/${id}`)), retry: false });
  const refresh = () => client.invalidateQueries({ queryKey: userKey });
  const update = useMutation({
    mutationFn: async (form: FormData) => applicationSchema.parse(await call(`applications/${id}`, { method: 'PATCH', body: formBody(form, true) })),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => call(`applications/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  if (detail.isPending) return <p role="status" className="mt-4 text-body-sm text-muted-foreground">상세를 불러오고 있습니다.</p>;
  if (detail.isError) return <p role="alert" className="mt-4 text-body-sm text-destructive">{detail.error.message}</p>;
  const d = detail.data;
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); update.mutate(new FormData(event.currentTarget)); };
  return <div className="mt-4 border-t border-border pt-4">
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
      <label className={label}>회사<input name="company" defaultValue={d.company} required className={fieldClass} /></label>
      <label className={label}>직무<input name="roleTitle" defaultValue={d.roleTitle} required className={fieldClass} /></label>
      <label className={label}>공고 URL<input name="postingUrl" type="url" pattern="https://.*" defaultValue={d.postingUrl ?? ''} className={fieldClass} /></label>
      <label className={label}>상태<select name="status" defaultValue={d.status} className={fieldClass}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
      <label className={label}>열람<select name="readStatus" defaultValue={d.readStatus} className={fieldClass}>{READ_STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
      <fieldset className="flex flex-col gap-2 text-body-sm md:col-span-2"><legend className="mb-1">잠금 (잠근 값은 메일로 바뀌지 않습니다. 확인 목록에서 직접 확정하면 바뀝니다)</legend>
        <label className="flex items-center gap-2"><input type="checkbox" name="lock" value="status" defaultChecked={d.lockedFields.includes('status')} className="size-icon-md accent-primary" />상태 잠금</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="lock" value="readStatus" defaultChecked={d.lockedFields.includes('readStatus')} className="size-icon-md accent-primary" />열람 잠금</label>
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <Button type="submit" disabled={update.isPending}>저장</Button>
        <Button disabled={remove.isPending} className="border-destructive !bg-transparent !text-destructive" onClick={() => { if (window.confirm('이 지원 건과 변경 이력을 삭제합니다.')) remove.mutate(); }}>삭제</Button>
      </div>
      {(update.isError || remove.isError) && <p role="alert" className="text-body-sm text-destructive md:col-span-2">{(update.error ?? remove.error)?.message}</p>}
      {update.isSuccess && <p role="status" className="text-body-sm text-muted-foreground md:col-span-2">저장했습니다.</p>}
    </form>
    <h3 className="mb-2 mt-6 text-body font-semibold">변경 이력</h3>
    {d.events.length === 0 ? <p className="text-body-sm text-muted-foreground">상태·열람 변경 이력이 없습니다.</p>
      : <ul className="flex flex-col gap-1 text-body-sm text-muted-foreground">{d.events.map(e => <li key={`${e.at}-${e.field}`}>
        {new Date(e.at).toLocaleString('ko-KR')} · {e.field === 'status' ? '상태' : '열람'} {e.from ?? '없음'} → {e.to} ({e.source === 'mail' ? '메일' : e.source === 'import' ? '가져오기' : '직접 수정'})</li>)}</ul>}
  </div>;
}
