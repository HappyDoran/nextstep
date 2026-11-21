// 작업 결과의 분석 실패 원인 코드 → 사용자 문구(추천·메일 결과 공용). 모델·처리 방식은 사용자에게 보이지 않는다.
export const AI_CAUSES: Record<string, string> = { ai_network: '분석 연결 실패', ai_timeout: '분석 시간 초과', ai_model_unavailable: '분석 준비 안 됨', ai_http: '분석 오류', ai_invalid_output: '분석 결과 형식 오류' };
