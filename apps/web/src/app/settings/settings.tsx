'use client';
import { useEffect, type ReactNode } from 'react';
import { Sheet } from '@nextstep/design-system';
import type { Me } from '@nextstep/contracts';
import { useMe } from '../api-client';
import { Account } from '../account';
import { AutomationSetting } from '../automation';
import { DocumentsSetting } from './resume';
import { GeneralSetting } from './general';
import { ProfileSetting } from './profile';
import { MailSetting } from './mail';
import { ConnectionPanel } from './connections';
import { AiSetting } from './ai';
import { AuthLayout, LoadingScreen } from '../frame';

// 설정은 어느 화면에서든 여는 창이다(2026-11-19 결정). 한 번에 한 구역만 보여 준다(기획서 4절).
// 주소 #settings-<구역>으로 바로 연다(상태바 '연결 확인' → #settings-status).
// 순서: 일반(이 기기 화면 설정) → 추천에 바로 쓰는 것(프로필·서류) → 연결·자동화 → 점검 → 계정(로그아웃·삭제는 맨 아래).
const SECTIONS = [
  { value: 'general', label: '일반' },
  { value: 'profile', label: '프로필·필터' },
  { value: 'documents', label: '서류' },
  { value: 'ai', label: '내 AI 연결' },
  { value: 'mail', label: '네이버 메일' },
  { value: 'automation', label: '자동 갱신' },
  { value: 'status', label: '연결 상태' },
  { value: 'account', label: '계정' },
] as const;
export type Section = (typeof SECTIONS)[number]['value'];
// 잘못 인코딩된 해시(예: #%E0)는 설정이 아닌 것으로 본다.
const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return ''; } };
const isSection = (v: string): v is Section => SECTIONS.some(s => s.value === v);
/** 주소의 해시에서 열 구역을 읽는다. #settings는 첫 구역(일반), #settings-mail은 메일. 설정이 아니면 null. */
export function sectionFromHash(hash: string): Section | null {
  const h = decode(hash.replace(/^#/, ''));
  if (h === 'settings') return SECTIONS[0].value;
  const s = h.startsWith('settings-') ? h.slice('settings-'.length) : '';
  return isSection(s) ? s : null;
}

/** /settings 주소: 로그인했으면 지원 현황 위에 설정 창을 연다. 로그인 전에는 계정 양식. */
export function Settings() {
  const me = useMe();
  useEffect(() => {
    if (!me.data) return;
    const old = decode(window.location.hash.slice(1));
    window.location.replace(`/#settings${isSection(old) ? `-${old}` : ''}`);
  }, [me.data]);
  // 확인 중이거나 로그인했으면(지원 현황 위 설정 창으로 옮기는 중) 같은 로딩 화면을 보인다.
  if (me.isPending || me.data) return <LoadingScreen />;
  return <AuthLayout>
    <h1 className="text-title-lg">설정</h1>
    <Account />
  </AuthLayout>;
}

export function SettingsDialog({ me, section, onSection, onClose }: { me: Me; section: Section; onSection: (s: Section) => void; onClose: () => void }) {
  const block = (id: string, title: string, description: string | null, body: ReactNode) => <section aria-labelledby={`section-${id}`} className="grid gap-4">
    <div><h3 id={`section-${id}`} className="text-body-lg font-extrabold">{title}</h3>{description && <p className="mt-1 text-body-sm text-muted-foreground">{description}</p>}</div>
    {body}
  </section>;
  const content = {
    account: block('account', '계정', null, <Account />),
    mail: block('mail', '네이버 메일', '메일은 읽기만 해요. 읽음 표시·삭제·이동·답장은 하지 않아요.', <MailSetting me={me} />),
    general: block('general', '일반', '이 기기에만 저장돼요.', <GeneralSetting />),
    documents: block('documents', '서류', '이력서는 꼭 필요해요. 여러 번 올리면 버전으로 남고, 고른 버전으로 추천해요.', <DocumentsSetting me={me} />),
    profile: block('profile', '프로필·필터', '필터는 공고를 가져올 때와 추천 목록에 그대로 써요.', <ProfileSetting me={me} />),
    automation: block('automation', '자동 갱신', null, <AutomationSetting me={me} />),
    ai: block('ai', '내 AI 연결', '내 Codex 계정으로 공고·서류를 분석하면 더 정확하고 빨라요. 데스크톱 앱이 이 컴퓨터에서 처리해요.', <AiSetting me={me} />),
    status: block('status', '연결 상태', '공고·메일을 가져오는 데 필요한 연결을 확인해요. 문제가 있으면 하단 상태바에도 표시돼요.', <ConnectionPanel me={me} />),
  } satisfies Record<Section, ReactNode>;
  return <Sheet open onClose={onClose} size="lg" title="설정" meta="화면·프로필·서류·메일·계정을 관리해요">
    <div className="grid min-h-0 grid-cols-[11rem_minmax(0,1fr)] gap-8">
      <nav aria-label="설정 구역" className="sticky top-0 flex flex-col gap-1 self-start">
        {SECTIONS.map(s => <button key={s.value} type="button" aria-pressed={s.value === section} onClick={() => onSection(s.value)}
          className={`h-control cursor-pointer rounded-control px-3 text-left text-body-sm focus-visible:outline focus-visible:outline-focus focus-visible:outline-ring ${s.value === section ? 'bg-secondary font-bold text-secondary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{s.label}</button>)}
      </nav>
      <div className="min-w-0">{content[section]}</div>
    </div>
  </Sheet>;
}
