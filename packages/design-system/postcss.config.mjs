import { fileURLToPath } from 'node:url';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const config = { plugins: [tailwindcss({ config: fileURLToPath(new URL('./tailwind.config.ts', import.meta.url)) }), autoprefixer()] };
export default config;
