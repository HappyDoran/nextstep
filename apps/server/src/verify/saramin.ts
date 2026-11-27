// P1-04 사람인 공개 페이지 소량 수집 검증. 네 직무 검색 목록 1회·상세 3건씩, 원문은 저장·출력하지 않고 추출 결과와 본문 길이만 출력한다.
// 실행: pnpm --filter @nextstep/server verify:saramin
import { pathToFileURL } from 'node:url';
import { jobFamilySchema, type Profile } from '@nextstep/contracts';
import { politeGet } from '../sources/http.js';
import { fetchSaramin, listPostingIds, saraminSearchUrl } from '../sources/saramin.js';

const PER_ROLE = 3;

async function main() {
  // 필터 없는 기본 검색으로 확인한다.
  const profile: Profile = { jobFamilies: jobFamilySchema.options, experiences: [], regions: [], remoteOk: false, employmentTypes: [], careerMax: null, skills: [], summary: '', salaryMin: null, excludeCompanies: [], favoriteCompanies: [], preferredSkills: [], avoidSkills: [], companyTypes: [] };
  const report: Record<string, unknown> = {};
  for (const family of jobFamilySchema.options) {
    const list = await politeGet(saraminSearchUrl(family, profile));
    if ('code' in list) { report[family] = { list }; continue; }
    const ids = listPostingIds(list.text);
    const postings = [];
    for (const id of ids.slice(0, PER_ROLE)) {
      const r = await fetchSaramin(id);
      if ('code' in r) { postings.push({ id, failure: r.code }); continue; }
      const { body, ...facts } = r;
      postings.push({ ...facts, body: body ? { chars: body.length } : { failure: r.bodyFailure } });
    }
    report[family] = { listed: ids.length, postings };
  }
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
