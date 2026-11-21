'use client';
import { useSyncExternalStore, type ReactNode } from 'react';
import { Button, Segmented, Toggle } from '@nextstep/design-system';
import { usePrefs } from '../api-client';
import { resetDevice, setPrefs, type Prefs } from '../prefs';

/** 설정 한 줄: 제목·설명 왼쪽, 고르는 것 오른쪽. */
function Row({ title, desc, children }: { title: string; desc: ReactNode; children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-border bg-card px-5 py-4">
    <div className="min-w-0 flex-1"><p className="text-body-sm font-semibold">{title}</p><p className="text-caption text-muted-foreground">{desc}</p></div>
    <div className="shrink-0">{children}</div>
  </div>;
}

const noop = () => () => undefined;
/** 데스크톱 앱이면 그 버전(사용자 에이전트의 NextStep/버전), 아니면 null. 서버 렌더링에서는 null. */
const desktopVersion = () => /Electron\//.test(navigator.userAgent) ? navigator.userAgent.match(/NextStep\/([\w.-]+)/)?.[1] ?? '개발 실행' : null;

// 일반(기획서 4절 사용 편의): 모두 이 기기에만 저장한다. 데스크톱 앱 전용 항목은 웹에서 숨기지 않고 잠근 이유를 보여 준다.
export function GeneralSetting() {
  const prefs = usePrefs();
  const desktop = useSyncExternalStore(noop, desktopVersion, () => null);
  const set = <K extends keyof Prefs>(key: K) => (value: Prefs[K]) => setPrefs({ [key]: value } as Partial<Prefs>);
  const desktopOnly = desktop ? null : <span className="mt-1 block font-semibold">데스크톱 앱에서만 바꿀 수 있어요.</span>;
  return <div className="grid gap-3">
    <Row title="시작 화면" desc="앱을 처음 열 때 보여 줄 화면이에요.">
      <Segmented label="시작 화면" value={prefs.startScreen} onChange={set('startScreen')} options={[{ value: 'applications', label: '지원 현황' }, { value: 'recommendations', label: '추천' }, { value: 'last', label: '마지막 화면' }]} />
    </Row>
    <Row title="글자 크기" desc="화면 전체 글자와 간격이 함께 커져요.">
      <Segmented label="글자 크기" value={prefs.fontScale} onChange={set('fontScale')} options={[{ value: 'sm', label: '작게' }, { value: 'md', label: '보통' }, { value: 'lg', label: '크게' }, { value: 'xl', label: '아주 크게' }]} />
    </Row>
    <Row title="시간 표기" desc="상대는 '3시간 전'처럼, 절대는 '11. 21. 오후 9:05'처럼 보여요.">
      <Segmented label="시간 표기" value={prefs.timeFormat} onChange={set('timeFormat')} options={[{ value: 'absolute', label: '절대' }, { value: 'relative', label: '상대' }]} />
    </Row>
    <Row title="갱신 알림" desc={<>공고 가져오기가 끝나면 컴퓨터 알림으로 알려요.{desktopOnly}</>}>
      <fieldset disabled={!desktop} className="contents"><Segmented label="갱신 알림" value={prefs.notify} onChange={set('notify')} options={[{ value: 'all', label: '모두' }, { value: 'basic', label: '기본 추천 있을 때' }, { value: 'failures', label: '실패만' }, { value: 'off', label: '끄기' }]} /></fieldset>
    </Row>
    <Row title="알림 소리" desc={<>갱신 알림에 소리를 함께 내요.{desktopOnly}</>}>
      <Toggle checked={prefs.sound} disabled={!desktop || prefs.notify === 'off'} onChange={e => setPrefs({ sound: e.target.checked })}><span className="sr-only">알림 소리</span></Toggle>
    </Row>
    <Row title="이 기기 설정 초기화" desc="이 기기에 저장한 화면 설정을 처음으로 되돌려요. 로그인과 서버의 자료는 그대로예요.">
      <Button variant="secondary" onClick={() => { if (window.confirm('이 기기의 화면 설정을 처음으로 되돌립니다.')) { resetDevice(); window.location.reload(); } }}>초기화</Button>
    </Row>
    <p className="text-caption text-muted-foreground">웹 {process.env.NEXT_PUBLIC_BUILD ?? '개발'}{desktop ? ` · 데스크톱 앱 ${desktop}` : ''}</p>
  </div>;
}
