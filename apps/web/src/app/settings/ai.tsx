'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { aiStatusSchema, type Me } from '@nextstep/contracts';
import { Button, Field, Input, Tag, Toggle } from '@nextstep/design-system';
import { call, useWhen } from '../api-client';

type Settings = ReturnType<typeof aiStatusSchema.parse>['settings'];

// 내 AI 연결(사용자 결정 2026-11-26): 이 사람의 기기(데스크톱 앱)가 자기 Codex 계정으로 공고·서류를 분석한다.
// 서버는 AI 로그인 정보를 갖지 않는다. 연결이 없거나 늦으면 서버의 기본 분석이 대신하고, 나중에 내 AI로 다시 분석한다.
export function AiSetting({ me }: { me: Me }) {
  const when = useWhen();
  const client = useQueryClient();
  const key = ['settings', 'ai', me.id];
  const query = useQuery({ queryKey: key, queryFn: async () => aiStatusSchema.parse(await call('ai/status')), refetchInterval: 30_000, retry: false });
  // 사용자가 고치기 전에는 서버 값을 그대로 보여 준다.
  const [edited, setEdited] = useState<Settings | null>(null);
  const save = useMutation({
    mutationFn: async (next: Settings) => aiStatusSchema.parse(await call('ai/settings', { method: 'PUT', body: JSON.stringify(next), messages: { 400: '하루 상한은 1~200 사이로 넣으세요.' } })),
    onSuccess: data => { client.setQueryData(key, data); setEdited(null); },
  });
  const s = query.data;
  const draft = edited ?? s?.settings;
  if (query.isPending || !draft) return <p role="status" className="text-body-sm text-muted-foreground">연결 상태를 불러오고 있어요.</p>;
  if (query.isError || !s) return <p role="alert" className="text-body-sm text-destructive">연결 상태를 불러오지 못했어요.</p>;
  const codex = s.runner?.codex;
  const state = s.active ? { tag: '기본', label: '연결됨' } : !s.runner ? { tag: '미확인', label: '연결 전' } : !codex?.installed ? { tag: '도전', label: 'Codex 설치 필요' } : !codex.loggedIn ? { tag: '도전', label: 'Codex 로그인 필요' } : !s.settings.enabled ? { tag: '미확인', label: '꺼짐' } : { tag: '미확인', label: '앱 꺼짐' };
  const changed = JSON.stringify(draft) !== JSON.stringify(s.settings);
  const set = (patch: Partial<Settings>) => setEdited({ ...draft, ...patch });
  return <div className="grid gap-5">
    <div className="grid gap-2 rounded-surface border border-border px-4 py-3 text-body-sm">
      <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">Codex</span><Tag classification={state.tag as '기본' | '도전' | '미확인'}>{state.label}</Tag>
        {s.runner && <span className="text-muted-foreground">{s.runner.device}{codex?.version ? ` · ${codex.version}` : ''}{s.seenAt ? ` · 마지막 확인 ${when(s.seenAt)}` : ''}</span>}</div>
      <p className="text-muted-foreground">오늘 {s.usage.calls} / {s.settings.dailyLimit}번 · 분석 대기 {s.pending}건 · 내 AI로 분석한 공고 {s.remotePostings}건 · 서류 {s.remoteDocuments ? '내 AI로 분석함' : '기본 분석'}</p>
    </div>
    {!s.active && <ol className="grid list-decimal gap-1 pl-5 text-body-sm text-muted-foreground">
      <li>이 컴퓨터에 NextStep 데스크톱 앱을 설치하고 로그인해요.</li>
      <li>터미널에서 Codex를 설치해요: <code className="rounded bg-muted px-1">npm install -g @openai/codex</code></li>
      <li>내 ChatGPT 계정으로 로그인해요: <code className="rounded bg-muted px-1">codex login</code></li>
      <li>앱을 켜 두면 1분 안에 연결을 확인해요. 앱이 꺼져 있는 동안은 기본 분석이 대신하고, 다시 켜면 내 AI로 다시 분석해요.</li>
    </ol>}
    <div className="grid gap-3">
      <Toggle checked={draft.enabled} onChange={e => set({ enabled: e.target.checked })} className="font-semibold">내 AI로 분석하기</Toggle>
      <Toggle checked={draft.sendPostings} disabled={!draft.enabled} onChange={e => set({ sendPostings: e.target.checked })}>공고 보내기</Toggle>
      <Toggle checked={draft.sendDocuments} disabled={!draft.enabled} onChange={e => set({ sendDocuments: e.target.checked })}>서류(이력서·경력기술서·포트폴리오) 보내기</Toggle>
      <Toggle checked={false} disabled>메일 보내기(준비 중)</Toggle>
      <div className="max-w-48"><Field label="하루 상한(분석 횟수)" help="공고는 10건씩 묶어 한 번으로 세요."><Input type="number" min={1} max={200} value={draft.dailyLimit} onChange={e => set({ dailyLimit: Number(e.target.value) })} /></Field></div>
    </div>
    <p className="text-caption text-muted-foreground">켠 항목은 이 컴퓨터에서 내 Codex 계정(OpenAI)으로 보내 분석해요. 서버는 Codex 로그인 정보를 갖지 않아요.</p>
    <div className="flex items-center gap-3">
      <Button disabled={!changed || save.isPending} onClick={() => save.mutate(draft)}>저장</Button>
      {save.isError && <span role="alert" className="text-body-sm text-destructive">{save.error.message}</span>}
      {save.isSuccess && !changed && <span role="status" className="text-body-sm text-muted-foreground">저장했어요.</span>}
    </div>
  </div>;
}
