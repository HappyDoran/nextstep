'use client';
import { Panel } from '@nextstep/design-system';
import { useMe } from '../api-client';
import { Account } from '../account';
import { AutomationSetting } from '../automation';
import { ResumeSetting } from './resume';
import { AiSetting } from './ai';
import { ProfileSetting } from './profile';
import { MailSetting } from './mail';
import { ConnectionStatus } from '../status';
import { Frame, LegacyLayout } from '../frame';

export function Settings() {
  const me = useMe();
  const body = <div className="flex flex-col gap-6">
    {!me.data && <h1 className="text-title-lg">설정</h1>}
    <Panel><h2 className="mb-3 text-title">계정</h2><Account /></Panel>
    {me.data && <Panel><h2 className="mb-3 text-title">네이버 메일 연결</h2><MailSetting me={me.data} /></Panel>}
    {me.data && <Panel><h2 className="mb-3 text-title">AI 처리</h2><AiSetting me={me.data} /></Panel>}
    {me.data && <Panel><h2 className="mb-3 text-title">이력서 (필수)</h2><ResumeSetting me={me.data} /></Panel>}
    {me.data && <Panel><h2 className="mb-3 text-title">경력기술서 (선택)</h2><ResumeSetting me={me.data} kind="career" /></Panel>}
    {me.data && <Panel><h2 className="mb-3 text-title">포트폴리오 (선택)</h2><ResumeSetting me={me.data} kind="portfolio" /></Panel>}
    {me.data && <Panel><h2 className="mb-3 text-title">프로필·필터</h2><ProfileSetting me={me.data} /></Panel>}
    {me.data && <Panel><h2 className="mb-3 text-title">자동 갱신</h2><AutomationSetting me={me.data} /></Panel>}
    <Panel><h2 className="mb-3 text-title">서비스 연결 확인</h2><ConnectionStatus /></Panel>
  </div>;
  return me.data ? <Frame me={me.data} title="설정" description="계정·메일·서류·프로필을 관리해요">{body}</Frame> : <LegacyLayout>{body}</LegacyLayout>;
}
