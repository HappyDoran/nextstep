// P1-01 잡코리아 공개 공고 소량 수집 검증. 원문을 저장하지 않고 추출 가능 여부·실패 구분만 출력한다.
// 원티드·자소설닷컴은 약관상 자동 수집에 사전 허락이 필요해 검증 대상에서 제외했다(gap-analysis 미결 결정).
// 실행: pnpm --filter @nextstep/server verify:jobkorea
import { pathToFileURL } from 'node:url';
import { htmlText, politeGet } from '../sources/http.js';
import { ORIGIN, PER_ROLE, ROLES, listPostingIds, parsePosting } from '../sources/jobkorea.js';

async function main() {
  const report: Record<string, unknown> = {};
  for (const [role, keyword] of Object.entries(ROLES)) {
    const list = await politeGet(`${ORIGIN}/Search/?stext=${encodeURIComponent(keyword)}&tabType=recruit`);
    if ('code' in list) { report[role] = { list: list }; continue; }
    const ids = listPostingIds(list.text);
    const postings = [];
    for (const id of ids.slice(0, PER_ROLE)) {
      const page = await politeGet(`${ORIGIN}/Recruit/GI_Read/${id}`);
      if ('code' in page) { postings.push({ id, failure: page.code }); continue; }
      const parsed = parsePosting(id, page.text);
      if ('code' in parsed) { postings.push({ id, failure: parsed.code }); continue; }
      const body = await politeGet(`${ORIGIN}/Recruit/GI_Read_Comt_Ifrm?Gno=${id}`, { referer: parsed.url });
      const text = 'text' in body ? htmlText(body.text) : body;
      // 원문 본문은 출력하지 않고 길이만 남긴다.
      postings.push({ ...parsed, body: 'text' in text ? { chars: text.text.length } : { failure: text.code } });
    }
    report[role] = { keyword, listed: ids.length, postings };
  }
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
