// 공고 출처 요청 공통 규칙: 로그인·쿠키 없이 사람 속도로 한 번씩 요청하고, 차단 응답은 재시도하지 않는다.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
export const REQUEST_DELAY_MS = 2500;

export type FetchFailure = 'blocked' | 'not_found' | 'http_error' | 'network';
export type BodyFailure = 'body_missing' | 'body_image_only';

// 한 번 차단 응답을 준 호스트에는 같은 프로세스에서 다시 요청하지 않는다.
const blockedHosts = new Set<string>();
export const resetBlockedHosts = () => blockedHosts.clear();

export async function politeGet(url: string, options: { referer?: string; accept?: string } = {}): Promise<{ text: string } | { code: FetchFailure; status?: number }> {
  const host = new URL(url).host;
  if (blockedHosts.has(host)) return { code: 'blocked' };
  await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
  const request = () => fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: options.accept ?? 'text/html', 'accept-language': 'ko-KR,ko', ...(options.referer ? { referer: options.referer } : {}) },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  let res: Response;
  try {
    res = await request();
  } catch {
    // 일시적인 연결 끊김·시간 초과는 같은 간격을 두고 한 번만 다시 시도한다(2026-11-18 사람인 상세 2건 연결 실패). 차단 응답은 다시 시도하지 않는다.
    await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
    try { res = await request(); } catch { return { code: 'network' }; }
  }
  if (res.status === 403 || res.status === 429) {
    blockedHosts.add(host);
    return { code: 'blocked', status: res.status };
  }
  if (res.status === 404 || res.status === 410) return { code: 'not_found', status: res.status };
  if (!res.ok) return { code: 'http_error', status: res.status };
  // 본문 읽기도 시간 제한(AbortSignal)에 걸리므로 연결 실패와 같게 다룬다.
  try { return { text: await res.text() }; } catch { return { code: 'network' }; }
}

// 출처 마감 값을 시각대가 있는 ISO로 맞춘다. 날짜만 오면 그날 KST 끝으로, 시각대가 없으면 KST로 본다. 읽을 수 없으면 null(미확인).
export function kstDeadline(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().replace(' ', 'T');
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59+09:00` : /^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(v) ? `${v}+09:00` : v;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export function htmlText(html: string): { text: string } | { code: BodyFailure } {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length >= 100) return { text };
  return { code: /<img\b/i.test(html) ? 'body_image_only' : 'body_missing' };
}

export function nextData(html: string): unknown {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]!) : undefined;
}
