import type { JobFamily, SourceId } from '@nextstep/contracts';

export type Career = { type: 'NEWBIE' | 'EXPERIENCED' | 'ANY'; fromYears: number | null; toYears: number | null };
// 출처별 해석 결과를 같은 구조로 맞춘다. body는 판정용으로만 잠시 쓰고 저장하지 않는다.
export type CollectedPosting = {
  source: SourceId;
  sourceId: string;
  url: string;
  title: string;
  company: string;
  deadline: string | null;
  alwaysHire: boolean;
  location: string | null;
  remote: boolean | null;
  careers: Career[];
  companyType: string | null;
  employeeCount: number | null;
  externalApplyUrl: string | null;
  body: string | null;
  bodyFailure: string | null;
};
export type CollectFailure = { source: SourceId; id?: string; code: string };
export const FAMILY_KEYS: Record<JobFamily, 'frontend' | 'app' | 'design' | 'planning'> = { 프론트엔드: 'frontend', '앱 개발': 'app', 디자인: 'design', 기획: 'planning' };
