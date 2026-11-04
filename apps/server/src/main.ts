import { resolve } from 'node:path';
import { createApp } from './app.js';
const port = Number(process.env.NEXTSTEP_API_PORT ?? 4100);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API 포트를 확인하세요.');
const app = createApp(process.env.NEXTSTEP_DB_PATH ?? resolve('.data/nextstep.sqlite'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
await app.listen({ host: '127.0.0.1', port });
console.info(`NextStep API: http://127.0.0.1:${port}`);
