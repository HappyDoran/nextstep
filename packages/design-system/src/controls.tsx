import { ChevronDown } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, PropsWithChildren, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export const focus = 'focus-visible:outline focus-visible:outline-focus focus-visible:outline-ring focus-visible:outline-offset-focus';
export const join = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

const buttonVariant = {
  primary: 'border-primary bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active',
  secondary: 'border-border-strong bg-card text-foreground hover:enabled:bg-muted',
  quiet: 'border-transparent bg-transparent text-muted-foreground font-medium hover:enabled:bg-muted',
  danger: 'border-transparent bg-transparent text-destructive font-medium enabled:hover:bg-destructive-muted',
} as const;
const buttonSize = { md: 'h-control px-4 text-body-sm', sm: 'h-control-sm px-3 text-caption' } as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonVariant; size?: keyof typeof buttonSize };
/** 버튼 모양의 링크(외부 지원 페이지 등)에 같은 모양을 쓴다. */
export const buttonClass = (variant: keyof typeof buttonVariant = 'primary', size: keyof typeof buttonSize = 'md', className?: string) =>
  join('inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-control border font-sans font-semibold transition-[color,background-color,border-color,transform] duration-fast ease-hover motion-safe:active:enabled:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none', buttonVariant[variant], buttonSize[size], focus, className);
/** 화면마다 주된 행동 하나만 primary로 둔다. 아이콘만 있으면 aria-label을 준다. */
export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return <button type="button" {...props} className={buttonClass(variant, size, className)} />;
}

const control = join('w-full rounded-control border border-border-strong bg-card px-3 text-body-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none aria-[invalid=true]:border-destructive disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground', focus);

/** 라벨·도움말·오류를 묶는다. 오류가 있으면 입력에 aria-invalid를 함께 준다. */
export function Field({ label, help, error, children }: PropsWithChildren<{ label: ReactNode; help?: ReactNode; error?: ReactNode }>) {
  // 도움말은 라벨 밖에 두어 입력의 이름에 섞이지 않게 한다. 오류는 role="alert"로 알린다.
  return <div className="grid gap-1.5">
    <label className="grid gap-1.5 text-body-sm font-semibold text-foreground"><span>{label}</span>{children}</label>
    {error ? <p role="alert" className="text-caption text-destructive">{error}</p> : help ? <p className="text-caption text-muted-foreground">{help}</p> : null}
  </div>;
}
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={join(control, 'h-control', className)} />;
}
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={join(control, 'min-h-24 resize-y py-2.5', className)} />;
}
export function Select({ className, size = 'md', ...props }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: 'md' | 'sm' }) {
  // 브라우저 기본 화살표는 테두리에 붙어 보여(사용자 요청 2026-11-24) 숨기고 안쪽에 같은 모양을 둔다.
  return <span className={join('relative', size === 'sm' ? 'inline-grid' : 'grid')}>
    <select {...props} className={join(control, 'cursor-pointer appearance-none', size === 'sm' ? 'h-control-sm w-auto pr-8 text-caption' : 'h-control pr-10', className)} />
    <ChevronDown aria-hidden="true" focusable="false" className={join('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground', size === 'sm' ? 'right-2.5 size-3.5' : 'right-3.5 size-4')} />
  </span>;
}

/** 켜고 끄는 설정. 네이티브 체크박스라 키보드·폼 동작을 그대로 쓴다. */
export function Toggle({ children, className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <label className={join('inline-flex cursor-pointer items-center gap-2.5 text-body-sm text-foreground', className)}>
    <input type="checkbox" role="switch" {...props} className={join('relative h-6 w-10 shrink-0 cursor-pointer appearance-none rounded-full bg-border-strong transition-colors duration-fast checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none', "after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-card after:transition-transform after:duration-fast after:content-[''] checked:after:translate-x-4 motion-reduce:after:transition-none", focus)} />
    {children}
  </label>;
}

/** 여러 개를 고르는 둥근 선택지(희망 직무·고용 형태 등). */
export function OptionChip({ selected, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return <button type="button" aria-pressed={selected} {...props} className={join('inline-flex h-control-sm cursor-pointer items-center gap-1.5 rounded-full border px-3 text-caption transition-colors duration-fast motion-reduce:transition-none', selected ? 'border-primary bg-secondary font-semibold text-secondary-foreground' : 'border-border-strong bg-card text-muted-foreground hover:bg-muted', focus, className)} />;
}

/** 하나만 고르는 보기 전환(상태별/회사별, 설정 구역). */
export function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: readonly { value: T; label: ReactNode }[]; value: T; onChange: (value: T) => void }) {
  return <div role="group" aria-label={label} className="inline-flex flex-wrap gap-1.5">
    {options.map(option => <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)} className={join('h-control-sm cursor-pointer rounded-full border px-4 text-body-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 duration-fast motion-reduce:transition-none', option.value === value ? 'border-foreground bg-foreground font-semibold text-background' : 'border-border-strong bg-card text-muted-foreground hover:enabled:bg-muted', focus)}>{option.label}</button>)}
  </div>;
}
