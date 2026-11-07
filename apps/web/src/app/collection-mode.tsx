'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { collectionSettingsSchema, type CollectionMode, type CollectionSettings } from '@nextstep/contracts';
const KEY = ['settings', 'collection'];
const MODES: { value: CollectionMode; label: string; description: string }[] = [
  { value: 'service', label: '서비스', description: '초대 사용자에게 제공. 잡코리아만 자동 수집하고 원티드·자소설닷컴은 사용자가 넣은 공고 링크만 판정합니다.' },
  { value: 'personal', label: '개인', description: '운영자 본인만 사용. 세 출처 모두 공개 페이지를 낮은 속도로 자동 수집합니다. 로그인·차단 우회는 하지 않습니다.' },
];
const SOURCE_NAMES = { jobkorea: '잡코리아', wanted: '원티드', jasoseol: '자소설닷컴' } as const;
async function request(init?: RequestInit) {
  const response = await fetch('/api/settings/collection', { ...init, cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('설정 요청 실패');
  return collectionSettingsSchema.parse(await response.json());
}
export function CollectionModeSetting() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => request(), retry: false, refetchOnWindowFocus: false });
  const mutation = useMutation({
    mutationFn: (mode: CollectionMode) => request({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) }),
    onSuccess: data => client.setQueryData<CollectionSettings>(KEY, data),
  });
  // 저장 중에는 선택한 값을 보여 주고 실패하면 서버 값으로 돌아간다.
  const current = mutation.isPending ? mutation.variables : query.data?.mode;
  const busy = query.isPending || mutation.isPending;
  return <div>
    <fieldset disabled={busy || query.isError} className="mb-4">
      <legend className="mb-3 text-body-sm text-muted-foreground">공고 수집 모드</legend>
      <div className="flex flex-col gap-3 md:flex-row">
        {MODES.map(mode => <label key={mode.value} className={`flex flex-1 cursor-pointer gap-3 rounded-control border p-4 ${current === mode.value ? 'border-primary' : 'border-border'}`}>
          <input type="radio" name="collection-mode" value={mode.value} checked={current === mode.value} onChange={() => mutation.mutate(mode.value)} className="mt-1 size-icon-md accent-primary" />
          <span><strong className="block text-body font-semibold">{mode.label}</strong><span className="text-body-sm text-muted-foreground">{mode.description}</span></span>
        </label>)}
      </div>
    </fieldset>
    <p role="status" aria-live="polite" className="text-body-sm text-muted-foreground">
      {query.isPending ? '수집 모드를 불러오고 있습니다.'
        : query.isError ? '수집 모드를 불러오지 못했습니다.'
          : mutation.isError ? '수집 모드를 바꾸지 못했습니다. 다시 선택하세요.'
            : query.data ? Object.entries(query.data.sources).map(([id, access]) => `${SOURCE_NAMES[id as keyof typeof SOURCE_NAMES]} ${access === 'auto' ? '자동 수집' : '링크만'}`).join(' · ') : ''}
    </p>
  </div>;
}
