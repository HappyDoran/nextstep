# 지역 작업 규칙

웹은 서버 DB에 직접 접근하지 않는다. 비밀 환경 변수는 서버 route에만 사용하고 NEXT_PUBLIC으로 옮기지 않는다. 공통 UI는 @nextstep/design-system, 응답 검증은 @nextstep/contracts를 소비한다. 개발 화면을 실제 로그인·추천·지원 기능처럼 표현하지 않는다. 인증 화면과 서비스 화면은 기획 범위를 읽은 뒤 구현한다.

공통 Tailwind preset을 사용하고 content에 공통 UI 소스도 포함한다. 컴포넌트 스타일은 Tailwind 유틸리티로 작성한다. 토큰 값이나 preset 매핑을 앱에서 중복 정의하지 않는다.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
