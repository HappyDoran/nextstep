---
title: AI Agent 작업 지원 체계
kind: design
last_verified: 2026-11-07
---

# AI Agent 작업 지원 체계

Agent가 과거 대화 없이 작업을 시작해 사실을 찾고, 변경을 검증하고, 근거를 남기게 하는 장치의 설계와 자동 검증 범위를 소유한다. 기획 범위와 구현 근거를 구분하며 다른 사실은 AGENTS.md 문서 맵의 소유자가 가진다.

```
AGENTS.md (= CLAUDE.md)  →  작업 범위·완료 조건 확인(백로그)  →  소유 문서 선택
  →  실제 코드·설정 확인  →  작업 유형별 skill 적용  →  코드·소유 문서 변경
  →  README.md 검증  →  review  →  커밋 본문에 이유·검증 보존  →  다음 세션
```

## 진입점과 skill

진입점은 AGENTS.md다. 전역 기술 규칙은 TECH_RULES.md, 지역 규칙은 각 workspace의 AGENTS.md가 소유한다. skill은 `.codex/skills/<name>/SKILL.md`, 역할 정의는 `.codex/agents/<name>.md`가 canonical이며 `CLAUDE.md`와 `.claude/` 아래 skill·agent는 symlink만 둔다. 루트 규범 문서(AGENTS.md, TECH_RULES.md)와 `docs/` 아래 문서는 `title`, `kind`(`rule|design|spec|guide|runbook|snapshot|history`), `last_verified` frontmatter를 둔다. README.md처럼 사람이 먼저 읽는 문서와 workspace AGENTS.md는 frontmatter를 두지 않는다. skill·agent frontmatter의 `name`은 디렉터리·파일명과 같다.

| skill | 적용 시점 |
|---|---|
| nextstep-structure | 파일·workspace 배치, 의존 변경 |
| nextstep-doc-policy | 문서·skill·agent 생성·변경 |
| nextstep-testing | 동작·계약·신뢰 경계 변경 |
| nextstep-review | 완료 전, 리뷰 요청 |
| nextstep-commit | 커밋·푸시 |
| nextstep-backlog | 기능 착수·완료, 다음 작업 선택 |
| nextstep-parallel | 여러 역할로 나누는 작업, 병렬 실행·병합 |

skill을 읽었다는 기록을 서비스 데이터나 보고서로 저장하지 않는다.

## 역할과 소유 범위

역할의 공통 행동은 .codex/agents가 소유하고 이 표는 NextStep에서 각 역할이 쓸 수 있는 경로를 소유한다. 표 밖 경로가 필요하면 소유 역할에 요청한다. 실행 방식과 병합은 nextstep-parallel을 따른다. 쓰기 범위가 겹치지 않는 작업만 각자의 worktree와 `<역할>/<주제>` 브랜치에서 동시에 진행한다.

| 역할 | agent | 쓰기 범위 | 주 입력 |
|---|---|---|---|
| 기획 | nextstep-planner | docs/spec/서비스기획서_v0.2.md, docs/spec/gap-analysis.md | 사용자 결정, 사업 제안 |
| 디자인 | nextstep-designer | packages/design-system | 기획서 4절 화면·흐름 |
| 프론트엔드 | nextstep-frontend | apps/web, apps/desktop, tests/e2e, tests/desktop | 기획 완료 조건, 디자인 기초, 계약 |
| 백엔드 | nextstep-backend | apps/server(프롬프트 경로 제외), packages/contracts, docs/spec/기술설계_부록.md | 기획서, 기술 설계 부록 |
| AI 프롬프트 | nextstep-prompt-engineer | apps/server/src/prompts, apps/server/tests/prompts (생성 시) | 기획서 8절, 기술 설계 부록 C·D절, 계약 |
| 사업 | nextstep-business | 없음(제안만) | 기획서 1·7·9절 |

AI 처리 제공자는 미결정이므로 프롬프트 역할은 제공자 결정 전까지 템플릿·출력 스키마·정답 사례만 다룬다. 기획서는 개발 단계에 가격·운영비·매출 목표를 넣지 않으므로 사업 역할은 이를 산정하지 않고 시장·경쟁·사용자 검증 근거만 기획에 제안한다. README.md·TECH_RULES.md·AGENTS.md·scripts·CI 등 공통 파일은 변경한 역할이 자기 사실만 고치고 겹치는 변경은 병합 담당이 정리한다.

## 자동 검사와 한계

구조 검사는 workspace 의존 그래프·소스 import 경계·도구 진입·skill·agent symlink·규범 문서와 skill·agent의 frontmatter·문서 상대 링크·개인 파일 추적을 검사한다. 검사 구현과 검사 항목의 정답은 scripts/check-structure.mjs, 회귀 검증은 tests/harness가 소유한다. Markdown 본문의 의미·`last_verified`의 진실성·보안의 완전성·역할 쓰기 범위 준수·임의 셸 우회는 검사하지 않으며 리뷰 대상이다.

pnpm install의 prepare가 clone별 core.hooksPath를 .githooks로 설정한다. pre-commit은 구조와 harness 테스트, commit-msg는 변경 이유·검증을 담을 본문 존재 여부를 검사한다. 본문의 진실성·테스트 적절성은 리뷰 대상이다. hooks는 우회 가능하므로 CI도 전체 검증을 실행한다. CI는 push와 PR에서 실행하지만 저장소의 required check 설정까지 구성한 것은 아니다.

PR template은 역할·변경·이유·검증·인계·문서 동기화를 안내한다. 실제 명령과 현재 검증 범위는 README.md가 소유한다. 브라우저 검증은 로컬 웹과 API 경로를 확인하며 실제 공고 수집·네이버 조회·운영 예약이나 서명된 macOS 배포를 입증하지 않는다.
