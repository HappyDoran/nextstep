# NextStep

취업·이직 준비자를 위한 맞춤 채용공고 추천·지원 관리 독립 서비스다. 운영자와 초대 사용자만 홈서버에서 비공개로 쓰며 [서비스 기획서](docs/spec/서비스기획서.md)가 요구·완료 조건, [기술 설계](docs/spec/기술설계.md)이 데이터·작업·보호 설계를 소유한다.

## 현재 구현 범위

기획 범위와의 차이(2026-11-14 개정 기준): AI는 서버의 로컬 LLM(Ollama qwen3:1.7b) 하나로 공고·서류·메일 정보 추출만 하고 추천 분류는 서버 규칙이 한다(사용자별 OpenAI 키 기능은 2026-11-15 제거). 자동 수집 다섯 곳·직무 여섯 개는 구현했으나 백엔드·QA·점핏은 실제 추천 흐름 검증 전이고, 메일은 네이버(조회 기간 선택·매시간 조회·과거 범위 넓히기 구현, 정기 누락 확인은 보류)이고, 추천 고급 필터·좋아요/별로·제외 복구, 지원 건 잠금, 확인 요청 보류·회사별 묶음·연결 제안, 지원 현황 CSV 가져오기를 구현했으며 서버는 아직 운영자 컴퓨터의 로컬 서버다. 데스크톱 상주 앱(Electron)은 macOS 개발 실행과 설치용 앱(`NextStep.app`) 실행을 확인했고, Windows용 압축 파일은 만들었으나 Windows 실행은 아직 확인하지 않았다. 단계별 상태는 [백로그](docs/spec/백로그.md)가 소유한다.

pnpm/Turborepo 모노레포, 웹 개발 화면, API·SQLite 준비 확인, DB 버전 관리, 공통 계약·UI·토큰과 Storybook을 구성했다. 디자인 기초는 원시 값·의미 색상·타입·간격·radius·그림자·모션 시간·이징·Lucide React 아이콘을 제공하며 선택한 브랜드와 Light/Dark를 카탈로그에서 비교할 수 있다. 웹의 연결 확인은 실제 로컬 API와 DB를 읽는다. 실패 후 재시도할 수 있다. 초대 코드 가입·이메일/비밀번호 로그인·로그아웃·계정 삭제, 지원 현황(직접 등록·검색·상태 필터·상세·상태/열람 수정과 변경 이력·삭제), 설정(계정·자동 갱신 ON/OFF 저장·연결 확인)이 웹에서 동작한다. 공고 열기는 기본 브라우저로 이동만 하고 지원 상태를 바꾸지 않는다. 서버에는 P1-01 기술 검증용 텍스트 PDF/MD 이력서 추출 모듈과 잡코리아 공고·네이버 IMAP 읽기 전용 검증 명령이 있으며 API에 연결하지 않았다. 서버 하나를 운영자와 초대 사용자가 쓰며, 공고는 갱신한 사용자 자료로만 저장한다.

설정에서 쓰는 로컬 AI 모델 확인(사용자가 등록할 키 없음), 이력서(필수)·경력기술서·포트폴리오(선택) 등록·교체·삭제(PDF·MD·Notion ZIP을 모두 MD로 변환, 이미지 쪽은 글자 인식(OCR), 변환된 MD 확인·수정, 추천에는 세 서류를 합쳐 사용)와 프로필·필터(AI 초안은 확인 후 저장)를 다룬다. 추천 화면의 새로 가져오기는 서버 작업자가 다섯 출처(사람인·잡코리아·원티드·자소설닷컴 자동 수집, 점핏은 개발 직무만이며 사람인과 같은 공고는 한 번만 저장)에서 그 사용자의 공고를 모으고 로컬 AI로 조건을 추출하고 규칙으로 판정한 결과(기본·도전·미확인·제외와 근거)를 보여 주며, 공고 링크 한 건 판정·관심 없음·지원 현황 저장을 제공한다. 공고 원문은 저장하지 않는다. 실제 흐름은 OpenAI(gpt-5.5) 시기에 검증했고 로컬 AI로는 정답 사례만 쟀다(검증 기록: docs/spec/검증기록.md). 설정의 네이버 메일 연결은 로그인 검사 후 애플리케이션 비밀번호를 암호화(AES-256-GCM, 키는 DB 옆 `secret.key` 0600 또는 `NEXTSTEP_SECRET_KEY`)해 저장하고, 작업자가 편지함별 위치로 증분 조회해 채용 메일을 규칙으로 판정한다. 공고 링크로 식별되는 지원 건에만 자동 반영하고 최종 결과 충돌·모호는 확인 목록으로 보낸다. 대상을 식별하지 못한 메일은 보관하고, 로컬 AI로 회사·직무를 해석해 지원 건 생성·연결·확인 요청으로 넘긴다(실제 메일 609건으로 qwen3:4b·qwen3:1.7b 정확도 측정). 자동 갱신이 켜진 사용자는 서버가 한국 시간 매일 `NEXTSTEP_SCHEDULE_HOUR`(기본 21시) 이후 한 번 공고 갱신 작업을, 매시간 메일 확인 작업을 만든다. 서버는 앱과 별도 프로세스라 앱을 꺼도 동작하지만, 사용자 컴퓨터를 끄면 멈추므로 별도 서버 배포가 필요하다. 단계별 진행 상태는 [백로그](docs/spec/백로그.md)가 소유한다. 앱·사용자 컴퓨터 종료 중 별도 서버 자동화와 배포·서명·패키징도 검증 대상에 남아 있다. 브랜드 색상은 디자인 기초 소유 문서를 따른다. 로그인 후 화면은 공통 틀(왼쪽 아이콘 메뉴·화면 머리·하단 상태바: 메일 마지막 확인과 공고 갱신 결과(처리 중에는 출처 진행·확인한 공고 수·남은 시간 어림), 실패 시 설정으로 안내)을 쓰고, 추천 화면은 마감 묶음(7일·2주·그 이후·상시·마감 미확인) 카드 줄과 상세 창으로, 지원 현황은 상태별·회사별 묶음(불합격은 처음에 접힘)·줄 안 상태 변경·상세 창·직접 등록과 CSV 창·등록 후 되돌리기로 바뀌었다. 확인 목록은 왼쪽 회사별 대기열·오른쪽 근거와 처리(처리 후 다음 항목으로 이동, 메일 전체 보기는 열 때만 메일함에서 읽고 저장하지 않음)로 바뀌었다. 설정은 어느 화면에서든 왼쪽 메뉴로 여는 창이고 창 왼쪽 구역 목록(계정·네이버 메일·서류·프로필·필터·자동 갱신·연결 상태)으로 한 구역씩 보인다. 주소 `#settings-<구역>`으로 바로 열리고(상태바 '연결 확인' → `#settings-status`), `/settings` 주소는 지원 현황 위에 창을 연다. 연결 상태 구역은 홈서버·DB와 로컬 AI(모델 설치 여부)를 확인할 때마다 묻고, 네이버 메일과 공고 출처 다섯 곳은 마지막 실행 결과(받은 공고 수, 일부 실패·실패와 사유별 건수)를 보여 준다. 로그인 전 화면은 왼쪽 인디고 소개 면과 오른쪽 양식으로 나뉜다. 테마는 운영체제의 밝게·어둡게 설정을 따른다.

## 설치와 실행

Node 24.22.1, pnpm 10.34.6을 사용한다. mise 사용 시 저장소 설정을 신뢰하고 실행한다.

```sh
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm dev
```

이미 해당 도구가 PATH에 있으면 `mise exec --`를 생략한다. 설치 시 Git hooks가 연결된다. 글로벌 도구 설정은 바꾸지 않는다.

상시 운영은 홈서버(`doran-server`)에서 한다(2026-11-20부터). 접속 주소는 `https://doran-server.tail70f0b3.ts.net`(Tailscale 사설망 HTTPS, `tailscale serve`가 127.0.0.1:3100으로 전달)이고, API·웹은 systemd 서비스 `nextstep-api`·`nextstep-web`(재부팅 후 자동 시작, 종료되면 재시작)로 `/srv/nextstep/app`에서 실행된다. 환경 변수는 `/srv/nextstep/nextstep.env`(0600), DB·`files/`·`secret.key`는 `/srv/nextstep/data/`에 있다. 로그는 서버에서 `journalctl -u nextstep-api`. 코드를 원격 저장소에 올린 뒤 Mac에서 배포한다.

```sh
sh scripts/home-deploy.sh   # 받기·설치·서버/웹 빌드·서비스 재시작
```

홈서버를 쓸 수 없을 때만 Mac에서 launchd로 띄운다(`pnpm build` 후 `sh scripts/mac-service.sh install`, `restart`·`uninstall`, 로그 `~/Library/Logs/nextstep/`). 홈서버와 동시에 켜면 예약 처리가 두 곳에서 돌므로 함께 쓰지 않는다.

로컬 AI(Ollama)를 쓰려면 `brew install ollama && brew services start ollama && ollama pull qwen3:1.7b`(Ubuntu는 Ollama 설치 스크립트). 모든 AI 처리는 이 로컬 모델로만 하며 외부 AI를 호출하지 않는다(사용자 키 없음).

서류의 이미지 쪽 글자 인식(OCR)은 시스템 도구를 쓴다. 없으면 OCR 없이 글자 없는 쪽만 경고한다. macOS: `brew install poppler tesseract tesseract-lang`, Ubuntu: `sudo apt install poppler-utils tesseract-ocr tesseract-ocr-kor`.

| 명령 | 동작 |
|---|---|
| `pnpm dev` | API 127.0.0.1:4100, 웹 127.0.0.1:3100 동시 실행 |
| `pnpm dev:desktop` | 데스크톱 상주 앱(Electron) 실행. 웹·API는 먼저 실행. 창은 웹을 그대로 열고, 창을 닫아도 macOS 메뉴 막대·Windows 알림 영역 아이콘으로 남아 1분마다 마지막 공고 갱신을 확인해 끝나면 OS 알림. 종료는 아이콘 메뉴의 'NextStep 종료'. 설치용 패키지는 만들지 않음 |
| `pnpm --filter @nextstep/desktop dist:mac` | 설치용 macOS 앱을 `apps/desktop/release/mac-arm64/NextStep.app`으로 만듦(서명 없음, 응용 프로그램 폴더에 복사해 사용). 처음 열 때 macOS가 확인되지 않은 개발자 경고를 내면 Finder에서 우클릭 → 열기 |
| `pnpm --filter @nextstep/desktop dist:win` | Windows x64용 압축 파일 `apps/desktop/release/NextStep-win-x64.zip`(서명·설치 프로그램 없음, 압축을 풀고 `NextStep.exe` 실행). Mac에서도 빌드됨 |
| `pnpm storybook` | 공통 UI 카탈로그 127.0.0.1:6006 실행 |
| `pnpm build` | 계약·UI·Storybook·서버·웹·데스크톱 main 컴파일 |
| `pnpm --filter @nextstep/server start` | 빌드된 API 실행 |
| `pnpm --filter @nextstep/web start` | 빌드된 웹 실행 |
| `pnpm --filter @nextstep/server verify:jobkorea` | 잡코리아 네 직무 공개 공고 소량 조회(직무당 목록 1회·상세 3건, 요청 간 2.5초). 원문 없이 추출 결과·실패 구분만 출력. 공고 검증 명령은 403·429를 받은 호스트에는 다시 요청하지 않음 |
| `pnpm --filter @nextstep/server invite` | 운영자용 초대 링크 발급(`NEXTSTEP_WEB_URL/?invite=코드`, 14일 유효, 1회용). 서버와 같은 DB에 코드 해시만 저장하고 링크는 이 출력에서만 보임. 링크를 연 사람은 코드 입력 없이 이메일·비밀번호만 정해 가입하고, 가입 후 주소에서 코드를 지움 |
| `pnpm --filter @nextstep/server eval:recommend` | 정답 사례 57건(합성)의 공고 조건·지원자 사실을 로컬 AI로 추출하고 규칙으로 분류해 직무별 일치율·주입 사례·오판 근거를 출력(조정용 74건, `EVAL_SET=holdout`이면 검증용 20건) |
| `pnpm --filter @nextstep/server verify:saramin` | 사람인 네 직무 공개 검색 목록 1회·상세 3건 조회(요청 간 2.5초). 원문 없이 추출 결과·본문 길이·실패 구분만 출력 |
| `pnpm --filter @nextstep/server verify:wanted` | 원티드 네 직무 공개 목록·상세 각 3건 조회 |
| `pnpm --filter @nextstep/server verify:jumpit` | 점핏 개발 직무(프론트엔드·앱 개발·백엔드·QA) 공개 목록·상세 각 3건 조회. 원문 없이 추출 결과·본문 길이·실패만 출력 |
| `pnpm --filter @nextstep/server verify:jasoseol` | 자소설닷컴 네 직무 공개 직무별 목록·상세 각 2건 조회 |
| `pnpm --filter @nextstep/server verify:recommend-flow [--all-families] [링크…]` | 임시 DB·합성 이력서로 실제 출처 수집과 로컬 AI 조건·지원자 추출, 규칙 분류를 한 번 실행하고 공개 공고 제목·분류·근거 요약만 출력 후 삭제. `--all-families`는 여섯 직무 전체. 출처 요청 발생 |
| `pnpm --filter @nextstep/server verify:mail-sync [-- --ai]` | 임시 DB·임시 사용자로 실제 네이버 증분 동기화를 3회(`--ai`면 로컬 AI 해석 포함 1회) 실행해 건수·분류 분포·중복 수만 출력하고 임시 DB를 삭제. `NAVER_IMAP_USER`·`NAVER_IMAP_PASSWORD` 필요 |
| `pnpm --filter @nextstep/server verify:naver` | 네이버 IMAP 읽기 전용(EXAMINE) 조회. 제목·주소·본문 없이 편지함별 위치·건수·출처 도메인과 알림 메일의 공고 링크 확보 건수 집계만 출력. 원티드 추적 링크는 최대 5건 리다이렉트 위치만 확인 |


최초 실행 전에 포트가 비어 있는지 확인한다. 다른 서비스의 프로세스를 종료하지 않는다. API·웹 포트를 바꾸는 경우 관련 URL을 함께 맞춘다. Next CLI 포트는 해당 workspace 명령의 `--port`를 수정하거나 CLI로 별도 지정한다.

## 환경과 데이터

실제 값은 셸 환경 또는 무시된 환경 파일에 설정한다. 웹은 Next.js 환경 파일을, 서버의 `dev`·`start`·`eval:recommend`는 `apps/server/.env.local`(Node `--env-file-if-exists`, 셸 값이 우선)을 읽는다. [.env.example](.env.example)은 키 설명용이며 계정 비밀정보를 담지 않는다.

| 변수 | 소비자 | 기본값 / 의미 |
|---|---|---|
| NEXTSTEP_API_PORT | 서버 | 4100 |
| NEXTSTEP_DB_PATH | 서버 | 서버 실행 cwd의 `.data/nextstep.sqlite`. 공유하려면 절대 경로 지정 |
| NEXTSTEP_API_URL | 웹 서버 route | http://127.0.0.1:4100. 브라우저로 전달하지 않음 |
| NEXTSTEP_WEB_URL | 초대 링크 발급·데스크톱 앱이 여는 주소 | 개발 기본 http://127.0.0.1:3100. 홈서버에서는 사설망 HTTPS 주소로 지정. 데스크톱 앱은 원격이면 HTTPS만 허용하고, 환경 변수가 없으면 앱 사용자 데이터 폴더의 `settings.json`의 `webUrl`을 읽음 |
| NEXTSTEP_SECURE_COOKIE | 서버 | `1`이면 세션 쿠키에 Secure 지정. HTTPS 배포에서 필수, 로컬 HTTP 개발은 미지정 |
| NEXTSTEP_OLLAMA_URL·NEXTSTEP_OLLAMA_MODEL | 서버·평가·검증 명령 | 로컬 Ollama 주소 http://127.0.0.1:11434, 모델 qwen3:1.7b |
| NEXTSTEP_AI_FAKE·NEXTSTEP_AI_CACHE_DIR | 서버(개발용, 운영에서 켜지 않음) | 개발 시간 절감. `NEXTSTEP_AI_FAKE=1`은 로컬 AI 대신 스키마에 맞는 고정 응답(화면·흐름 개발), `NEXTSTEP_AI_CACHE_DIR`(예: `.data/ai-cache`)은 같은 모델·지시·입력의 응답을 파일(0600)로 재사용. 판정은 규칙이라 상한이 없다. 캐시에는 추출 결과(회사명 등)가 남으므로 개발 중에만 쓰고 필요 없으면 폴더를 지운다 |
| NEXTSTEP_SCHEDULE_HOUR | 서버 | 21. 한국 시간 기준 예약 실행 시작 시각(0~23) |
| NEXTSTEP_SECRET_KEY | 서버 | 선택. base64 32바이트 연결 비밀정보 암호화 키. 없으면 DB 옆 `secret.key`를 만들어 씀 |
| NAVER_IMAP_USER·NAVER_IMAP_PASSWORD | `verify:naver` | 동의한 계정의 주소·앱 비밀번호. 실행 셸에서만 지정하고 파일·로그에 남기지 않음 |

DB에는 서비스 메타데이터·계정(비밀번호는 scrypt 해시)·초대 코드 해시·세션 토큰 해시·지원 건·이력서 추출 본문·프로필을 저장한다. 이력서 원본은 DB 옆 `files/<사용자 ID>/`(디렉터리 0700, 파일 0600)에 두고 교체·삭제·계정 삭제 시 지운다. 파일 DB는 Git에서 제외하며 파일 권한은 0600, 새 디렉터리는 0700으로 생성한다. Node 내장 SQLite 사용 시 실험적 경고가 표시될 수 있다. private 파일·자격정보 보관 체계를 구현하기 전에는 실제 메일이나 이력서를 투입하지 않는다.

## 검증

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
```

| 명령 | 검증 범위 |
|---|---|
| `pnpm structure:check` | 의존 그래프·import 경계·symlink·규범 문서·skill·agent frontmatter·문서 상대 링크(기획서 기록본 제외)·기획서 버전과 최신 기록본 일치·금지 파일 추적 |
| `pnpm lint` | 전체 JS·TS·React ESLint, 경고도 실패 |
| `pnpm typecheck` | workspace·Storybook 설정·브라우저 테스트·Next route 타입 |
| `pnpm test:harness` | 구조 검사 자체의 위반 탐지 회귀 |
| `pnpm test` | harness·공통 계약·파일 DB/API·두 계정 격리·이력서 등록/실패 시 기존 유지/교체/삭제/파일 권한/글자 없는 쪽 경고 저장·프로필 검증·로컬 AI(Ollama) 요청 형식·한 번 재질의·모델 미설치/연결 실패 구분·응답 캐시(로컬 모의 서버)·DB 버전 15 OpenAI 키 표 삭제·지원 현황 CSV 가져오기(중복·형식 오류·확인 요청 재연결·사용자 격리)·확인 요청 회사·연결 제안·메일 추천 영역 제외·제목에서 회사 읽기·회사명 오인식 대조·메일 규칙 판정·연결 검사·비밀번호 암호화 저장·증분 위치·중복 방지·상태 역행 방지·최종 결과 충돌·확인 목록 처리·연결 해제·AI 해석 분기(가짜 메일 소스·모의 AI)·예약 실행 조건·하루 한 번·OFF 정리·결과 표시·작업 중 계정 삭제 경합·30일 보관 기한 정리·수집·추천 작업(가짜 출처·AI로 세 출처 수집, 사용자별 공고 저장·비공유, 원문 미저장, 중복 작업 합치기, 같은 기준 재판정 생략, 링크 공고 사용자 전용, 재시작 복구)·초대 1회 사용/만료·세션 만료·로그인 실패 제한·계정 삭제 후 재생성 차단·이력서 추출(합성 텍스트·일부 이미지 쪽·암호화·스캔·손상 PDF와 MD)·잡코리아·사람인 상세 구조 해석(합성 HTML)·메일 알림 공고 링크 추출·추천 정답 사례 구조·DB 버전 10 공용 공고 정리·차단 호스트 재요청 중단·원티드/자소설닷컴/점핏 상세 해석(합성)·데스크톱 앱 주소·외부 링크 정책과 갱신 알림 판단(한 번만, 끝난 작업만, 실패 구분)·마지막 갱신 조회(`/jobs/latest`, 사용자별)·메일 전체 보기(`/reviews/:id/body`, 본인 것만·저장 안 함·no-store)·연결 상태(`/settings/connections`, 출처별 일부 실패·AI 연결 실패·사용자별)·출처 요청 연결 끊김 한 번 재시도·갱신 진행 기록(끝낸 출처 묶음 수·남은 시간)·토큰 참조/색상 대비 |
| `pnpm build` | 실제 빌드·Storybook 정적 출력 |
| `pnpm test:e2e` | 빌드된 로컬 웹·API 실행, Chromium에서 연결·503·재시도, 초대 링크 가입(코드 입력 숨김·주소에서 코드 제거)·초대 코드 가입·재접속 유지·로그아웃·로그인 실패·계정 삭제, 교차 출처 변경 요청 거부, 지원 건 등록 창·검색·필터·공고 열기 후 상태 불변·상세 창 수정 이력·줄 안 상태 변경·불합격 묶음 접힘·재접속 유지·목록 오류 재시도. 이력서 등록·암호화 PDF 실패 시 유지·프로필 저장 유지·AI 실패 안내·로컬 AI 모델 표시, 갱신 작업 실패 사유 표시(실제 작업자), 링크 판정 창의 링크 오류, 추천 줄을 눌러 여는 상세 창의 표시 규칙·지원 현황 저장·제외 복구(추천 응답은 모의). 임시 DB와 닿지 않는 Ollama 주소로 서버를 띄워 개발 DB·실제 AI와 분리. 한 번에 하나씩 실행 |

브라우저 테스트는 3100·4100을 독점하며 기존 서버를 재사용하지 않는다. 먼저 `pnpm build`를 완료한다. E2E의 503 응답은 오류 표시 검증을 위한 모의 실패다. DB 영속성 테스트는 임시 파일을 사용하고 종료 후 지운다. 실제 외부 연동을 검증하지 않는다.

CI는 설치·전체 검사·Chromium E2E를 수행한다. CI 성공과 브랜치 보호 설정은 별개다.

## 다음 작업

다음 착수 단계와 막는 결정은 [백로그](docs/spec/백로그.md)를 따른다. 개인 Notion·메일·키체인·기존 Chrome 로그인 세션을 재사용하지 않는다.

기술 책임은 [TECH_RULES.md](TECH_RULES.md), 작업 규칙은 [AGENTS.md](AGENTS.md), 지원 체계와 검사 한계는 [AI_AGENT_HARNESS.md](docs/AI_AGENT_HARNESS.md)를 따른다.
