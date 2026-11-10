---
title: 다음 세션 할 일
kind: handoff
last_verified: 2026-11-10
---

# 다음 세션 할 일

다음 세션에서 이어서 할 순서만 적는다. 단계별 상태와 완료 기준은 [백로그](docs/spec/gap-analysis.md)가 소유하므로, 끝낸 항목은 이 문서가 아니라 백로그에 기록하고 이 문서에서는 지운다.

## 1. 다른 로컬에서 실행 준비

```sh
git clone git@github-personal:HappyDoran/nextstep.git && cd nextstep
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm build
mise exec -- pnpm dev                                    # API 4100, 웹 3100
mise exec -- pnpm --filter @nextstep/server invite       # 별도 터미널, 가입용 초대 코드
```

- 환경 파일 없이 실행된다. DB·`secret.key`·이력서 파일은 `apps/server/.data/`에 새로 생긴다(커밋 제외).
- 3100·4100 포트가 비어 있는지 먼저 확인한다.

## 2. 실제 사용 확인 (사용자 수행)

1. 초대 코드로 가입한다.
2. 설정 → OpenAI 키·모델: 실제 키를 등록한다. 잘못된 키가 원인과 함께 거부되는지도 본다. 확인되면 P1-08이 끝난다.
3. 설정 → 이력서·프로필·필터를 저장한다.
4. 추천 → 새로 가져오기: AI 실패 0건인지, 판정 근거가 유용한지 본다(P1-04 남은 확인).
5. 설정 → 메일: 네이버 앱 비밀번호를 새로 발급해 연결한다(2단계 인증 → 애플리케이션 비밀번호, 이전 비밀번호는 삭제). 메일 해석이 내 키로 동작하는지 본다.
6. 자동 갱신을 켜 두고, 앱을 닫은 동안 21시 예약 처리가 되는지 본다(P1-06).
7. 막힌 화면은 화면에 나온 문구를 그대로 기록해 다음 세션에 가져온다.

## 3. 이후 (사용자 결정·외부 회신 대기)

- 운영자 2주 매일 사용 기록, 이후 지인 1~2명 초대(P1-07 완료 조건 9).
- 사람인 OpenAPI 승인, 원티드·자소설닷컴 문의 회신 확인.
- 홈서버 장비 결정 후 P1-09 착수.
