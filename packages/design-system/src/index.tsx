import type { PropsWithChildren } from 'react';
export { Button, buttonClass, Field, Input, OptionChip, Segmented, Select, Textarea, Toggle, type ButtonProps } from './controls.js';
export { ClassLabel, DueDate, GoogleMark, Logo, LogoMark, Lane, Row, RowList, RowTrigger, Skeleton, StatePanel, Tag, Toast, type Classification } from './display.js';
export { Sheet } from './overlay.js';
export { AppShell, NavItem, PageHeader, Rail, StatusBar } from './shell.js';

export function Panel({ children }: PropsWithChildren) {
  return <section className="rounded-surface border border-border bg-card p-6">{children}</section>;
}
