'use client';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@nextstep/design-system';
import { AI_MODELS, aiSettingsSchema, type AiSettings, type Me } from '@nextstep/contracts';
import { call, fieldClass, RequestError } from '../api-client';

// 저장 전에 서버가 OpenAI에 키·모델 권한을 확인한다. 실패 사유는 서버 문구를 그대로 보여 준다.
async function save(body: { apiKey?: string; model: string }) {
  const response = await fetch('/api/settings/ai', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (response.status === 422 || response.status === 400) throw new Error(((await response.json()) as { message?: string }).message ?? '키와 모델을 확인하세요.');
  if (!response.ok) throw new RequestError(response.status);
  return aiSettingsSchema.parse(await response.json());
}

export function AiSetting({ me }: { me: Me }) {
  const client = useQueryClient();
  const key = ['settings', 'ai', me.id];
  const query = useQuery({ queryKey: key, queryFn: async () => aiSettingsSchema.parse(await call('settings/ai')), retry: false });
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const update = useMutation({ mutationFn: save, onSuccess: data => { client.setQueryData(key, data); setApiKey(''); setModel(null); } });
  const remove = useMutation({ mutationFn: () => call('settings/ai', { method: 'DELETE' }), onSuccess: () => client.invalidateQueries({ queryKey: key }) });
  const current: AiSettings | undefined = query.data;
  const selected = model ?? current?.model ?? AI_MODELS[0].id;
  const submit = (e: FormEvent) => { e.preventDefault(); update.mutate({ ...(apiKey ? { apiKey } : {}), model: selected }); };

  return <form onSubmit={submit} className="flex flex-col gap-4">
    <p className="text-body-sm text-muted-foreground">추천 판정·프로필 초안·메일 해석은 본인 OpenAI API 키로 처리하고 요금도 키 주인에게 청구됩니다. 키는 서버에 암호화해 저장하고 화면에는 끝 4자리만 보여 줍니다.</p>
    <p role="status" className="text-body-sm">
      {query.isPending ? 'AI 설정을 불러오고 있습니다.' : query.isError ? 'AI 설정을 불러오지 못했습니다.'
        : current?.configured ? `등록된 키: …${current.keyHint} · 모델 ${current.model} · 확인 ${new Date(current.verifiedAt ?? '').toLocaleString('ko-KR')}` : '등록한 키가 없습니다. 키를 등록해야 AI 기능을 쓸 수 있습니다.'}
    </p>
    <label className="flex flex-col gap-2 text-body-sm">OpenAI API 키 {current?.configured ? '(바꿀 때만 입력)' : ''}
      <input type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-…" className={fieldClass} />
    </label>
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-body-sm">모델</legend>
      {AI_MODELS.map(m => <label key={m.id} className="flex gap-3 text-body-sm">
        <input type="radio" name="ai-model" value={m.id} checked={selected === m.id} onChange={() => setModel(m.id)} className="mt-1 size-icon-md accent-primary" />
        <span><strong className="block font-semibold">{m.label}</strong><span className="text-muted-foreground">{m.note}</span></span>
      </label>)}
    </fieldset>
    <div className="flex flex-wrap gap-3">
      <Button type="submit" disabled={update.isPending || (!apiKey && !current?.configured)}>{update.isPending ? 'OpenAI에서 확인 중' : '확인 후 저장'}</Button>
      {current?.configured && <Button type="button" disabled={remove.isPending} className="border-destructive !bg-transparent !text-destructive" onClick={() => { if (window.confirm('저장한 OpenAI 키를 삭제합니다. 이후 AI 기능이 멈춥니다.')) remove.mutate(); }}>키 삭제</Button>}
    </div>
    {(update.isError || remove.isError) && <p role="alert" className="text-body-sm text-destructive">{(update.error ?? remove.error)?.message}</p>}
  </form>;
}
