---
title: NextStep 에이전트 작업 규칙
kind: rule
last_verified: 2026-11-07
---

# NextStep 에이전트 작업 규칙

취업·이직 준비자의 공고 추천·지원 관리 독립 서비스다. 현재는 로컬 실행 기반 구축 단계이며 비공개 MVP 완료와 구분한다.

이 문서는 저장소 규칙의 도구 중립 진입점이며 규칙 본문은 아래 소유 문서가 가진다. `CLAUDE.md`는 이 파일의 symlink이고 Claude skill·agent도 `.codex/` canonical 파일의 symlink다. 본문을 복사하지 않는다.

## 권위 순서 (충돌 시 위가 이긴다)

1. 실행 가능한 계약: 소스 코드, 스키마, 설정, 구조 검사, 테스트. 문서가 코드와 다르면 코드가 현재 사실이고 문서를 고친다.
2. `TECH_RULES.md`: 기술 선택, workspace 책임, 의존 경계.
3. 아래 문서 맵의 소유 문서.
4. 이 문서의 절대 금지와 작업 흐름.

요구는 기획서가 정하며 코드가 기획과 다르면 요구를 낮추지 않고 구현 차이로 보고한다. 계약을 바꾸면 코드와 소유 문서를 같은 변경에서 함께 바꾼다.

## 문서 맵 (사실 하나당 소유 문서 하나)

| 사실 | 소유 문서 | 갱신을 유발하는 변경 |
|---|---|---|
| 사용자 요구·단계별 범위·1차 완료 조건 | [서비스 기획서](docs/spec/서비스기획서_v0.2.md) | 범위·요구·완료 조건 변경 |
| 데이터 모델·작업·보호·2차 연결 설계 | [기술 설계 부록](docs/spec/기술설계_부록.md) | 데이터 구조·작업 처리·보호 정책·마이그레이션 원칙 변경 |
| 1차 구현 순서(P1)·현재 상태·미결 결정 | [백로그](docs/spec/gap-analysis.md) | 단계 착수·완료, 결정 확정 |
| 기술 선택·workspace 책임·의존 경계 | [TECH_RULES.md](TECH_RULES.md) | 의존성 추가·교체, workspace 추가, 금지 패턴 |
| 실행·검증·환경 변수·현재 구현 범위 | [README.md](README.md) | script·명령·환경 변수·구현 범위 변경 |
| 디자인 기초의 토큰·타입·아이콘 사용법 | [디자인 기초](packages/design-system/README.md) | 토큰·타입·아이콘·Storybook 변경 |
| 작업 지원 체계·역할 소유 범위·검사 한계 | [AI_AGENT_HARNESS.md](docs/AI_AGENT_HARNESS.md) | 진입점·skill·역할·검사 흐름 변경 |
| 웹·서버·데스크톱·공통 패키지 지역 규칙 | 각 workspace의 AGENTS.md | 해당 workspace의 경계·함정 변경 |
| 구조적 결정의 이유와 검증 결과 | Git 커밋 본문 | 구조 규칙 도입, 예외 승인, 동작 변경 |

새 문서는 `nextstep-doc-policy`를 통과한 뒤에만 만들고 이 표에 한 줄 추가한다.

## 작업 유형별 필독

| 작업 | 시작 전 읽는 것 |
|---|---|
| 모든 코드 변경 | 기획서의 해당 범위·완료 조건, TECH_RULES.md, 변경 workspace의 AGENTS.md, `nextstep-testing` |
| 파일·workspace 배치, 의존 변경 | `nextstep-structure` |
| 문서·skill·agent 변경 | docs/AI_AGENT_HARNESS.md, `nextstep-doc-policy` |
| 범위 정리·변경 | docs/spec/서비스기획서_v0.2.md, docs/spec/기술설계_부록.md |
| 기능 착수·완료, 다음 작업 선택 | docs/spec/gap-analysis.md, `nextstep-backlog` |
| 범위·요구·완료 조건 정리·변경 | docs/spec/서비스기획서_v0.2.md, `nextstep-spec-discovery` |
| 화면·공통 UI 변경 | packages/design-system/README.md |
| 역할을 지정받은 작업 | `.codex/agents/nextstep-<역할>.md`, docs/AI_AGENT_HARNESS.md 역할 표 |
| 여러 역할로 나누는 작업 | `nextstep-parallel` |
| 완료 전 / 커밋·푸시 | `nextstep-review` / `nextstep-commit` |

## 절대 금지

- 실제 지원·취소·메일 발송을 하지 않는다. 외부 지원은 사용자가 기본 브라우저에서 한다.
- 기존 개인 Notion·메일·키체인·개인별 예외를 복제하거나 무단 연결하지 않는다. 실제 계정은 동의한 시험 계정만 사용한다.
- 개인 상태·열람·공고 상태는 별도다. 사용자 격리·최소 근거·정정 재적용 방지·삭제 경합·멱등성을 처음부터 유지한다.
- 원문·이력서·자격정보·로컬 DB를 커밋하지 않는다.
- 요구를 임의 축소하지 않는다.
- 사실 하나당 소유 문서 하나를 유지한다. 빈 문서·과제용 프롬프트 기록·LLM_REPORT·LLM 활용 보고서를 만들지 않는다.
- 파일·브랜치 삭제, 이력 재작성(`push --force`, `reset --hard`), 원격 리소스 변경은 사용자 승인 없이 하지 않는다.
- 문서와 사용자 문구는 한국어로 작성한다. 미실행 검증을 통과로, 모의 데이터를 실제 연동으로 보고하지 않는다.

## 작업 흐름

1. 작업 범위와 완료 조건을 확인한다. 기능 작업은 docs/spec/gap-analysis.md의 가장 앞선 미완료 단계에서 시작하고 끝나면 상태를 갱신한다.
2. 변경 범위의 소유 문서만 읽고 실제 코드·스키마·테스트로 현재 상태를 확인한다. 기획과 다르면 구현 차이로 보고한다.
3. 코드와 소유 문서를 함께 바꾸고 frontmatter의 `last_verified`를 갱신한다.
4. README.md의 검증을 실행하고 `nextstep-review`를 적용한다.
5. 완료 보고와 커밋 본문에 실행한 검증과 실행하지 못한 검증을 구분해 적는다.
