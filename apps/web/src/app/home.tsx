'use client';
import { Panel } from '@nextstep/design-system';
import { useMe } from './api-client';
import { Account } from './account';
import { Applications } from './applications';
import { ConnectionStatus } from './status';
import { LegacyLayout } from './frame';

export function Home() {
  const me = useMe();
  if (me.data) return <Applications me={me.data} />;
  return <LegacyLayout>
    <div className="max-w-2xl"><p className="mb-4 text-body-sm font-semibold text-primary">나의 다음 커리어</p><h1 className="mb-6 text-display">다음 기회를 준비하는<br />나만의 공간.</h1><p className="mb-10 leading-relaxed text-muted-foreground">나에게 맞는 공고를 살펴보고, 직접 지원한 이후의 과정을 한곳에서 확인합니다.</p></div>
    <div className="flex flex-col gap-6">
      <Panel><h2 className="mb-3 text-title">계정</h2><Account /></Panel>
      <Panel><h2 className="mb-3 text-title">서비스 연결 확인</h2><ConnectionStatus /></Panel>
    </div>
  </LegacyLayout>;
}
