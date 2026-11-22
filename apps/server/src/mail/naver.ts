import { text } from 'node:stream/consumers';
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
// 과거 범위 넓히기: [since, before) 기간을 최근 것부터 편지함별로 나눠 가져온다. belowUid는 지난 실행에서 처리한 가장 작은 UID.
export type BackfillProgress = Map<string, { uidValidity: string; belowUid: number }>;
export type BackfillBatch = MailboxBatch & { lowestUid: number | null };
export type BackfillSource = (account: string, password: string, progress: BackfillProgress, since: Date, before: Date) => Promise<BackfillBatch[]>;
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

type Client = InstanceType<typeof ImapFlow>;

// 스트림 디코더가 조각 경계에 걸친 한글을 이어 붙여 읽는다.
export const streamText = (content: AsyncIterable<Buffer | string>) => text(content);

async function openClient(account: string, password: string) {
  const client = new ImapFlow({ host: 'imap.naver.com', port: 993, secure: true, auth: { user: account, pass: password }, logger: false });
  client.on('error', () => {});
  try { await client.connect(); } catch (error) { throw new MailSourceError(classifyImapError(error)); }
  return client;
}

// 조회 대상 편지함(보낸·임시·휴지통·스팸 제외)을 읽기 전용으로 열며 하나씩 처리한다.
async function eachMailbox<T>(client: Client, fn: (path: string, uidValidity: string, exists: number) => Promise<T>) {
  const out: T[] = [];
  try {
    for (const box of await client.list()) {
      if (box.flags.has('\\Noselect') || (box.specialUse && EXCLUDED.has(box.specialUse))) continue;
      // 편지함 하나를 열거나 읽지 못해도 연결이 살아 있으면 그 편지함만 건너뛴다(다른 편지함의 새 메일은 반영).
      try {
        const opened = await client.mailboxOpen(box.path, { readOnly: true });
        out.push(await fn(box.path, String(opened.uidValidity), opened.exists));
      } catch (error) { if (!client.usable) throw error; }
    }
  } catch (error) {
    await client.logout().catch(() => {});
    throw new MailSourceError(error instanceof MailSourceError ? error.code : classifyImapError(error));
  }
  await client.logout();
  return out;
}

async function fetchMessages(client: Client, path: string, uidValidity: string, uids: number[]) {
  const messages: FetchedMail[] = [];
  const metas = [];
  if (uids.length) for await (const msg of client.fetch(uids, { uid: true, envelope: true, bodyStructure: true, internalDate: true }, { uid: true })) metas.push(msg);
  for (const msg of metas) {
    const part = textPart(msg.bodyStructure as Part);
    let raw = '';
    if (part) {
      const { content } = await client.download(String(msg.uid), part.part, { uid: true });
      if (content) raw = await streamText(content);
    }
    const { text, links } = mailText(raw, part?.html ?? false);
    const env = msg.envelope;
    messages.push({
      uid: msg.uid,
      messageKey: env?.messageId || `${path}:${uidValidity}:${msg.uid}`,
      receivedAt: msg.internalDate instanceof Date ? msg.internalDate.toISOString() : null,
      fromAddress: env?.from?.[0]?.address ?? '',
      subject: env?.subject ?? '',
      text: text.slice(0, 50_000),
      links: links.slice(0, 200),
    });
  }
  return messages;
}

// 네이버 IMAP 읽기 전용 조회(EXAMINE, BODY.PEEK). 메일을 읽음 처리·이동·삭제하지 않는다.
export const naverSource: MailSource = async (account, password, cursors, since) => {
  const client = await openClient(account, password);
  return eachMailbox(client, async (path, uidValidity, exists) => {
    const cursor = cursors.get(path);
    // 위치가 유효하면 그 다음 UID부터, UIDVALIDITY가 바뀌었거나 처음이면 조회 시작일부터 다시 본다(중복은 메시지 키로 막는다).
    const resume = cursor && cursor.uidValidity === uidValidity;
    let uids: number[] = [];
    if (exists) {
      const found = resume ? await client.search({ uid: `${cursor.lastUid + 1}:*` }, { uid: true }) : await client.search({ since }, { uid: true });
      uids = (found || []).filter(uid => !resume || uid > cursor.lastUid).sort((a, b) => a - b);
    }
    let oldestDate: string | null = null;
    if (!resume && exists) {
      const first = await client.fetchOne('1', { internalDate: true });
      const d = first && first.internalDate;
      oldestDate = d instanceof Date ? d.toISOString() : null;
    }
    const messages = await fetchMessages(client, path, uidValidity, uids.slice(0, PER_MAILBOX));
    return { mailbox: path, uidValidity, messages, oldestDate, complete: uids.length <= PER_MAILBOX };
  });
};

// 과거 범위: 최근 것부터 편지함별 300건씩. 진행 위치(belowUid)보다 작은 UID만 본다. UIDVALIDITY가 바뀌면 그 편지함은 처음부터 다시 본다.
export const naverBackfill: BackfillSource = async (account, password, progress, since, before) => {
  const client = await openClient(account, password);
  return eachMailbox(client, async (path, uidValidity, exists) => {
    const p = progress.get(path);
    const below = p && p.uidValidity === uidValidity ? p.belowUid : Infinity;
    const found = exists ? (await client.search({ since, before }, { uid: true })) || [] : [];
    const uids = found.filter(uid => uid < below).sort((a, b) => b - a);
    const take = uids.slice(0, PER_MAILBOX);
    const messages = await fetchMessages(client, path, uidValidity, take);
    return { mailbox: path, uidValidity, messages, oldestDate: null, complete: uids.length <= PER_MAILBOX, lowestUid: take.length ? Math.min(...take) : null };
  });
};

export type BodyRef = { mailbox: string; uidValidity: string; uid: number };
export type MailBody = { text: string; links: string[]; fromAddress: string };
export type MailBodySource = (account: string, password: string, refs: BodyRef[]) => Promise<Map<string, MailBody>>;
export const bodyKey = (r: { mailbox: string; uid: number }) => `${r.mailbox}:${r.uid}`;

// 보관한 메일을 해석할 때 본문을 다시 읽는다(읽기 전용). UIDVALIDITY가 바뀐 편지함은 건너뛴다.
export const naverBodies: MailBodySource = async (account, password, refs) => {
  const out = new Map<string, MailBody>();
  if (!refs.length) return out;
  const client = await openClient(account, password);
  try {
    const byBox = new Map<string, BodyRef[]>();
    for (const r of refs) byBox.set(r.mailbox, [...(byBox.get(r.mailbox) ?? []), r]);
    for (const [mailbox, list] of byBox) {
      const opened = await client.mailboxOpen(mailbox, { readOnly: true }).catch(() => undefined);
      if (!opened) continue;
      const uids = list.filter(r => r.uidValidity === String(opened.uidValidity)).map(r => r.uid);
      if (!uids.length) continue;
      const metas = [];
      for await (const msg of client.fetch(uids, { uid: true, envelope: true, bodyStructure: true }, { uid: true })) metas.push(msg);
      for (const msg of metas) {
        const part = textPart(msg.bodyStructure as Part);
        let raw = '';
        if (part) {
          const { content } = await client.download(String(msg.uid), part.part, { uid: true });
          if (content) raw = await streamText(content);
        }
        out.set(bodyKey({ mailbox, uid: msg.uid }), { ...mailText(raw, part?.html ?? false), fromAddress: msg.envelope?.from?.[0]?.address ?? '' });
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
};
