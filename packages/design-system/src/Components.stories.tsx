import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { BriefcaseBusiness, Check, Inbox, Mail, RefreshCw, Settings, Star } from 'lucide-react';
import { AppShell, Button, buttonClass, ClassLabel, DueDate, Field, GoogleMark, Logo, LogoMark, Input, Lane, NavItem, OptionChip, PageHeader, Rail, Row, RowList, RowTrigger, Segmented, Select, Sheet, Skeleton, StatePanel, StatusBar, Tag, Textarea, Toast, Toggle, type Classification } from './index.js';

// 모든 공고·회사는 예시 데이터다.
const meta = { title: '공통/화면 부품', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const icon = 'size-icon-md shrink-0 stroke-icon';
const rows: { c: Classification; t: string; s: string; why: string; days: number | null; date?: string }[] = [
  { c: '도전', t: '핀테크 프론트엔드 개발자 (결제)', s: '예시페이 · 잡코리아 · 서울 송파구', why: '직무 경력 1년 6개월로 요구 3년보다 부족', days: 2, date: '11/20' },
  { c: '미확인', t: '2026 하반기 신입사원 채용', s: '예시테크 · 자소설닷컴 · 근무지 미기재', why: '근무지·원격 여부 미기재', days: 3, date: '11/21' },
  { c: '기본', t: '모바일 앱 개발 담당자', s: '예시에듀 · 사람인 · 서울 강남구', why: '맞지 않는 조건 없음', days: 5, date: '11/23' },
  { c: '제외', t: 'Flutter 개발자 (POS)', s: '예시시스 · 점핏 · 서울 송파구', why: 'Flutter 실무 2년 이상: 실무 경력 없음', days: null },
  { c: '미확인', t: '웹 프론트엔드 개발자 (마감)', s: '예시랩 · 원티드 · 서울 마포구', why: '이미 마감된 공고', days: -3, date: '11/15' },
];

export const Fields: Story = {
  render: function Render() {
    const [jobs, setJobs] = useState(['프론트엔드', '앱 개발']);
    const [view, setView] = useState<'상태별' | '회사별'>('상태별');
    return <div className="grid max-w-xl gap-5 p-6">
      <Field label="회사"><Input placeholder="예: 예시커머스" /></Field>
      <Field label="공고 URL" help="선택"><Input placeholder="https://" /></Field>
      <Field label="이메일" error="이메일 형식이 아니에요"><Input aria-invalid="true" defaultValue="example@" /></Field>
      <Field label="상태"><Select><option>지원 완료</option><option>전형 진행중</option></Select></Field>
      <Field label="메모"><Textarea placeholder="면접 일정, 담당자 등" /></Field>
      <Field label="비활성"><Input disabled defaultValue="이 서버의 로컬 AI만 써요" /></Field>
      <Toggle defaultChecked>매일 밤 9시 이후 자동으로 가져오기</Toggle>
      <Toggle disabled>비활성 토글</Toggle>
      <div className="flex flex-wrap gap-1.5">{['프론트엔드', '앱 개발', '디자인', 'QA'].map(job => <OptionChip key={job} selected={jobs.includes(job)} onClick={() => setJobs(jobs.includes(job) ? jobs.filter(j => j !== job) : [...jobs, job])}>{jobs.includes(job) ? <Check className="size-icon-xs shrink-0 stroke-emphasis" aria-hidden="true" focusable="false" /> : null}{job}</OptionChip>)}</div>
      <Segmented label="묶는 방식" value={view} onChange={setView} options={[{ value: '상태별', label: '상태별' }, { value: '회사별', label: '회사별' }]} />
      {/* 비활성: fieldset disabled로 감싸면 안의 선택지가 함께 잠긴다(설정 일반의 데스크톱 전용 항목). */}
      <fieldset disabled className="contents"><Segmented label="비활성 예시" value="모두" onChange={() => undefined} options={[{ value: '모두', label: '모두' }, { value: '끄기', label: '끄기' }]} /></fieldset>
    </div>;
  },
};

function Timeline({ onOpen }: { onOpen?: (index: number) => void }) {
  const [folded, setFolded] = useState(false);
  return <>
    <Lane title="이번 주 마감" count="9건">
      <RowList>{rows.map((r, i) => <Row key={r.t} classification={r.c} className="grid-cols-[4.5rem_1fr_16rem_5rem]">
        <ClassLabel classification={r.c} />
        <RowTrigger onClick={() => onOpen?.(i)}><span className="block text-body font-bold">{r.t}</span><span className="block text-caption text-muted-foreground">{r.s}</span></RowTrigger>
        <span className="text-caption text-muted-foreground">{r.why}</span>
        <DueDate days={r.days} {...(r.date ? { date: r.date } : {})} />
      </Row>)}</RowList>
    </Lane>
    <Lane title="불합격" count="139건" expanded={!folded} onToggle={() => setFolded(!folded)}>
      <RowList><Row className="grid-cols-[1fr_10rem]"><RowTrigger><span className="block text-body font-bold">예시게임즈</span><span className="block text-caption text-muted-foreground">웹 프론트엔드 개발자</span></RowTrigger><Select size="sm" className="relative z-10" aria-label="상태" defaultValue="불합격"><option>지원 완료</option><option>불합격</option></Select></Row></RowList>
    </Lane>
  </>;
}
export const Lists: Story = { render: () => <div className="max-w-5xl p-6"><div className="mb-4 flex gap-2">{(['기본', '도전', '미확인', '제외'] as const).map(c => <Tag key={c} classification={c} />)}<Tag>정보 없음</Tag></div><Timeline /></div> };

export const States: Story = {
  render: () => <div className="grid max-w-3xl gap-6 p-6">
    <StatePanel title="아직 추천이 없어요" description="서류와 프로필·필터를 저장한 뒤 새로 가져오기를 누르면 공고를 모아 분류해요." actions={<><Button variant="secondary">서류 등록하러 가기</Button><Button>새로 가져오기</Button></>} />
    <StatePanel tone="error" title="추천을 불러오지 못했어요" description="서버에 연결하지 못했어요. 홈서버가 켜져 있는지 확인한 뒤 다시 시도하세요." actions={<Button variant="secondary">다시 시도</Button>} />
    <RowList>{[0, 1, 2].map(i => <Row key={i} className="grid-cols-[4.5rem_1fr_5rem]"><Skeleton className="w-10" /><div className="grid gap-2"><Skeleton className="h-3.5 w-3/5" /><Skeleton className="w-1/3" /></div><Skeleton className="h-4 w-10 justify-self-end" /></Row>)}</RowList>
    <div className="flex justify-center"><Toast action={<Button size="sm" variant="quiet" className="text-background hover:bg-transparent">되돌리기</Button>}>예시커머스 · 프론트엔드 개발자를 지원 현황에 등록했어요</Toast></div>
  </div>,
};

export const Detail: Story = {
  render: function Render() {
    const [open, setOpen] = useState(true);
    const r = rows[0]!;
    return <div className="p-6"><Button onClick={() => setOpen(true)}>상세 열기</Button>
      <Sheet open={open} onClose={() => setOpen(false)} classification={r.c} eyebrow={<Tag classification={r.c} />} title={r.t} meta={r.s}
        footer={<><Button variant="quiet" onClick={() => setOpen(false)}>관심 없음</Button><div className="ml-auto flex gap-2"><Button variant="secondary">원문 보기</Button><Button>지원 페이지 열기</Button></div></>}>
        <div className="rounded-surface bg-class-challenge-muted px-4 py-3.5"><p className="text-caption font-bold text-class-challenge">도전으로 본 이유</p><p className="text-body-sm font-semibold">{r.why}</p></div>
        <section><h3 className="mb-2 text-body-sm font-extrabold">맞는 점 <span className="text-muted-foreground">2</span></h3><ul className="grid gap-1.5 text-body-sm"><li>✓ React·TypeScript로 웹을 개발해 보신 분</li><li>✓ Git 기반 협업과 코드 리뷰</li></ul></section>
      </Sheet></div>;
  },
};

export const Brand: Story = {
  render: () => <div className="grid gap-6 p-6">
    <div className="flex items-center gap-4"><LogoMark className="size-16" label="NextStep" /><LogoMark label="NextStep" /><LogoMark className="size-5" label="NextStep" /><Logo /></div>
    <a href="#" className={buttonClass('secondary', 'md', 'w-72')}><GoogleMark />Google로 계속하기</a>
  </div>,
};

export const Shell: Story = {
  render: function Render() {
    const [bar, setBar] = useState<'done' | 'running' | 'failed'>('done');
    return <AppShell
      rail={<Rail brand={<LogoMark label="NextStep" />}>
        <NavItem href="#" current icon={<Star className={icon} aria-hidden="true" focusable="false" />} label="추천" />
        <NavItem href="#" icon={<BriefcaseBusiness className={icon} aria-hidden="true" focusable="false" />} label="지원 현황" />
        <NavItem href="#" icon={<Inbox className={icon} aria-hidden="true" focusable="false" />} label="확인 목록" count={4} />
        <NavItem href="#" icon={<Settings className={icon} aria-hidden="true" focusable="false" />} label="설정" />
      </Rail>}
      status={<StatusBar start={<><Mail className="size-icon-sm shrink-0 stroke-icon" aria-hidden="true" focusable="false" />네이버 메일 · 마지막 21:00</>}
        end={bar === 'done' ? '공고 가져오기 끝 · 판정 114건 (기본 5 · 도전 50)' : bar === 'running' ? <><RefreshCw className="size-icon-sm shrink-0 animate-spin stroke-icon motion-reduce:animate-none" aria-hidden="true" focusable="false" />공고 가져오는 중 · 28/105건</> : <span className="text-destructive">공고 가져오기 일부 실패 · 출처 3곳 연결 실패 <button type="button" className="ml-2 font-bold text-primary">연결 확인</button></span>} />}>
      <PageHeader title="추천" description="서류와 희망 조건으로 고른 공고" actions={<><Button variant="secondary">링크로 판정</Button><Button>새로 가져오기</Button></>} />
      <div className="min-h-0 flex-1 overflow-auto"><div className="mx-auto max-w-content px-7 py-6">
        <div className="mb-4"><Segmented label="상태바 예시" value={bar} onChange={setBar} options={[{ value: 'done', label: '방금 갱신' }, { value: 'running', label: '가져오는 중' }, { value: 'failed', label: '실패' }]} /></div>
        <Timeline />
      </div></div>
    </AppShell>;
  },
};
