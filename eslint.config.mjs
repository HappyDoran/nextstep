import js from '@eslint/js';
import ts from 'typescript-eslint';
import next from 'eslint-config-next/core-web-vitals';
const config = [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/next-env.d.ts', '**/storybook-static/**', '**/test-results/**', '**/playwright-report/**', '**/.data/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...next.map(item => item.ignores ? item : { ...item, files: ['apps/web/**/*.{js,mjs,ts,tsx}'], settings: { ...item.settings, react: { version: '19.3' }, next: { rootDir: 'apps/web/' } } }),
  { files: ['**/*.{mjs,ts,tsx}'], languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', fetch: 'readonly', setTimeout: 'readonly' } } },
];

export default config;
