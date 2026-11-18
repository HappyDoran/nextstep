import { useEffect, useId, useRef, type PropsWithChildren, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Classification } from './display.js';

const bar = { 기본: 'before:bg-class-basic', 도전: 'before:bg-class-challenge', 미확인: 'before:bg-class-unknown', 제외: 'before:bg-class-exclude' } as const;

/**
 * 상세·입력 창. 네이티브 <dialog>의 showModal로 포커스 가두기·Esc·바깥 비활성을 브라우저에 맡긴다.
 * 주된 행동은 footer(아래 고정 줄)에 둔다.
 */
export function Sheet({ open, onClose, title, eyebrow, meta, classification, footer, size = 'md', children }: PropsWithChildren<{ open: boolean; onClose: () => void; title: ReactNode; eyebrow?: ReactNode; meta?: ReactNode; classification?: Classification; footer?: ReactNode; size?: 'md' | 'sm' }>) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} onClose={onClose} onClick={event => { if (event.target === ref.current) onClose(); }} aria-labelledby={titleId}
    className={`m-auto max-h-[calc(100dvh-4rem)] w-[calc(100vw-2rem)] overflow-hidden rounded-dialog bg-card p-0 text-foreground shadow-lg backdrop:bg-black/40 open:flex open:flex-col ${size === 'sm' ? 'max-w-lg' : 'max-w-3xl'}`}>
    <header className={`relative border-b border-border px-8 pb-5 pt-7 before:absolute before:inset-x-0 before:top-0 before:h-1.5 before:content-[''] ${classification ? bar[classification] : 'before:bg-primary'}`}>
      {eyebrow}
      <h2 id={titleId} className="mt-2.5 pr-10 text-title font-extrabold text-balance">{title}</h2>
      {meta ? <p className="mt-1 text-body-sm text-muted-foreground">{meta}</p> : null}
      <button type="button" onClick={onClose} aria-label="닫기" className="absolute right-4 top-4 grid size-9 cursor-pointer place-items-center rounded-full bg-muted text-muted-foreground focus-visible:outline focus-visible:outline-focus focus-visible:outline-ring focus-visible:outline-offset-focus"><X className="size-icon-base shrink-0 stroke-emphasis" aria-hidden="true" focusable="false" /></button>
    </header>
    <div className="grid min-h-0 gap-5 overflow-auto px-8 py-6">{children}</div>
    {footer ? <footer className="flex items-center gap-2 border-t border-border bg-background px-8 py-4">{footer}</footer> : null}
  </dialog>;
}
