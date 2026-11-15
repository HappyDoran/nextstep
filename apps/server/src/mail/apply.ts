import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { postingKey, type MailVerdict } from './classify.js';

// 메일 근거를 지원 건에 반영한다. 기획서 5절 원칙:
// - 공고 식별자로만 자동 연결하고, 회사명만 같거나 후보가 하나뿐이라는 이유로 확정하지 않는다.
// - 오래된 접수·진행은 더 나중 상태를 되돌리지 않는다. 최종 결과 충돌은 현재 값을 두고 확인받는다.
// - 열람은 개인 상태와 별도 속성이다. 공고 마감은 개인 상태를 바꾸지 않는다.
const RANK: Record<string, number> = { 미지원: 0, '지원 완료': 1, '전형 진행중': 2, 합격: 3, 불합격: 3 };
const now = () => new Date().toISOString();

export type StoredMessage = { id: string; userId: string; messageKey: string; verdict: MailVerdict; subject: string; receivedAt: string | null };
export type Outcome = 'applied' | 'created' | 'no_change' | 'review' | 'suppressed' | 'unlinked';

type AppRow = { id: string; status: string; read_status: string; posting_url: string | null; locked_fields?: string };

function logEvent(db: DatabaseSync, appId: string, field: 'status' | 'readStatus', from: string, to: string, messageId: string) {
  db.prepare("INSERT INTO application_events (id, application_id, field, from_value, to_value, source, at, message_id) VALUES (?, ?, ?, ?, ?, 'mail', ?, ?)")
    .run(randomUUID(), appId, field, from, to, now(), messageId);
}

function review(db: DatabaseSync, msg: StoredMessage, reason: '연결 불명' | '모호' | '최종 결과 충돌', hint: { company?: string | null; roleTitle?: string | null } = {}): Outcome {
  // 같은 근거는 다시 요청하지 않는다(메시지당 하나).
  db.prepare("INSERT OR IGNORE INTO review_requests (id, user_id, message_id, reason, status, created_at, company, role_title) VALUES (?, ?, ?, ?, '대기', ?, ?, ?)")
    .run(randomUUID(), msg.userId, msg.id, reason, now(), hint.company?.slice(0, 200) ?? null, hint.roleTitle?.slice(0, 200) ?? null);
  return 'review';
}

// 연결 대상이 정해진 뒤 상태를 반영한다. 확인 목록에서 사용자가 연결할 때도 이 함수를 쓴다.
export function applyToApplication(db: DatabaseSync, msg: StoredMessage, app: AppRow, options: { force?: boolean } = {}): Outcome {
  const status = msg.verdict.status;
  db.prepare('UPDATE mail_messages SET application_id = ? WHERE id = ?').run(app.id, msg.id);
  // 사용자가 잠근 필드는 메일로 바꾸지 않는다. 확인 목록에서 사용자가 직접 확정한 경우(force)만 반영한다.
  const locked = JSON.parse(app.locked_fields ?? '[]') as string[];
  if (status === '열람') {
    if (!options.force && locked.includes('readStatus')) return 'no_change';
    if (app.read_status === '열람') return 'no_change';
    db.prepare("UPDATE applications SET read_status = '열람', updated_at = ? WHERE id = ?").run(now(), app.id);
    logEvent(db, app.id, 'readStatus', app.read_status, '열람', msg.id);
    return 'applied';
  }
  if (status === '모호') return review(db, msg, '모호');
  // 모호한 결과는 잠금과 상관없이 확인받는다. 확정된 결과만 잠금을 지킨다.
  if (!options.force && locked.includes('status')) return 'no_change';
  // 사용자가 확인 목록에서 확정하면 순서 규칙 대신 사용자 선택을 따른다.
  if (options.force) {
    if (app.status === status) return 'no_change';
    db.prepare('UPDATE applications SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), app.id);
    logEvent(db, app.id, 'status', app.status, status, msg.id);
    return 'applied';
  }
  const current = RANK[app.status] ?? 0;
  const next = RANK[status]!;
  if (current === 3 && next === 3 && app.status !== status) return review(db, msg, '최종 결과 충돌');
  if (next <= current) return 'no_change';
  db.prepare('UPDATE applications SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), app.id);
  logEvent(db, app.id, 'status', app.status, status, msg.id);
  return 'applied';
}

export function applyMessage(db: DatabaseSync, msg: StoredMessage): Outcome {
  if (db.prepare('SELECT 1 FROM evidence_suppressions WHERE user_id = ? AND message_key = ?').get(msg.userId, msg.messageKey)) return 'suppressed';
  const keys = new Set(msg.verdict.postingKeys);
  const apps = db.prepare('SELECT id, status, read_status, posting_url, locked_fields FROM applications WHERE user_id = ?').all(msg.userId) as AppRow[];
  const matches = keys.size ? apps.filter(a => a.posting_url && keys.has(postingKey(a.posting_url) ?? '')) : [];
  if (matches.length === 1) return applyToApplication(db, msg, matches[0]!);
  if (matches.length > 1) return review(db, msg, '연결 불명');
  // 지원 건은 없지만 공고 식별자가 수집한 공고와 일치하면 회사·직무가 명확하므로 지원 건을 만든다. 지원일은 만들지 않는다.
  if (keys.size === 1 && msg.verdict.status !== '모호' && msg.verdict.status !== '열람') {
    const [source, id] = [...keys][0]!.split(':');
    const posting = db.prepare('SELECT url, title, company FROM postings WHERE source = ? AND source_id = ? AND owner_user_id = ? LIMIT 1').get(source!, id!, msg.userId) as { url: string; title: string; company: string } | undefined;
    if (posting) {
      const appId = randomUUID();
      const at = now();
      db.prepare("INSERT INTO applications (id, user_id, company, role_title, posting_url, status, created_at, updated_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mail')")
        .run(appId, msg.userId, posting.company.slice(0, 200), posting.title.slice(0, 200), posting.url, msg.verdict.status, at, at);
      logEvent(db, appId, 'status', '미지원', msg.verdict.status, msg.id);
      db.prepare('UPDATE mail_messages SET application_id = ? WHERE id = ?').run(appId, msg.id);
      return 'created';
    }
  }
  // 대상을 식별할 수 없는 메일은 확인 요청을 바로 만들지 않고 보관한다. 회사·직무 해석(AI) 단계가
  // 지원 건 생성 또는 확인 요청으로 넘긴다. 최초 조회에서 수백 건의 확인 요청이 쌓이는 것을 막는다.
  return 'unlinked';
}

// 회사·직무 표기 차이(주식회사·㈜·공백·대소문자)만 지운다. 비슷한 이름을 같다고 보지 않는다.
export const normalizeName = (value: string) => value.replace(/\(주\)|㈜|주식회사|\s+/g, '').toLowerCase();

// AI 해석 결과로 대상 찾기·지원 건 생성·확인 요청을 정한다.
// 회사와 직무가 모두 같은 지원 건이 정확히 하나일 때만 연결하고, 회사만 같거나 확신이 낮으면 확인받는다.
export function applyInterpretation(db: DatabaseSync, msg: StoredMessage, interp: { isRecruiting: boolean; company: string | null; roleTitle: string | null; status: string; confidence: string }): Outcome | 'ignored' {
  if (!interp.isRecruiting) return 'ignored';
  if (db.prepare('SELECT 1 FROM evidence_suppressions WHERE user_id = ? AND message_key = ?').get(msg.userId, msg.messageKey)) return 'suppressed';
  const status = interp.status as MailVerdict['status'];
  const verdictMsg: StoredMessage = { ...msg, verdict: { ...msg.verdict, status } };
  // 작은 모델이 플랫폼 이름(원티드랩·jumpit.co.kr 등, 2026-11-15 실제 해석)을 회사로 쓰거나 지시문을 섞어 내는 경우가 있어(2026-11-14 실제 해석) 그런 회사명은 확정하지 않는다.
  const badCompany = !interp.company || /^(원티드(랩)?|잡코리아|사람인|점핏|자소설닷컴|(www\.)?(wanted|jobkorea|saramin|jumpit|jasoseol)(lab)?(\.co\.kr|\.com)?)$/i.test(normalizeName(interp.company)) || /[:\n]/.test(interp.company) || interp.company.length > 60;
  const appsOf = (name: string) => (db.prepare('SELECT id, company, role_title, status, read_status, posting_url, locked_fields FROM applications WHERE user_id = ?').all(msg.userId) as (AppRow & { company: string; role_title: string })[])
    .filter(a => normalizeName(a.company) === normalizeName(name));
  if (status === '열람') {
    // 열람은 지원 상태가 아닌 별도 표시라, 직무명이 없거나 확신이 낮아도 같은 회사 지원 건이 하나뿐이면 붙인다(사용자 결정 2026-11-15).
    // 같은 회사 지원 건이 여럿이면 직무명이 정확히 같은 건에만 붙이고, 아니면 바꾸지 않는다(열람만으로 확인 요청을 만들지 않음).
    const same = badCompany ? [] : appsOf(interp.company!);
    const byRole = interp.roleTitle ? same.filter(a => normalizeName(a.role_title) === normalizeName(interp.roleTitle!)) : [];
    const target = same.length === 1 ? same[0] : byRole.length === 1 ? byRole[0] : undefined;
    return target ? applyToApplication(db, verdictMsg, target) : 'no_change';
  }
  const hint = { company: badCompany ? null : interp.company, roleTitle: interp.roleTitle };
  if (interp.confidence !== 'high' || badCompany || !interp.roleTitle || status === '모호') {
    return review(db, verdictMsg, status === '모호' ? '모호' : '연결 불명', hint);
  }
  const role = normalizeName(interp.roleTitle);
  const apps = appsOf(interp.company!);
  const exact = apps.filter(a => normalizeName(a.role_title) === role);
  if (exact.length === 1) return applyToApplication(db, verdictMsg, exact[0]!);
  // 같은 회사 지원 건이 하나뿐이고 직무명이 한쪽에 포함되면(예: '프론트엔드 개발자' ⊂ '프론트엔드 개발자 (React)') 같은 지원으로 본다.
  // 회사만 같은 것으로 확정하지 않는다는 원칙은 지킨다: 직무명이 포함 관계가 아니거나 후보가 여럿이면 확인받는다(사용자 결정 2026-11-14).
  const contained = exact.length === 0 && apps.length === 1 && Math.min(role.length, normalizeName(apps[0]!.role_title).length) >= 2
    && (normalizeName(apps[0]!.role_title).includes(role) || role.includes(normalizeName(apps[0]!.role_title)));
  if (contained) return applyToApplication(db, verdictMsg, apps[0]!);
  if (exact.length > 1 || apps.length > 0) return review(db, verdictMsg, '연결 불명', hint);
  // 결과만 있어도 회사·직무·결과가 명확하면 지원 건을 만든다. 실제 지원일은 만들지 않는다.
  const appId = randomUUID();
  const at = now();
  db.prepare("INSERT INTO applications (id, user_id, company, role_title, status, created_at, updated_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?, 'mail')")
    .run(appId, msg.userId, interp.company!.slice(0, 200), interp.roleTitle.slice(0, 200), status, at, at);
  logEvent(db, appId, 'status', '미지원', status, msg.id);
  db.prepare('UPDATE mail_messages SET application_id = ? WHERE id = ?').run(appId, msg.id);
  return 'created';
}
