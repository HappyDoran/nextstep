import { z } from 'zod';
export const applicationStatusSchema = z.enum(['미지원', '지원 완료', '전형 진행중', '합격', '불합격']);
export const postingStatusSchema = z.enum(['모집중', '마감', '미확인']);
export const readStatusSchema = z.enum(['열람', '미열람', '정보 없음']);
export const healthSchema = z.object({ service: z.literal('nextstep'), status: z.literal('ok'), database: z.literal('ready'), schemaVersion: z.number().int().positive() });
export type Health = z.infer<typeof healthSchema>;
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

export const sourceIdSchema = z.enum(['saramin', 'jobkorea', 'jasoseol', 'wanted', 'jumpit']);
export type SourceId = z.infer<typeof sourceIdSchema>;

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
  source: z.enum(['manual', 'mail']),
  at: z.string(),
});
export const applicationDetailSchema = applicationSchema.extend({ events: z.array(applicationEventSchema) });
export type ApplicationEvent = z.infer<typeof applicationEventSchema>;
export type ApplicationDetail = z.infer<typeof applicationDetailSchema>;
export const automationSchema = z.object({ enabled: z.boolean() }).strict();
export type Application = z.infer<typeof applicationSchema>;

// 이력서: 사용자당 활성 문서 한 개. 추출 실패 사유는 사용자에게 재등록 경로와 함께 보여 준다.
export const resumeFailureSchema = z.enum(['unsupported_type', 'too_large', 'encrypted', 'damaged', 'scanned_or_empty', 'timeout']);
// 서류: 이력서(필수)·포트폴리오·경력기술서(선택). 모두 MD 텍스트로 바꿔 저장하고 사용자가 확인·수정한다.
export const documentKindSchema = z.enum(['resume', 'portfolio', 'career']);
export type DocumentKind = z.infer<typeof documentKindSchema>;
export const DOCUMENT_TEXT_MAX = 200_000;
export const resumeSchema = z.object({ id: z.string(), kind: documentKindSchema.default('resume'), filename: z.string(), size: z.number().int(), createdAt: z.string(), text: z.string(), emptyPages: z.array(z.number().int()).default([]), ocrPages: z.array(z.number().int()).default([]), edited: z.boolean().default(false) });
export type Resume = z.infer<typeof resumeSchema>;

// 프로필·필터: 사용자가 확인한 사실만 저장한다. 직무는 기획서 3절 여섯 직무, 복수 선택은 OR.
// 선호(지역·원격·고용 형태·요구 경력)는 사용자만 고른다. 빈 목록·null은 제한 없음(전국·전체)이다.
export const jobFamilySchema = z.enum(['프론트엔드', '앱 개발', '디자인', '기획', '백엔드', 'QA']);
export type JobFamily = z.infer<typeof jobFamilySchema>;
export const profileSchema = z.object({
  jobFamilies: z.array(jobFamilySchema).min(1).max(6),
  experiences: z.array(z.object({ jobFamily: jobFamilySchema, years: z.number().min(0).max(50) })).max(6),
  regions: z.array(z.string().trim().min(1).max(40)).max(10),
  remoteOk: z.boolean(),
  employmentTypes: z.array(z.enum(['정규직', '계약직', '인턴', '프리랜서'])).max(4),
  // 공고 요구 경력 상한(년). null이면 제한 없음. 이전 저장분 호환을 위해 기본값 null.
  careerMax: z.number().int().min(0).max(30).nullable().default(null),
  skills: z.array(z.string().trim().min(1).max(60)).max(60),
  summary: z.string().trim().max(2000),
}).strict();
export type Profile = z.infer<typeof profileSchema>;

// 작업: 화면 요청과 분리해 처리하고 상태를 조회한다.
export const jobStatusSchema = z.enum(['대기', '실행중', '성공', '일부 실패', '실패']);
export const jobSchema = z.object({
  id: z.string(),
  kind: z.enum(['refresh', 'link', 'mail']),
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

// 네이버 메일 연결: 애플리케이션 비밀번호는 서버에서 암호화 저장하고 다시 내보내지 않는다.
export const mailConnectRequestSchema = z.object({
  account: z.email().max(254),
  appPassword: z.string().min(1).max(100),
  consent: z.literal(true),
}).strict();
export const mailConnectionSchema = z.object({
  provider: z.literal('naver'),
  account: z.string(),
  status: z.enum(['정상', '인증 실패']),
  consentAt: z.string(),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
  rangeIncomplete: z.boolean(),
  lastJob: jobSchema.nullable(),
});
export type MailConnection = z.infer<typeof mailConnectionSchema>;

// 확인 목록: 연결 불명·모호·최종 결과 충돌. 처리는 연결·새 지원 건 확정·무시만 제공한다.
export const mailStatusSchema = z.enum(['지원 완료', '전형 진행중', '합격', '불합격', '열람', '모호']);
export const reviewSchema = z.object({
  id: z.string(),
  reason: z.enum(['연결 불명', '모호', '최종 결과 충돌']),
  createdAt: z.string(),
  subject: z.string(),
  receivedAt: z.string().nullable(),
  platform: z.string().nullable(),
  classification: mailStatusSchema,
  evidence: z.string().nullable(),
});
export type Review = z.infer<typeof reviewSchema>;
const reviewStatus = z.enum(['지원 완료', '전형 진행중', '합격', '불합격', '열람']).optional();
export const reviewActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('link'), applicationId: z.string().min(1), status: reviewStatus }).strict(),
  z.object({ action: z.literal('create'), company: z.string().trim().min(1).max(200), roleTitle: z.string().trim().min(1).max(200), status: reviewStatus }).strict(),
  z.object({ action: z.literal('ignore') }).strict(),
]);

// 자동 갱신 상태: 최근 예약 실행 결과(앱이 꺼져 있던 동안 처리된 것 포함)를 다음 실행에서 보여 준다.
export const automationStatusSchema = z.object({
  enabled: z.boolean(),
  lastScheduled: z.array(z.object({ kind: z.string(), status: jobStatusSchema.nullable(), finishedAt: z.string().nullable(), runDate: z.string() })),
});

// 사용자 본인 OpenAI 키·모델(기획서 3절 4-1). 목록은 정답 사례로 판정 정확도를 잰 모델만 둔다.
// ponytail: 측정한 두 모델만 고정 목록. 새 모델은 eval:recommend로 잰 뒤 추가한다.
export const AI_MODELS = [
  { id: 'gpt-5.5', label: 'gpt-5.5 (권장)', note: '정답 사례 55/57 (2026-11-08). 정확하지만 요금이 더 듭니다.' },
  { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini (저렴)', note: '정답 사례 39/57 (2026-11-07). 요금은 적지만 오판이 많습니다.' },
] as const;
export const aiModelSchema = z.enum(['gpt-5.5', 'gpt-5.4-mini']);
export const aiSettingsSchema = z.object({ configured: z.boolean(), keyHint: z.string().nullable(), model: aiModelSchema, verifiedAt: z.string().nullable() });
export type AiSettings = z.infer<typeof aiSettingsSchema>;
// 키를 비우면 저장된 키를 그대로 두고 모델만 바꾼다.
export const aiSettingsUpdateSchema = z.object({ apiKey: z.string().trim().min(20).max(300).regex(/^\S+$/).optional(), model: aiModelSchema }).strict();
