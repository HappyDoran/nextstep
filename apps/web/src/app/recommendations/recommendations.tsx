'use client';
import { useState, type FormEvent } from 'react';
import { ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@nextstep/design-system';
import { jobSchema, profileSchema, recommendationClassSchema, recommendationListSchema, type Job, type Me, type Recommendation } from '@nextstep/contracts';
import { call, fieldClass, useMe } from '../api-client';
import { Account } from '../account';

const CLASSES = recommendationClassSchema.options;
const SOURCE_NAMES = { saramin: '사람인', jobkorea: '잡코리아', jasoseol: '자소설닷컴', wanted: '원티드' } as const;
const ERRORS: Record<string, string> = {
  profile_or_resume_missing: '설정에서 이력서와 프로필을 먼저 저장하세요.',
  collect_failed: '공고를 가져오지 못했습니다. 잠시 후 다시 시도하세요.',
  unsupported_link: '지원하지 않는 링크입니다.',
  lease_expired: '처리 시간이 초과되었습니다. 다시 시도하세요.',
};
// 사용자가 고칠 수 있는 AI 실패 원인(설정의 OpenAI 키·모델에서 해결).
const AI_CAUSES: Record<string, string> = { ai_unconfigured: '설정에서 OpenAI 키 등록 필요', ai_key_invalid: 'OpenAI 키 거부됨', ai_quota: 'OpenAI 잔액 부족', ai_model_unavailable: '선택한 모델 사용 불가' };
const ACTIVE: string[] = ['대기', '실행중'];
const date = (iso: string) => new Date(iso).toLocaleString('ko-KR');

function JobStatus({ job }: { job: Job | null }) {
  if (!job) return <p role="status" className="text-body-sm text-muted-foreground">아직 공고를 가져온 적이 없습니다.</p>;
  const result = job.result as { collected?: number; judged?: number; sourceFailures?: string[]; aiFailures?: number; aiFailureCodes?: Record<string, number> } | null;
  const aiCauses = Object.keys(result?.aiFailureCodes ?? {}).map(c => AI_CAUSES[c]).filter(Boolean);
  const text = job.status === '대기' || job.status === '실행중' ? '공고를 가져와 판정하고 있습니다. 몇 분 걸릴 수 있습니다.'
    : job.status === '실패' ? `실패: ${ERRORS[job.errorCode ?? ''] ?? job.errorCode ?? '알 수 없는 오류'}`
      : `${job.status}: 공고 ${result?.collected ?? 0}건 확인, ${result?.judged ?? 0}건 판정${result?.sourceFailures?.length ? ` · 출처 실패 ${result.sourceFailures.length}건(${[...new Set(result.sourceFailures.map(f => f.split(':')[0]))].join(', ')})` : ''}${result?.aiFailures ? ` · AI 실패 ${result.aiFailures}건${aiCauses.length ? `(${aiCauses.join(', ')})` : ''}` : ''}`;
  return <p role="status" className="text-body-sm text-muted-foreground">{text}{job.finishedAt ? ` (${date(job.finishedAt)})` : ''}</p>;
}

export function Recommendations() {
  const me = useMe();
  if (me.isPending) return <p role="status" className="text-muted-foreground">계정 상태를 확인하고 있습니다.</p>;
  if (!me.data) return <div className="flex flex-col gap-4"><h1 className="text-title-lg">추천</h1><p>로그인 후 이용하세요.</p><Account /></div>;
  return <RecommendationList me={me.data} />;
}

function RecommendationList({ me }: { me: Me }) {
  const client = useQueryClient();
  const key = ['recommendations', me.id];
  const list = useQuery({ queryKey: key, queryFn: async () => recommendationListSchema.parse(await call('recommendations')), retry: false, refetchOnWindowFocus: false });
  const [jobId, setJobId] = useState<string | null>(null);
  // 처리중일 때만 작업 상태를 조회하고 끝나면 멈춘다. 끝나면 추천 목록을 다시 읽는다.
  const job = useQuery({
    queryKey: ['jobs', me.id, jobId], enabled: Boolean(jobId), retry: false,
    queryFn: async () => {
      const j = jobSchema.parse(await call(`jobs/${jobId}`));
      if (!ACTIVE.includes(j.status)) void client.invalidateQueries({ queryKey: key });
      return j;
    },
    refetchInterval: q => (q.state.data && !ACTIVE.includes(q.state.data.status) ? false : 3000),
  });
  const running = Boolean(jobId) && (!job.data || ACTIVE.includes(job.data.status));
  const refresh = useMutation({ mutationFn: async () => jobSchema.parse(await call('postings/refresh', { method: 'POST' })), onSuccess: j => setJobId(j.id) });
  const link = useMutation({
    mutationFn: async (url: string) => jobSchema.parse(await call('postings/link', { method: 'POST', body: JSON.stringify({ url }), messages: { 400: '사람인·잡코리아·자소설닷컴·원티드 공고 상세 링크(https)를 넣으세요.' } })),
    onSuccess: j => setJobId(j.id),
  });
  const [filter, setFilter] = useState<(typeof CLASSES)[number] | '전체'>('전체');
  const [showHidden, setShowHidden] = useState(false);
  const busy = running || refresh.isPending || link.isPending;
  const currentJob = job.data ?? list.data?.lastJob ?? null;
  const items = (list.data?.items ?? []).filter(i => (filter === '전체' || i.classification === filter) && i.hidden === showHidden);
  const submitLink = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const form = e.currentTarget; link.mutate(String(new FormData(form).get('url')), { onSuccess: () => form.reset() }); };

  return <div className="flex flex-col gap-8">
    <section aria-labelledby="refresh-heading" className="flex flex-col gap-3">
      <h1 id="refresh-heading" className="text-title-lg">추천</h1>
      <p className="text-body-sm text-muted-foreground">판정을 위해 저장한 프로필·이력서 일부와 공고 정보를 본인 OpenAI 키로 보냅니다. 마감·기업 규모는 출처에 적힌 값만 보여 주고 없으면 미확인으로 둡니다.</p>
      <FilterSummary me={me} />
      <div><Button disabled={busy} onClick={() => refresh.mutate()}>{busy ? <LoaderCircle className="size-icon-md shrink-0 animate-spin stroke-icon motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw className="size-icon-md shrink-0 stroke-icon" aria-hidden="true" />}새로 가져오기</Button></div>
      <JobStatus job={currentJob} />
      {(refresh.isError || link.isError) && <p role="alert" className="text-body-sm text-destructive">{(refresh.error ?? link.error)?.message}</p>}
      <form onSubmit={submitLink} className="flex flex-col gap-2 md:flex-row md:items-end">
        <label className="flex flex-1 flex-col gap-2 text-body-sm">공고 링크로 판정<input name="url" type="url" required pattern="https://.*" placeholder="https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=…" className={fieldClass} /></label>
        <Button type="submit" disabled={busy}>판정</Button>
      </form>
    </section>

    <section aria-labelledby="list-heading">
      <h2 id="list-heading" className="mb-4 text-title">추천 목록</h2>
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="분류 필터">
        {(['전체', ...CLASSES] as const).map(c => <button key={c} type="button" aria-pressed={filter === c} onClick={() => setFilter(c)}
          className={`min-h-control rounded-control px-4 text-body ${filter === c ? 'bg-muted font-semibold' : 'text-muted-foreground'}`}>{c}</button>)}
        <label className="ml-auto flex items-center gap-2 text-body-sm"><input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} className="size-icon-md accent-primary" />관심 없음만 보기</label>
      </div>
      {list.isPending ? <p role="status" className="text-muted-foreground">추천을 불러오고 있습니다.</p>
        : list.isError ? <div><p role="alert" className="mb-4 text-destructive">{list.error.message}</p><Button onClick={() => { void list.refetch(); }}>다시 시도</Button></div>
          : items.length === 0 ? <p role="status" className="text-muted-foreground">{list.data.items.length === 0 ? '추천이 없습니다. 설정에서 이력서·프로필을 저장한 뒤 새로 가져오기를 누르세요.' : '조건에 맞는 추천이 없습니다.'}</p>
            : <ul className="flex flex-col gap-3">{items.map(item => <RecommendationItem key={item.postingId} item={item} me={me} listKey={key} />)}</ul>}
    </section>
  </div>;
}

function RecommendationItem({ item, me, listKey }: { item: Recommendation; me: Me; listKey: string[] }) {
  const client = useQueryClient();
  const hide = useMutation({ mutationFn: (hidden: boolean) => call(`recommendations/${item.postingId}/hide`, { method: 'PUT', body: JSON.stringify({ hidden }) }), onSuccess: () => client.invalidateQueries({ queryKey: listKey }) });
  // 지원 현황에 미지원으로 저장만 한다. 지원 완료는 사용자가 직접 바꾼다.
  const track = useMutation({
    mutationFn: () => call('applications', { method: 'POST', body: JSON.stringify({ company: item.company.slice(0, 200), roleTitle: item.title.slice(0, 200), postingUrl: item.url }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['applications', me.id] }),
  });
  const deadline = item.alwaysHire ? '상시채용' : item.deadline ? `마감 ${date(item.deadline)}` : '마감 미확인';
  const size = item.companyType || item.employeeCount ? [item.companyType, item.employeeCount ? `${item.employeeCount}명` : null].filter(Boolean).join(' · ') : '기업 유형·규모 미확인';
  const reasons = (title: string, values: string[]) => values.length > 0 && <div><h4 className="text-body-sm font-semibold">{title}</h4><ul className="list-disc pl-5 text-body-sm">{values.map(v => <li key={v}>{v}</li>)}</ul></div>;
  return <li className="rounded-control border border-border p-4">
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <span className="rounded-control bg-muted px-3 py-1 text-body-sm font-semibold">{item.classification}</span>
      <span className="text-body-sm text-muted-foreground">{SOURCE_NAMES[item.source]}{item.linkOnly ? ' · 링크 판정' : ''} · {item.postingStatus} · {deadline}</span>
    </div>
    <strong className="block text-body font-semibold">{item.title}</strong>
    <span className="text-body-sm text-muted-foreground">{item.company} · {size}</span>
    <p className="mt-2 text-body-sm">{item.reason}</p>
    <div className="mt-2 grid gap-2 md:grid-cols-3">{reasons('맞는 점', item.met)}{reasons('불충족', item.unmet)}{reasons('미확인', item.unknown)}</div>
    <p className="mt-2 text-caption text-muted-foreground">공고 확인 {date(item.checkedAt)} · 판정 {date(item.evaluatedAt)}</p>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <a href={item.externalApplyUrl ?? item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-body-sm text-primary underline">지원하기(외부)<ExternalLink className="size-icon-sm shrink-0 stroke-icon" aria-hidden="true" /></a>
      {item.externalApplyUrl && <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-body-sm underline">원문 보기</a>}
      <button type="button" disabled={track.isPending || track.isSuccess} onClick={() => track.mutate()} className="min-h-control rounded-control px-3 text-body-sm underline">{track.isSuccess ? '지원 현황에 저장됨' : '지원 현황에 저장'}</button>
      <button type="button" disabled={hide.isPending} onClick={() => hide.mutate(!item.hidden)} className="min-h-control rounded-control px-3 text-body-sm underline">{item.hidden ? '숨김 해제' : '관심 없음'}</button>
    </div>
    {(hide.isError || track.isError) && <p role="alert" className="mt-2 text-body-sm text-destructive">{(hide.error ?? track.error)?.message}</p>}
  </li>;
}

// 지금 적용 중인 공고 필터. 사용자가 고른 값만 보여 주고 바꾸는 곳(설정)으로 안내한다.
function FilterSummary({ me }: { me: Me }) {
  const profile = useQuery({
    queryKey: ['profile', me.id], retry: false,
    queryFn: async () => { try { return (await call('profile')) as { profile: unknown; updatedAt: string }; } catch { return null; } },
  });
  const p = profile.data ? profileSchema.safeParse(profile.data.profile) : null;
  if (!p?.success) return <p className="text-body-sm text-muted-foreground">공고 필터가 없습니다. <a href="/settings" className="text-primary underline">설정</a>에서 프로필과 필터를 저장하세요.</p>;
  const f = p.data;
  const chips = [
    `직무: ${f.jobFamilies.join('·')}`,
    `지역: ${f.regions.length ? f.regions.join('·') : '전국'}${f.remoteOk ? ' (+전면 원격)' : ''}`,
    `고용 형태: ${f.employmentTypes.length ? f.employmentTypes.join('·') : '전체'}`,
    `요구 경력: ${f.careerMax === null ? '제한 없음' : `${f.careerMax}년 이하`}`,
  ];
  return <div className="flex flex-wrap items-center gap-2 text-body-sm" aria-label="적용 중인 공고 필터">
    {chips.map(c => <span key={c} className="rounded-control bg-muted px-3 py-1">{c}</span>)}
    <a href="/settings" className="text-primary underline">필터 바꾸기</a>
  </div>;
}
