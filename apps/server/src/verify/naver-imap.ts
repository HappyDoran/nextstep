// P1-01 네이버 읽기 전용 조회 검증. 메일을 읽음 처리·이동·삭제하지 않고(EXAMINE, 헤더·플래그만 조회)
// 제목·주소·본문을 출력하지 않는다. 출력은 편지함별 위치·건수·채용 출처 도메인 집계뿐이다.
// 실행: NAVER_IMAP_USER=... NAVER_IMAP_PASSWORD=... pnpm --filter @nextstep/server verify:naver
import { pathToFileURL } from 'node:url';
import { ImapFlow } from 'imapflow';

const EXCLUDED = new Set(['\\Sent', '\\Drafts', '\\Trash', '\\Junk']);
const PLATFORMS: Record<string, string[]> = {
  wanted: ['wanted.co.kr', 'wantedlab.com'],
  jobkorea: ['jobkorea.co.kr'],
  jasoseol: ['jasoseol.com'],
};
const SINCE_DAYS = 90;
// 출처별 최근 메일만 본문 링크를 확인한다. 본문은 메모리에서 링크 집계 후 버린다.
const ALERT_SAMPLE = 40;
const POSTING_LINKS: Record<string, RegExp> = {
  wanted: /wanted\.co\.kr\/(?:wd|jobs)\/(\d+)/g,
  jobkorea: /jobkorea\.co\.kr\/Recruit\/GI_Read\/(\d+)/gi,
  jasoseol: /jasoseol\.com\/recruit\/(\d+)/g,
};

// 메일 본문에서 출처 공고 ID를 찾는다. 추적 링크 안에 URL 인코딩된 주소도 풀어서 본다.
export function postingIds(platform: string, body: string) {
  let text = body.replace(/&amp;/g, '&');
  for (let i = 0; i < 3; i++) {
    try { const next = decodeURIComponent(text); if (next === text) break; text = next; } catch { break; }
  }
  return [...new Set([...text.matchAll(POSTING_LINKS[platform]!)].map(m => m[1]!))];
}

async function resolveRedirect(platform: string, url: string, hops = 4): Promise<string | undefined> {
  let current = url;
  for (let i = 0; i < hops; i++) {
    const found = postingIds(platform, current)[0];
    if (found) return found;
    let res: Response;
    try { res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(10_000) }); } catch { return undefined; }
    await res.body?.cancel();
    const next = res.headers.get('location');
    if (!next) return undefined;
    current = new URL(next, current).href;
  }
  return postingIds(platform, current)[0];
}

type Part = { part?: string; type?: string; childNodes?: Part[]; disposition?: string };
function textPart(node: Part | undefined): string | undefined {
  if (!node) return undefined;
  if (node.childNodes) {
    const parts = node.childNodes.map(textPart).filter(Boolean);
    return parts[0];
  }
  return node.disposition !== 'attachment' && (node.type === 'text/html' || node.type === 'text/plain') ? (node.part ?? '1') : undefined;
}

export type ImapFailure = 'missing_credentials' | 'auth_failed' | 'network' | 'tls' | 'protocol';

export function classifyImapError(error: unknown): ImapFailure {
  const e = error as { authenticationFailed?: boolean; code?: string; message?: string };
  if (e.authenticationFailed) return 'auth_failed';
  if (e.code && ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ETIMEOUT', 'NoConnection'].includes(e.code)) return 'network';
  if (e.code?.startsWith('ERR_TLS') || e.code === 'CERT_HAS_EXPIRED' || /certificate|tls/i.test(e.message ?? '')) return 'tls';
  return 'protocol';
}

function platformOf(address: string | undefined) {
  const domain = address?.split('@')[1]?.toLowerCase();
  if (!domain) return undefined;
  return Object.keys(PLATFORMS).find(key => PLATFORMS[key]!.some(d => domain === d || domain.endsWith('.' + d)));
}

async function main() {
  const user = process.env.NAVER_IMAP_USER;
  const pass = process.env.NAVER_IMAP_PASSWORD;
  if (!user || !pass) return fail('missing_credentials');
  const client = new ImapFlow({ host: 'imap.naver.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  client.on('error', () => {});
  try {
    await client.connect();
  } catch (error) {
    return fail(classifyImapError(error));
  }
  const since = new Date(Date.now() - SINCE_DAYS * 86_400_000);
  const mailboxes = [];
  try {
    for (const box of await client.list()) {
      if (box.flags.has('\\Noselect') || (box.specialUse && EXCLUDED.has(box.specialUse))) continue;
      const opened = await client.mailboxOpen(box.path, { readOnly: true });
      const uids = opened.exists ? ((await client.search({ since }, { uid: true })) || []) : [];
      const platforms: Record<string, number> = {};
      const platformUids: Record<string, number[]> = {};
      let seenBefore = 0;
      if (uids.length) {
        for await (const msg of client.fetch(uids, { uid: true, flags: true, envelope: true }, { uid: true })) {
          if (msg.flags?.has('\\Seen')) seenBefore++;
          const p = platformOf(msg.envelope?.from?.[0]?.address);
          if (p) { platforms[p] = (platforms[p] ?? 0) + 1; (platformUids[p] ??= []).push(msg.uid); }
        }
      }
      // 같은 범위를 다시 조회해 읽음 플래그가 바뀌지 않았는지 확인한다.
      let seenAfter = 0;
      if (uids.length) for await (const msg of client.fetch(uids, { uid: true, flags: true }, { uid: true })) if (msg.flags?.has('\\Seen')) seenAfter++;
      const alerts: Record<string, { sampled: number; withPostingLink: number; uniquePostings: number; otherLinkHosts: string[]; redirectTried: number; redirectResolved: number }> = {};
      for (const [platform, list] of Object.entries(platformUids)) {
        const sample = list.sort((a, b) => b - a).slice(0, ALERT_SAMPLE);
        const ids = new Set<string>();
        const hosts = new Set<string>();
        let withLink = 0;
        const tracking: string[] = [];
        const structures = [];
        for await (const msg of client.fetch(sample, { uid: true, bodyStructure: true }, { uid: true })) structures.push(msg);
        for (const msg of structures) {
          const part = textPart(msg.bodyStructure as Part);
          if (!part) continue;
          const { content } = await client.download(String(msg.uid), part, { uid: true });
          let body = '';
          if (!content) continue;
          for await (const chunk of content) body += chunk.toString('utf8');
          const found = postingIds(platform, body);
          if (found.length) withLink++;
          found.forEach(id => ids.add(id));
          if (!found.length) for (const m of body.matchAll(/https?:\/\/([a-z0-9.-]+)[^\s"'<>]*/gi)) {
            hosts.add(m[1]!.toLowerCase());
            if (/^(?:o2\.mail\.wanted\.co\.kr|ablink\.[a-z.]*wantedlab\.com)$/i.test(m[1]!) && tracking.length < 5) tracking.push(m[0].replace(/&amp;/g, '&'));
          }
        }
        // 추적 링크는 사용자가 받은 메일의 링크다. 리다이렉트 위치만 확인하고 공고 페이지는 요청하지 않는다.
        let resolved = 0;
        for (const link of tracking) {
          const id = await resolveRedirect(platform, link);
          if (id) { resolved++; ids.add(id); }
        }
        alerts[platform] = { sampled: sample.length, withPostingLink: withLink, uniquePostings: ids.size, otherLinkHosts: [...hosts].slice(0, 10), redirectTried: tracking.length, redirectResolved: resolved };
      }
      // 증분: 확보한 최대 UID 다음부터 조회하면 새 메일만 나온다(위치 전진 검증).
      const lastUid = uids.length ? Math.max(...uids) : 0;
      const newer = lastUid ? ((await client.search({ uid: `${lastUid + 1}:*` }, { uid: true })) || []).filter(uid => uid > lastUid) : [];
      mailboxes.push({
        specialUse: box.specialUse ?? null,
        uidValidity: String(opened.uidValidity),
        uidNext: opened.uidNext,
        exists: opened.exists,
        sinceDays: SINCE_DAYS,
        matched: uids.length,
        lastUid,
        newerThanLastUid: newer.length,
        seenUnchanged: seenBefore === seenAfter,
        platforms,
        alerts,
      });
    }
  } catch (error) {
    await client.logout().catch(() => {});
    return fail(classifyImapError(error));
  }
  await client.logout();
  // 편지함 이름은 사용자가 만든 폴더명일 수 있어 출력하지 않는다.
  console.log(JSON.stringify({ ok: true, mailboxes }, null, 2));
}

function fail(code: ImapFailure) {
  console.log(JSON.stringify({ ok: false, code }));
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
