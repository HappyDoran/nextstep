import { z } from 'zod';
export const applicationStatusSchema = z.enum(['미지원', '지원 완료', '전형 진행중', '합격', '불합격']);
export const postingStatusSchema = z.enum(['모집중', '마감', '미확인']);
export const readStatusSchema = z.enum(['열람', '미열람', '정보 없음']);
export const healthSchema = z.object({ service: z.literal('nextstep'), status: z.literal('ok'), database: z.literal('ready'), schemaVersion: z.number().int().positive() });
export type Health = z.infer<typeof healthSchema>;
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;
