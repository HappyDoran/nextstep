# 지역 작업 규칙

웹은 서버 DB에 직접 접근하지 않는다. 비밀 환경 변수는 서버 route에만 사용하고 NEXT_PUBLIC으로 옮기지 않는다. 공통 UI는 @nextstep/design-system, 응답 검증은 @nextstep/contracts를 소비한다. 개발 화면을 실제 로그인·추천·지원 기능처럼 표현하지 않는다. 인증 화면과 1차 화면은 기획 범위를 읽은 뒤 구현한다.
