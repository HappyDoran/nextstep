// 창이 여는 서비스 주소와 외부 링크 검사. 원격은 HTTPS만, 같은 컴퓨터(loopback)는 HTTP도 허용한다(홈서버 전 Mac 로컬 서비스).
export function serviceUrl(value: string | undefined): URL {
  const url = new URL(value || 'http://127.0.0.1:3100');
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((!loopback && url.protocol !== 'https:') || url.username || url.password) throw new Error('허용되지 않는 서비스 주소입니다.');
  return url;
}
export function isServiceNavigation(target: string, service: URL): boolean {
  try { const url = new URL(target); return url.origin === service.origin && !url.username && !url.password; } catch { return false; }
}
export function isExternalUrl(target: string): boolean {
  try { const url = new URL(target); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
// 구글 로그인 시작 주소: 구글은 앱 안 창의 로그인을 막으므로 기본 브라우저로 연다(client=desktop을 붙여 끝나면 앱 주소로 돌아옴).
// nonce는 이 앱이 로그인마다 만든 임의 값이며, 서버는 돌려준 코드를 이 값과 함께 낼 때만 바꿔 준다.
export function googleLoginUrl(target: string, service: URL, nonce: string): string | undefined {
  if (!isServiceNavigation(target, service)) return undefined;
  const url = new URL(target);
  if (url.pathname !== '/api/auth/google/start') return undefined;
  url.searchParams.set('client', 'desktop');
  url.searchParams.set('desktop_nonce', nonce);
  return url.href;
}
// 기본 브라우저 로그인이 끝나면 nextstep://auth?code=… 로 앱을 연다. 형식이 맞는 코드만 이 앱이 시작한 로그인의 임의 값과 함께
// 창의 첫 화면(?desktop_code=&desktop_nonce=)으로 넘긴다.
export function desktopLoginPath(link: string, nonce: string): string | undefined {
  try {
    const url = new URL(link);
    const code = url.searchParams.get('code') ?? '';
    return url.protocol === 'nextstep:' && url.hostname === 'auth' && /^[\w-]{43}$/.test(code) ? `/?desktop_code=${code}&desktop_nonce=${nonce}` : undefined;
  } catch { return undefined; }
}
