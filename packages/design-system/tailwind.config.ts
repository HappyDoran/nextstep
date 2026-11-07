import type { Config } from 'tailwindcss';
import nextstepPreset from './src/tailwind-preset';
const config = {
  presets: [nextstepPreset],
  content: { relative: true, files: ['./src/**/*.{ts,tsx}', './.storybook/**/*.{ts,tsx}'] },
} satisfies Config;
export default config;
