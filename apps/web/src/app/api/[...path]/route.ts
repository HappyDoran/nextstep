// 브라우저 → 웹 서버 → API 동일 출처 경유. 세션 쿠키를 그대로 전달하고 API 응답 상태·쿠키를 돌려준다.
// 인가는 API가 세션으로 판단한다. 여기서는 허용 경로와 교차 출처 변경 요청만 거른다.
export const dynamic = 'force-dynamic';
const ALLOWED = /^(auth\/(signup|login|logout|me)|account|applications(\/[\w-]+)?|settings\/collection)$/;
const origin = () => process.env.NEXTSTEP_API_URL ?? 'http://127.0.0.1:4100';

async function forward(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join('/');
  if (!ALLOWED.test(path)) return Response.json({ message: '찾을 수 없습니다.' }, { status: 404 });
  if (request.method !== 'GET') {
    const from = request.headers.get('origin');
    if (!from || new URL(from).host !== request.headers.get('host')) return Response.json({ message: '요청을 확인하세요.' }, { status: 403 });
  }
  const headers: Record<string, string> = {};
  for (const name of ['cookie', 'content-type']) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  try {
    const response = await fetch(new URL(`/${path}`, origin()), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'DELETE' ? null : await request.text(),
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    const out = new Headers({ 'content-type': response.headers.get('content-type') ?? 'application/json' });
    const cookie = response.headers.get('set-cookie');
    if (cookie) out.set('set-cookie', cookie);
    return new Response(response.status === 204 ? null : await response.text(), { status: response.status, headers: out });
  } catch {
    return Response.json({ message: '서버 연결을 확인하세요.' }, { status: 503 });
  }
}
export { forward as GET, forward as POST, forward as PUT, forward as DELETE };
