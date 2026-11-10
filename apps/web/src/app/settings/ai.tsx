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

// 개발자가 아닌 사용자를 위한 발급 안내. OpenAI 화면 이름은 자주 바뀌므로 링크와 함께 단계만 적는다(2026-11-10 기준).
const GUIDE = [
  { text: 'OpenAI 플랫폼에 가입하거나 로그인합니다. ChatGPT 계정으로도 로그인되지만, ChatGPT Plus 구독과 API 요금은 별개입니다.', href: 'https://platform.openai.com/', link: 'OpenAI 플랫폼 열기' },
  { text: '결제(Billing)에서 카드를 등록하고 크레딧을 충전합니다. 충전하지 않으면 키를 만들어도 “잔액 부족”으로 실패합니다.', href: 'https://platform.openai.com/settings/organization/billing/overview', link: '결제 화면 열기' },
  { text: '사용 한도(Limits)에서 월 한도를 정해 두면 예상보다 많이 청구되는 일을 막을 수 있습니다.', href: 'https://platform.openai.com/settings/organization/limits', link: '사용 한도 열기' },
  { text: 'API 키 화면에서 “Create new secret key”를 눌러 키를 만들고 바로 복사합니다. 키는 만들 때 한 번만 보입니다.', href: 'https://platform.openai.com/api-keys', link: 'API 키 화면 열기' },
  { text: '복사한 키(sk-로 시작)를 아래 칸에 붙여 넣고 모델을 고른 뒤 “확인 후 저장”을 누릅니다. 키는 다른 사람에게 보여 주지 마세요.' },
];

function KeyGuide() {
  return <details className="rounded-control border border-border p-4">
    <summary className="cursor-pointer text-body-sm font-semibold">키가 없나요? 발급 방법 (5단계)</summary>
    <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-body-sm">
      {GUIDE.map(step => <li key={step.text}>{step.text}{step.href && <> <a href={step.href} target="_blank" rel="noreferrer" className="text-primary underline">{step.link}</a></>}</li>)}
    </ol>
    <p className="mt-3 text-body-sm text-muted-foreground">한 번 새로 가져오기에 OpenAI 호출이 수십 번 일어납니다. 자동 갱신을 켜면 매일 한 번 호출되니 한도를 정해 두는 것을 권합니다. 요금이 부담되면 gpt-5.4-mini를 고를 수 있지만 판정이 덜 정확합니다.</p>
  </details>;
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
    {!current?.configured && <KeyGuide />}
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
