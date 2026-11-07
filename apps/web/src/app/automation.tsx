'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { automationSchema, type Me } from '@nextstep/contracts';
import { call } from './api-client';

// 자동 갱신 ON/OFF 저장. 서버 예약 실행은 P1-06에서 이 값을 사용한다.
export function AutomationSetting({ me }: { me: Me }) {
  const client = useQueryClient();
  const key = ['settings', 'automation', me.id];
  const query = useQuery({ queryKey: key, queryFn: async () => automationSchema.parse(await call('settings/automation')), retry: false });
  const save = useMutation({
    mutationFn: async (enabled: boolean) => automationSchema.parse(await call('settings/automation', { method: 'PUT', body: JSON.stringify({ enabled }) })),
    onSuccess: data => client.setQueryData(key, data),
  });
  const checked = save.isPending ? save.variables : query.data?.enabled;
  return <div>
    <label className="flex items-center gap-3 text-body">
      <input type="checkbox" role="switch" checked={checked ?? false} disabled={!query.data || save.isPending} onChange={e => save.mutate(e.target.checked)} className="size-icon-md accent-primary" />
      자동 갱신
    </label>
    <p role="status" className="mt-2 text-body-sm text-muted-foreground">
      {query.isPending ? '설정을 불러오고 있습니다.'
        : query.isError ? '설정을 불러오지 못했습니다.'
          : save.isError ? '저장하지 못했습니다. 다시 시도하세요.'
            : checked ? '켜짐: 서버 예약 실행이 준비되면 하루 한 번 갱신합니다(아직 예약 실행은 없습니다).' : '꺼짐: 직접 요청할 때만 갱신합니다.'}
    </p>
  </div>;
}
