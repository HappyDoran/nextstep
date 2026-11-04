---
name: nextstep-structure
description: workspace·패키지·import 경계를 추가하거나 바꿀 때 적용한다.
---

# nextstep-structure

TECH_RULES.md의 책임 표와 변경 workspace의 AGENTS.md를 읽는다. 기존 책임에 배치할 수 있는지 먼저 판단한다. apps 간 참조와 다른 workspace src 직접 참조를 만들지 않는다. 새 workspace는 scripts/check-structure.mjs의 허용 그래프와 테스트에 함께 등록한다. 실행 명령은 README.md, 절차 설명은 docs/AI_AGENT_HARNESS.md 소유인지 확인하고 중복을 피한다. 구조 검사와 변경 계약의 타입 검사를 실행한다.
