import { ImapFlow } from 'imapflow';

export type ImapFailure = 'missing_credentials' | 'auth_failed' | 'network' | 'tls' | 'protocol';

export function classifyImapError(error: unknown): ImapFailure {
  const e = error as { authenticationFailed?: boolean; code?: string; message?: string };
  if (e.authenticationFailed) return 'auth_failed';
  if (e.code && ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ETIMEOUT', 'NoConnection'].includes(e.code)) return 'network';
  if (e.code?.startsWith('ERR_TLS') || e.code === 'CERT_HAS_EXPIRED' || /certificate|tls/i.test(e.message ?? '')) return 'tls';
  return 'protocol';
}

export type FetchedMail = { uid: number; messageKey: string; receivedAt: string | null; fromAddress: string; subject: string; text: string; links: string[] };
export type MailboxBatch = { mailbox: string; uidValidity: string; messages: FetchedMail[]; oldestDate: string | null; complete: boolean };
export type Cursor = { uidValidity: string; lastUid: number };
export type MailSource = (account: string, password: string, cursors: Map<string, Cursor>, since: Date) => Promise<MailboxBatch[]>;
export class MailSourceError extends Error { constructor(readonly code: string) { super(code); } }

const EXCLUDED = new Set(['\\Sent', '\\Drafts', '\\Trash', '\\Junk']);
// 실행당 편지함별 처리 상한. 남은 메일은 다음 실행에서 이어서 가져온다.
const PER_MAILBOX = 300;

type Part = { part?: string; type?: string; childNodes?: Part[]; disposition?: string };
function textPart(node: Part | undefined): { part: string; html: boolean } | undefined {
  if (!node) return undefined;
  if (node.childNodes) {
    const parts = node.childNodes.map(textPart).filter(Boolean) as { part: string; html: boolean }[];
    return parts.find(p => p.html) ?? parts[0];
  }
  if (node.disposition === 'attachment') return undefined;
  if (node.type === 'text/html') return { part: node.part ?? '1', html: true };
  if (node.type === 'text/plain') return { part: node.part ?? '1', html: false };
  return undefined;
}

export function mailText(raw: string, html: boolean) {
  const links = [...raw.matchAll(/href\s*=\s*["']([^"']+)["']|https?:\/\/[^\s<>"')\]]+/gi)].map(m => (m[1] ?? m[0]).replace(/&amp;/g, '&'));
  const text = html
    ? raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    : raw;
  return { text: text.replace(/\s+/g, ' ').trim(), links };
}

// 네이버 IMAP 읽기 전용 조회(EXAMINE, BODY.PEEK). 메일을 읽음 처리·이동·삭제하지 않는다.
export const naverSource: MailSource = async (account, password, cursors, since) => {
  const client = new ImapFlow({ host: 'imap.naver.com', port: 993, secure: true, auth: { user: account, pass: password }, logger: false });
  client.on('error', () => {});
  try { await client.connect(); } catch (error) { throw new MailSourceError(classifyImapError(error)); }
  const batches: MailboxBatch[] = [];
  try {
    for (const box of await client.list()) {
      if (box.flags.has('\\Noselect') || (box.specialUse && EXCLUDED.has(box.specialUse))) continue;
      const opened = await client.mailboxOpen(box.path, { readOnly: true });
      const uidValidity = String(opened.uidValidity);
      const cursor = cursors.get(box.path);
      // 위치가 유효하면 그 다음 UID부터, UIDVALIDITY가 바뀌었거나 처음이면 조회 시작일부터 다시 본다(중복은 메시지 키로 막는다).
      const resume = cursor && cursor.uidValidity === uidValidity;
      let uids: number[] = [];
      if (opened.exists) {
        const found = resume ? await client.search({ uid: `${cursor.lastUid + 1}:*` }, { uid: true }) : await client.search({ since }, { uid: true });
        uids = (found || []).filter(uid => !resume || uid > cursor.lastUid).sort((a, b) => a - b);
      }
      let oldestDate: string | null = null;
      if (!resume && opened.exists) {
        const first = await client.fetchOne('1', { internalDate: true });
        const d = first && first.internalDate;
        oldestDate = d instanceof Date ? d.toISOString() : null;
      }
      const take = uids.slice(0, PER_MAILBOX);
      const messages: FetchedMail[] = [];
      const metas = [];
      if (take.length) for await (const msg of client.fetch(take, { uid: true, envelope: true, bodyStructure: true, internalDate: true }, { uid: true })) metas.push(msg);
      for (const msg of metas) {
        const part = textPart(msg.bodyStructure as Part);
        let raw = '';
        if (part) {
          const { content } = await client.download(String(msg.uid), part.part, { uid: true });
          if (content) for await (const chunk of content) raw += chunk.toString('utf8');
        }
        const { text, links } = mailText(raw, part?.html ?? false);
        const env = msg.envelope;
        messages.push({
          uid: msg.uid,
          messageKey: env?.messageId || `${box.path}:${uidValidity}:${msg.uid}`,
          receivedAt: msg.internalDate instanceof Date ? msg.internalDate.toISOString() : null,
          fromAddress: env?.from?.[0]?.address ?? '',
          subject: env?.subject ?? '',
          text: text.slice(0, 50_000),
          links: links.slice(0, 200),
        });
      }
      batches.push({ mailbox: box.path, uidValidity, messages, oldestDate, complete: uids.length <= PER_MAILBOX });
    }
  } catch (error) {
    await client.logout().catch(() => {});
    throw new MailSourceError(error instanceof MailSourceError ? error.code : classifyImapError(error));
  }
  await client.logout();
  return batches;
};
