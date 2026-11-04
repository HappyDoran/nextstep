# NextStep

취업·이직 준비자를 위한 맞춤 채용공고 추천·지원 관리 독립 서비스다. 1차는 초대 계정의 비공개 MVP이며 [서비스 기획서](docs/spec/서비스기획서_v0.2.md)와 [기술 설계 부록](docs/spec/기술설계_부록.md)이 요구·완료 조건을 소유한다.

## 현재 구현 범위

pnpm/Turborepo 모노레포, 웹 개발 화면, API·SQLite 준비 확인, DB 버전 관리, Electron 기본 창·종료·URL 보호, 공통 계약·UI·토큰과 Storybook을 구성했다. 웹의 연결 확인은 실제 로컬 API와 DB를 읽는다. 실패 후 재시도할 수 있다. 개인 데이터는 아직 받지 않는다.

초대 로그인·세션·수동 지원·이력서·추천·메일·작업자·예약·삭제 기능은 미구현이다. 로컬 기반 구축은 P1-01~07 또는 MVP 완료가 아니다. 앱·사용자 컴퓨터 종료 중 별도 서버 자동화와 배포·서명·패키징도 검증 대상에 남아 있다. 색상·레이아웃은 초기 개발안이다.

## 설치와 실행

Node 24.22.1, pnpm 10.34.6을 사용한다. mise 사용 시 저장소 설정을 신뢰하고 실행한다.

```sh
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm dev
```

이미 해당 도구가 PATH에 있으면 `mise exec --`를 생략한다. 설치 시 Git hooks가 연결된다. 글로벌 도구 설정은 바꾸지 않는다.

| 명령 | 동작 |
|---|---|
| `pnpm dev` | API 127.0.0.1:4100, 웹 127.0.0.1:3100 동시 실행 |
| `pnpm dev:desktop` | 별도 터미널에서 Electron 창 실행. 웹·API는 먼저 실행 |
| `pnpm storybook` | 공통 UI 카탈로그 127.0.0.1:6006 실행 |
| `pnpm build` | 계약·UI·Storybook·서버·웹·Electron main 컴파일 |
| `pnpm --filter @nextstep/server start` | 빌드된 API 실행 |
| `pnpm --filter @nextstep/web start` | 빌드된 웹 실행 |

`pnpm dev:desktop`은 개발 실행이며 설치용 앱 패키지를 만들지 않는다. macOS 창 닫기는 창만 닫으며 메뉴의 ‘NextStep 종료’로 완전 종료한다. 서버는 독립 프로세스이므로 앱 종료가 서버 종료나 자동 OFF를 의미하지 않는다.

최초 실행 전에 포트가 비어 있는지 확인한다. 다른 서비스의 프로세스를 종료하지 않는다. API·웹 포트를 바꾸는 경우 관련 URL을 함께 맞춘다. Next CLI 포트는 해당 workspace 명령의 `--port`를 수정하거나 CLI로 별도 지정한다.

## 환경과 데이터

실제 값은 셸 환경에 설정한다. 웹은 Next.js 환경 파일도 지원하지만 서버·Electron은 환경 파일을 자동 로드하지 않는다. [.env.example](.env.example)은 키 설명용이며 계정 비밀정보를 담지 않는다.

| 변수 | 소비자 | 기본값 / 의미 |
|---|---|---|
| NEXTSTEP_API_PORT | 서버 | 4100 |
| NEXTSTEP_DB_PATH | 서버 | 서버 실행 cwd의 `.data/nextstep.sqlite`. 공유하려면 절대 경로 지정 |
| NEXTSTEP_API_URL | 웹 서버 route | http://127.0.0.1:4100. 브라우저로 전달하지 않음 |
| NEXTSTEP_WEB_URL | Electron main | 개발 기본 http://127.0.0.1:3100. 패키징 실행은 소유 HTTPS 주소 필수 |

현재 DB에는 서비스 메타데이터만 저장한다. 파일 DB는 Git에서 제외하며 파일 권한은 0600, 새 디렉터리는 0700으로 생성한다. Node 내장 SQLite 사용 시 실험적 경고가 표시될 수 있다. private 파일·자격정보 보관 체계를 구현하기 전에는 실제 메일이나 이력서를 투입하지 않는다.

## 검증

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
```

| 명령 | 검증 범위 |
|---|---|
| `pnpm structure:check` | 의존 그래프·import 경계·symlink·문서 상대 링크·금지 파일 추적 |
| `pnpm lint` | 전체 JS·TS·React ESLint, 경고도 실패 |
| `pnpm typecheck` | workspace·Storybook 설정·브라우저/Electron 테스트·Next route 타입 |
| `pnpm test:harness` | 구조 검사 자체의 위반 탐지 회귀 |
| `pnpm test` | harness·공통 계약·파일 DB/API·Electron URL 정책 |
| `pnpm build` | 실제 빌드·Storybook 정적 출력 |
| `pnpm test:e2e` | 빌드된 로컬 웹·API 실행, Chromium에서 연결·503·재시도 |
| `pnpm test:desktop` | macOS Electron 실행·권한 격리·창 닫기·완전 종료. 격리된 임시 프로필 사용 |

브라우저 테스트는 3100·4100을 독점하며 기존 서버를 재사용하지 않는다. 먼저 `pnpm build`를 완료한다. E2E의 503 응답은 오류 표시 검증을 위한 모의 실패다. DB 영속성 테스트는 임시 파일을 사용하고 종료 후 지운다. 실제 외부 연동을 검증하지 않는다.

CI는 설치·전체 검사·Chromium E2E를 수행한다. macOS Electron 실제 실행·완전 종료는 별도 확인한다. CI 성공과 브랜치 보호 설정은 별개다.

## 다음 작업 경계

기반 세팅 후 기술 부록 P1-01의 세 출처 수집 → 동의된 네이버 시험 계정의 읽기 전용 조회 → 텍스트 PDF/MD 추출 검증을 진행한다. 네 직무 정답 사례와 실패 구분을 확보한 뒤 P1-02 인증·사용자 격리·삭제 경계를 구현한다. 초대 인증 수단·AI 처리 제공자·별도 서버 배포 환경·운영 DB·macOS 최소 환경은 필요한 시점에 결정한다. 개인 Notion·메일·키체인·기존 Chrome 로그인 세션을 재사용하지 않는다.

기술 책임은 [TECH_RULES.md](TECH_RULES.md), 작업 규칙은 [AGENTS.md](AGENTS.md), 지원 체계와 검사 한계는 [AI_AGENT_HARNESS.md](docs/AI_AGENT_HARNESS.md)를 따른다.
