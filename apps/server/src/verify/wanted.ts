// P1-01 원티드 개인 모드 검증. 약관상 사전 허락 없는 자동 수집이 금지된 출처라 개인 모드에서만 실행한다.
// 목록은 웹 화면이 쓰는 공개 JSON, 상세는 공개 페이지의 __NEXT_DATA__에서 읽는다. 로그인·차단 우회는 하지 않는다.
// 실행: pnpm --filter @nextstep/server verify:wanted
import { pathToFileURL } from 'node:url';
import { politeGet } from '../sources/http.js';
import { ORIGIN, PER_ROLE, ROLES, listIds, parseDetail } from '../sources/wanted.js';
import { requireAutoCollect } from './mode.js';

async function main() {
  if (!requireAutoCollect('wanted')) return;
  const report: Record<string, unknown> = {};
  // 차단 응답을 받으면 이 출처 요청을 모두 멈춘다.
  let blocked = false;
  for (const [role, tags] of Object.entries(ROLES)) {
    if (blocked) break;
    const query = new URLSearchParams({ country: 'kr', locations: 'all', years: '-1', limit: String(PER_ROLE), job_sort: 'job.latest_order' });
    for (const tag of tags) query.append('tag_type_ids', String(tag));
    const list = await politeGet(`${ORIGIN}/api/v4/jobs?${query}`, { accept: 'application/json' });
    if ('code' in list) { report[role] = { list }; blocked = list.code === 'blocked'; continue; }
    const postings = [];
    for (const id of listIds(list.text)) {
      const page = await politeGet(`${ORIGIN}/wd/${id}`);
      if ('code' in page) { postings.push({ id, failure: page.code }); blocked = page.code === 'blocked'; if (blocked) break; continue; }
      const parsed = parseDetail(id, page.text);
      // 원문은 출력하지 않고 길이만 남긴다.
      postings.push('code' in parsed ? { id, failure: parsed.code } : { ...parsed, body: Object.fromEntries(Object.entries(parsed.body).map(([k, v]) => [k, v.length])) });
    }
    report[role] = { tags, postings };
  }
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
