import type { Config } from 'tailwindcss';

// 값은 CSS 토큰이 소유하고 이 파일은 유틸리티 이름만 연결한다.
const color = (name: string) => `var(--ns-color-${name})`;
const typeRole = (name: string): [string, { lineHeight: string; fontWeight: string; letterSpacing: string }] => [
  `var(--ns-type-${name}-size)`,
  { lineHeight: `var(--ns-type-${name}-line-height)`, fontWeight: `var(--ns-type-${name}-weight)`, letterSpacing: `var(--ns-type-${name}-tracking)` },
];
const preset = {
  theme: {
    extend: {
      colors: {
        background: color('background'), foreground: color('foreground'),
        card: { DEFAULT: color('card'), foreground: color('card-foreground') },
        popover: { DEFAULT: color('popover'), foreground: color('popover-foreground') },
        primary: { DEFAULT: color('primary'), foreground: color('primary-foreground'), hover: color('action-hover'), active: color('action-active') },
        secondary: { DEFAULT: color('secondary'), foreground: color('secondary-foreground') },
        muted: { DEFAULT: color('muted'), foreground: color('muted-foreground') },
        accent: { DEFAULT: color('accent'), foreground: color('accent-foreground') },
        destructive: { DEFAULT: color('destructive'), foreground: color('destructive-foreground'), muted: color('destructive-muted') },
        border: color('border'), input: color('input'), ring: color('ring'),
        success: { DEFAULT: color('success'), foreground: color('success-foreground'), muted: color('success-muted') },
        warning: { DEFAULT: color('warning'), foreground: color('warning-foreground'), muted: color('warning-muted') },
        info: { DEFAULT: color('info'), muted: color('info-muted') },
        highlight: { DEFAULT: color('highlight'), muted: color('highlight-muted') },
      },
      fontFamily: { sans: ['var(--ns-font-family-sans)'], mono: ['var(--ns-font-family-mono)'] },
      fontSize: {
        display: typeRole('display'), 'title-lg': typeRole('title-lg'), title: typeRole('title'),
        'body-lg': typeRole('body-lg'), body: typeRole('body'), 'body-sm': typeRole('body-sm'),
        caption: typeRole('caption'), micro: typeRole('micro'), mono: typeRole('mono'),
      },
      lineHeight: { tight: 'var(--ns-line-height-tight)', normal: 'var(--ns-line-height-normal)', relaxed: 'var(--ns-line-height-relaxed)' },
      spacing: {
        0: 'var(--ns-space-0)', 0.5: 'var(--ns-space-0-5)', 1: 'var(--ns-space-1)', 1.5: 'var(--ns-space-1-5)',
        2: 'var(--ns-space-2)', 2.5: 'var(--ns-space-2-5)', 3: 'var(--ns-space-3)',
        4: 'var(--ns-space-4)', 5: 'var(--ns-space-5)', 6: 'var(--ns-space-6)', 8: 'var(--ns-space-8)',
        10: 'var(--ns-space-10)', 12: 'var(--ns-space-12)', 16: 'var(--ns-space-16)', 24: 'var(--ns-space-24)',
        control: 'var(--ns-control-height)',
        'icon-xs': 'var(--ns-icon-size-xs)', 'icon-sm': 'var(--ns-icon-size-sm)',
        'icon-base': 'var(--ns-icon-size-base)', 'icon-md': 'var(--ns-icon-size-md)', 'icon-lg': 'var(--ns-icon-size-lg)',
      },
      strokeWidth: { icon: 'var(--ns-icon-stroke-width)', emphasis: 'var(--ns-icon-stroke-width-strong)' },
      maxWidth: { content: 'var(--ns-content-width)' },
      borderRadius: {
        xs: 'var(--ns-radius-xs)', sm: 'var(--ns-radius-sm)', md: 'var(--ns-radius-md)', lg: 'var(--ns-radius-lg)',
        xl: 'var(--ns-radius-xl)', '2xl': 'var(--ns-radius-2xl)', full: 'var(--ns-radius-full)',
        control: 'var(--ns-radius-control)', surface: 'var(--ns-radius-surface)',
      },
      outlineWidth: { focus: 'var(--ns-focus-width)' },
      outlineOffset: { focus: 'var(--ns-focus-offset)' },
      boxShadow: { sm: 'var(--ns-shadow-sm)', md: 'var(--ns-shadow-md)', lg: 'var(--ns-shadow-lg)' },
      transitionDuration: { fast: 'var(--ns-duration-fast)', base: 'var(--ns-duration-base)', slow: 'var(--ns-duration-slow)' },
      transitionTimingFunction: { out: 'var(--ns-ease-out)', 'in-out': 'var(--ns-ease-in-out)', hover: 'var(--ns-ease-hover)', drawer: 'var(--ns-ease-drawer)' },
      animation: { spin: 'spin var(--ns-duration-spin) var(--ns-ease-linear) infinite' },
    },
  },
} satisfies Partial<Config>;
export default preset;
