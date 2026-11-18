'use client';
import { useEffect, type ReactNode } from 'react';
import { Sheet } from '@nextstep/design-system';
import type { Me } from '@nextstep/contracts';
import { useMe } from '../api-client';
import { Account } from '../account';
import { AutomationSetting } from '../automation';
import { ResumeSetting } from './resume';
import { AiSetting } from './ai';
import { ProfileSetting } from './profile';
import { MailSetting } from './mail';
import { ConnectionStatus } from '../status';
import { ConnectionPanel } from './connections';
import { AuthLayout } from '../frame';

// 설정은 어느 화면에서든 여는 창이다(2026-11-19 결정). 한 번에 한 구역만 보여 준다(기획서 4절).
// 주소 #settings-<구역>으로 바로 연다(상태바 '연결 확인' → #settings-status).
export const SECTIONS = [
  { value: 'account', label: '계정' },
  { value: 'mail', label: '네이버 메일' },
  { value: 'documents', label: '서류' },
  { value: 'profile', label: '프로필·필터' },
  { value: 'automation', label: '자동 갱신' },
  { value: 'status', label: '연결 상태' },
] as const;
export type Section = (typeof SECTIONS)[number]['value'];
export const isSection = (v: string): v is Section => SECTIONS.some(s => s.value === v);
/** 주소의 해시에서 열 구역을 읽는다. #settings는 계정, #settings-mail은 메일. 설정이 아니면 null. */
export function sectionFromHash(hash: string): Section | null {
  const h = decodeURIComponent(hash.replace(/^#/, ''));
  if (h === 'settings') return 'account';
  const s = h.startsWith('settings-') ? h.slice('settings-'.length) : '';
  return isSection(s) ? s : null;
}

/** /settings 주소: 로그인했으면 지원 현황 위에 설정 창을 연다. 로그인 전에는 계정 양식. */
export function Settings() {
  const me = useMe();
  useEffect(() => {
    if (!me.data) return;
    const old = decodeURIComponent(window.location.hash.slice(1));
    window.location.replace(`/#settings${isSection(old) ? `-${old}` : ''}`);
  }, [me.data]);
  if (me.data) return <p role="status" className="p-6 text-muted-foreground">설정을 여는 중입니다.</p>;
  return <AuthLayout>
    <h1 className="text-title-lg">설정</h1>
    <Account />
    <section aria-labelledby="service-check" className="border-t border-border pt-6"><h2 id="service-check" className="mb-3 text-body-sm font-extrabold">서비스 연결 확인</h2><ConnectionStatus /></section>
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
    documents: <div className="grid gap-8">
      {block('resume', '이력서 (필수)', '모든 서류는 MD로 바꿔 추천에 써요. 이미지 쪽은 글자 인식으로 바꿔요.', <ResumeSetting me={me} />)}
      {block('career', '경력기술서 (선택)', null, <ResumeSetting me={me} kind="career" />)}
      {block('portfolio', '포트폴리오 (선택)', null, <ResumeSetting me={me} kind="portfolio" />)}
    </div>,
    profile: block('profile', '프로필·필터', '필터는 공고를 가져올 때와 추천 목록에 그대로 써요.', <><ProfileSetting me={me} /><AiSetting me={me} /></>),
    automation: block('automation', '자동 갱신', null, <AutomationSetting me={me} />),
    status: block('status', '연결 상태', '공고·메일을 가져오는 데 필요한 연결을 확인해요. 문제가 있으면 하단 상태바에도 표시돼요.', <div className="grid gap-5"><ConnectionPanel me={me} /><AiSetting me={me} /></div>),
  } satisfies Record<Section, ReactNode>;
  return <Sheet open onClose={onClose} size="lg" title="설정" meta="계정·메일·서류·프로필을 관리해요">
    <div className="grid min-h-0 grid-cols-[11rem_minmax(0,1fr)] gap-8">
      <nav aria-label="설정 구역" className="sticky top-0 flex flex-col gap-1 self-start">
        {SECTIONS.map(s => <button key={s.value} type="button" aria-pressed={s.value === section} onClick={() => onSection(s.value)}
          className={`h-control cursor-pointer rounded-control px-3 text-left text-body-sm focus-visible:outline focus-visible:outline-focus focus-visible:outline-ring ${s.value === section ? 'bg-secondary font-bold text-secondary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{s.label}</button>)}
      </nav>
      <div className="min-w-0">{content[section]}</div>
    </div>
  </Sheet>;
}
