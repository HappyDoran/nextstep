// response/damping 표기 그대로의 설계값이다. 애니메이션 엔진 설정으로 직접 전달하지 않는다.
// 엔진 도입 시 단위와 파라미터 변환·동작 감소·키보드 경로를 함께 검증한다.
export const springPresets = {
  ui: { damping: 1, responseSeconds: 0.35 },
  drawer: { damping: 0.8, responseSeconds: 0.3 },
  content: { damping: 0.8, responseSeconds: 0.4 },
} as const;
