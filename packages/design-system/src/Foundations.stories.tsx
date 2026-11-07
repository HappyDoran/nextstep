import { useEffect, useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { springPresets } from './motion.js';
import { Button } from './index.js';
import { Search, Filter, ArrowUpRight, RefreshCw, CircleCheck, CircleAlert, Info, X, LoaderCircle } from 'lucide-react';
const meta = { title: '기초/토큰', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function TokenValue({ tokens }: { tokens: string[] }) {
  const output = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    if (!output.current) return;
    const style = getComputedStyle(output.current);
    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    output.current.textContent = tokens.map(name => {
      const value = style.getPropertyValue(name).trim();
      if (/^[\d.]+rem$/.test(value)) return `${parseFloat(value) * rootSize}px`;
      if (name.endsWith('-line-height')) return `${Math.round(parseFloat(value) * 100)}%`;
      return value;
    }).join(' · ');
  }, [tokens]);
  return <output ref={output} className="foundation-value" aria-label="실제 적용값" />;
}
const colorTokens = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
  'accent', 'accent-foreground', 'destructive', 'destructive-foreground', 'destructive-muted',
  'border', 'input', 'ring', 'success', 'success-foreground', 'success-muted', 'warning',
  'warning-foreground', 'warning-muted', 'info', 'info-muted', 'highlight', 'highlight-muted',
];
function ColorPalette({ theme }: { theme: 'light' | 'dark' }) {
  return <article className="foundation foundation-theme" data-ns-theme={theme}><h1>{theme === 'light' ? 'Light' : 'Dark'} 색상 역할</h1><p>브랜드 색상은 인디고입니다. 피드백·브랜드·개인 상태의 의미를 구분합니다.</p>
    <div className="foundation-palette">{colorTokens.map(name => <div className="foundation-swatch" key={name}><div data-color-swatch={name} style={{ background: `var(--ns-color-${name})` }} /><strong>{name}</strong><code>--ns-color-{name}</code><TokenValue tokens={[`--ns-color-${name}`]} /></div>)}</div>
  </article>;
}
export const Colors: Story = { name: 'Light 색상', render: () => <ColorPalette theme="light" /> };
export const DarkColors: Story = { name: 'Dark 색상', render: () => <ColorPalette theme="dark" /> };
const typeClasses: Record<string, string> = {
  display: 'text-display', 'title-lg': 'text-title-lg', title: 'text-title',
  'body-lg': 'text-body-lg', body: 'text-body', 'body-sm': 'text-body-sm',
  caption: 'text-caption', micro: 'text-micro', mono: 'font-mono text-mono',
};
const iconSizes = [
  ['xs', 'size-icon-xs stroke-emphasis'], ['sm', 'size-icon-sm stroke-emphasis'],
  ['base', 'size-icon-base stroke-icon'], ['md', 'size-icon-md stroke-icon'], ['lg', 'size-icon-lg stroke-icon'],
];
const typography = [['display', '다음 기회를 준비하는 공간'], ['title-lg', '나의 다음 커리어'], ['title', '지원 내역'], ['body-lg', '추천 공고를 확인하세요'], ['body', '공고와 근거를 차분하게 읽는 본문입니다.'], ['body-sm', '마지막 확인 시각과 보조 설명'], ['caption', '출처와 기준 시각'], ['micro', '보조 레이블'], ['mono', '2026-11-07 · ID 001']];
export const Typography: Story = {
  name: '타이포그래피',
  render: () => <article className="foundation"><h1>타이포그래피</h1><p>Pretendard Variable을 로컬에서 제공합니다. 본문은 16px이며 현재 크기·두께는 검토 중인 초안입니다.</p>
    {typography.map(([name, sample]) => <div className="foundation-sample" key={name}><code>--ns-type-{name}-*</code><div className={typeClasses[name!]} data-type-preview>{sample}</div><TokenValue tokens={[`--ns-type-${name}-size`, `--ns-type-${name}-line-height`, `--ns-type-${name}-weight`, `--ns-type-${name}-tracking`]} /></div>)}
  </article>,
};
export const Spacing: Story = {
  name: '간격',
  render: () => <article className="foundation"><h1>간격</h1><p>기본 4px 스케일에 2·6·10px 미세 간격을 둡니다. rem 단위이므로 브라우저 기본 글자 크기에 따라 함께 변합니다.</p>
    {['0-5', '1', '1-5', '2', '2-5', '3', '4', '5', '6', '8', '10', '12', '16', '24'].map(step => <div className="foundation-row" key={step}><code>--ns-space-{step}</code><span style={{ display: 'block', width: `var(--ns-space-${step})`, height: 'var(--ns-space-4)', background: 'var(--ns-color-action-primary)' }} /><TokenValue tokens={[`--ns-space-${step}`]} /></div>)}
  </article>,
};
export const ShapeAndFocus: Story = {
  name: '모서리·포커스',
  render: () => <article className="foundation"><h1>모서리·포커스</h1><div className="foundation-row">{['xs', 'sm', 'md', 'lg', 'xl', '2xl', 'full'].map(size => <div className="foundation-sample" data-radius={size} key={size} style={{ borderRadius: `var(--ns-radius-${size})` }}><code>radius-{size}</code><br /><TokenValue tokens={[`--ns-radius-${size}`]} /></div>)}</div><p>Tab 키로 아래 링크의 포커스를 확인하세요.</p><a className="text-primary focus-visible:outline focus-visible:outline-focus focus-visible:outline-ring focus-visible:outline-offset-focus" style={{ color: 'var(--ns-color-action-primary)' }} href="#foundation-focus" id="foundation-focus">키보드 포커스 예시</a></article>,
};
const icons = [Search, Filter, ArrowUpRight, RefreshCw, CircleCheck, CircleAlert, Info, X];
export const Icons: Story = {
  name: 'Lucide 아이콘',
  render: () => <article className="foundation"><h1>Lucide React</h1><p>12/14/16/20/24px·currentColor. 기본 선 두께 1.5, 작은 크기와 강조는 2를 사용합니다.</p>
    <div className="foundation-row">{icons.map((Icon, index) => <div className="foundation-sample" key={index}><Icon className="size-icon-md shrink-0 stroke-icon" aria-hidden="true" focusable="false" /></div>)}</div>
    <h2>크기</h2><div className="foundation-row">{iconSizes.map(([size, classes]) => <span key={size}><Search className={`shrink-0 ${classes}`} aria-hidden="true" focusable="false" /> {size}</span>)}</div>
    <h2>동작·접근성</h2><p><LoaderCircle className="size-icon-md shrink-0 animate-spin stroke-icon motion-reduce:animate-none" aria-hidden="true" focusable="false" /> 처리중 — 동작 감소 설정에서는 회전을 멈춥니다.</p><p>텍스트 옆 아이콘은 장식으로 숨기고, 아이콘만 있는 버튼에는 버튼의 aria-label을 제공합니다.</p>
  </article>,
};

export const ElevationAndMotion: Story = {
  name: '그림자·모션',
  render: () => <article className="foundation"><h1>그림자·모션</h1><div className="foundation-row">{['sm', 'md', 'lg'].map(size => <div key={size} className="foundation-sample" style={{ boxShadow: `var(--ns-shadow-${size})`, borderRadius: 'var(--ns-radius-surface)' }}>shadow-{size}<br /><TokenValue tokens={[`--ns-shadow-${size}`]} /></div>)}</div><p>상태 변화 120ms, 일반 전환 200ms, 큰 전환 320ms. 진입·피드백은 ease-out, 위치 전환은 ease-in-out을 사용합니다.</p><p>동작 감소 설정에서는 회전과 버튼 전환을 멈춥니다. 제스처용 spring은 설계값만 정의했으며 실행 엔진은 아직 추가하지 않았습니다.</p><LoaderCircle className="size-icon-md shrink-0 animate-spin stroke-icon motion-reduce:animate-none" aria-hidden="true" focusable="false" /> 처리중</article>,
};
export const Themes: Story = {
  name: 'Light·Dark',
  render: () => <article className="foundation"><h1>Light·Dark</h1><p>토큰 수준의 테마 초안입니다. 앱의 테마 설정 기능은 아직 없습니다.</p><div className="foundation-grid">{['light', 'dark'].map(theme => <section key={theme} data-ns-theme={theme} className="foundation-sample" style={{ background: 'var(--ns-color-bg-canvas)', color: 'var(--ns-color-text-primary)' }}><h2>{theme}</h2><p>공고와 최소 근거를 확인하는 공간입니다.</p><Button>다음 단계</Button><p style={{ color: 'var(--ns-color-warning-text)' }}>확인이 필요한 정보가 있습니다.</p></section>)}</div></article>,
};
export const BrandCandidates: Story = {
  name: '브랜드 색상 비교',
  render: () => <article className="foundation"><h1>브랜드 색상</h1><p>선택한 인디고를 기본 브랜드에 적용했습니다. 이전 후보는 비교용으로 유지합니다.</p><div className="foundation-grid">{[['indigo', '인디고 · 선택', 'NextStep의 기본 브랜드 색상'], ['teal', '페트롤 틸', '이전 후보 · 차분한 강조'], ['slate-blue', '슬레이트 블루', '절제되고 업무 도구에 가까운 표현']].map(([brand, title, description]) => <section key={brand} data-ns-brand={brand} className="foundation-sample"><h2 style={{ color: 'var(--ns-color-action-primary)' }}>{title}</h2><TokenValue tokens={['--ns-color-action-primary']} /><p>{description}</p><Button>다음 단계</Button></section>)}</div></article>,
};

export const EasingAndDuration: Story = {
  name: '이징·시간·spring',
  render: () => <article className="foundation"><h1>이징·시간·spring</h1><p>일반 전환은 CSS 토큰을 사용합니다. spring과 duration은 서로 대체하는 값이 아닙니다.</p><div className="foundation-grid">{['out', 'in-out', 'hover', 'drawer'].map(name => <div className="foundation-sample" key={name}><strong>ease-{name}</strong><br /><code>--ns-ease-{name}</code><br /><TokenValue tokens={[`--ns-ease-${name}`]} /></div>)}</div><div className="foundation-row">{['fast', 'base', 'slow'].map(name => <div key={name} className="foundation-sample"><code>--ns-duration-{name}</code><br /><span style={{ transitionDuration: `var(--ns-duration-${name})` }}><TokenValue tokens={[`--ns-duration-${name}`]} /></span></div>)}</div><h2>제스처 설계값</h2><p>response/damping 표기입니다. 라이브러리의 stiffness/damping에 그대로 전달하지 않습니다.</p><table className="foundation-table"><thead><tr><th>범위</th><th>damping</th><th>response (s)</th></tr></thead><tbody>{Object.entries(springPresets).map(([name, value]) => <tr key={name}><th>{name}</th><td>{value.damping}</td><td>{value.responseSeconds}</td></tr>)}</tbody></table></article>,
};
export const MotionRules: Story = {
  name: '모션 규칙',
  render: () => <article className="foundation"><h1>모션 규칙</h1><ol className="foundation-rules"><li>진입·종료는 ease-out, 위치 전환은 ease-in-out, hover는 ease를 사용합니다.</li><li>자주 쓰는 키보드 단축키·반복 작업에는 진입 애니메이션을 생략합니다.</li><li>눌림 피드백은 pointer-down부터 반영하며 클릭이 끝날 때까지 기다리지 않습니다.</li><li>진입 시 scale(0)에서 시작하지 않습니다.</li><li>팝오버는 트리거 방향, 모달은 중앙에서 시작하는 것을 기본으로 검토합니다.</li><li>이동·크기 변형에는 transform과 opacity를 쓰고 width·height·padding을 애니메이션하지 않습니다.</li><li>반복해서 여닫는 UI는 중단·역전이 가능한 transition을 우선합니다.</li><li>일반 전환은 base 이하, 큰 전환만 slow를 사용합니다.</li><li>동작 감소 설정에서는 이동·spring을 제거하고 필요하면 base 길이의 opacity 전환만 사용합니다.</li><li>이 규칙은 새 UI 구현의 기준이며 아직 없는 팝오버·모달·제스처가 구현됐다는 의미는 아닙니다.</li></ol></article>,
};
