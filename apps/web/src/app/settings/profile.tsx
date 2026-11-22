'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { Button, Field, Input, Loading, Textarea } from '@nextstep/design-system';
import { jobFamilySchema, jobSchema, profileSchema, type JobFamily, type Me, type Profile } from '@nextstep/contracts';
import { ACTIVE_JOB, AI_CAUSES, buttonIcon, call, draftKey, noticeKey, optional, RequestError, useProfileDraft, useWhen } from '../api-client';

const FAMILIES = jobFamilySchema.options;
const EMPLOYMENT = ['정규직', '계약직', '인턴', '프리랜서'] as const;
// 선호(지역·원격·고용 형태·요구 경력)는 기본값 없이 비워 둔다. 비어 있으면 제한 없음.
const EMPTY: Profile = { jobFamilies: ['프론트엔드'], experiences: [], regions: [], remoteOk: false, employmentTypes: [], careerMax: null, skills: [], summary: '' };
const list = (text: string) => text.split(',').map(s => s.trim()).filter(Boolean);

// 저장한 값만 추천 기준이 된다. 초안은 서버가 만들어 두고(화면을 떠나도 계속), 사용자가 바뀌는 항목을 보고 저장한다.
export function ProfileSetting({ me }: { me: Me }) {
  const key = ['profile', me.id];
  const query = useQuery({
    queryKey: key, retry: false,
    queryFn: async () => (await optional('profile')) as { profile: Profile; updatedAt: string } | null,
  });
  if (query.isPending) return <Loading label="프로필을 불러오고 있습니다." lines={8} />;
  if (query.isError) return <p role="alert" className="text-destructive">{query.error.message}</p>;
  // 저장할 때마다 key가 바뀌어 폼이 저장값으로 다시 시작한다.
  return <ProfileForm key={query.data?.updatedAt ?? 'new'} me={me} initial={query.data?.profile ?? EMPTY} updatedAt={query.data?.updatedAt ?? null} />;
}

function ProfileForm({ me, initial, updatedAt }: { me: Me; initial: Profile; updatedAt: string | null }) {
  const when = useWhen();
  const client = useQueryClient();
  const key = ['profile', me.id];
  const [form, setForm] = useState<Profile>(initial);
  const [regions, setRegions] = useState(initial.regions.join(', '));
  const [skills, setSkills] = useState(initial.skills.join(', '));
  const current = (): Profile => ({ ...form, regions: list(regions), skills: list(skills) });
  const clearDraft = () => { client.setQueryData(draftKey(me), null); client.setQueryData(noticeKey(me), null); };
  // 초안을 입력칸에 채웠으면 그 저장으로 초안을 받아들인 것이다. 필터만 고쳐 저장하면 받지 않은 초안은 남긴다.
  const [filledId, setFilledId] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async ({ profile }: { profile: Profile; consume: boolean }) => (await call('profile', { method: 'PUT', body: JSON.stringify(profileSchema.parse(profile)) })) as { profile: Profile; updatedAt: string },
    // 추천 목록의 필터 적용 결과도 바뀌므로 다시 읽는다.
    onSuccess: (data, { consume }) => {
      if (consume) { clearDraft(); void call('profile/draft', { method: 'DELETE' }).catch(() => undefined); }
      client.setQueryData(key, data); void client.invalidateQueries({ queryKey: ['recommendations', me.id] });
    },
  });
  const job = useProfileDraft(me).data ?? null;
  const running = job !== null && ACTIVE_JOB.includes(job.status);
  const ready = job?.status === '성공' ? profileSchema.safeParse(job.result?.profile).data ?? null : null;
  // 초안은 서류 사실(직무·경력·기술)만 바꾸고 사용자가 고른 선호는 그대로 둔다. 요약이 비어 있으면 지금 요약을 유지한다.
  const applied = ready && { ...current(), jobFamilies: ready.jobFamilies, experiences: ready.experiences, skills: ready.skills, summary: ready.summary || current().summary };
  const suggest = useMutation({
    mutationFn: async () => jobSchema.parse(await call('profile/suggest', { method: 'POST', messages: { 409: '이력서를 먼저 등록하세요.' } })),
    onSuccess: started => { client.setQueryData(noticeKey(me), null); client.setQueryData(draftKey(me), started); },
  });
  const discard = useMutation({ mutationFn: () => call('profile/draft', { method: 'DELETE' }), onSuccess: clearDraft });
  // 이 구역에서 끝난 초안을 보고 있으면 다른 화면 알림은 필요 없다.
  const finished = job?.finishedAt ? job.id : null;
  useEffect(() => { if (finished) client.setQueryData(noticeKey(me), null); }, [client, finished, me]);
  const draftError = job?.status === '실패' ? (job.errorCode === 'no_resume' ? '이력서를 먼저 등록하세요.' : `초안을 만들지 못했습니다${job.errorCode && AI_CAUSES[job.errorCode] ? `(${AI_CAUSES[job.errorCode]})` : ''}. 잠시 후 다시 시도하고, 계속되면 운영자에게 알려 주세요.`) : null;
  const toggle = <T,>(items: T[], item: T) => items.includes(item) ? items.filter(i => i !== item) : [...items, item];
  const years = (family: JobFamily) => form.experiences.find(e => e.jobFamily === family)?.years ?? '';
  const setYears = (family: JobFamily, value: string) => setForm({ ...form, experiences: [...form.experiences.filter(e => e.jobFamily !== family), ...(value === '' ? [] : [{ jobFamily: family, years: Number(value) }])] });

  return <form className="flex flex-col gap-5" onSubmit={e => { e.preventDefault(); save.mutate({ profile: current(), consume: ready !== null && filledId === job?.id }); }}>
    <p className="text-body-sm text-muted-foreground">사용 중인 서류(이력서·경력기술서·포트폴리오)로 직무·경력·기술 초안을 만들 수 있어요. 다른 화면으로 가도 계속 만들고, 다 되면 알려 드려요.</p>
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" disabled={running || suggest.isPending} onClick={() => suggest.mutate()}>
        {running ? <><LoaderCircle className={`${buttonIcon} animate-spin motion-reduce:animate-none`} aria-hidden="true" focusable="false" />초안 만드는 중</> : ready ? '초안 다시 만들기' : '이력서로 초안 만들기'}
      </Button>
      {running && <p role="status" className="text-body-sm text-muted-foreground">서류 분량에 따라 몇 분 걸릴 수 있어요. 공고 갱신이 같은 서류를 이미 읽었으면 바로 끝나요.</p>}
      {draftError && <Button variant="quiet" disabled={discard.isPending} onClick={() => discard.mutate()}>실패 안내 지우기</Button>}
    </div>
    {ready && applied && <DraftReview now={current()} next={applied} otherEdits={JSON.stringify({ ...current(), jobFamilies: 0, experiences: 0, skills: 0, summary: 0 }) !== JSON.stringify({ ...initial, jobFamilies: 0, experiences: 0, skills: 0, summary: 0 })} busy={save.isPending || discard.isPending}
      onSave={() => save.mutate({ profile: applied, consume: true })} onFill={() => { setFilledId(job?.id ?? null); setForm(applied); setSkills(ready.skills.join(', ')); }} onDiscard={() => discard.mutate()} />}
    <fieldset className="flex flex-col gap-3"><legend className="mb-2 text-body-sm font-semibold">희망 직무 (복수 선택)</legend>
      {FAMILIES.map(family => <div key={family} className="flex flex-wrap items-center gap-3">
        <label className="inline-flex h-control-sm cursor-pointer items-center gap-2 rounded-full border border-border-strong bg-card px-3 text-body-sm text-muted-foreground has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:checked]:font-semibold has-[:checked]:text-secondary-foreground has-[:focus-visible]:outline has-[:focus-visible]:outline-focus has-[:focus-visible]:outline-ring min-w-32"><input type="checkbox" checked={form.jobFamilies.includes(family)} onChange={() => setForm({ ...form, jobFamilies: toggle(form.jobFamilies, family) })} className="size-icon-sm accent-primary" />{family}</label>
        <label className="flex items-center gap-2 text-body-sm">관련 경력(년)<Input type="number" min={0} max={50} step={0.5} value={years(family)} onChange={e => setYears(family, e.target.value)} className="!w-24" /></label>
      </div>)}
    </fieldset>
    <fieldset className="flex flex-col gap-4 rounded-surface border border-border bg-background p-5"><legend className="px-1 text-body-sm font-extrabold">공고 필터 (직접 고르는 선호)</legend>
      <p className="text-body-sm text-muted-foreground">공고를 가져올 때와 추천 목록에 그대로 적용합니다. NextStep이 대신 정하지 않으며, 비워 두면 제한하지 않습니다.</p>
      <Field label="근무 지역 (쉼표로 구분, 예: 서울, 경기 성남시 · 비우면 전국)"><Input value={regions} onChange={e => setRegions(e.target.value)} placeholder="전국" /></Field>
      <label className="flex items-center gap-2"><input type="checkbox" checked={form.remoteOk} onChange={e => setForm({ ...form, remoteOk: e.target.checked })} className="size-icon-md accent-primary" />지역 밖이라도 전면 원격 공고 포함</label>
      <fieldset className="flex flex-wrap gap-2"><legend className="mb-2 text-body-sm font-semibold">고용 형태 (모두 해제하면 전체)</legend>
        {EMPLOYMENT.map(type => <label key={type} className="inline-flex h-control-sm cursor-pointer items-center gap-2 rounded-full border border-border-strong bg-card px-3 text-body-sm text-muted-foreground has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:checked]:font-semibold has-[:checked]:text-secondary-foreground has-[:focus-visible]:outline has-[:focus-visible]:outline-focus has-[:focus-visible]:outline-ring"><input type="checkbox" checked={form.employmentTypes.includes(type)} onChange={() => setForm({ ...form, employmentTypes: toggle(form.employmentTypes, type) })} className="size-icon-sm accent-primary" />{type}</label>)}
      </fieldset>
      <Field label="요구 경력 상한(년) · 이 연차를 넘게 요구하는 경력직 공고는 빼고 가져옵니다. 비우면 제한 없음"><Input type="number" min={0} max={30} step={1} value={form.careerMax ?? ''} onChange={e => setForm({ ...form, careerMax: e.target.value === '' ? null : Number(e.target.value) })} placeholder="제한 없음" className="!w-32" /></Field>
    </fieldset>
    <Field label="업무·도구·기술 (쉼표로 구분)"><Input value={skills} onChange={e => setSkills(e.target.value)} /></Field>
    <Field label="경력 요약"><Textarea value={form.summary} maxLength={2000} rows={3} onChange={e => setForm({ ...form, summary: e.target.value })} /></Field>
    <div><Button type="submit" disabled={save.isPending || form.jobFamilies.length === 0}>프로필 저장</Button></div>
    <p role="status" className="text-body-sm text-muted-foreground">{updatedAt ? `마지막 저장: ${when(updatedAt)}` : '아직 저장한 프로필이 없습니다.'}</p>
    {(save.isError || suggest.isError || discard.isError || draftError) && <p role="alert" className="text-body-sm text-destructive">{save.isError && !(save.error instanceof RequestError) ? '입력값을 확인하세요(희망 직무 1개 이상, 경력 0~50년, 요구 경력 상한 0~30년).' : (save.error ?? suggest.error ?? discard.error)?.message ?? draftError}</p>}
  </form>;
}

const families = (p: Profile) => p.jobFamilies.map(f => { const y = p.experiences.find(e => e.jobFamily === f)?.years; return y === undefined ? f : `${f} ${y}년`; }).join(', ');
const FIELDS: [string, (p: Profile) => string][] = [['희망 직무·경력', families], ['업무·도구·기술', p => p.skills.join(', ')], ['경력 요약', p => p.summary]];

/** 다 만든 초안: 지금 값에서 바뀌는 항목만 보여 주고 한 번에 저장한다. */
function DraftReview({ now, next, otherEdits, busy, onSave, onFill, onDiscard }: { now: Profile; next: Profile; otherEdits: boolean; busy: boolean; onSave: () => void; onFill: () => void; onDiscard: () => void }) {
  const changes = FIELDS.map(([label, show]) => [label, show(now), show(next)] as const).filter(([, a, b]) => a !== b);
  return <section aria-labelledby="draft-title" className="grid animate-fade-up gap-3 rounded-surface border border-primary bg-card p-5 motion-reduce:animate-fade">
    <div><h4 id="draft-title" className="text-body font-extrabold">이력서로 만든 초안이 준비됐어요</h4>
      <p className="mt-1 text-body-sm text-muted-foreground">{changes.length ? '바뀌는 항목만 보여 드려요. 근무 지역·고용 형태 같은 공고 필터는 그대로예요.' : '지금 입력한 프로필과 같아요.'}</p></div>
    {changes.length > 0 && <dl className="grid gap-2.5 text-body-sm">
      {changes.map(([label, a, b]) => <div key={label} className="grid gap-0.5">
        <dt className="font-semibold">{label}</dt>
        <dd className="text-muted-foreground"><span className="mr-2 font-semibold">지금</span>{a || '없음'}</dd>
        <dd className="text-foreground"><span className="mr-2 font-semibold text-primary">초안</span>{b || '없음'}</dd>
      </div>)}
    </dl>}
    {otherEdits && <p className="text-body-sm font-semibold text-warning">입력칸에서 고치고 저장하지 않은 공고 필터도 함께 저장돼요.</p>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || next.jobFamilies.length === 0} onClick={onSave}>초안으로 저장</Button>
      <Button variant="secondary" disabled={busy} onClick={onFill}>입력칸에 채워 고치기</Button>
      <Button variant="quiet" disabled={busy} onClick={onDiscard}>버리기</Button>
    </div>
  </section>;
}
