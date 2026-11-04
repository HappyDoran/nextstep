export function serviceUrl(value: string | undefined, development: boolean): URL {
  if (!value && !development) throw new Error('서비스 HTTPS 주소가 필요합니다.');
  const url = new URL(value ?? 'http://127.0.0.1:3100');
  const local = development && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || url.username || url.password) throw new Error('허용되지 않는 서비스 주소입니다.');
  return url;
}
export function isServiceNavigation(target: string, service: URL): boolean {
  try { const url = new URL(target); return url.origin === service.origin && !url.username && !url.password; } catch { return false; }
}
export function isExternalUrl(target: string): boolean {
  try { const url = new URL(target); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
