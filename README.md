# NextStep

취업·이직 준비자를 위한 맞춤 채용공고 추천·지원 관리 독립 서비스다. 1차는 초대 계정의 비공개 MVP이며 [서비스 기획서](docs/spec/서비스기획서_v0.2.md)가 요구·완료 조건, [기술 설계 부록](docs/spec/기술설계_부록.md)이 데이터·작업·보호 설계를 소유한다.

## 현재 구현 범위

pnpm/Turborepo 모노레포, 웹 개발 화면, API·SQLite 준비 확인, DB 버전 관리, Electron 기본 창·종료·URL 보호, 공통 계약·UI·토큰과 Storybook을 구성했다. 디자인 기초는 원시 값·의미 색상·타입·간격·radius·그림자·모션 시간·이징·Lucide React 아이콘을 제공하며 선택한 브랜드와 Light/Dark를 카탈로그에서 비교할 수 있다. 웹의 연결 확인은 실제 로컬 API와 DB를 읽는다. 실패 후 재시도할 수 있다. 초대 코드 가입·이메일/비밀번호 로그인·로그아웃·계정 삭제, 지원 현황(직접 등록·검색·상태 필터·상세·상태/열람 수정과 변경 이력·삭제), 설정(계정·자동 갱신 ON/OFF 저장·연결 확인·수집 모드)이 웹과 Electron에서 동작한다. 공고 열기는 기본 브라우저로 이동만 하고 지원 상태를 바꾸지 않는다. 서버에는 P1-01 기술 검증용 텍스트 PDF/MD 이력서 추출 모듈과 잡코리아 공고·네이버 IMAP 읽기 전용 검증 명령이 있으며 API에 연결하지 않았다. 웹 첫 화면의 관리 토글로 서버 전체 수집 모드(서비스·개인)를 바꾸며 DB에 저장한다. 공고 검증 명령은 이 모드를 읽어 자동 수집 허용 출처만 요청한다. 토글은 인증 없이 누구에게나 보인다.

설정에서 이력서(텍스트 PDF·MD) 등록·교체·삭제와 프로필·필터(AI 초안은 확인 후 저장)를 다룬다. 추천 화면의 새로 가져오기는 서버 작업자가 수집 모드에 따라 공고를 모으고 OpenAI로 조건 추출·판정한 결과(기본·도전·미확인·제외와 근거)를 보여 주며, 공고 링크 한 건 판정·관심 없음·지원 현황 저장을 제공한다. 공고 원문은 저장하지 않는다. 실제 OpenAI 키를 넣은 전체 흐름과 판정 정확도는 아직 검증하지 않았다. 설정의 네이버 메일 연결은 로그인 검사 후 애플리케이션 비밀번호를 암호화(AES-256-GCM, 키는 DB 옆 `secret.key` 0600 또는 `NEXTSTEP_SECRET_KEY`)해 저장하고, 작업자가 편지함별 위치로 증분 조회해 채용 메일을 규칙으로 판정한다. 공고 링크로 식별되는 지원 건에만 자동 반영하고 최종 결과 충돌·모호는 확인 목록으로 보낸다. 대상을 식별하지 못한 메일은 보관하고, OpenAI가 설정되면 회사·직무를 해석해 지원 건 생성·연결·확인 요청으로 넘긴다(실제 OpenAI 해석은 미검증). 자동 갱신이 켜진 사용자는 서버가 한국 시간 매일 `NEXTSTEP_SCHEDULE_HOUR`(기본 21시) 이후 한 번 갱신·메일 작업을 만든다. 서버는 앱과 별도 프로세스라 앱을 꺼도 동작하지만, 사용자 컴퓨터를 끄면 멈추므로 별도 서버 배포가 필요하다. 단계별 진행 상태는 [백로그](docs/spec/gap-analysis.md)가 소유한다. 앱·사용자 컴퓨터 종료 중 별도 서버 자동화와 배포·서명·패키징도 검증 대상에 남아 있다. 브랜드 색상은 디자인 기초 소유 문서를 따르며 화면 레이아웃은 초기 개발안이다.

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
| `pnpm --filter @nextstep/server verify:jobkorea` | 잡코리아 네 직무 공개 공고 소량 조회(직무당 목록 1회·상세 3건, 요청 간 2.5초). 원문 없이 추출 결과·실패 구분만 출력. 공고 검증 명령은 모두 서버 DB의 수집 모드를 따르고 403·429를 받은 호스트에는 다시 요청하지 않음 |
| `pnpm --filter @nextstep/server invite` | 운영자용 초대 코드 발급(14일 유효, 1회용). 서버와 같은 DB에 해시만 저장하고 코드 원문은 이 출력에서만 보임 |
| `pnpm --filter @nextstep/server eval:recommend` | 추천 판정 프롬프트를 정답 사례 57건(합성)으로 실제 OpenAI에 보내 직무별 일치율·주입 사례 결과를 출력. 요금 발생 |
| `pnpm --filter @nextstep/server verify:wanted` | 개인 모드에서만 원티드 네 직무 공개 목록·상세 각 3건 조회. 서비스 모드면 요청 없이 종료 |
| `pnpm --filter @nextstep/server verify:jasoseol` | 개인 모드에서만 자소설닷컴 sitemap 최신 공고 상세 20건 조회. 서비스 모드면 요청 없이 종료 |
| `pnpm --filter @nextstep/server verify:mail-sync` | 임시 DB·임시 사용자로 실제 네이버 증분 동기화를 3회 실행해 건수·분류 분포·중복 수만 출력하고 임시 DB를 삭제. `NAVER_IMAP_USER`·`NAVER_IMAP_PASSWORD` 필요 |
| `pnpm --filter @nextstep/server verify:naver` | 네이버 IMAP 읽기 전용(EXAMINE) 조회. 제목·주소·본문 없이 편지함별 위치·건수·출처 도메인과 알림 메일의 공고 링크 확보 건수 집계만 출력. 원티드 추적 링크는 최대 5건 리다이렉트 위치만 확인 |

`pnpm dev:desktop`은 개발 실행이며 설치용 앱 패키지를 만들지 않는다. macOS 창 닫기는 창만 닫으며 메뉴의 ‘NextStep 종료’로 완전 종료한다. 서버는 독립 프로세스이므로 앱 종료가 서버 종료나 자동 OFF를 의미하지 않는다.

최초 실행 전에 포트가 비어 있는지 확인한다. 다른 서비스의 프로세스를 종료하지 않는다. API·웹 포트를 바꾸는 경우 관련 URL을 함께 맞춘다. Next CLI 포트는 해당 workspace 명령의 `--port`를 수정하거나 CLI로 별도 지정한다.

## 환경과 데이터

실제 값은 셸 환경 또는 무시된 환경 파일에 설정한다. 웹은 Next.js 환경 파일을, 서버의 `dev`·`start`·`eval:recommend`는 `apps/server/.env.local`(Node `--env-file-if-exists`, 셸 값이 우선)을 읽는다. Electron은 환경 파일을 자동 로드하지 않는다. [.env.example](.env.example)은 키 설명용이며 계정 비밀정보를 담지 않는다.

| 변수 | 소비자 | 기본값 / 의미 |
|---|---|---|
| NEXTSTEP_API_PORT | 서버 | 4100 |
| NEXTSTEP_DB_PATH | 서버 | 서버 실행 cwd의 `.data/nextstep.sqlite`. 공유하려면 절대 경로 지정 |
| NEXTSTEP_API_URL | 웹 서버 route | http://127.0.0.1:4100. 브라우저로 전달하지 않음 |
| NEXTSTEP_WEB_URL | Electron main | 개발 기본 http://127.0.0.1:3100. 패키징 실행은 소유 HTTPS 주소 필수 |
| NEXTSTEP_SECURE_COOKIE | 서버 | `1`이면 세션 쿠키에 Secure 지정. HTTPS 배포에서 필수, 로컬 HTTP 개발은 미지정 |
| OPENAI_API_KEY·NEXTSTEP_OPENAI_MODEL | 서버·`eval:recommend` | OpenAI 키와 모델 이름. 둘 다 있어야 AI 처리(프로필 초안·공고 조건 추출·추천 판정)가 동작. 없으면 AI 기능은 미설정 오류 |
| NEXTSTEP_SCHEDULE_HOUR | 서버 | 21. 한국 시간 기준 예약 실행 시작 시각(0~23) |
| NEXTSTEP_SECRET_KEY | 서버 | 선택. base64 32바이트 연결 비밀정보 암호화 키. 없으면 DB 옆 `secret.key`를 만들어 씀 |
| NAVER_IMAP_USER·NAVER_IMAP_PASSWORD | `verify:naver` | 동의한 계정의 주소·앱 비밀번호. 실행 셸에서만 지정하고 파일·로그에 남기지 않음 |

DB에는 서비스 메타데이터·수집 모드·계정(비밀번호는 scrypt 해시)·초대 코드 해시·세션 토큰 해시·지원 건·이력서 추출 본문·프로필을 저장한다. 이력서 원본은 DB 옆 `files/<사용자 ID>/`(디렉터리 0700, 파일 0600)에 두고 교체·삭제·계정 삭제 시 지운다. 파일 DB는 Git에서 제외하며 파일 권한은 0600, 새 디렉터리는 0700으로 생성한다. Node 내장 SQLite 사용 시 실험적 경고가 표시될 수 있다. private 파일·자격정보 보관 체계를 구현하기 전에는 실제 메일이나 이력서를 투입하지 않는다.

## 검증

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
```

| 명령 | 검증 범위 |
|---|---|
| `pnpm structure:check` | 의존 그래프·import 경계·symlink·규범 문서·skill·agent frontmatter·문서 상대 링크·금지 파일 추적 |
| `pnpm lint` | 전체 JS·TS·React ESLint, 경고도 실패 |
| `pnpm typecheck` | workspace·Storybook 설정·브라우저/Electron 테스트·Next route 타입 |
| `pnpm test:harness` | 구조 검사 자체의 위반 탐지 회귀 |
| `pnpm test` | harness·공통 계약·파일 DB/API·두 계정 격리·이력서 등록/실패 시 기존 유지/교체/삭제/파일 권한·프로필 검증·OpenAI 요청 형식과 응답 검증(로컬 모의 서버)·메일 규칙 판정·연결 검사·비밀번호 암호화 저장·증분 위치·중복 방지·상태 역행 방지·최종 결과 충돌·확인 목록 처리·연결 해제·AI 해석 분기(가짜 메일 소스·모의 AI)·예약 실행 조건·하루 한 번·OFF 정리·결과 표시·수집·추천 작업(가짜 출처·AI로 모드별 출처, 원문 미저장, 중복 작업 합치기, 같은 기준 재판정 생략, 링크 공고 사용자 전용, 재시작 복구)·초대 1회 사용/만료·세션 만료·로그인 실패 제한·계정 삭제 후 재생성 차단·이력서 추출(합성 텍스트·암호화·스캔·손상 PDF와 MD)·잡코리아 상세 구조 해석(합성 HTML)·메일 알림 공고 링크 추출·추천 정답 사례 구조·수집 모드 기본값·변경 유지·잘못된 값 거부·차단 호스트 재요청 중단·원티드/자소설닷컴 상세 해석(합성)·Electron URL 정책·토큰 참조/색상 대비 |
| `pnpm build` | 실제 빌드·Storybook 정적 출력 |
| `pnpm test:e2e` | 빌드된 로컬 웹·API 실행, Chromium에서 연결·503·재시도, 수집 모드 변경·재접속 유지·저장 실패 표시(끝나면 서비스로 복원), 초대 가입·재접속 유지·로그아웃·로그인 실패·계정 삭제, 교차 출처 변경 요청 거부, 지원 건 등록·검색·필터·공고 열기 후 상태 불변·수정 이력·재접속 유지·목록 오류 재시도. 이력서 등록·암호화 PDF 실패 시 유지·프로필 저장 유지·AI 미설정 표시, 갱신 작업 실패 사유 표시(실제 작업자), 링크 오류, 추천 카드 표시 규칙·지원 현황 저장(추천 응답은 모의). 로컬 DB에 테스트 계정을 만들고 삭제함. 한 번에 하나씩 실행 |
| `pnpm test:desktop` | macOS Electron 실행·권한 격리·창 닫기·완전 종료, 가입·지원 건 등록 후 앱 완전 종료·재실행 시 로그인·자료 유지. 격리된 임시 프로필 사용, 테스트 계정은 삭제 |

브라우저 테스트는 3100·4100을 독점하며 기존 서버를 재사용하지 않는다. 먼저 `pnpm build`를 완료한다. E2E의 503 응답은 오류 표시 검증을 위한 모의 실패다. DB 영속성 테스트는 임시 파일을 사용하고 종료 후 지운다. 실제 외부 연동을 검증하지 않는다.

CI는 설치·전체 검사·Chromium E2E를 수행한다. macOS Electron 실제 실행·완전 종료는 별도 확인한다. CI 성공과 브랜치 보호 설정은 별개다.

## 다음 작업

다음 착수 단계와 막는 결정은 [백로그](docs/spec/gap-analysis.md)를 따른다. 개인 Notion·메일·키체인·기존 Chrome 로그인 세션을 재사용하지 않는다.

기술 책임은 [TECH_RULES.md](TECH_RULES.md), 작업 규칙은 [AGENTS.md](AGENTS.md), 지원 체계와 검사 한계는 [AI_AGENT_HARNESS.md](docs/AI_AGENT_HARNESS.md)를 따른다.
