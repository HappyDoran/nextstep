'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@nextstep/design-system';
import { jobFamilySchema, profileSchema, type JobFamily, type Me, type Profile } from '@nextstep/contracts';
import { call, fieldClass, RequestError } from '../api-client';

const FAMILIES = jobFamilySchema.options;
const EMPLOYMENT = ['정규직', '계약직', '인턴', '프리랜서'] as const;
const EMPTY: Profile = { jobFamilies: ['프론트엔드'], experiences: [], regions: ['서울'], remoteOk: true, employmentTypes: ['정규직'], skills: [], summary: '' };
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
  const load = (p: Profile) => { setForm(p); setRegions(p.regions.join(', ')); setSkills(p.skills.join(', ')); };
  const save = useMutation({
    mutationFn: async () => (await call('profile', { method: 'PUT', body: JSON.stringify(profileSchema.parse({ ...form, regions: list(regions), skills: list(skills) })) })) as { profile: Profile; updatedAt: string },
    onSuccess: data => client.setQueryData(key, data),
  });
  const suggest = useMutation({
    mutationFn: async () => profileSchema.parse(((await call('profile/suggest', { method: 'POST', messages: { 409: '이력서를 먼저 등록하세요.', 503: 'AI 처리가 설정되지 않았습니다(서버 OPENAI_API_KEY·NEXTSTEP_OPENAI_MODEL).', 502: 'AI 처리에 실패했습니다. 잠시 후 다시 시도하세요.' } })) as { profile: unknown }).profile),
    onSuccess: load,
  });
  const toggle = <T,>(items: T[], item: T) => items.includes(item) ? items.filter(i => i !== item) : [...items, item];
  const years = (family: JobFamily) => form.experiences.find(e => e.jobFamily === family)?.years ?? '';
  const setYears = (family: JobFamily, value: string) => setForm({ ...form, experiences: [...form.experiences.filter(e => e.jobFamily !== family), ...(value === '' ? [] : [{ jobFamily: family, years: Number(value) }])] });

  return <form className="flex flex-col gap-5" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
    <p className="text-body-sm text-muted-foreground">이력서로 초안 만들기는 이력서 본문을 OpenAI로 보내 경력·기술을 추출합니다. 초안은 저장 전까지 반영되지 않습니다.</p>
    <div><Button disabled={suggest.isPending} onClick={() => suggest.mutate()}>이력서로 초안 만들기</Button></div>
    <fieldset className="flex flex-col gap-3"><legend className="mb-2 text-body-sm">희망 직무 (복수 선택)</legend>
      {FAMILIES.map(family => <div key={family} className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-32 items-center gap-2"><input type="checkbox" checked={form.jobFamilies.includes(family)} onChange={() => setForm({ ...form, jobFamilies: toggle(form.jobFamilies, family) })} className="size-icon-md accent-primary" />{family}</label>
        <label className="flex items-center gap-2 text-body-sm">관련 경력(년)<input type="number" min={0} max={50} step={0.5} value={years(family)} onChange={e => setYears(family, e.target.value)} className={`${fieldClass} !w-24`} /></label>
      </div>)}
    </fieldset>
    <label className="flex flex-col gap-2 text-body-sm">근무 지역 (쉼표로 구분)<input value={regions} onChange={e => setRegions(e.target.value)} className={fieldClass} /></label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={form.remoteOk} onChange={e => setForm({ ...form, remoteOk: e.target.checked })} className="size-icon-md accent-primary" />원격 근무 가능</label>
    <fieldset className="flex flex-wrap gap-4"><legend className="mb-2 text-body-sm">고용 형태</legend>
      {EMPLOYMENT.map(type => <label key={type} className="flex items-center gap-2"><input type="checkbox" checked={form.employmentTypes.includes(type)} onChange={() => setForm({ ...form, employmentTypes: toggle(form.employmentTypes, type) })} className="size-icon-md accent-primary" />{type}</label>)}
    </fieldset>
    <label className="flex flex-col gap-2 text-body-sm">업무·도구·기술 (쉼표로 구분)<input value={skills} onChange={e => setSkills(e.target.value)} className={fieldClass} /></label>
    <label className="flex flex-col gap-2 text-body-sm">경력 요약<textarea value={form.summary} maxLength={2000} rows={3} onChange={e => setForm({ ...form, summary: e.target.value })} className={`${fieldClass} py-3`} /></label>
    <div><Button type="submit" disabled={save.isPending || form.jobFamilies.length === 0}>프로필 저장</Button></div>
    <p role="status" className="text-body-sm text-muted-foreground">{updatedAt ? `마지막 저장: ${new Date(updatedAt).toLocaleString('ko-KR')}` : '아직 저장한 프로필이 없습니다.'}{suggest.isSuccess && !save.isSuccess ? ' · 초안을 채웠습니다. 확인 후 저장하세요.' : ''}</p>
    {(save.isError || suggest.isError) && <p role="alert" className="text-body-sm text-destructive">{save.isError && save.error instanceof Error && !(save.error instanceof RequestError) ? '입력값을 확인하세요(희망 직무 1개 이상, 경력 0~50년).' : (save.error ?? suggest.error)?.message}</p>}
  </form>;
}
