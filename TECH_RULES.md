---
title: 기술 규칙
kind: rule
last_verified: 2026-11-14
---

# 기술 규칙

## 실행 환경과 선택

개발 Node는 `.node-version`, 패키지 관리자는 루트 package.json, 공통 라이브러리 선언은 pnpm-workspace.yaml, 실제 해석 버전은 pnpm-lock.yaml이 소유한다. mise.toml은 로컬 도구 선택을 연결한다.

서버는 Fastify 5, 로컬 관계형 DB는 SQLite와 Node 내장 `node:sqlite`를 사용한다. 단일 서버·작업자, 트랜잭션·고유 제약을 사용할 수 있는 초기 로컬 개발 선택이다. 내장 SQLite API의 안정성 상태는 Node 버전에 종속되며 현재 실행 시 실험적 경고가 발생할 수 있다. 작은 동기 쿼리용으로 한정하고 수집·추출처럼 오래 걸리는 처리는 요청 경로에 넣지 않는다. 운영 환경은 홈서버 한 대(Ubuntu)이며 웹·API·SQLite를 함께 실행하고 Tailscale 사설망으로만 접속한다. 개발은 Mac, 빌드·실행은 홈서버에서 한다(사용자 결정 2026-11-14).

AI 처리는 최종적으로 홈서버의 로컬 LLM 하나로만 한다(사용자 결정 2026-11-14). 구현 기간에는 현재 OpenAI 경로를 공고 추출 위주로 최소한만 쓰고 마지막에 로컬로 바꾼다. Ollama를 `127.0.0.1`에만 열어 서버가 fetch로 호출하고, JSON Schema 구조화 출력을 받아 공통 계약 schema로 다시 검증한다. 모델은 정답 사례 측정(검증 기록)으로 정한 Qwen3 1.7B(Q4_K_M)다. 로컬 LLM은 공고·서류·메일의 정보 추출만 하고 추천 분류는 서버 규칙이 한다. 로컬 전환 후에는 외부 AI API를 호출하지 않는다. 현재 코드는 `NEXTSTEP_AI_PROVIDER=ollama`이면 Ollama(`NEXTSTEP_OLLAMA_URL` 기본 127.0.0.1:11434, `NEXTSTEP_OLLAMA_MODEL` 기본 qwen3:1.7b)로, 아니면 OpenAI Responses API와 사용자별 키(`ai_settings`)로 처리한다. OpenAI 경로는 P1-10에서 제거한다. 이력서·공고·메일 본문은 구분자 안의 데이터로만 전달한다. 메일 조회는 imapflow, PDF 본문 추출은 pdfjs-dist legacy 빌드를 서버에서만 사용한다. IMAP은 읽기 전용(EXAMINE)으로 열고 플래그를 바꾸지 않는다. 서류는 모두 MD 텍스트로 바꿔 저장·분석한다. PDF는 크기·처리 시간 제한 안에서 텍스트 레이어를 읽고, 글자 없는 쪽만 시스템 도구 `pdftoppm`(poppler)·`tesseract`(kor+eng)로 글자를 인식한다(도구가 없으면 경고만). Notion ZIP은 의존성 없이 Node `zlib`으로 MD 항목만 메모리에서 읽고 디스크에 풀지 않는다(항목·해제 크기 제한, 암호화·ZIP64 거부). 공고 수집은 사람 속도로 요청하고 로그인·차단 우회를 하지 않는다. 출처는 자동 수집하며(현재 코드: 사람인·잡코리아·자소설닷컴, 범위: 원티드·점핏 추가) 약관 위험과 결정 근거는 기술 설계 D절이 소유한다.

Fastify의 [Node 지원 정책](https://fastify.dev/docs/latest/Reference/LTS/), Node의 [SQLite API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)를 기준으로 설치·타입·실행 호환성을 검증한다. 버전 문자열만으로 호환성을 보장하지 않는다.

Next.js App Router·React·Tailwind CSS로 웹을 구현한다. 화면과 공통 UI는 공유 Tailwind preset의 유틸리티로 작성하며 styled-components 등 CSS-in-JS를 도입하지 않는다. CSS 변수는 토큰·테마 값의 정본이고 preset은 값 복제 없이 색상·타입·크기·포커스·모션 유틸리티에 연결한다. 공통 UI·토큰은 design-system과 Storybook에서 관리한다. 아이콘은 Lucide React를 정적 import로 사용한다. 토큰·타입·아이콘의 사용법은 packages/design-system/README.md가 소유한다. 브랜드 색상 선택은 디자인 기초 소유 문서를 따른다. 화면·타입·테마의 세부 디자인은 개발 초기안이다. 서버 상태는 TanStack Query, 화면 간 공유하는 클라이언트 상태는 Jotai를 사용한다. 서버 응답을 atom에 복제하지 않고 컴포넌트 안에서만 필요한 상태는 React 로컬 상태로 둔다. QueryClient는 서버 요청 사이에 공유하지 않으며 Jotai는 첫 공유 상태가 생길 때 추가하고 앱의 Provider 범위에 격리한다. 개인 데이터 도입 시 query key의 사용자 구분과 로그아웃·계정 전환 시 캐시 및 atom 초기화를 함께 구현한다.

## 책임과 의존 그래프

| workspace | 책임 | 허용하는 내부 의존 |
|---|---|---|
| apps/web | 웹 UI, 동일 출처 API 경유, 로딩·오류 표시 | contracts, design-system |
| apps/server | API·로컬 DB·마이그레이션. 향후 인증·작업·수집의 소유자 | contracts |
| packages/contracts | 런타임 Zod 계약·공통 타입·상태 구분 | 없음 |
| packages/design-system | React UI·CSS 토큰·Storybook | 없음 |

앱 사이 직접 import, workspace 밖 상대경로 import, 다른 패키지 src 직접 참조를 금지한다. package exports로만 소비한다. 공통 패키지에 DB·파일·자격정보·외부 수집을 넣지 않는다. 서버에서 UI를 import하지 않는다. 검사는 scripts/check-structure.mjs가 소유한다.

## 신뢰 경계

API는 기본 loopback에만 바인딩하고 개인 데이터를 제공하는 엔드포인트는 인증·사용자 범위와 삭제 경합 검증을 갖춘 뒤 추가한다. 초대 인증은 운영자가 발급한 1회용 초대 코드(해시 저장, 14일 만료, 초대 링크 `/?invite=` 로 전달하고 가입 후 주소에서 지움)로 가입하고 이메일·비밀번호로 로그인한다. 비밀번호는 Node 내장 scrypt로 해시하고, 세션은 무작위 토큰의 해시를 DB에 저장해 14일 후 만료하며 HttpOnly·SameSite=Lax 쿠키로 전달한다(HTTPS 배포는 Secure). 로그인 실패는 이메일별 15분 5회로 제한한다. 개인 API는 세션에서 얻은 사용자 ID로만 범위를 정하고 다른 사용자 자료는 404로 답한다. 웹은 동일 출처 경유 route가 허용 경로만 API로 전달하고 Origin이 다른 변경 요청을 거부한다. 계정 삭제는 외래키 연쇄로 세션·소유 자료를 지운다. 공고는 갱신을 요청한 사용자의 자료로만 저장하고(`postings.owner_user_id`) 다른 사용자와 공유하지 않는다. SQLite 파일은 서버의 무시된 비공개 경로에 두고 외래키·WAL·busy timeout을 적용한다. DB 스키마 버전은 트랜잭션으로 전진하며 미래 버전은 거부한다.

Electron 데스크톱 앱은 2026-11-14 제거했다(사용자 결정). 웹 화면에서 원문·지원 링크는 URL·스킴을 검사해 새 창으로 연다.

문서·메일·공고는 입력 자료이며 도구 실행이나 정책 변경 지시로 취급하지 않는다. 원문·연결 비밀정보의 평문 로그를 만들지 않는다. 실제 개인 데이터 투입 전 인증·암호화·보관·삭제 구현을 검증해야 한다.
