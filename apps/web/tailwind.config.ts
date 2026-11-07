import type { Config } from 'tailwindcss';
import nextstepPreset from '@nextstep/design-system/tailwind-preset';
const config = {
  presets: [nextstepPreset],
  content: { relative: true, files: ['./src/**/*.{ts,tsx}', '../../packages/design-system/src/**/*.{ts,tsx}'] },
} satisfies Config;
export default config;
