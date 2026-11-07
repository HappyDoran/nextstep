import { collectionModeUpdateSchema, collectionSettingsSchema } from '@nextstep/contracts';
export const dynamic = 'force-dynamic';
const origin = () => process.env.NEXTSTEP_API_URL ?? 'http://127.0.0.1:4100';
async function forward(init?: RequestInit) {
  try {
    const response = await fetch(new URL('/settings/collection', origin()), { ...init, cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (response.status === 400) return Response.json({ message: '요청을 확인하세요.' }, { status: 400 });
    if (!response.ok) throw new Error('연결 실패');
    return Response.json(collectionSettingsSchema.parse(await response.json()));
  } catch { return Response.json({ message: '서버 연결을 확인하세요.' }, { status: 503 }); }
}
export function GET() { return forward(); }
export async function PUT(request: Request) {
  const body = collectionModeUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ message: '요청을 확인하세요.' }, { status: 400 });
  return forward({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body.data) });
}
