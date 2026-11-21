// 브라우저 → 웹 서버 → API 동일 출처 경유. 세션 쿠키를 그대로 전달하고 API 응답 상태·쿠키를 돌려준다.
// 인가는 API가 세션으로 판단한다. 여기서는 허용 경로와 교차 출처 변경 요청만 거른다.
export const dynamic = 'force-dynamic';
const ALLOWED = /^(auth\/(google\/(start|callback)|desktop\/exchange|pending|invite|logout|me)|account|applications(\/[\w-]+)?|settings\/(automation|connections)|documents\/(resume|portfolio|career)(\/text|\/versions(\/[\w-]+(\/active)?)?)?|profile(\/suggest)?|postings\/(refresh|link)|recommendations(\/[\w-]+(\/(hide|feedback))?)?|jobs\/[\w-]+|mail\/(connection|sync|backfill)|reviews(\/[\w-]+(\/body)?)?)$/;
const origin = () => process.env.NEXTSTEP_API_URL ?? 'http://127.0.0.1:4100';

async function forward(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join('/');
  if (!ALLOWED.test(path)) return Response.json({ message: '찾을 수 없습니다.' }, { status: 404 });
  if (request.method !== 'GET') {
    const from = request.headers.get('origin');
    if (!from || new URL(from).host !== request.headers.get('host')) return Response.json({ message: '요청을 확인하세요.' }, { status: 403 });
  }
  const headers: Record<string, string> = {};
  for (const name of ['cookie', 'content-type', 'x-filename']) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  try {
    // 쿼리 문자열(예: 연결 해제 시 지원 건 유지 여부)도 함께 전달한다.
    const response = await fetch(new URL(`/${path}${new URL(request.url).search}`, origin()), {
      method: request.method,
      headers,
      // 이력서 파일처럼 이진 본문도 그대로 전달한다.
      body: request.method === 'GET' || request.method === 'DELETE' ? null : await request.arrayBuffer(),
      cache: 'no-store',
      redirect: 'manual',
      // 서류 변환(이미지 쪽 글자 인식 최대 40초)·AI 처리는 오래 걸릴 수 있다.
      signal: AbortSignal.timeout(120_000),
    });
    const out = new Headers({ 'content-type': response.headers.get('content-type') ?? 'application/json' });
    // 구글 로그인 콜백은 진행 상태 쿠키 삭제와 세션 쿠키를 함께 보내므로 쿠키를 하나씩 옮긴다.
    for (const cookie of response.headers.getSetCookie()) out.append('set-cookie', cookie);
    // 구글 로그인 시작·콜백은 이동 응답이다(구글 인가 화면, 첫 화면, 데스크톱 앱 주소).
    const location = response.headers.get('location');
    if (location) out.set('location', location);
    return new Response(response.status === 204 ? null : await response.text(), { status: response.status, headers: out });
  } catch {
    return Response.json({ message: '서버 연결을 확인하세요.' }, { status: 503 });
  }
}
export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
