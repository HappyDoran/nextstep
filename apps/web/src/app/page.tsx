import { Panel } from '@nextstep/design-system';
import { ConnectionStatus } from './status';
export default function Home() {
  return <main className="mx-auto max-w-5xl px-6 py-12 md:py-24">
    <header className="mb-16 flex items-center justify-between border-b border-[var(--ns-border)] pb-6"><strong className="text-2xl tracking-tight">NextStep<span className="text-[var(--ns-accent)]">.</span></strong><span className="text-sm text-[var(--ns-muted)]">로컬 개발 환경</span></header>
    <div className="max-w-2xl"><p className="mb-4 text-sm font-semibold text-[var(--ns-accent)]">나의 다음 커리어</p><h1 className="mb-6 text-4xl font-semibold leading-tight md:text-5xl">다음 기회를 준비하는<br />나만의 공간.</h1><p className="mb-10 leading-7 text-[var(--ns-muted)]">나에게 맞는 공고를 살펴보고, 직접 지원한 이후의 과정을 한곳에서 확인합니다.</p></div>
    <Panel><h2 className="mb-3 text-lg font-semibold">서비스 연결 확인</h2><ConnectionStatus /></Panel>
    <p className="mt-6 text-sm leading-6 text-[var(--ns-muted)]">현재는 실행 기반을 확인하는 개발 화면입니다. 초대 로그인·추천·지원 현황·확인 목록·설정은 아직 제공하지 않습니다.</p>
  </main>;
}
