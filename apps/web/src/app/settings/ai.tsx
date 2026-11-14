'use client';
import { useQuery } from '@tanstack/react-query';
import { aiSettingsSchema, type Me } from '@nextstep/contracts';
import { call } from '../api-client';

// 작업 결과의 AI 실패 원인 코드 → 사용자 문구(추천·메일 결과 공용).
export const AI_CAUSES: Record<string, string> = { ai_network: '로컬 AI(Ollama) 연결 실패', ai_timeout: '로컬 AI 응답 시간 초과', ai_model_unavailable: '로컬 AI 모델 미설치', ai_http: '로컬 AI 오류', ai_invalid_output: '로컬 AI 출력 형식 오류' };

// AI는 서버의 로컬 LLM 하나로 처리한다. 사용자가 설정할 것은 없고 모델 이름만 보여 준다.
export function AiSetting({ me }: { me: Me }) {
  const query = useQuery({ queryKey: ['settings', 'ai', me.id], queryFn: async () => aiSettingsSchema.parse(await call('settings/ai')), retry: false });
  return <p role="status" className="text-body-sm">
    {query.data ? `로컬 AI(${query.data.model})를 씁니다. ` : ''}서류·공고·메일은 이 서버 안에서만 처리되고 외부 AI로 보내지 않습니다. 사용자가 등록할 키나 요금은 없습니다.
  </p>;
}
