import { z } from 'zod';
export const applicationStatusSchema = z.enum(['미지원', '지원 완료', '전형 진행중', '합격', '불합격']);
export const postingStatusSchema = z.enum(['모집중', '마감', '미확인']);
export const readStatusSchema = z.enum(['열람', '미열람', '정보 없음']);
export const healthSchema = z.object({ service: z.literal('nextstep'), status: z.literal('ok'), database: z.literal('ready'), schemaVersion: z.number().int().positive() });
export type Health = z.infer<typeof healthSchema>;
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

export const sourceIdSchema = z.enum(['saramin', 'jobkorea', 'jasoseol', 'wanted', 'jumpit']);
export type SourceId = z.infer<typeof sourceIdSchema>;

// 초대 계정 인증: 구글 로그인 먼저, 미등록 계정은 초대 코드를 요청·입력해 가입한다(기획서 0.2.13).
// 데스크톱 앱 로그인: 기본 브라우저의 구글 로그인 뒤 앱으로 넘겨받은 1회용 코드.
export const desktopExchangeSchema = z.object({ code: z.string().regex(/^[\w-]{43}$/) }).strict();
export const meSchema = z.object({ id: z.string(), email: z.string() });
// 코드 입력을 기다리는 구글 계정. requested: 운영자에게 그 계정 전용 코드 요청 알림이 갔다(유효한 코드가 있다).
export const pendingSchema = z.object({ email: z.string(), requested: z.boolean() });
export type Pending = z.infer<typeof pendingSchema>;
export const inviteCodeSchema = z.object({ code: z.string().trim().min(8).max(64) }).strict();
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
  // 사용자가 잠근 필드는 메일로 바꾸지 않는다(기획서 5절).
  lockedFields: z.array(z.enum(['status', 'readStatus'])).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
// 지원 현황 CSV 가져오기: 다른 곳(엑셀·Notion 내보내기)에서 관리하던 지원 건을 한 번에 옮긴다.
// 필수 열은 회사·직무·상태, 선택 열은 공고URL. 같은 회사·직무(또는 같은 공고 URL)가 이미 있으면 건너뛴다.
export const applicationImportSchema = z.object({ csv: z.string().min(1).max(2_000_000) }).strict();
export const applicationImportResultSchema = z.object({
  imported: z.number().int(),
  duplicates: z.number().int(),
  invalid: z.number().int(),
  // 가져온 지원 건으로 다시 연결해 보도록 해석 대기로 되돌린 확인 요청(연결 불명) 수.
  requeued: z.number().int(),
});
export type ApplicationImportResult = z.infer<typeof applicationImportResultSchema>;
// 직접 수정: 보낸 필드만 바꾼다. postingUrl은 null로 지울 수 있다.
export const applicationUpdateSchema = z.object({
  company: z.string().trim().min(1).max(200).optional(),
  roleTitle: z.string().trim().min(1).max(200).optional(),
  postingUrl: z.url({ protocol: /^https$/ }).max(2000).nullable().optional(),
  status: applicationStatusSchema.optional(),
  readStatus: readStatusSchema.optional(),
  lockedFields: z.array(z.enum(['status', 'readStatus'])).max(2).optional(),
}).strict().refine(value => Object.keys(value).length > 0);
export const applicationEventSchema = z.object({
  field: z.enum(['status', 'readStatus']),
  from: z.string().nullable(),
  to: z.string(),
  source: z.enum(['manual', 'mail', 'import']),
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
// 서류 버전: 종류마다 올린 파일을 버전으로 남기고, 사용 중(active)인 하나만 추천에 쓴다. 목록에는 본문을 싣지 않는다.
export const DOCUMENT_VERSION_MAX = 10;
export const documentVersionSchema = z.object({ id: z.string(), filename: z.string(), size: z.number().int(), createdAt: z.string(), edited: z.boolean(), active: z.boolean() });
export type DocumentVersion = z.infer<typeof documentVersionSchema>;

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
  // 사용자 피드백(좋아요는 위로, 별로는 숨김)과 제외 복구. 그 사용자 목록에만 쓰고 회사·직무 전체 차단으로 해석하지 않는다.
  feedback: z.enum(['up', 'down']).nullable().default(null),
  restored: z.boolean().default(false),
  evaluatedAt: z.string(),
});
export const recommendationFeedbackSchema = z.object({ feedback: z.enum(['up', 'down']).nullable().optional(), restored: z.boolean().optional() }).strict().refine(v => Object.keys(v).length > 0);
export type Recommendation = z.infer<typeof recommendationSchema>;
export const recommendationListSchema = z.object({ items: z.array(recommendationSchema), lastJob: jobSchema.nullable() });
// 데스크톱 상주 앱 알림용: 마지막 공고 갱신 작업과 그 작업이 판정한 기본·도전 건수(끝나기 전에는 null).
export const latestRefreshSchema = z.object({ job: jobSchema.nullable(), counts: z.object({ basic: z.number().int(), challenge: z.number().int() }).nullable() });

// 네이버 메일 연결: 애플리케이션 비밀번호는 서버에서 암호화 저장하고 다시 내보내지 않는다.
export const mailConnectRequestSchema = z.object({
  account: z.email().max(254),
  appPassword: z.string().min(1).max(100),
  consent: z.literal(true),
  // 최초 조회 기간(일). 사용자가 고르고 동의한다(기획서 4절).
  days: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]).default(90),
}).strict();
// 과거 범위 넓히기: 지금 조회한 범위보다 오래된 메일을 별도 작업으로 가져온다. 현재 조회 위치는 바꾸지 않는다.
export const mailBackfillRequestSchema = z.object({ days: z.union([z.literal(90), z.literal(180), z.literal(365), z.literal(730)]) }).strict();
export const mailConnectionSchema = z.object({
  provider: z.literal('naver'),
  account: z.string(),
  status: z.enum(['정상', '인증 실패']),
  consentAt: z.string(),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
  rangeIncomplete: z.boolean(),
  // 조회한 범위의 시작 시각과, 넓히는 중이면 목표 시작 시각.
  coveredSince: z.string().nullable(),
  backfillSince: z.string().nullable(),
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
  // 보류한 항목은 목록 아래에 따로 두고 언제든 다시 처리한다.
  held: z.boolean().default(false),
  // AI가 메일에서 읽은 회사·직무(없을 수 있음)와, 같은 회사 지원 건이 하나뿐일 때의 연결 제안. 확정은 사용자가 한다.
  company: z.string().nullable().default(null),
  roleTitle: z.string().nullable().default(null),
  suggestedApplicationId: z.string().nullable().default(null),
});
export type Review = z.infer<typeof reviewSchema>;
// 메일 전체 보기 응답. 서버는 저장하지 않고 열 때마다 메일함에서 읽는다.
export const reviewBodySchema = z.object({ text: z.string(), fromAddress: z.string() });
const reviewStatus = z.enum(['지원 완료', '전형 진행중', '합격', '불합격', '열람']).optional();
export const reviewActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('link'), applicationId: z.string().min(1), status: reviewStatus }).strict(),
  z.object({ action: z.literal('create'), company: z.string().trim().min(1).max(200), roleTitle: z.string().trim().min(1).max(200), status: reviewStatus }).strict(),
  z.object({ action: z.literal('ignore') }).strict(),
  z.object({ action: z.literal('hold'), held: z.boolean() }).strict(),
]);

// 자동 갱신 상태: 최근 예약 실행 결과(앱이 꺼져 있던 동안 처리된 것 포함)를 다음 실행에서 보여 준다.
export const automationStatusSchema = z.object({
  enabled: z.boolean(),
  lastScheduled: z.array(z.object({ kind: z.string(), status: jobStatusSchema.nullable(), finishedAt: z.string().nullable(), runDate: z.string() })),
});

// 서버가 쓰는 로컬 LLM 모델 이름(설정 화면 표시용). 사용자별 AI 설정은 없다(P1-10).
export const aiSettingsSchema = z.object({ model: z.string() });
export type AiSettings = z.infer<typeof aiSettingsSchema>;
// 설정 '연결 상태': 로컬 AI는 확인할 때마다 실제로 묻고, 메일·공고 출처는 마지막 실행 결과를 보여 준다.
export const connectionStatusSchema = z.object({
  checkedAt: z.string(),
  ai: z.object({ model: z.string(), status: z.enum(['정상', '모델 없음', '연결 실패']) }),
  mail: z.object({ status: z.enum(['정상', '인증 실패']), lastSuccessAt: z.string().nullable(), lastError: z.string().nullable() }).nullable(),
  // 일부 실패: 공고는 받았지만 일부 상세를 읽지 못함. 실패: 받은 공고 없이 실패. collected는 기록이 없던 예전 작업이면 null.
  sources: z.array(z.object({ source: sourceIdSchema, status: z.enum(['정상', '일부 실패', '실패', '확인 전']), failures: z.record(z.string(), z.number().int()), collected: z.number().int().nullable(), finishedAt: z.string().nullable() })),
});
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;
