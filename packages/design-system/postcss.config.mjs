import { fileURLToPath } from 'node:url';
import tailwindcss from 'tailwindcss';
const config = { plugins: [tailwindcss({ config: fileURLToPath(new URL('./tailwind.config.ts', import.meta.url)) })] };
export default config;
