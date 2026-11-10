// P1-01·P1-04 자소설닷컴 개인 모드 검증. 약관상 허가 없는 자동 수집이 금지된 출처라 개인 모드에서만 실행한다.
// 목록은 웹 화면이 쓰는 공개 직무별 목록, 상세는 공개 페이지의 __NEXT_DATA__에서 읽는다. 원문은 출력하지 않는다.
// 실행: pnpm --filter @nextstep/server verify:jasoseol
import { pathToFileURL } from 'node:url';
import { collectJasoseol } from '../sources/jasoseol.js';

async function main() {
  const { postings, failures } = await collectJasoseol(['프론트엔드', '앱 개발', '디자인', '기획'], 2);
  console.log(JSON.stringify({
    failures,
    postings: postings.map(p => ({ id: p.sourceId, title: p.title, company: p.company, deadline: p.deadline, companyType: p.companyType, apply: p.externalApplyUrl ? new URL(p.externalApplyUrl).host : null, body: p.bodyFailure ?? `${p.body?.length ?? 0}자` })),
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
