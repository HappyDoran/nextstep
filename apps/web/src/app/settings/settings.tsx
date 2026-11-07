'use client';
import { Panel } from '@nextstep/design-system';
import { useMe } from '../api-client';
import { Account } from '../account';
import { AutomationSetting } from '../automation';
import { ResumeSetting } from './resume';
import { ProfileSetting } from './profile';
import { CollectionModeSetting } from '../collection-mode';
import { ConnectionStatus } from '../status';

export function Settings() {
  const me = useMe();
  return <div className="flex flex-col gap-6">
    <h1 className="text-title-lg">설정</h1>
    <Panel><h2 className="mb-3 text-title">계정</h2><Account /></Panel>
    {me.data && <Panel><h2 className="mb-3 text-title">이력서</h2><ResumeSetting me={me.data} /></Panel>}
    {me.data && <Panel><h2 className="mb-3 text-title">프로필·필터</h2><ProfileSetting me={me.data} /></Panel>}
    {me.data && <Panel><h2 className="mb-3 text-title">자동 갱신</h2><AutomationSetting me={me.data} /></Panel>}
    <Panel><h2 className="mb-3 text-title">서비스 연결 확인</h2><ConnectionStatus /></Panel>
    <Panel><h2 className="mb-1 text-title">관리: 수집 모드</h2><p className="mb-5 text-body-sm text-muted-foreground">개발 중에는 누구나 바꿀 수 있습니다. 배포 전에 관리자 전용으로 제한합니다.</p><CollectionModeSetting /></Panel>
    <p className="text-body-sm leading-relaxed text-muted-foreground">네이버 연결은 다음 단계에서 제공합니다.</p>
  </div>;
}
