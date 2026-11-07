import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`inline-flex min-h-control cursor-pointer items-center justify-center gap-2 rounded-control border border-transparent bg-primary px-5 py-3 font-sans text-body font-medium text-primary-foreground transition-colors duration-fast ease-out enabled:hover:bg-primary-hover enabled:active:bg-primary-active disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground focus-visible:outline focus-visible:outline-focus focus-visible:outline-ring focus-visible:outline-offset-focus motion-reduce:transition-none ${props.className ?? ''}`} />;
}
export function Panel({ children }: PropsWithChildren) {
  return <section className="rounded-surface border border-border bg-card p-6">{children}</section>;
}
