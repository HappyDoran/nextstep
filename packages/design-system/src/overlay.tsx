import { useEffect, useId, useRef, type PropsWithChildren, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { classBar as bar, type Classification } from './display.js';

/**
 * 상세·입력 창. 네이티브 <dialog>의 showModal로 포커스 가두기·Esc·바깥 비활성을 브라우저에 맡긴다.
 * 주된 행동은 footer(아래 고정 줄)에 둔다.
 */
export function Sheet({ open, onClose, title, eyebrow, meta, classification, footer, size = 'md', children }: PropsWithChildren<{ open: boolean; onClose: () => void; title: ReactNode; eyebrow?: ReactNode; meta?: ReactNode; classification?: Classification; footer?: ReactNode; size?: 'md' | 'sm' | 'lg' }>) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // 바깥 누르기로 닫기: 누른 곳과 뗀 곳이 모두 바깥일 때만(입력 칸에서 끌어 선택하다 바깥에서 떼도 닫히지 않게).
  const downOutside = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} onClose={onClose} onMouseDown={event => { downOutside.current = event.target === ref.current; }} onClick={event => { if (event.target === ref.current && downOutside.current) onClose(); }} aria-labelledby={titleId}
    className={`m-auto max-h-[calc(100dvh-4rem)] w-[calc(100vw-2rem)] overflow-hidden rounded-dialog bg-card p-0 text-foreground shadow-lg backdrop:bg-black/40 open:flex open:flex-col ${size === 'sm' ? 'max-w-lg' : size === 'lg' ? 'h-[min(52rem,calc(100dvh-4rem))] max-w-5xl' : 'max-w-3xl'}`}>
    <header className={`relative border-b border-border px-8 pb-5 pt-7 before:absolute before:inset-x-0 before:top-0 before:h-1.5 before:content-[''] ${classification ? bar[classification] : 'before:bg-primary'}`}>
      {eyebrow}
      <h2 id={titleId} className="mt-2.5 pr-10 text-title font-extrabold text-balance">{title}</h2>
      {meta ? <p className="mt-1 text-body-sm text-muted-foreground">{meta}</p> : null}
      <button type="button" onClick={onClose} aria-label="닫기" className="absolute right-4 top-4 grid size-9 cursor-pointer place-items-center rounded-full bg-muted text-muted-foreground focus-visible:outline focus-visible:outline-focus focus-visible:outline-ring focus-visible:outline-offset-focus"><X className="size-icon-base shrink-0 stroke-emphasis" aria-hidden="true" focusable="false" /></button>
    </header>
    {/* 넘치면 본문만 스크롤한다. 자식은 줄어들지 않게 둔다(overflow-hidden 자식이 잘리는 문제). */}
    <div className="flex min-h-0 flex-col gap-5 overflow-auto px-8 py-6 [&>*]:shrink-0">{children}</div>
    {footer ? <footer className="flex items-center gap-2 border-t border-border bg-background px-8 py-4">{footer}</footer> : null}
  </dialog>;
}
