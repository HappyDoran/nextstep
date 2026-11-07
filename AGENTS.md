# NextStep 에이전트 작업 규칙

취업·이직 준비자의 공고 추천·지원 관리 독립 서비스다. 현재는 로컬 실행 기반 구축 단계이며 비공개 MVP 완료와 구분한다.

| 사실 | 소유 문서 |
|---|---|
| 사용자 요구·단계별 범위·완료 조건 | [서비스 기획서](docs/spec/서비스기획서_v0.2.md) |
| 데이터·작업·보호·P1 구현 순서 | [기술 설계 부록](docs/spec/기술설계_부록.md) |
| 기술 선택·workspace 책임·의존 경계 | [TECH_RULES.md](TECH_RULES.md) |
| 실행·검증·환경 변수·현재 구현 범위 | [README.md](README.md) |
| 디자인 기초의 토큰·타입·아이콘 사용법 | [디자인 기초](packages/design-system/README.md) |
| 작업 지원 체계·검사 한계 | [AI_AGENT_HARNESS.md](docs/AI_AGENT_HARNESS.md) |
| 웹·서버·데스크톱·공통 패키지 지역 규칙 | 각 workspace의 AGENTS.md |

작업 전 두 기획서의 해당 범위·완료 조건과 TECH_RULES.md, 변경 workspace의 지역 규칙을 읽는다. 코드·스키마·테스트는 현재 구현의 근거이며 기획과 다르면 구현 차이로 보고한다. 요구를 임의 축소하지 않는다.

작업별 절차는 `.codex/skills/`의 `nextstep-structure`, `nextstep-doc-policy`, `nextstep-testing`, `nextstep-review`, `nextstep-commit`에서 읽는다. 도구별 본문을 복제하지 않으며 CLAUDE.md와 Claude skill은 canonical symlink로 유지한다.

- 실제 지원·취소·메일 발송을 하지 않는다. 외부 지원은 사용자가 기본 브라우저에서 한다.
- 기존 개인 Notion·메일·키체인·개인별 예외를 복제하거나 무단 연결하지 않는다. 실제 계정은 동의한 시험 계정만 사용한다.
- 개인 상태·열람·공고 상태는 별도다. 사용자 격리·최소 근거·정정 재적용 방지·삭제 경합·멱등성을 처음부터 유지한다.
- 원문·이력서·자격정보·로컬 DB를 커밋하지 않는다.
- 사실 하나당 소유 문서 하나를 유지한다. 빈 문서·과제용 프롬프트 기록·LLM_REPORT·LLM 활용 보고서를 만들지 않는다.
- 문서와 사용자 문구는 한국어로 작성한다. 미실행 검증을 통과로, 모의 데이터를 실제 연동으로 보고하지 않는다.
