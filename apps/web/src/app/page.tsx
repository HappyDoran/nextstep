import { Panel } from '@nextstep/design-system';
import { ConnectionStatus } from './status';
export default function Home() {
  return <main className="mx-auto max-w-content px-6 py-12 md:py-24">
    <header className="mb-16 flex items-center justify-between border-b border-border pb-6"><strong className="text-title-lg">NextStep<span className="text-primary">.</span></strong><span className="text-body-sm text-muted-foreground">로컬 개발 환경</span></header>
    <div className="max-w-2xl"><p className="mb-4 text-body-sm font-semibold text-primary">나의 다음 커리어</p><h1 className="mb-6 text-display">다음 기회를 준비하는<br />나만의 공간.</h1><p className="mb-10 leading-relaxed text-muted-foreground">나에게 맞는 공고를 살펴보고, 직접 지원한 이후의 과정을 한곳에서 확인합니다.</p></div>
    <Panel><h2 className="mb-3 text-title">서비스 연결 확인</h2><ConnectionStatus /></Panel>
    <p className="mt-6 text-body-sm leading-relaxed text-muted-foreground">현재는 실행 기반을 확인하는 개발 화면입니다. 초대 로그인·추천·지원 현황·확인 목록·설정은 아직 제공하지 않습니다.</p>
  </main>;
}
