// 점핏 공개 API 소량 수집 검증. 개발 직무별 목록 1회·상세 3건, 원문은 저장·출력하지 않고 추출 결과와 본문 길이만 출력한다.
// 실행: pnpm --filter @nextstep/server verify:jumpit
import { pathToFileURL } from 'node:url';
import type { Profile } from '@nextstep/contracts';
import { collectJumpit } from '../sources/jumpit.js';
import { DEV_FAMILIES } from '../sources/types.js';

async function main() {
  const profile: Profile = { jobFamilies: DEV_FAMILIES, experiences: [], regions: [], remoteOk: false, employmentTypes: [], careerMax: null, skills: [], summary: '', salaryMin: null, excludeCompanies: [], favoriteCompanies: [], preferredSkills: [], avoidSkills: [], companyTypes: [] };
  const report: Record<string, unknown> = {};
  for (const family of DEV_FAMILIES) {
    const { postings, failures } = await collectJumpit(family, 3, profile);
    report[family] = { failures, postings: postings.map(({ body, ...facts }) => ({ ...facts, body: body ? { chars: body.length } : { failure: facts.bodyFailure } })) };
  }
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
