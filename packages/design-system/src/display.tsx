import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

const focus = 'focus-visible:outline focus-visible:outline-focus focus-visible:outline-ring focus-visible:outline-offset-focus';
const join = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

/** 추천 분류. 화면은 서버가 준 값을 그대로 넘기고, 색은 글자와 함께만 쓴다. */
export type Classification = '기본' | '도전' | '미확인' | '제외';
const classText = { 기본: 'text-class-basic', 도전: 'text-class-challenge', 미확인: 'text-class-unknown', 제외: 'text-class-exclude' } as const;
const classTag = { 기본: 'bg-class-basic-muted text-class-basic', 도전: 'bg-class-challenge-muted text-class-challenge', 미확인: 'bg-class-unknown-muted text-class-unknown', 제외: 'bg-class-exclude-muted text-class-exclude' } as const;
const classBar = { 기본: 'before:bg-class-basic', 도전: 'before:bg-class-challenge', 미확인: 'before:bg-class-unknown', 제외: 'before:bg-class-exclude' } as const;

/** 둥근 표시. 분류를 주면 분류 색, 아니면 회색. */
export function Tag({ classification, children }: PropsWithChildren<{ classification?: Classification }>) {
  return <span className={join('inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-caption font-bold', classification ? classTag[classification] : 'bg-muted text-muted-foreground')}>{children ?? classification}</span>;
}
export function ClassLabel({ classification }: { classification: Classification }) {
  return <span className={join('text-caption font-bold', classText[classification])}>{classification}</span>;
}

/** 마감·상태 묶음. onToggle을 주면 접고 펼칠 수 있다. */
export function Lane({ title, hint, count, expanded = true, onToggle, children }: PropsWithChildren<{ title: ReactNode; hint?: ReactNode; count: ReactNode; expanded?: boolean; onToggle?: () => void }>) {
  return <section className="mb-7">
    <div className="mb-2.5 flex items-center gap-2.5">
      {onToggle
        ? <button type="button" aria-expanded={expanded} onClick={onToggle} className={join('inline-flex cursor-pointer items-center gap-1.5 text-body-sm font-extrabold text-foreground', focus)}><ChevronDown className={join('size-icon-sm shrink-0 stroke-emphasis transition-transform duration-fast motion-reduce:transition-none', !expanded && '-rotate-90')} aria-hidden="true" focusable="false" />{title}</button>
        : <h3 className="text-body-sm font-extrabold text-foreground">{title}</h3>}
      {hint ? <span className="text-caption text-muted-foreground">{hint}</span> : null}
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      <span className="text-caption font-semibold tabular-nums text-muted-foreground">{count}</span>
    </div>
    {expanded ? children : null}
  </section>;
}

/** 카드 줄 묶음. 안에 Row를 둔다. */
export function RowList({ children }: PropsWithChildren) {
  return <ul className="divide-y divide-border overflow-hidden rounded-surface border border-border bg-card">{children}</ul>;
}
/**
 * 카드 줄 하나. 상세를 여는 RowTrigger를 안에 두면 줄 전체가 눌린다.
 * 줄 안의 다른 조작(상태 선택 등)은 relative z-10을 주어 RowTrigger 위에 둔다(버튼 안에 버튼을 넣지 않는다).
 */
export function Row({ classification, className, children }: PropsWithChildren<{ classification?: Classification; className?: string }>) {
  return <li className={join("relative grid items-center gap-4 py-3.5 pl-6 pr-5 transition-colors duration-fast hover:bg-muted motion-reduce:transition-none before:absolute before:inset-y-2.5 before:left-0 before:w-1 before:rounded-r before:content-['']", classification ? classBar[classification] : 'before:bg-border-strong', className)}>{children}</li>;
}
export function RowTrigger({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={join("cursor-pointer text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-focus focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring", className)} />;
}
/** 줄 오른쪽 마감 표시. 3일 이하는 강조한다. null이면 상시. */
export function DueDate({ days, date }: { days: number | null; date?: string }) {
  if (days === null) return <span className="text-right text-body-sm font-bold text-muted-foreground">상시</span>;
  return <span className={join('grid text-right tabular-nums', days <= 3 ? 'text-destructive' : 'text-foreground')}><span className="text-body-lg font-extrabold">{days === 0 ? '오늘' : `D-${days}`}</span>{date ? <span className="text-micro font-normal text-muted-foreground">{date}</span> : null}</span>;
}

/** 빈 상태와 오류. 오류는 다시 시도 같은 행동을 함께 준다. */
export function StatePanel({ tone = 'empty', title, description, actions }: { tone?: 'empty' | 'error'; title: ReactNode; description: ReactNode; actions?: ReactNode }) {
  return <div role={tone === 'error' ? 'alert' : undefined} className={join('max-w-2xl rounded-surface px-11 py-10', tone === 'error' ? 'bg-destructive-muted' : 'border-2 border-dashed border-border-strong bg-card')}>
    <h3 className={join('text-body-lg font-extrabold', tone === 'error' ? 'text-destructive' : 'text-foreground')}>{title}</h3>
    <p className="mt-1.5 text-body-sm text-muted-foreground">{description}</p>
    {actions ? <div className="mt-5 flex flex-wrap gap-2">{actions}</div> : null}
  </div>;
}
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={join('h-3 rounded-full bg-muted', className)} />;
}

/** 아래 가운데에 잠깐 뜨는 알림. 되돌리기처럼 행동 하나를 붙일 수 있다. */
export function Toast({ children, action }: PropsWithChildren<{ action?: ReactNode }>) {
  return <div role="status" className="pointer-events-auto flex items-center gap-3.5 rounded-full bg-foreground py-2.5 pl-5 pr-2.5 text-body-sm text-background shadow-lg">{children}{action}</div>;
}
