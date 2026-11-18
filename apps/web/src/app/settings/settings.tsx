'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Segmented } from '@nextstep/design-system';
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
import { Frame, AuthLayout } from '../frame';

// 한 번에 한 구역만 보여 준다(기획서 4절). 주소의 #구역으로 바로 열 수 있다(상태바 '연결 확인' → #status).
const SECTIONS = [
  { value: 'account', label: '계정' },
  { value: 'mail', label: '네이버 메일' },
  { value: 'documents', label: '서류' },
  { value: 'profile', label: '프로필·필터' },
  { value: 'automation', label: '자동 갱신' },
  { value: 'status', label: '연결 상태' },
] as const;
type Section = (typeof SECTIONS)[number]['value'];
const isSection = (v: string): v is Section => SECTIONS.some(s => s.value === v);

export function Settings() {
  const me = useMe();
  if (!me.data) return <AuthLayout>
    <h1 className="text-title-lg">설정</h1>
    <Account />
    <section aria-labelledby="service-check" className="border-t border-border pt-6"><h2 id="service-check" className="mb-3 text-body-sm font-extrabold">서비스 연결 확인</h2><ConnectionStatus /></section>
  </AuthLayout>;
  return <SettingSections me={me.data} />;
}

function SettingSections({ me }: { me: Me }) {
  const [section, setSection] = useState<Section>('account');
  useEffect(() => {
    const read = () => { const hash = decodeURIComponent(window.location.hash.slice(1)); if (isSection(hash)) setSection(hash); };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const choose = (value: Section) => { setSection(value); window.history.replaceState(null, '', `#${value}`); };
  const card = (id: string, title: string, description: string | null, body: ReactNode) => <section aria-labelledby={`section-${id}`} className="grid max-w-3xl gap-5 rounded-surface border border-border bg-card px-8 py-7">
    <div><h2 id={`section-${id}`} className="text-body-lg font-extrabold">{title}</h2>{description && <p className="mt-1 text-body-sm text-muted-foreground">{description}</p>}</div>
    {body}
  </section>;
  const content = {
    account: card('account', '계정', null, <Account />),
    mail: card('mail', '네이버 메일', '메일은 읽기만 해요. 읽음 표시·삭제·이동·답장은 하지 않아요.', <MailSetting me={me} />),
    documents: <div className="grid gap-5">
      {card('resume', '이력서 (필수)', '모든 서류는 MD로 바꿔 추천에 써요. 이미지 쪽은 글자 인식으로 바꿔요.', <ResumeSetting me={me} />)}
      {card('career', '경력기술서 (선택)', null, <ResumeSetting me={me} kind="career" />)}
      {card('portfolio', '포트폴리오 (선택)', null, <ResumeSetting me={me} kind="portfolio" />)}
    </div>,
    profile: card('profile', '프로필·필터', '필터는 공고를 가져올 때와 추천 목록에 그대로 써요.', <><ProfileSetting me={me} /><AiSetting me={me} /></>),
    automation: card('automation', '자동 갱신', null, <AutomationSetting me={me} />),
    status: card('status', '연결 상태', '공고·메일을 가져오는 데 필요한 연결을 확인해요. 문제가 있으면 하단 상태바에도 표시돼요.', <div className="grid gap-5"><ConnectionPanel me={me} /><AiSetting me={me} /></div>),
  } satisfies Record<Section, ReactNode>;
  return <Frame me={me} title="설정" description="계정·메일·서류·프로필을 관리해요">
    <div className="mb-5"><Segmented label="설정 구역" value={section} onChange={choose} options={SECTIONS} /></div>
    {content[section]}
  </Frame>;
}
