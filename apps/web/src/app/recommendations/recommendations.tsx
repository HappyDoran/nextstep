'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Check, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, buttonClass, ClassLabel, classTag, DueDate, Field, Input, Lane, Row, RowList, RowTrigger, Select, Sheet, Skeleton, StatePanel, Tag, Toggle } from '@nextstep/design-system';
import { applicationSchema, jobSchema, profileSchema, resumeSchema, recommendationClassSchema, recommendationListSchema, type Job, type Me, type Recommendation } from '@nextstep/contracts';
import { ACTIVE_JOB, AI_CAUSES, buttonIcon as icon, call, monthDay, optional, SOURCE_NAMES, useMailConnection, useMe, useStored, useWhen } from '../api-client';
import { Account } from '../account';
import { Frame, AuthLayout, progressText, useLatestRefresh } from '../frame';
import { formatWhen } from '../prefs';

const CLASSES = recommendationClassSchema.options;
// 사용자가 제외에서 되살린 공고는 '복구' 묶음으로 따로 본다.
const GROUPS = [...CLASSES, '복구'] as const;
type Group = (typeof GROUPS)[number];
const groupOf = (i: Recommendation): Group => (i.restored ? '복구' : i.classification);
const DAY = 86_400_000;
const PAGE = 30;
const ERRORS: Record<string, string> = {
  profile_or_resume_missing: '설정에서 이력서와 프로필을 먼저 저장하세요.',
  collect_failed: '공고를 가져오지 못했습니다. 잠시 후 다시 시도하세요.',
  unsupported_link: '지원하지 않는 링크입니다.',
  lease_expired: '처리 시간이 초과되었습니다. 다시 시도하세요.',
  fetch_blocked: '공고 사이트가 접속을 막았습니다. 잠시 후 다시 시도하세요.',
  fetch_not_found: '공고를 찾을 수 없습니다(마감·삭제).',
  fetch_http_error: '공고 사이트 응답 오류입니다. 잠시 후 다시 시도하세요.',
  fetch_network: '공고 사이트에 연결하지 못했습니다.',
  fetch_parse_failed: '공고 화면 형식을 읽지 못했습니다.',
  internal: '처리 중 오류가 났습니다. 다시 시도하세요.',
};

function JobStatus({ job }: { job: Job | null }) {
  const when = useWhen();
  if (!job) return null;
  const result = job.result as { collected?: number; judged?: number; sourceFailures?: string[]; aiFailures?: number; aiFailureCodes?: Record<string, number> } | null;
  const aiCauses = Object.keys(result?.aiFailureCodes ?? {}).map(c => AI_CAUSES[c]).filter(Boolean);
  const text = job.status === '대기' ? '공고 가져오기를 기다리고 있습니다.' : job.status === '실행중' ? `${progressText(job.result)}. 창을 닫아도 서버에서 계속합니다.`
    : job.status === '실패' ? `실패: ${ERRORS[job.errorCode ?? ''] ?? job.errorCode ?? '알 수 없는 오류'}`
      : `${job.status}: 공고 ${result?.collected ?? 0}건 확인, ${result?.judged ?? 0}건 판정${result?.sourceFailures?.length ? ` · 출처 실패 ${result.sourceFailures.length}건(${[...new Set(result.sourceFailures.map(f => f.split(':')[0]))].join(', ')})` : ''}${result?.aiFailures ? ` · 분석 실패 ${result.aiFailures}건${aiCauses.length ? `(${aiCauses.join(', ')})` : ''}` : ''}`;
  return <p role="status" className={`mb-4 text-body-sm ${job.status === '실패' ? 'text-destructive' : 'text-muted-foreground'}`}>{text}{job.finishedAt ? ` (${when(job.finishedAt)})` : ''}</p>;
}

export function Recommendations() {
  const me = useMe();
  if (me.isPending) return <AuthLayout><p role="status" className="text-muted-foreground">계정 상태를 확인하고 있습니다.</p></AuthLayout>;
  if (!me.data) return <AuthLayout><div className="flex flex-col gap-4"><h1 className="text-title-lg">추천</h1><p>로그인 후 이용하세요.</p><Account /></div></AuthLayout>;
  return <RecommendationList me={me.data} />;
}

/** 마감 묶음: 남은 날로 나눈다. 상시·마감 미확인은 맨 뒤. */
function laneOf(i: Recommendation, now: number) {
  if (i.alwaysHire) return '상시 채용';
  if (!i.deadline) return '마감 미확인';
  const days = Math.floor((Date.parse(i.deadline) - now) / DAY);
  return days < 0 ? '마감 지남' : days < 7 ? '7일 안에 마감' : days < 14 ? '2주 안에 마감' : '그 이후';
}
const DUE_LANES = ['7일 안에 마감', '2주 안에 마감', '그 이후', '상시 채용', '마감 미확인', '마감 지남'];
const isBool = (v: unknown) => typeof v === 'boolean';
const dueTime = (i: Recommendation) => (i.alwaysHire || !i.deadline ? Infinity : Date.parse(i.deadline));

function RecommendationList({ me }: { me: Me }) {
  const client = useQueryClient();
  const key = ['recommendations', me.id];
  const list = useQuery({ queryKey: key, queryFn: async () => recommendationListSchema.parse(await call('recommendations')), retry: false, refetchOnWindowFocus: false });
  const [jobId, setJobId] = useState<string | null>(null);
  // 처리중일 때만 작업 상태를 조회하고 끝나면 멈춘다. 끝나면 추천 목록과 상태바를 다시 읽는다.
  const job = useQuery({
    queryKey: ['jobs', me.id, jobId], enabled: Boolean(jobId), retry: false,
    queryFn: async () => {
      const j = jobSchema.parse(await call(`jobs/${jobId}`));
      if (!ACTIVE_JOB.includes(j.status)) { void client.invalidateQueries({ queryKey: key }); void client.invalidateQueries({ queryKey: ['jobs', 'latest', me.id] }); }
      return j;
    },
    // 작업 조회가 실패하면(서버 중단·404) 화면을 잠그지 않고 30초마다만 다시 본다.
    refetchInterval: q => (q.state.data && !ACTIVE_JOB.includes(q.state.data.status) ? false : q.state.status === 'error' ? 30_000 : 3000),
  });
  const running = Boolean(jobId) && !job.isError && (!job.data || ACTIVE_JOB.includes(job.data.status));
  // 다른 화면·트레이·자동 갱신이 시작한 갱신도 따라간다: 상태바가 읽는 마지막 갱신이 처리 중이면 그 작업을 조회 대상으로 삼는다.
  const latest = useLatestRefresh(me).data?.job;
  if (latest && ACTIVE_JOB.includes(latest.status) && latest.id !== jobId && !running) setJobId(latest.id);
  const refresh = useMutation({ mutationFn: async () => jobSchema.parse(await call('postings/refresh', { method: 'POST' })), onSuccess: j => setJobId(j.id) });
  const link = useMutation({
    mutationFn: async (url: string) => jobSchema.parse(await call('postings/link', { method: 'POST', body: JSON.stringify({ url }), messages: { 400: '사람인·잡코리아·자소설닷컴·원티드·점핏 공고 상세 링크(https)를 넣으세요.', 409: '앞서 넣은 링크를 처리하는 중이에요. 끝난 뒤 다시 넣으세요.' } })),
    onSuccess: j => { setJobId(j.id); setLinkOpen(false); },
  });
  const [linkOpen, setLinkOpen] = useState(false);
  // 보는 방식만 바꾼다(서버 판정은 그대로): 분류·출처·마감 임박·관심 없음·정렬은 이 기기에 기억하고 검색어는 기억하지 않는다.
  const [filter, setFilter] = useStored<Group | null>(me, 'recommendations.class', null, v => (GROUPS as readonly unknown[]).includes(v));
  const [showHidden, setShowHidden] = useStored(me, 'recommendations.hidden', false, isBool);
  const [source, setSource] = useStored<keyof typeof SOURCE_NAMES | '전체'>(me, 'recommendations.source', '전체', v => v === '전체' || (typeof v === 'string' && Object.hasOwn(SOURCE_NAMES, v)));
  const [soon, setSoon] = useStored(me, 'recommendations.soon', false, isBool);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useStored<'마감순' | '분류순'>(me, 'recommendations.sort', '마감순', v => v === '마감순' || v === '분류순');
  const [limit, setLimit] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  const busy = running || refresh.isPending || link.isPending;
  const currentJob = job.data ?? list.data?.lastJob ?? null;
  const all = list.data?.items ?? [];
  // 창을 며칠 띄워 둬도 D-day·마감 묶음·7일 안 필터가 맞도록 1분마다 기준 시각을 다시 잡는다.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id); }, []);
  const q = search.trim().toLowerCase();
  const matches = (i: Recommendation) => i.hidden === showHidden && (source === '전체' || i.source === source)
    && (!soon || (!i.alwaysHire && i.deadline !== null && Date.parse(i.deadline) >= now && Date.parse(i.deadline) - now <= 7 * DAY))
    && (!q || `${i.title} ${i.company}`.toLowerCase().includes(q));
  const visible = all.filter(matches);
  const counts = Object.fromEntries(GROUPS.map(g => [g, visible.filter(i => groupOf(i) === g).length])) as Record<Group, number>;
  const items = visible.filter(i => !filter || groupOf(i) === filter)
    // 마감순은 그리는 묶음 순서(마감 지남이 맨 뒤)대로 먼저 나눠야 앞 30건이 화면 위 묶음부터 채워진다.
    .sort((a, b) => sort === '분류순' ? GROUPS.indexOf(groupOf(a)) - GROUPS.indexOf(groupOf(b)) || dueTime(a) - dueTime(b)
      : DUE_LANES.indexOf(laneOf(a, now)) - DUE_LANES.indexOf(laneOf(b, now)) || dueTime(a) - dueTime(b));
  const shown = items.slice(0, limit);
  const lanes = (sort === '마감순' ? DUE_LANES : [...GROUPS]).map(name => ({
    name,
    total: items.filter(i => (sort === '마감순' ? laneOf(i, now) : groupOf(i)) === name).length,
    rows: shown.filter(i => (sort === '마감순' ? laneOf(i, now) : groupOf(i)) === name),
  })).filter(l => l.rows.length > 0);
  const opened = all.find(i => i.postingId === openId) ?? null;
  const submitLink = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); link.mutate(String(new FormData(e.currentTarget).get('url'))); };

  const actions = <>
    <Button variant="secondary" onClick={() => setLinkOpen(true)}>링크로 판정</Button>
    <Button disabled={busy} onClick={() => refresh.mutate()}>{busy ? <LoaderCircle className={`${icon} animate-spin motion-reduce:animate-none`} aria-hidden="true" focusable="false" /> : <RefreshCw className={icon} aria-hidden="true" focusable="false" />}새로 가져오기</Button>
  </>;
  return <Frame me={me} title="추천" description="서류와 희망 조건으로 고른 공고" actions={actions}>
    <JobStatus job={currentJob} />
    {refresh.isError && <p role="alert" className="mb-4 text-body-sm text-destructive">{refresh.error.message}</p>}

    <div className="mb-4 flex flex-wrap items-center gap-1.5 text-body-sm text-muted-foreground" role="group" aria-label="분류 필터">
      <span className="mr-1">판정 <b className="text-foreground tabular-nums">{visible.length}</b>건 중</span>
      {GROUPS.filter(g => g !== '복구' || counts[g] > 0).map(g => <button key={g} type="button" aria-pressed={filter === g} onClick={() => { setFilter(filter === g ? null : g); setLimit(PAGE); }}
        className={`inline-flex h-control-sm cursor-pointer items-center gap-1.5 rounded-full border px-3 focus-visible:outline focus-visible:outline-focus focus-visible:outline-ring ${filter === g ? 'border-border-strong bg-card font-semibold text-foreground' : 'border-transparent hover:bg-muted'}`}>
        {g === '복구' ? g : <ClassLabel classification={g} />} <b className="tabular-nums text-foreground">{counts[g]}</b>
      </button>)}
      {filter && <button type="button" onClick={() => setFilter(null)} className="ml-1 cursor-pointer font-semibold text-primary">전체 보기</button>}
    </div>

    <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="보기 조건">
      <div className="w-72"><Input aria-label="검색(제목·회사)" placeholder="공고·회사 검색" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="w-36"><Select aria-label="출처" value={source} onChange={e => setSource(e.target.value as typeof source)}>
        <option value="전체">출처 전체</option>{Object.entries(SOURCE_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select></div>
      <Toggle checked={soon} onChange={e => setSoon(e.target.checked)}>7일 안에 마감</Toggle>
      <Toggle checked={showHidden} onChange={e => setShowHidden(e.target.checked)}>관심 없음만 보기</Toggle>
      <div className="ml-auto w-32"><Select aria-label="정렬" value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option>마감순</option><option>분류순</option></Select></div>
    </div>
    <FilterSummary me={me} />

    {list.isPending ? <><p role="status" className="sr-only">추천을 불러오고 있습니다.</p><RowList>{[0, 1, 2, 3].map(i => <Row key={i} className="grid-cols-[4.5rem_1fr_5rem]"><Skeleton className="w-10" /><div className="grid gap-2"><Skeleton className="h-3.5 w-3/5" /><Skeleton className="w-1/3" /></div><Skeleton className="h-4 w-10 justify-self-end" /></Row>)}</RowList></>
      : list.isError ? <StatePanel tone="error" title="추천을 불러오지 못했어요" description={list.error.message} actions={<Button variant="secondary" onClick={() => { void list.refetch(); }}>다시 시도</Button>} />
        : all.length === 0 ? <SetupSteps me={me} busy={busy} onRefresh={() => refresh.mutate()} />
          : items.length === 0 ? <p role="status" className="py-10 text-center text-muted-foreground">조건에 맞는 추천이 없습니다.</p>
            : <>
              {lanes.map(l => <Lane key={l.name} title={l.name} count={`${l.total}건`}>
                <RowList>{l.rows.map(item => <Row key={item.postingId} classification={item.classification} className="grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,16rem)_5rem]">
                  <ClassLabel classification={item.classification} />
                  <RowTrigger onClick={() => setOpenId(item.postingId)}>
                    <span className="block truncate text-body font-bold">{item.title}</span>
                    <span className="block truncate text-caption text-muted-foreground">{item.company} · {SOURCE_NAMES[item.source]}{item.linkOnly ? ' · 링크 판정' : ''}{item.restored ? ' · 직접 복구' : ''}{item.feedback === 'up' ? ' · 좋아요' : ''}</span>
                  </RowTrigger>
                  <span className="line-clamp-2 text-caption text-muted-foreground">{item.reason}</span>
                  <DueDate days={item.alwaysHire || !item.deadline ? null : Math.floor((Date.parse(item.deadline) - now) / DAY)} {...(item.deadline && !item.alwaysHire ? { date: monthDay(item.deadline) } : {})} />
                </Row>)}</RowList>
              </Lane>)}
              {items.length > limit && <div className="flex justify-center"><Button variant="secondary" onClick={() => setLimit(limit + PAGE)}>{PAGE}건 더 보기 <span className="tabular-nums text-primary">{shown.length} / {items.length}</span></Button></div>}
            </>}

    {opened && <Detail item={opened} me={me} listKey={key} onClose={() => setOpenId(null)} />}
    <Sheet open={linkOpen} onClose={() => setLinkOpen(false)} size="sm" title="공고 링크로 판정" meta="사람인·잡코리아·자소설닷컴·원티드·점핏 공고 상세 링크">
      <form onSubmit={submitLink} className="grid gap-4">
        <Field label="공고 링크" {...(link.isError ? { error: link.error.message } : {})}><Input name="url" type="url" required pattern="https://.*" placeholder="https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=…" aria-invalid={link.isError} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setLinkOpen(false)}>취소</Button><Button type="submit" disabled={busy}>판정</Button></div>
      </form>
    </Sheet>
  </Frame>;
}

function Detail({ item, me, listKey, onClose }: { item: Recommendation; me: Me; listKey: string[]; onClose: () => void }) {
  const when = useWhen();
  const client = useQueryClient();
  const hide = useMutation({ mutationFn: (hidden: boolean) => call(`recommendations/${item.postingId}/hide`, { method: 'PUT', body: JSON.stringify({ hidden }) }), onSuccess: () => client.invalidateQueries({ queryKey: listKey }) });
  // 피드백(좋아요는 같은 분류 안에서 위로, 별로는 숨김)과 제외 복구는 내 목록에만 반영된다.
  const feedback = useMutation({ mutationFn: (body: { feedback?: 'up' | 'down' | null; restored?: boolean }) => call(`recommendations/${item.postingId}/feedback`, { method: 'PUT', body: JSON.stringify(body) }), onSuccess: () => client.invalidateQueries({ queryKey: listKey }) });
  // 지원 현황에 미지원으로 저장만 한다. 지원 완료는 사용자가 직접 바꾼다.
  const track = useMutation({
    mutationFn: () => call('applications', { method: 'POST', body: JSON.stringify({ company: item.company.slice(0, 200), roleTitle: item.title.slice(0, 200), postingUrl: item.url }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['applications', me.id] }),
  });
  // 이미 같은 공고 URL로 저장한 지원 건이 있으면 저장됨으로 보인다(서버도 같은 URL은 새로 만들지 않는다).
  const apps = useQuery({ queryKey: ['applications', me.id], queryFn: async () => applicationSchema.array().parse(await call('applications')), retry: false, refetchOnWindowFocus: false });
  const saved = track.isSuccess || Boolean(apps.data?.some(a => a.postingUrl === item.url));
  const deadline = item.alwaysHire ? '상시채용' : item.deadline ? formatWhen(item.deadline, 'absolute') : '마감 미확인';
  const size = item.companyType || item.employeeCount ? [item.companyType, item.employeeCount ? `${item.employeeCount}명` : null].filter(Boolean).join(' · ') : '기업 유형·규모 미확인';
  const reasonTone = classTag[item.classification];
  const section = (title: string, mark: string, tone: string, values: string[]) => <section>
    <h3 className="mb-2 text-body-sm font-extrabold">{title} <span className="text-muted-foreground tabular-nums">{values.length}</span></h3>
    {values.length ? <ul className="grid gap-1.5 text-body-sm">{values.map(v => <li key={v} className="flex gap-2.5"><span aria-hidden="true" className={`w-4 shrink-0 text-center font-extrabold ${tone}`}>{mark}</span>{v}</li>)}</ul> : <p className="text-body-sm text-muted-foreground">없음</p>}
  </section>;
  const error = hide.error ?? track.error ?? feedback.error;
  return <Sheet open onClose={onClose} classification={item.classification} title={item.title}
    eyebrow={<div className="flex flex-wrap gap-1.5"><Tag classification={item.classification} />{item.restored && <Tag>직접 복구</Tag>}{item.feedback === 'up' && <Tag>좋아요</Tag>}</div>}
    meta={`${item.company} · ${SOURCE_NAMES[item.source]}${item.linkOnly ? ' · 링크 판정' : ''}`}
    footer={<>
      <Button variant="quiet" disabled={hide.isPending || feedback.isPending} onClick={() => item.feedback === 'down' ? feedback.mutate({ feedback: null }) : hide.mutate(!item.hidden)}>{item.hidden ? '숨김 해제' : '관심 없음'}</Button>
      <div className="ml-auto flex flex-wrap gap-2">
        <Button variant="secondary" disabled={track.isPending || saved} onClick={() => track.mutate()}>{saved ? '지원 현황에 저장됨' : '지원 현황에 저장'}</Button>
        {item.externalApplyUrl && <a href={item.url} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary')}>원문 보기</a>}
        <a href={item.externalApplyUrl ?? item.url} target="_blank" rel="noopener noreferrer" className={buttonClass()}><ExternalLink className={icon} aria-hidden="true" focusable="false" />지원 페이지 열기</a>
      </div>
    </>}>
    <dl className="grid grid-cols-2 overflow-hidden rounded-surface border border-border text-body-sm md:grid-cols-4">
      {[['마감', deadline], ['모집 상태', item.postingStatus], ['기업 규모', size], ['마지막 확인', when(item.checkedAt)]].map(([k, v]) => <div key={k} className="border-border px-4 py-3 [&:not(:first-child)]:border-l"><dt className="text-caption text-muted-foreground">{k}</dt><dd className="mt-0.5 font-bold">{v}</dd></div>)}
    </dl>
    <div className={`rounded-surface px-4 py-3.5 ${reasonTone}`}><p className="text-caption font-bold">{item.classification}으로 본 이유</p><p className="text-body-sm font-semibold text-foreground">{item.reason}</p></div>
    {section('맞는 점', '✓', 'text-class-basic', item.met)}
    {section('불충족', '✕', 'text-class-exclude', item.unmet)}
    {section('확인 못 한 조건', '?', 'text-muted-foreground', item.unknown)}
    <div className="flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
      이 판정이 맞나요?
      <Button size="sm" variant="secondary" aria-pressed={item.feedback === 'up'} disabled={feedback.isPending} onClick={() => feedback.mutate({ feedback: item.feedback === 'up' ? null : 'up' })}>{item.feedback === 'up' ? '좋아요 취소' : '좋아요'}</Button>
      {item.feedback !== 'down' && <Button size="sm" variant="secondary" disabled={feedback.isPending} onClick={() => feedback.mutate({ feedback: 'down' })}>별로예요</Button>}
      {(item.classification === '제외' || item.restored) && <Button size="sm" variant="secondary" disabled={feedback.isPending} onClick={() => feedback.mutate({ restored: !item.restored })}>{item.restored ? '복구 취소' : '제외 복구'}</Button>}
    </div>
    <p className="text-caption text-muted-foreground">공고 확인 {when(item.checkedAt)} · 판정 {when(item.evaluatedAt)}. 지원은 기본 브라우저에서 직접 하고, 마치면 지원 현황에서 상태를 바꾸세요.</p>
    {error && <p role="alert" className="text-body-sm text-destructive">{error.message}</p>}
  </Sheet>;
}

// 지금 적용 중인 공고 필터. 사용자가 고른 값만 보여 주고 바꾸는 곳(설정)으로 안내한다.
function FilterSummary({ me }: { me: Me }) {
  const profile = useQuery({
    queryKey: ['profile', me.id], retry: false,
    queryFn: async () => (await optional('profile')) as { profile: unknown; updatedAt: string } | null,
  });
  const p = profile.data ? profileSchema.safeParse(profile.data.profile) : null;
  if (!p?.success) return <p className="mb-6 text-caption text-muted-foreground">공고 필터가 없습니다. <a href="#settings-profile" className="font-semibold text-primary">설정</a>에서 프로필과 필터를 저장하세요.</p>;
  const f = p.data;
  const text = [
    f.jobFamilies.join('·'),
    `${f.regions.length ? f.regions.join('·') : '전국'}${f.remoteOk ? '(+전면 원격)' : ''}`,
    f.employmentTypes.length ? f.employmentTypes.join('·') : '고용 형태 전체',
    f.careerMax === null ? '경력 제한 없음' : `경력 ${f.careerMax}년 이하`,
  ].join(' · ');
  return <p className="mb-6 text-caption text-muted-foreground" aria-label="적용 중인 공고 필터">적용 중인 필터: {text} <a href="#settings-profile" className="ml-1 font-semibold text-primary">필터 바꾸기</a></p>;
}

/** 추천이 없는 첫 화면: 시작 단계와 완료 여부(기획서 4절 사용 편의). 각 단계는 설정 창의 해당 구역을 연다. */
function SetupSteps({ me, busy, onRefresh }: { me: Me; busy: boolean; onRefresh: () => void }) {
  // 설정 화면들과 같은 쿼리 키를 써서 거기서 저장하면 여기도 바로 바뀐다.
  const resume = useQuery({ queryKey: ['documents', 'resume', me.id], retry: false, queryFn: async () => { const doc = await optional('documents/resume'); return doc === null ? null : resumeSchema.parse(doc); } });
  const profile = useQuery({ queryKey: ['profile', me.id], retry: false, queryFn: () => optional('profile') });
  const mail = useMailConnection(me);
  const ready = Boolean(resume.data) && Boolean(profile.data);
  const failed = resume.isError || profile.isError;
  const steps = [
    { done: Boolean(resume.data), title: '이력서 올리기', desc: '추천의 기준이 돼요. 경력기술서·포트폴리오는 선택이에요.', href: '#settings-documents' },
    { done: Boolean(profile.data), title: '프로필·필터 저장', desc: '희망 직무와 지역·고용 형태 같은 조건을 골라요.', href: '#settings-profile' },
    { done: Boolean(mail.data), title: '네이버 메일 연결 (선택)', desc: '지원한 뒤 결과 메일로 지원 현황을 자동으로 바꿔요.', href: '#settings-mail' },
  ];
  return <section aria-labelledby="setup-title" className="max-w-2xl rounded-surface border border-border bg-card p-6">
    <h2 id="setup-title" className="text-title font-extrabold">추천을 받으려면</h2>
    <p className="mt-1 text-body-sm text-muted-foreground">두 단계만 마치면 공고를 가져와 서류와 맞춰 볼 수 있어요.</p>
    <ol className="mt-5 grid gap-2">{steps.map((s, i) => <li key={s.href}>
      <a href={s.href} className="flex items-center gap-4 rounded-control border border-border px-4 py-3 text-foreground no-underline hover:bg-muted">
        <span aria-hidden="true" className={`grid size-7 shrink-0 place-items-center rounded-full text-caption font-bold ${s.done ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground'}`}>{s.done ? <Check className="size-icon-sm stroke-emphasis" /> : i + 1}</span>
        <span className="min-w-0 flex-1"><span className="block text-body-sm font-semibold">{s.title}</span><span className="block text-caption text-muted-foreground">{s.desc}</span></span>
        <span className="text-caption font-semibold text-muted-foreground">{s.done ? '완료' : '하기'}</span>
      </a>
    </li>)}</ol>
    <div className="mt-5 flex items-center gap-3">
      <Button disabled={!ready || busy} onClick={onRefresh}>공고 가져오기</Button>
      {failed ? <span role="alert" className="text-caption text-destructive">저장한 서류·프로필을 확인하지 못했어요. <button type="button" className="cursor-pointer font-semibold underline" onClick={() => { void resume.refetch(); void profile.refetch(); }}>다시 확인</button></span>
        : !ready && <span className="text-caption text-muted-foreground">이력서와 프로필을 저장하면 누를 수 있어요.</span>}
    </div>
  </section>;
}
