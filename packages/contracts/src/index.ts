import { z } from 'zod';
export const applicationStatusSchema = z.enum(['미지원', '지원 완료', '전형 진행중', '합격', '불합격']);
export const postingStatusSchema = z.enum(['모집중', '마감', '미확인']);
export const readStatusSchema = z.enum(['열람', '미열람', '정보 없음']);
export const healthSchema = z.object({ service: z.literal('nextstep'), status: z.literal('ok'), database: z.literal('ready'), schemaVersion: z.number().int().positive() });
export type Health = z.infer<typeof healthSchema>;
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

// 수집 모드: personal은 운영자 본인만 쓰는 개인 도구, service는 초대 사용자에게 제공하는 서비스다.
// 출처 접근은 auto(자동 탐색·수집) 또는 link_only(사용자가 넣은 공고 링크 한 건만 판정)다.
export const collectionModeSchema = z.enum(['personal', 'service']);
export const sourceIdSchema = z.enum(['jobkorea', 'wanted', 'jasoseol']);
export const sourceAccessSchema = z.enum(['auto', 'link_only']);
export type CollectionMode = z.infer<typeof collectionModeSchema>;
export type SourceId = z.infer<typeof sourceIdSchema>;
export type SourceAccess = z.infer<typeof sourceAccessSchema>;
export const SOURCE_POLICY: Readonly<Record<CollectionMode, Readonly<Record<SourceId, SourceAccess>>>> = {
  personal: { jobkorea: 'auto', wanted: 'auto', jasoseol: 'auto' },
  service: { jobkorea: 'auto', wanted: 'link_only', jasoseol: 'link_only' },
};
export const collectionSettingsSchema = z.object({
  mode: collectionModeSchema,
  sources: z.object({ jobkorea: sourceAccessSchema, wanted: sourceAccessSchema, jasoseol: sourceAccessSchema }),
});
export const collectionModeUpdateSchema = z.object({ mode: collectionModeSchema }).strict();
export type CollectionSettings = z.infer<typeof collectionSettingsSchema>;

// 초대 계정 인증: 초대 코드로 가입하고 이메일·비밀번호로 로그인한다.
export const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(10).max(200),
}).strict();
export const signupSchema = credentialsSchema.extend({ inviteCode: z.string().trim().min(8).max(64) }).strict();
export const meSchema = z.object({ id: z.string(), email: z.string() });
export type Me = z.infer<typeof meSchema>;

// 지원 건: 사용자 소유 자료. URL은 식별자가 아니며 없을 수 있다.
export const applicationCreateSchema = z.object({
  company: z.string().trim().min(1).max(200),
  roleTitle: z.string().trim().min(1).max(200),
  postingUrl: z.url({ protocol: /^https$/ }).max(2000).optional(),
  status: applicationStatusSchema.default('미지원'),
}).strict();
export const applicationSchema = z.object({
  id: z.string(),
  company: z.string(),
  roleTitle: z.string(),
  postingUrl: z.string().nullable(),
  status: applicationStatusSchema,
  readStatus: readStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
// 직접 수정: 보낸 필드만 바꾼다. postingUrl은 null로 지울 수 있다.
export const applicationUpdateSchema = z.object({
  company: z.string().trim().min(1).max(200).optional(),
  roleTitle: z.string().trim().min(1).max(200).optional(),
  postingUrl: z.url({ protocol: /^https$/ }).max(2000).nullable().optional(),
  status: applicationStatusSchema.optional(),
  readStatus: readStatusSchema.optional(),
}).strict().refine(value => Object.keys(value).length > 0);
export const applicationEventSchema = z.object({
  field: z.enum(['status', 'readStatus']),
  from: z.string().nullable(),
  to: z.string(),
  source: z.enum(['manual']),
  at: z.string(),
});
export const applicationDetailSchema = applicationSchema.extend({ events: z.array(applicationEventSchema) });
export type ApplicationEvent = z.infer<typeof applicationEventSchema>;
export type ApplicationDetail = z.infer<typeof applicationDetailSchema>;
export const automationSchema = z.object({ enabled: z.boolean() }).strict();
export type Application = z.infer<typeof applicationSchema>;

// 이력서: 사용자당 활성 문서 한 개. 추출 실패 사유는 사용자에게 재등록 경로와 함께 보여 준다.
export const resumeFailureSchema = z.enum(['unsupported_type', 'too_large', 'encrypted', 'damaged', 'scanned_or_empty', 'timeout']);
export const resumeSchema = z.object({ id: z.string(), filename: z.string(), size: z.number().int(), createdAt: z.string(), text: z.string() });
export type Resume = z.infer<typeof resumeSchema>;

// 프로필·필터: 사용자가 확인한 사실만 저장한다. 직무는 1차 네 직무, 복수 선택은 OR.
export const jobFamilySchema = z.enum(['프론트엔드', '앱 개발', '디자인', '기획']);
export type JobFamily = z.infer<typeof jobFamilySchema>;
export const profileSchema = z.object({
  jobFamilies: z.array(jobFamilySchema).min(1).max(4),
  experiences: z.array(z.object({ jobFamily: jobFamilySchema, years: z.number().min(0).max(50) })).max(4),
  regions: z.array(z.string().trim().min(1).max(40)).max(10),
  remoteOk: z.boolean(),
  employmentTypes: z.array(z.enum(['정규직', '계약직', '인턴', '프리랜서'])).max(4),
  skills: z.array(z.string().trim().min(1).max(60)).max(60),
  summary: z.string().trim().max(2000),
}).strict();
export type Profile = z.infer<typeof profileSchema>;

// 작업: 화면 요청과 분리해 처리하고 상태를 조회한다.
export const jobStatusSchema = z.enum(['대기', '실행중', '성공', '일부 실패', '실패']);
export const jobSchema = z.object({
  id: z.string(),
  kind: z.enum(['refresh', 'link']),
  status: jobStatusSchema,
  errorCode: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type Job = z.infer<typeof jobSchema>;
export const linkRequestSchema = z.object({ url: z.url({ protocol: /^https$/ }).max(2000) }).strict();

// 추천: 공고 사실과 판정 근거. 기업 유형·규모는 출처 명시값만, 없으면 null(미확인).
export const recommendationClassSchema = z.enum(['기본', '도전', '미확인', '제외']);
export const recommendationSchema = z.object({
  postingId: z.string(),
  source: sourceIdSchema,
  linkOnly: z.boolean(),
  url: z.string(),
  externalApplyUrl: z.string().nullable(),
  title: z.string(),
  company: z.string(),
  deadline: z.string().nullable(),
  alwaysHire: z.boolean(),
  postingStatus: postingStatusSchema,
  companyType: z.string().nullable(),
  employeeCount: z.number().nullable(),
  checkedAt: z.string(),
  classification: recommendationClassSchema,
  met: z.array(z.string()),
  unmet: z.array(z.string()),
  unknown: z.array(z.string()),
  reason: z.string(),
  hidden: z.boolean(),
  evaluatedAt: z.string(),
});
export type Recommendation = z.infer<typeof recommendationSchema>;
export const recommendationListSchema = z.object({ items: z.array(recommendationSchema), lastJob: jobSchema.nullable() });
