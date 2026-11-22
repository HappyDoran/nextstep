'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, Plus, Upload } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, buttonClass, Field, Input, Lane, Row, RowList, RowTrigger, Loading, Segmented, Select, Sheet, Skeleton, StatePanel, Tag, Toast, ToastRegion, toastAction, Toggle } from '@nextstep/design-system';
import {
  applicationDetailSchema, applicationImportResultSchema, applicationSchema, applicationStatusSchema, readStatusSchema,
  type Application, type ApplicationStatus, type Me,
} from '@nextstep/contracts';
import { buttonIcon as icon, call, monthDay, useApplications, useStored, useWhen } from './api-client';
import { Frame } from './frame';

const STATUSES = applicationStatusSchema.options;
const READ_STATUSES = readStatusSchema.options;
const PAGE = 30;

// 폼 값 중 빈 공고 URL은 보내지 않는다(등록) 또는 null로 지운다(수정).
function formBody(form: FormData, forUpdate: boolean) {
  const body: Record<string, unknown> = Object.fromEntries(form.entries());
  if (body.postingUrl === '') { if (forUpdate) body.postingUrl = null; else delete body.postingUrl; }
  // 잠금 토글은 여러 값이므로 배열로 보낸다(수정 때만).
  delete body.lock;
  if (forUpdate) body.lockedFields = form.getAll('lock');
  return body;
}

export function Applications({ me }: { me: Me }) {
  const client = useQueryClient();
  const key = ['applications', me.id];
  const list = useApplications(me, { refetchOnWindowFocus: false });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ApplicationStatus | '전체'>('전체');
  // 묶음 방식과 접은 묶음은 이 기기에 기억한다. 불합격 묶음은 처음에 접어 둔다(2026-11-18 결정).
  const [group, setGroup] = useStored<'상태별' | '회사별'>(me, 'applications.group', '상태별', v => v === '상태별' || v === '회사별');
  const [folded, setFolded] = useStored<Record<string, boolean>>(me, 'applications.folded', { 불합격: true }, v => typeof v === 'object' && !Array.isArray(v));
  const [limit, setLimit] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'new' | 'csv' | null>(null);
  const [created, setCreated] = useState<Application | null>(null);
  const [existed, setExisted] = useState(false);
  const undo = useMutation({ mutationFn: (id: string) => call(`applications/${id}`, { method: 'DELETE' }), onSuccess: () => { setCreated(null); void client.invalidateQueries({ queryKey: key }); } });
  useEffect(() => { if (!created) return; const t = setTimeout(() => setCreated(null), 6000); return () => clearTimeout(t); }, [created]);

  const needle = query.trim().toLowerCase();
  const all = list.data ?? [];
  const items = all.filter(item => (status === '전체' || item.status === status) && (!needle || `${item.company} ${item.roleTitle}`.toLowerCase().includes(needle)));
  const groupOf = (a: Application) => (group === '상태별' ? a.status : a.company);
  const names = group === '상태별' ? STATUSES.filter(s => items.some(i => i.status === s)) : [...new Set(items.map(i => i.company))].sort((a, b) => a.localeCompare(b, 'ko'));
  // 접은 묶음의 줄은 그리지 않으므로 '더 보기' 수에서 뺀다.
  const ordered = names.filter(name => !folded[name]).flatMap(name => items.filter(i => groupOf(i) === name));
  const shown = new Set(ordered.slice(0, limit).map(i => i.id));

  const actions = <>
    <Button variant="secondary" onClick={() => setDialog('csv')}><Upload className={icon} aria-hidden="true" focusable="false" />CSV 가져오기</Button>
    <Button onClick={() => setDialog('new')}><Plus className={icon} aria-hidden="true" focusable="false" />직접 등록</Button>
  </>;
  return <Frame me={me} title="지원 현황" description={list.data ? `전체 ${all.length}건 · 지원한 곳의 진행 상태를 관리해요` : '지원한 곳의 진행 상태를 관리해요'} actions={actions}>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Segmented label="묶는 방식" value={group} onChange={setGroup} options={[{ value: '상태별', label: '상태별' }, { value: '회사별', label: '회사별' }]} />
      <div className="w-72"><Input type="search" aria-label="검색 (회사·직무)" placeholder="회사·직무 검색" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <div className="w-36"><Select aria-label="상태 필터" value={status} onChange={e => setStatus(e.target.value as ApplicationStatus | '전체')}><option value="전체">상태 전체</option>{STATUSES.map(s => <option key={s}>{s}</option>)}</Select></div>
    </div>
    <p className="mb-6 text-caption text-muted-foreground">공고 열기는 기본 브라우저로 이동만 합니다. 지원을 마친 뒤 상태를 직접 &lsquo;지원 완료&rsquo;로 바꾸세요.</p>

    {list.isPending ? <><p role="status" className="sr-only">지원 현황을 불러오고 있습니다.</p><RowList>{[0, 1, 2].map(i => <Row key={i} className="grid-cols-[1fr_10rem]"><div className="grid gap-2"><Skeleton className="h-3.5 w-2/5" /><Skeleton className="w-1/4" /></div><Skeleton className="h-6" /></Row>)}</RowList></>
      : list.isError ? <StatePanel tone="error" title="지원 현황을 불러오지 못했어요" description={list.error.message} actions={<Button variant="secondary" disabled={list.isFetching} onClick={() => { void list.refetch(); }}>다시 시도</Button>} />
        : all.length === 0 ? <StatePanel title="아직 지원 건이 없어요" description="등록한 지원 건이 없습니다. 지원을 마친 공고를 직접 등록하거나, 엑셀·Notion에서 내보낸 CSV로 한 번에 가져오세요. 메일을 연결하면 접수 메일로도 생겨요." actions={<><Button variant="secondary" onClick={() => setDialog('csv')}>CSV 가져오기</Button><Button onClick={() => setDialog('new')}>직접 등록</Button></>} />
          : items.length === 0 ? <p role="status" className="py-10 text-center text-muted-foreground">조건에 맞는 지원 건이 없습니다.</p>
            : <>
              {names.map(name => {
                const rows = items.filter(i => groupOf(i) === name);
                const visible = rows.filter(i => shown.has(i.id));
                // 앞 페이지에 줄이 없는 묶음은 숨긴다. 다만 사용자가 직접 펼친 묶음(folded=false)은 머리를 남기고 더 보기를 준다.
                if (visible.length === 0 && folded[name] === undefined) return null;
                return <Lane key={name} title={name} count={`${rows.length}건`} expanded={!folded[name]} onToggle={() => setFolded({ ...folded, [name]: !folded[name] })}>
                  {visible.length > 0 ? <RowList>{visible.map(item => <ApplicationRow key={item.id} item={item} userKey={key} showStatus={group === '회사별'} onOpen={() => setOpenId(item.id)} />)}</RowList>
                    : <Button size="sm" variant="secondary" onClick={() => setLimit(limit + PAGE)}>{PAGE}건 더 보기</Button>}
                </Lane>;
              })}
              {ordered.length > limit && <div className="flex justify-center"><Button variant="secondary" onClick={() => setLimit(limit + PAGE)}>{PAGE}건 더 보기 <span className="tabular-nums text-primary">{shown.size} / {ordered.length}</span></Button></div>}
            </>}

    {openId && <ApplicationDetail id={openId} userKey={key} onClose={() => setOpenId(null)} />}
    <NewApplication open={dialog === 'new'} userKey={key} onClose={() => setDialog(null)} onCreated={(a, existed) => { setDialog(null); setCreated(a); setExisted(existed); }} />
    <ImportCsv open={dialog === 'csv'} userKey={key} onClose={() => setDialog(null)} />
    <ToastRegion>
      {created && (existed
        ? <Toast>{created.company} · {created.roleTitle}는 이미 등록되어 있어요</Toast>
        : <Toast action={<Button size="sm" variant="quiet" className={toastAction} disabled={undo.isPending} onClick={() => undo.mutate(created.id)}>되돌리기</Button>}>{created.company} · {created.roleTitle}를 등록했어요</Toast>)}
    </ToastRegion>
  </Frame>;
}

/** 한 줄: 회사·직무(누르면 상세), 등록일, 상태(바로 바꿈), 열람, 공고 열기. */
function ApplicationRow({ item, userKey, showStatus, onOpen }: { item: Application; userKey: string[]; showStatus: boolean; onOpen: () => void }) {
  const client = useQueryClient();
  const change = useMutation({
    mutationFn: (status: ApplicationStatus) => call(`applications/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: userKey }),
  });
  return <Row className="grid-cols-[minmax(0,1fr)_5rem_9.5rem_5rem_6rem]">
    <RowTrigger onClick={onOpen}>
      <span className="block truncate text-body font-bold">{item.company}</span>
      <span className="block truncate text-caption text-muted-foreground">{item.roleTitle}{showStatus ? ` · ${item.status}` : ''}{item.lockedFields.length ? ' · 잠금' : ''}</span>
    </RowTrigger>
    <span className="text-caption tabular-nums text-muted-foreground">등록 {monthDay(item.createdAt)}</span>
    <div className="relative z-10"><Select size="sm" aria-label="상태" value={item.status} disabled={change.isPending} onChange={e => change.mutate(e.target.value as ApplicationStatus)} className="w-full">{STATUSES.map(s => <option key={s}>{s}</option>)}</Select></div>
    <span className={`text-caption ${item.readStatus === '열람' ? 'font-bold text-primary' : 'text-muted-foreground'}`}>{item.readStatus === '열람' ? '열람함' : item.readStatus}</span>
    <span className="relative z-10 justify-self-end">{item.postingUrl ? <a href={item.postingUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('quiet', 'sm')}>공고 열기<ExternalLink className="size-icon-sm shrink-0 stroke-icon" aria-hidden="true" focusable="false" /></a> : null}</span>
    {change.isError && <p role="alert" className="col-span-full text-caption text-destructive">{change.error.message}</p>}
  </Row>;
}

function NewApplication({ open, userKey, onClose, onCreated }: { open: boolean; userKey: string[]; onClose: () => void; onCreated: (a: Application, existed: boolean) => void }) {
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: async (form: FormData) => applicationSchema.parse(await call('applications', { method: 'POST', body: JSON.stringify(formBody(form, false)) })),
    // 같은 공고 URL의 지원 건이 이미 있으면 서버가 그 건을 돌려준다. 새로 만든 건만 되돌리기를 보인다(기존 건을 지우지 않게).
    onSuccess: a => { const existed = client.getQueryData<Application[]>(userKey)?.some(x => x.id === a.id) ?? false; void client.invalidateQueries({ queryKey: userKey }); onCreated(a, existed); },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; create.mutate(new FormData(form), { onSuccess: () => form.reset() }); };
  return <Sheet open={open} onClose={onClose} size="sm" title="지원 직접 등록">
    <form id="new-application" onSubmit={submit} className="grid gap-4">
      <Field label="회사"><Input name="company" required maxLength={200} placeholder="예: 예시커머스" /></Field>
      <Field label="직무"><Input name="roleTitle" required maxLength={200} placeholder="예: 프론트엔드 개발자" /></Field>
      <Field label="공고 URL" help="선택. https 주소만"><Input name="postingUrl" type="url" pattern="https://.*" placeholder="https://" /></Field>
      <Field label="상태"><Select name="status" defaultValue="미지원">{STATUSES.map(s => <option key={s}>{s}</option>)}</Select></Field>
      {create.isError && <p role="alert" className="text-body-sm text-destructive">{create.error.message}</p>}
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button type="submit" disabled={create.isPending}>등록</Button></div>
    </form>
  </Sheet>;
}

// 엑셀·Notion에서 내보낸 지원 현황 CSV를 한 번에 옮긴다. 파일은 서버에 남기지 않고 지원 건만 저장한다.
function ImportCsv({ open, userKey, onClose }: { open: boolean; userKey: string[]; onClose: () => void }) {
  const client = useQueryClient();
  const run = useMutation({
    mutationFn: async (file: File) => applicationImportResultSchema.parse(await call('applications/import', { method: 'POST', body: JSON.stringify({ csv: await file.text() }) })),
    onSuccess: () => { void client.invalidateQueries({ queryKey: userKey }); void client.invalidateQueries({ queryKey: ['reviews', userKey[1]] }); },
  });
  return <Sheet open={open} onClose={onClose} size="sm" title="CSV로 한 번에 등록" meta="엑셀·Notion에서 내보낸 지원 현황">
    <p className="text-body-sm text-muted-foreground">필요한 열은 회사·직무·상태(지원 완료·이력서 열람·서류 합격·불합격 등)이고 공고URL은 선택입니다. 이미 있는 회사·직무는 건너뛰고, 확인 목록의 연결 불명 메일은 가져온 지원 건으로 다시 연결해 봅니다. 파일은 서버에 남기지 않습니다.</p>
    <Field label="CSV 파일"><input type="file" accept=".csv,text/csv" disabled={run.isPending} onChange={e => { const file = e.target.files?.[0]; if (file) run.mutate(file); e.target.value = ''; }} className="w-full cursor-pointer rounded-control border-2 border-dashed border-border-strong bg-background p-4 text-body-sm text-muted-foreground file:mr-3 file:h-control-sm file:cursor-pointer file:rounded-control file:border file:border-border-strong file:bg-card file:px-3 file:font-semibold file:text-foreground" /></Field>
    {run.isPending && <p role="status" className="text-body-sm text-muted-foreground">가져오고 있습니다.</p>}
    {run.data && <p role="status" className="text-body-sm">등록 {run.data.imported}건 · 이미 있음 {run.data.duplicates}건 · 형식 오류 {run.data.invalid}건{run.data.requeued ? ` · 확인 요청 ${run.data.requeued}건을 다시 연결하는 중` : ''}</p>}
    {run.isError && <p role="alert" className="text-body-sm text-destructive">{run.error.message}</p>}
  </Sheet>;
}

const fieldsOf = (a: Application): Record<string, unknown> => ({ company: a.company, roleTitle: a.roleTitle, status: a.status, readStatus: a.readStatus, postingUrl: a.postingUrl, lockedFields: a.lockedFields });

function ApplicationDetail({ id, userKey, onClose }: { id: string; userKey: string[]; onClose: () => void }) {
  const time = useWhen();
  const client = useQueryClient();
  const detailKey = [...userKey, id];
  const detail = useQuery({ queryKey: detailKey, queryFn: async () => applicationDetailSchema.parse(await call(`applications/${id}`)), retry: false });
  const refresh = () => client.invalidateQueries({ queryKey: userKey });
  // 바꾼 값만 보낸다. 폼이 처음 보여 준 값(저장하면 저장한 값)과 비교해, 창을 연 뒤 메일이 바꾼 상태·열람을 덮어쓰지 않게 한다.
  const [base, setBase] = useState<Record<string, unknown> | null>(null);
  if (detail.data && !base) setBase(fieldsOf(detail.data));
  const update = useMutation({
    mutationFn: async (form: FormData) => {
      const body = formBody(form, true);
      const same = (a: unknown, b: unknown) => (Array.isArray(a) && Array.isArray(b) ? [...a].sort().join() === [...b].sort().join() : a === b);
      for (const k of Object.keys(body)) if (same(body[k], base?.[k])) delete body[k];
      if (Object.keys(body).length === 0) return null;
      return applicationSchema.parse(await call(`applications/${id}`, { method: 'PATCH', body: JSON.stringify(body) }));
    },
    onSuccess: a => { if (a) setBase(fieldsOf(a)); void refresh(); },
  });
  const remove = useMutation({ mutationFn: () => call(`applications/${id}`, { method: 'DELETE' }), onSuccess: () => { void refresh(); onClose(); } });
  const d = detail.data;
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); update.mutate(new FormData(event.currentTarget)); };
  return <Sheet open onClose={onClose} title={d?.company ?? '지원 상세'} eyebrow={d ? <Tag>{d.status}</Tag> : null} meta={d?.roleTitle ?? null}
    footer={d ? <>
      <Button variant="danger" disabled={remove.isPending} onClick={() => { if (window.confirm('이 지원 건과 변경 이력을 삭제합니다.')) remove.mutate(); }}>삭제</Button>
      <div className="ml-auto flex gap-2">
        {d.postingUrl && <a href={d.postingUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary')}><ExternalLink className={icon} aria-hidden="true" focusable="false" />공고 원문</a>}
        <Button type="submit" form="application-form" disabled={update.isPending}>저장</Button>
      </div>
    </> : null}>
    {detail.isPending ? <Loading label="상세를 불러오고 있습니다." lines={6} />
      : detail.isError ? <p role="alert" className="text-body-sm text-destructive">{detail.error.message}</p>
        : d && <>
          <form id="application-form" onSubmit={submit} className="grid gap-4 md:grid-cols-2">
            <Field label="회사"><Input name="company" defaultValue={d.company} required /></Field>
            <Field label="직무"><Input name="roleTitle" defaultValue={d.roleTitle} required /></Field>
            <Field label="상태"><Select name="status" defaultValue={d.status}>{STATUSES.map(s => <option key={s}>{s}</option>)}</Select></Field>
            <Field label="열람"><Select name="readStatus" defaultValue={d.readStatus}>{READ_STATUSES.map(s => <option key={s}>{s}</option>)}</Select></Field>
            <div className="md:col-span-2"><Field label="공고 URL"><Input name="postingUrl" type="url" pattern="https://.*" defaultValue={d.postingUrl ?? ''} /></Field></div>
            <fieldset className="grid gap-2 md:col-span-2"><legend className="mb-1 text-caption text-muted-foreground">잠근 값은 메일로 바뀌지 않습니다. 확인 목록에서 직접 확정하면 바뀝니다.</legend>
              <Toggle name="lock" value="status" defaultChecked={d.lockedFields.includes('status')}>상태 잠금</Toggle>
              <Toggle name="lock" value="readStatus" defaultChecked={d.lockedFields.includes('readStatus')}>열람 잠금</Toggle>
            </fieldset>
          </form>
          {(update.isError || remove.isError) && <p role="alert" className="text-body-sm text-destructive">{(update.error ?? remove.error)?.message}</p>}
          {update.isSuccess && <p role="status" className="text-body-sm text-muted-foreground">저장했습니다.</p>}
          <section>
            <h3 className="mb-2 text-body-sm font-extrabold">변경 이력 <span className="tabular-nums text-muted-foreground">{d.events.length}</span></h3>
            {d.events.length === 0 ? <p className="text-body-sm text-muted-foreground">상태·열람 변경 이력이 없습니다.</p>
              : <ol className="grid gap-2 text-body-sm">{d.events.map(e => <li key={`${e.at}-${e.field}`} className="grid grid-cols-[8.5rem_1fr] gap-2">
                <time className="tabular-nums text-muted-foreground">{time(e.at)}</time>
                <span>{e.field === 'status' ? '상태' : '열람'} {e.from ?? '없음'} → {e.to} <span className="text-muted-foreground">({e.source === 'mail' ? '메일' : e.source === 'import' ? '가져오기' : '직접 수정'})</span></span>
              </li>)}</ol>}
          </section>
        </>}
  </Sheet>;
}
