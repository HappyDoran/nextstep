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
