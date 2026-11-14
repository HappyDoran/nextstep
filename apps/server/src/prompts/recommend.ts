import { z } from 'zod';

// 추천 판정 결과 형식. 분류는 recommend/classify.ts 규칙이 만든다(모델 판정 호출 없음, 2026-11-14).
export const judgementSchema = z.object({
  classification: z.enum(['기본', '도전', '미확인', '제외']),
  met: z.array(z.string()),
  unmet: z.array(z.string()),
  unknown: z.array(z.string()),
  reason: z.string(),
}).strict();
export type Judgement = z.infer<typeof judgementSchema>;
