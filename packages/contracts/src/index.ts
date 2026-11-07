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
