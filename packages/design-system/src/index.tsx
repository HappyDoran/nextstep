import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`ns-button ${props.className ?? ''}`} />;
}
export function Panel({ children }: PropsWithChildren) { return <section className="ns-panel">{children}</section>; }
