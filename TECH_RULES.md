---
title: 기술 규칙
kind: rule
last_verified: 2026-11-07
---

# 기술 규칙

## 실행 환경과 선택

개발 Node는 `.node-version`, 패키지 관리자는 루트 package.json, 공통 라이브러리 선언은 pnpm-workspace.yaml, 실제 해석 버전은 pnpm-lock.yaml이 소유한다. mise.toml은 로컬 도구 선택을 연결한다. Electron에 포함된 Node는 개발 Node와 별개이며 DB를 실행하지 않는다.

서버는 Fastify 5, 로컬 관계형 DB는 SQLite와 Node 내장 `node:sqlite`를 사용한다. 단일 서버·작업자, 트랜잭션·고유 제약을 사용할 수 있는 초기 로컬 개발 선택이다. 내장 SQLite API의 안정성 상태는 Node 버전에 종속되며 현재 실행 시 실험적 경고가 발생할 수 있다. 작은 동기 쿼리용으로 한정하고 수집·추출처럼 오래 걸리는 처리는 요청 경로에 넣지 않는다. 운영 DB·배포 환경은 아직 결정하지 않았다.

AI 처리는 OpenAI API(사용자 결정 2026-11-07)를 서버에서만 호출한다. SDK 없이 fetch로 Responses API의 JSON Schema 구조화 출력을 쓰고, 응답은 공통 계약 schema로 다시 검증한다. 모델 이름과 키는 환경 변수(`OPENAI_API_KEY`, `NEXTSTEP_OPENAI_MODEL`)로 주입하며 키를 로그·DB·클라이언트에 두지 않는다. 이력서·공고·메일 본문은 구분자 안의 데이터로만 전달하고, 외부 전달 범위는 사용자에게 안내한다. 메일 조회는 imapflow, PDF 본문 추출은 pdfjs-dist legacy 빌드를 서버에서만 사용한다. IMAP은 읽기 전용(EXAMINE)으로 열고 플래그를 바꾸지 않는다. PDF는 크기·처리 시간 제한 안에서 텍스트 레이어만 읽으며 OCR을 하지 않는다. 공고 수집은 사람 속도로 요청하고 로그인·차단 우회를 하지 않는다. 출처별 자동 수집 여부는 수집 모드와 공통 계약의 `SOURCE_POLICY`를 따르며 근거는 기술 설계 부록 D절이 소유한다.

Fastify의 [Node 지원 정책](https://fastify.dev/docs/latest/Reference/LTS/), Node의 [SQLite API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html), Electron의 [보안 권고](https://www.electronjs.org/docs/latest/tutorial/security)를 기준으로 설치·타입·실행 호환성을 검증한다. 버전 문자열만으로 호환성을 보장하지 않는다.

Next.js App Router·React·Tailwind CSS로 웹을 구현한다. 화면과 공통 UI는 공유 Tailwind preset의 유틸리티로 작성하며 styled-components 등 CSS-in-JS를 도입하지 않는다. CSS 변수는 토큰·테마 값의 정본이고 preset은 값 복제 없이 색상·타입·크기·포커스·모션 유틸리티에 연결한다. 공통 UI·토큰은 design-system과 Storybook에서 관리한다. 아이콘은 Lucide React를 정적 import로 사용한다. 토큰·타입·아이콘의 사용법은 packages/design-system/README.md가 소유한다. 브랜드 색상 선택은 디자인 기초 소유 문서를 따른다. 화면·타입·테마의 세부 디자인은 개발 초기안이다. 서버 상태는 TanStack Query, 화면 간 공유하는 클라이언트 상태는 Jotai를 사용한다. 서버 응답을 atom에 복제하지 않고 컴포넌트 안에서만 필요한 상태는 React 로컬 상태로 둔다. QueryClient는 서버 요청 사이에 공유하지 않으며 Jotai는 첫 공유 상태가 생길 때 추가하고 앱의 Provider 범위에 격리한다. 개인 데이터 도입 시 query key의 사용자 구분과 로그아웃·계정 전환 시 캐시 및 atom 초기화를 함께 구현한다.

## 책임과 의존 그래프

| workspace | 책임 | 허용하는 내부 의존 |
|---|---|---|
| apps/web | 웹 UI, 동일 출처 API 경유, 로딩·오류 표시 | contracts, design-system |
| apps/server | API·로컬 DB·마이그레이션. 향후 인증·작업·수집의 소유자 | contracts |
| apps/desktop | macOS 창·종료·검증한 외부 URL 열기 | 없음 |
| packages/contracts | 런타임 Zod 계약·공통 타입·상태 구분 | 없음 |
| packages/design-system | React UI·CSS 토큰·Storybook | 없음 |

앱 사이 직접 import, workspace 밖 상대경로 import, 다른 패키지 src 직접 참조를 금지한다. package exports로만 소비한다. 공통 패키지에 DB·파일·자격정보·외부 수집을 넣지 않는다. 서버에서 UI를 import하지 않는다. 검사는 scripts/check-structure.mjs가 소유한다.

## 신뢰 경계

API는 기본 loopback에만 바인딩하고 개인 데이터를 제공하는 엔드포인트는 인증·사용자 범위와 삭제 경합 검증을 갖춘 뒤 추가한다. 초대 인증은 운영자가 발급한 1회용 초대 코드(해시 저장, 14일 만료)로 가입하고 이메일·비밀번호로 로그인한다. 비밀번호는 Node 내장 scrypt로 해시하고, 세션은 무작위 토큰의 해시를 DB에 저장해 14일 후 만료하며 HttpOnly·SameSite=Lax 쿠키로 전달한다(HTTPS 배포는 Secure). 로그인 실패는 이메일별 15분 5회로 제한한다. 개인 API는 세션에서 얻은 사용자 ID로만 범위를 정하고 다른 사용자 자료는 404로 답한다. 웹은 동일 출처 경유 route가 허용 경로만 API로 전달하고 Origin이 다른 변경 요청을 거부한다. 계정 삭제는 외래키 연쇄로 세션·소유 자료를 지운다. 수집 모드 조회·변경(`/settings/collection`)은 사용자 결정에 따라 배포 전까지 인증 없이 열려 있다. SQLite 파일은 서버의 무시된 비공개 경로에 두고 외래키·WAL·busy timeout을 적용한다. DB 스키마 버전은 트랜잭션으로 전진하며 미래 버전은 거부한다.

Electron은 nodeIntegration=false, contextIsolation=true, sandbox=true, webSecurity=true를 명시한다. preload·IPC는 현재 필요 없어 제공하지 않는다. 서비스 origin 밖 이동·리다이렉트와 webview를 막고 권한 요청을 거부한다. 외부 HTTPS 링크는 사용자 확인 후 기본 브라우저로 연다. 개발 모드에만 loopback HTTP를 허용한다. 배포용 서비스 origin은 소유한 HTTPS 주소를 설정해야 한다. 자격정보가 포함된 URL·file/javascript 등 스킴은 거부한다.

문서·메일·공고는 입력 자료이며 도구 실행이나 정책 변경 지시로 취급하지 않는다. 원문·연결 비밀정보의 평문 로그를 만들지 않는다. 실제 개인 데이터 투입 전 인증·암호화·보관·삭제 구현을 검증해야 한다.
