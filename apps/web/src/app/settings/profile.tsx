'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@nextstep/design-system';
import { jobFamilySchema, profileSchema, type JobFamily, type Me, type Profile } from '@nextstep/contracts';
import { call, fieldClass, RequestError } from '../api-client';

const FAMILIES = jobFamilySchema.options;
const EMPLOYMENT = ['정규직', '계약직', '인턴', '프리랜서'] as const;
// 선호(지역·원격·고용 형태·요구 경력)는 기본값 없이 비워 둔다. 비어 있으면 제한 없음.
const EMPTY: Profile = { jobFamilies: ['프론트엔드'], experiences: [], regions: [], remoteOk: false, employmentTypes: [], careerMax: null, skills: [], summary: '' };
const list = (text: string) => text.split(',').map(s => s.trim()).filter(Boolean);

// 저장한 값만 추천 기준이 된다. AI 초안은 화면에만 채우고 사용자가 확인해 저장한다.
export function ProfileSetting({ me }: { me: Me }) {
  const key = ['profile', me.id];
  const query = useQuery({
    queryKey: key, retry: false,
    queryFn: async () => {
      try { return (await call('profile')) as { profile: Profile; updatedAt: string }; } catch (error) { if (error instanceof RequestError && error.status === 404) return null; throw error; }
    },
  });
  if (query.isPending) return <p role="status" className="text-muted-foreground">프로필을 불러오고 있습니다.</p>;
  if (query.isError) return <p role="alert" className="text-destructive">{query.error.message}</p>;
  // 저장할 때마다 key가 바뀌어 폼이 저장값으로 다시 시작한다.
  return <ProfileForm key={query.data?.updatedAt ?? 'new'} me={me} initial={query.data?.profile ?? EMPTY} updatedAt={query.data?.updatedAt ?? null} />;
}

function ProfileForm({ me, initial, updatedAt }: { me: Me; initial: Profile; updatedAt: string | null }) {
  const client = useQueryClient();
  const key = ['profile', me.id];
  const [form, setForm] = useState<Profile>(initial);
  const [regions, setRegions] = useState(initial.regions.join(', '));
  const [skills, setSkills] = useState(initial.skills.join(', '));
  // AI 초안은 이력서 사실(직무·경력·기술·요약)만 채우고 사용자가 고른 선호는 건드리지 않는다.
  const load = (p: Profile) => { setForm({ ...form, jobFamilies: p.jobFamilies, experiences: p.experiences, skills: p.skills, summary: p.summary }); setSkills(p.skills.join(', ')); };
  const save = useMutation({
    mutationFn: async () => (await call('profile', { method: 'PUT', body: JSON.stringify(profileSchema.parse({ ...form, regions: list(regions), skills: list(skills) })) })) as { profile: Profile; updatedAt: string },
    onSuccess: data => client.setQueryData(key, data),
  });
  const suggest = useMutation({
    mutationFn: async () => profileSchema.parse(((await call('profile/suggest', { method: 'POST', messages: { 409: '이력서를 먼저 등록하세요.', 502: 'AI 처리에 실패했습니다. 서버의 로컬 AI(Ollama)가 켜져 있는지 확인하고 다시 시도하세요.' } })) as { profile: unknown }).profile),
    onSuccess: load,
  });
  const toggle = <T,>(items: T[], item: T) => items.includes(item) ? items.filter(i => i !== item) : [...items, item];
  const years = (family: JobFamily) => form.experiences.find(e => e.jobFamily === family)?.years ?? '';
  const setYears = (family: JobFamily, value: string) => setForm({ ...form, experiences: [...form.experiences.filter(e => e.jobFamily !== family), ...(value === '' ? [] : [{ jobFamily: family, years: Number(value) }])] });

  return <form className="flex flex-col gap-5" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
    <p className="text-body-sm text-muted-foreground">이력서로 초안 만들기는 이력서 본문에서 서버의 로컬 AI로 경력·기술을 추출합니다. 초안은 저장 전까지 반영되지 않습니다.</p>
    <div><Button variant="secondary" disabled={suggest.isPending} onClick={() => suggest.mutate()}>이력서로 초안 만들기</Button></div>
    <fieldset className="flex flex-col gap-3"><legend className="mb-2 text-body-sm font-semibold">희망 직무 (복수 선택)</legend>
      {FAMILIES.map(family => <div key={family} className="flex flex-wrap items-center gap-3">
        <label className="inline-flex h-control-sm cursor-pointer items-center gap-2 rounded-full border border-border-strong bg-card px-3 text-body-sm text-muted-foreground has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:checked]:font-semibold has-[:checked]:text-secondary-foreground has-[:focus-visible]:outline has-[:focus-visible]:outline-focus has-[:focus-visible]:outline-ring min-w-32"><input type="checkbox" checked={form.jobFamilies.includes(family)} onChange={() => setForm({ ...form, jobFamilies: toggle(form.jobFamilies, family) })} className="size-icon-sm accent-primary" />{family}</label>
        <label className="flex items-center gap-2 text-body-sm">관련 경력(년)<input type="number" min={0} max={50} step={0.5} value={years(family)} onChange={e => setYears(family, e.target.value)} className={`${fieldClass} !w-24`} /></label>
      </div>)}
    </fieldset>
    <fieldset className="flex flex-col gap-4 rounded-surface border border-border bg-background p-5"><legend className="px-1 text-body-sm font-extrabold">공고 필터 (직접 고르는 선호)</legend>
      <p className="text-body-sm text-muted-foreground">공고를 가져올 때와 추천 목록에 그대로 적용합니다. NextStep이 대신 정하지 않으며, 비워 두면 제한하지 않습니다.</p>
      <label className="flex flex-col gap-1.5 text-body-sm font-semibold">근무 지역 (쉼표로 구분, 예: 서울, 경기 성남시 · 비우면 전국)<input value={regions} onChange={e => setRegions(e.target.value)} placeholder="전국" className={fieldClass} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={form.remoteOk} onChange={e => setForm({ ...form, remoteOk: e.target.checked })} className="size-icon-md accent-primary" />지역 밖이라도 전면 원격 공고 포함</label>
      <fieldset className="flex flex-wrap gap-2"><legend className="mb-2 text-body-sm font-semibold">고용 형태 (모두 해제하면 전체)</legend>
        {EMPLOYMENT.map(type => <label key={type} className="inline-flex h-control-sm cursor-pointer items-center gap-2 rounded-full border border-border-strong bg-card px-3 text-body-sm text-muted-foreground has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:checked]:font-semibold has-[:checked]:text-secondary-foreground has-[:focus-visible]:outline has-[:focus-visible]:outline-focus has-[:focus-visible]:outline-ring"><input type="checkbox" checked={form.employmentTypes.includes(type)} onChange={() => setForm({ ...form, employmentTypes: toggle(form.employmentTypes, type) })} className="size-icon-sm accent-primary" />{type}</label>)}
      </fieldset>
      <label className="flex flex-col gap-1.5 text-body-sm font-semibold">요구 경력 상한(년) · 이 연차를 넘게 요구하는 경력직 공고는 빼고 가져옵니다. 비우면 제한 없음<input type="number" min={0} max={30} step={1} value={form.careerMax ?? ''} onChange={e => setForm({ ...form, careerMax: e.target.value === '' ? null : Number(e.target.value) })} placeholder="제한 없음" className={`${fieldClass} !w-32`} /></label>
    </fieldset>
    <label className="flex flex-col gap-1.5 text-body-sm font-semibold">업무·도구·기술 (쉼표로 구분)<input value={skills} onChange={e => setSkills(e.target.value)} className={fieldClass} /></label>
    <label className="flex flex-col gap-1.5 text-body-sm font-semibold">경력 요약<textarea value={form.summary} maxLength={2000} rows={3} onChange={e => setForm({ ...form, summary: e.target.value })} className={`${fieldClass} py-3`} /></label>
    <div><Button type="submit" disabled={save.isPending || form.jobFamilies.length === 0}>프로필 저장</Button></div>
    <p role="status" className="text-body-sm text-muted-foreground">{updatedAt ? `마지막 저장: ${new Date(updatedAt).toLocaleString('ko-KR')}` : '아직 저장한 프로필이 없습니다.'}{suggest.isSuccess && !save.isSuccess ? ' · 초안을 채웠습니다. 확인 후 저장하세요.' : ''}</p>
    {(save.isError || suggest.isError) && <p role="alert" className="text-body-sm text-destructive">{save.isError && save.error instanceof Error && !(save.error instanceof RequestError) ? '입력값을 확인하세요(희망 직무 1개 이상, 경력 0~50년, 요구 경력 상한 0~30년).' : (save.error ?? suggest.error)?.message}</p>}
  </form>;
}
