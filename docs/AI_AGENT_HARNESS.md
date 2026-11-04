# AI Agent 작업 지원 체계

진입점은 AGENTS.md다. 기획 범위와 구현 근거를 구분하고, 전역 기술 규칙은 TECH_RULES.md, 지역 규칙은 각 workspace의 AGENTS.md가 소유한다. Codex skill은 .codex/skills 아래가 canonical이며 Claude 진입점과 skill은 symlink다.

작업자는 배치 변경 시 nextstep-structure, 문서 변경 시 nextstep-doc-policy, 동작 변경 시 nextstep-testing을 읽는다. 완료 전 nextstep-review, 커밋·푸시 전 nextstep-commit을 적용한다. skill을 읽었다는 기록을 서비스 데이터나 보고서로 저장하지 않는다.

구조 검사는 workspace 의존 그래프·소스 import 경계·도구 진입 symlink·문서 상대 링크·개인 파일 추적을 검사한다. 검사 구현과 검사 항목의 정답은 scripts/check-structure.mjs, 회귀 검증은 tests/harness가 소유한다. Markdown 본문의 의미·보안의 완전성·임의 셸 우회까지 검사하지 않는다.

pnpm install의 prepare가 clone별 core.hooksPath를 .githooks로 설정한다. pre-commit은 구조와 harness 테스트, commit-msg는 변경 이유·검증을 담을 본문 존재 여부를 검사한다. 본문의 진실성·테스트 적절성은 리뷰 대상이다. hooks는 우회 가능하므로 CI도 전체 검증을 실행한다. CI는 push와 PR에서 실행하지만 저장소의 required check 설정까지 구성한 것은 아니다.

PR template은 변경·이유·검증·문서 동기화를 안내한다. 실제 명령과 현재 검증 범위는 README.md가 소유한다. 브라우저 검증은 로컬 웹과 API 경로를 확인하며 실제 공고 수집·네이버 조회·운영 예약이나 서명된 macOS 배포를 입증하지 않는다.
