# 디자인 기초

NextStep의 브랜드 색상은 인디고이며 기본색은 #4F46E5로 선택했다. Light/Dark의 액션·포커스·보조 면에 같은 계열을 사용하고 성공·경고 등 상태색은 별도 의미를 유지한다. Storybook에서 선택한 인디고와 이전 후보를 비교할 수 있다. 타입 크기·테마의 세부 조정과 제품 화면 설계는 아직 진행 중이다. 실제 계정·공고·메일 데이터는 사용하지 않는다.

## 값과 사용처

- `src/primitives.css`: 원시 팔레트, 간격, 폰트 크기·두께, radius, shadow, duration·easing의 소유자.
- `src/tokens.css`: 배경·글자·액션·피드백·포커스, 타입 역할, 크기의 의미 토큰. Light가 기본이며 `data-ns-theme="dark"` 범위에서 테마 값을 바꾼다. 앱 설정 기능은 아직 없다.
- `src/styles.css`: 로컬 Pretendard Variable과 토큰을 불러오는 전역 진입점. 컴포넌트·타입·아이콘 CSS 클래스는 정의하지 않는다.
- `src/tailwind-preset.ts`: CSS 값을 복제하지 않고 색상·타입·간격·크기·stroke·포커스·그림자·모션의 Tailwind 이름에 연결한다.
- `src/Foundations.stories.tsx`: 기초 항목과 브랜드 후보의 시각 비교. 후보별 override는 Storybook에만 둔다.

웹에서 `@nextstep/design-system/styles.css`를 한 번 불러온다. Tailwind에는 `@nextstep/design-system/tailwind-preset`을 연결한다. 순수 변수만 필요하면 `@nextstep/design-system/tokens.css`를 사용한다. 제품 색상은 원시 팔레트가 아니라 의미 토큰으로 소비한다. 서버 상태·API·도메인 판정은 이 패키지에 넣지 않는다.

본문을 읽기 위한 타이포와 제목·보조·mono 역할을 분리한다. micro 크기는 장식적인 보조 레이블용이며 공고·근거·필수 안내 본문에 쓰지 않는다. 시스템 글꼴을 fallback으로 유지하며 웹 폰트는 외부 CDN에 요청하지 않는다.

## 아이콘

Lucide React에서 필요한 아이콘을 정적으로 직접 import한다. 전체 아이콘 레지스트리·이름 매핑·별도 래퍼를 만들지 않는다. 크기는 `size-icon-xs/sm/base/md/lg`, 기본 선은 `stroke-icon`, 강조와 작은 크기는 `stroke-emphasis`를 사용한다. 아이콘은 `shrink-0`으로 축소를 막고 현재 글자색을 상속한다. 회전은 `animate-spin motion-reduce:animate-none`으로 처리한다. 실제 크기와 선 두께의 정답은 tokens.css가 소유한다.

텍스트 옆의 장식 아이콘은 `aria-hidden="true" focusable="false"`로 표시한다. 아이콘만 있는 버튼은 버튼에 행동을 설명하는 `aria-label`을 둔다. 의미를 아이콘·색상 하나로만 전달하지 않는다. 회전은 처리중 표시에서만 사용하고 동작 감소 설정에서는 멈춘다.

## 확인

실행·검증 명령은 루트 README.md가 소유한다. 토큰 테스트는 참조 누락·순환과 Light/Dark의 주요 색상 대비를 확인한다. 자동 계산이 전체 UI의 WCAG 준수나 브라우저 시각 검토를 대신하지 않는다. 색상·타이포·간격·radius·그림자·모션·아이콘은 Storybook에서 실제 렌더링해 확인한다.

## 현재 적용 기준

Light/Dark 모두 background·foreground, card·popover, primary·secondary·muted·accent, destructive, border·border-strong·input·ring, success·warning·info·highlight 역할을 제공한다. CSS 변수 이름은 `--ns-color-<역할>`이다. 회색은 따뜻한 계열(Light 배경 #f7f6f3, Dark 배경 #161513)이다.

추천 분류는 `class-basic`·`class-challenge`·`class-unknown`·`class-exclude`(각각 `-muted` 배경)로 쓴다. 값은 success·warning·muted-foreground·destructive를 그대로 가리키므로 분류 색을 바꾸려면 이 별칭만 고친다. 분류는 색만으로 구분하지 않고 글자와 함께 표시한다.

밀도와 앱 틀(2026-11-18 와이어프레임 확정): 컨트롤 높이 40px(`h-control`), 작은 컨트롤 32px(`h-control-sm`), 컨트롤 모서리 10px, 카드 16px(`rounded-surface`), 대화 창 20px(`rounded-dialog`), 왼쪽 아이콘 메뉴 폭 `w-rail`, 화면 머리 `h-header`, 하단 상태바 `h-statusbar`, 본문 최대 폭 `max-w-content`. 브랜드 강조와 success·info는 별도 역할이며 상태 색상은 지원 결과를 자동 판정하지 않는다.

타입 역할은 Display·Title Lg·Title·Body Lg·Body·Body Sm·Caption·Micro·Mono다. 긴 공고·근거를 읽는 제품 특성에 맞춰 기본 본문 크기와 줄간격을 확보한다. 상세 수치의 정답은 tokens.css에만 둔다. 브랜드 색상 선택은 완료했으며 제품 화면·로고·전체 브랜드 가이드 완성을 의미하지 않는다.

spring 설계값과 애니메이션 라이브러리는 제스처 동작을 구현할 때 추가하며 단위·질량·초기 속도·중단/역전·최종 정지 상태를 함께 검증한다. CSS 일반 전환과 spring은 같은 실행 방식이 아니다.

진입은 ease-out, 위치 전환은 ease-in-out, hover는 ease를 기본으로 한다. ease-in으로 진입을 늦추지 않는다. 반복 키보드 작업은 진입 애니메이션을 생략한다. 이동은 transform·opacity로 처리하고 레이아웃 크기를 애니메이션하지 않는다. 동작 감소 설정에서는 이동·spring·회전을 없애고, 필요한 시각 전환만 base 길이의 opacity로 처리한다. 실제로 존재하는 버튼·로더에는 현재 가능한 범위의 포커스·전환·동작 감소 처리를 적용했다. 팝오버·모달·드래그 등은 실제 구현 시 이 기준으로 검증한다.

## Tailwind 사용 계약

화면·공통 컴포넌트·Storybook은 같은 Tailwind preset을 사용한다. styled-components나 다른 CSS-in-JS 런타임은 사용하지 않는다. CSS 변수로 값을 보관하는 것은 별도 스타일링 프레임워크 도입이 아니다. 테마 값을 바꾸면 같은 유틸리티를 사용하는 화면에 적용된다.

```tsx
<p className="text-body text-foreground">추천 근거를 확인하세요.</p>
<Search className="size-icon-md shrink-0 stroke-icon" aria-hidden="true" focusable="false" />
```

타입은 `text-display`, `text-title-lg`, `text-title`, `text-body-lg`, `text-body`, `text-body-sm`, `text-caption`, `text-micro`, `font-mono text-mono`로 사용한다. 각 text 역할은 크기·줄간격·굵기·자간을 함께 적용한다. 기본 굵기를 유지할 때 불필요한 font-normal 등을 덧붙이지 않는다.

앱의 Tailwind content에는 앱 소스와 공통 UI 패키지 소스를 모두 등록한다. Storybook은 자체 PostCSS/Tailwind 설정으로 같은 preset을 컴파일한다. 런타임 문자열 조합으로 유틸리티 이름을 만들지 말고, 여러 크기·역할이 필요하면 완전한 클래스 문자열을 정적으로 매핑한다.

CSS는 토큰·폰트·전역 base와 Storybook의 후보 토큰 override에 사용한다. 카탈로그의 배치 규칙도 @apply로 같은 Tailwind 유틸리티를 소비한다. 색상표 등 런타임 토큰 값을 시각화하는 샘플의 inline style은 카탈로그 용도이며 제품 스타일의 기본 작성 방식으로 사용하지 않는다.
