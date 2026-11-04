import { healthSchema } from '@nextstep/contracts';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const origin = process.env.NEXTSTEP_API_URL ?? 'http://127.0.0.1:4100';
    const response = await fetch(new URL('/health', origin), { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('연결 실패');
    return Response.json(healthSchema.parse(await response.json()));
  } catch { return Response.json({ message: '서버 연결을 확인하세요.' }, { status: 503 }); }
}
