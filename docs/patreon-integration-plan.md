# Patreon 연동 구현 계획

> 상태: 단계 A 로컬 구현 완료 · 공개 배포 및 단계 B 인터뷰 대기
> 최종 갱신: 2026-08-25
> 대상 origin: `https://about.bluehair.blue`
> 문서 목적: Patreon을 후원·관계 관리 레이어로 연결하고, 공개 제작로그를 포트폴리오에 안전하게 반영하기 위한 결정과 구현 계약을 누적한다.

## 1. 목표

이 연동의 목표는 Patreon을 포트폴리오 안에 복제하는 것이 아니다.

```text
AI 채팅 플랫폼
→ Portfolio: 작품 발견, 작가 브랜드, 공개 아카이브
→ Patreon: 무료 팔로우, 댓글, 알림, 후원 관계
```

포트폴리오는 브랜드와 공개 콘텐츠의 본진으로 유지한다. Patreon은 후원과 커뮤니티를 담당한다. Patreon 멤버십을 AI 채팅 접근권, 잠금 해제, 외부 성인 AI 서비스의 결제 수단으로 사용하지 않는다.

### 성공 조건

- 방문자가 사이트의 기존 언어와 디자인 안에서 후원 목적을 이해한다.
- Patreon으로 이동하기 전 가격·혜택·외부 이동 여부를 오해하지 않는다.
- 선택한 Patreon 공개 글만 포트폴리오에 노출된다.
- Patreon 장애나 토큰 만료가 포트폴리오 전체 장애로 번지지 않는다.
- 운영자는 Patreon에서 한 번 게시하는 흐름을 유지한다.
- 기존 DOM, 모션, 반응형, 다국어 계약을 보존한다.

## 2. 현재까지 확정한 제품 원칙

| ID | 결정 | 상태 |
| --- | --- | --- |
| P-01 | Patreon은 후원·관계 관리 레이어다. | 확정 |
| P-02 | Patreon 멤버십은 AI 채팅 접근권이나 잠금 해제를 제공하지 않는다. | 확정 |
| P-03 | 댓글, 무료 팔로우, 알림은 초기에는 Patreon에 둔다. 자체 댓글·계정은 만들지 않는다. | 확정 |
| P-04 | 자동 게시 방향은 `Patreon → Portfolio`만 검토한다. | 확정 |
| P-05 | 포트폴리오는 `ko / ja / en` 경험을 유지한다. | 확정 |
| P-06 | Patreon 원문, 댓글, 결제 UI를 iframe으로 삽입하지 않는다. 자체 카드와 외부 링크를 사용한다. | 권장 기본값 |
| P-07 | Patreon 정책·API·Webhook 세부 규격은 구현 직전 공식 문서로 다시 검증한다. | 필수 검증 |

## 3. 현재 사이트 기준선

현재 사이트에는 Patreon 클라이언트, API route, Webhook, 서버 저장소, 인증, D1, R2가 없다.

```text
siteContent[locale]
→ Home
→ 섹션별 copy props
→ DOM
```

- `app/page.tsx`는 locale과 섹션 조합만 담당한다.
- 번역과 정적 콘텐츠의 단일 출처는 `app/content.ts`다.
- `#support`는 준비 중인 후원 옵션 두 행을 이미 제공한다.
- `#now`와 hero showcase는 현재 같은 정적 `UpdateItem[]`을 사용한다.
- 브라우저 상태는 locale만 저장한다.
- Worker는 현재 Vinext handler를 그대로 export한다.

### 변경하면 안 되는 계약

- `.support-row`는 `.support-panel`의 직접 자식으로 유지한다.
- support 행 순서를 바꾸면 animation range와 테스트를 함께 검토한다.
- `.update-copy`는 `번호 문단 → 제목 → 설명 문단` 순서를 유지한다.
- `app/globals.css` import 순서를 유지한다.
- desktop/mobile 전환 경계 `52rem`을 유지한다.
- reduced-motion 최종 override 뒤에 새 animation 규칙을 추가하지 않는다.
- `app/page.tsx`에 섹션 구현을 넣지 않는다.

## 4. 권장 릴리스 구조

최종 자동 동기화 구조를 한 번에 배포하지 않고, 사용 가능한 Patreon 페이지와 실제 공개 글을 기준으로 단계를 연다.

### 단계 A — 후원 진입점

기존 `#support`에 Patreon 멤버십 CTA를 연결한다.

예상 변경 범위:

- `app/content.ts`: 세 언어의 CTA 문구, 설명, Patreon URL
- `app/components/support-section.tsx`: 기존 행 구조를 보존한 외부 링크
- support 관련 CSS: 링크 상태에 필요한 최소 변경만 허용
- 렌더 테스트: URL, 외부 링크 속성, DOM 순서 검증

이 단계에서는 Worker, D1, 새 의존성, 관리자 화면을 추가하지 않는다.

#### 단계 A 구현 결과 — 2026-08-25

- 공개 Patreon URL `https://www.patreon.com/bluehairblue`를 API v2로 확인하고 CTA에 연결했다.
- 현재 Patreon 상태는 공개된 Free 티어 1개, 게시물 0개다.
- 존재하지 않는 유료 가격이나 혜택은 사이트에 표시하지 않았다.
- `ko / ja / en`에 공개 제작로그, Patreon CTA, AI 채팅 이용권 비포함 안내를 반영했다.
- 새 탭 안내, 키보드 focus, 44px 최소 링크 높이, 명시적 밑줄을 적용했다.
- `.env*`는 Git에서 제외되고 개발에서만 사용한다. production build에는 로컬 secret이 포함되지 않으며 `.dev.vars*`가 있으면 build가 즉시 실패한다.
- lint, production build, 렌더·DOM·secret 회귀 테스트 6개를 통과했다.
- `http://localhost:3000/`에서 응답 200과 CTA 렌더를 확인했다.
- 공개 배포는 아직 수행하지 않았다.

### 단계 B — 공개 제작로그 동기화

Patreon에 실제 공개 제작로그가 쌓이고 자동 반영이 필요할 때 연다.

잠정 목표 흐름:

```text
Patreon에서 게시
→ 사이트 노출을 명시한 공개 글만 선택
→ 서버 측에서 검증·정규화
→ 내구성 있는 저장소에 반영
→ 포트폴리오가 안전한 메타데이터만 조회
→ #now 카드에서 Patreon 원문으로 이동
```

자동 동기화를 선택하면 Webhook 이벤트의 중복, 수정, 삭제, 재시도, 토큰 갱신 상태를 저장해야 한다. 이 경우 D1은 캐시 최적화가 아니라 동기화 상태의 일부로 추가한다.

초기 카드 후보 필드:

```ts
type PatreonUpdate = {
  id: string;
  kind: "note" | "production" | "release" | "review";
  title: string;
  publishedAt: string;
  url: string;
};
```

본문 HTML, 댓글, 회원 정보, 결제 정보는 동기화하지 않는 것을 기본값으로 둔다. Patreon 미디어 URL을 영구 자산처럼 직접 사용하지 않는다.

### 단계 C — 운영 복구와 관측

Webhook을 실제 운영할 때만 누락 복구와 상태 관측을 추가한다.

- 정기 reconciliation으로 Webhook 누락 복구
- 구조화 로그와 마지막 성공 시각 기록
- 토큰 갱신 실패 및 연속 동기화 실패 알림
- 수동 전체 재동기화 절차

별도 `/__ops/patreon` 관리자 UI는 운영 로그만으로 복구가 어렵다는 실제 필요가 확인되기 전에는 만들지 않는다.

## 5. 아직 확정하지 않은 핵심 경계

### 첫 배포 범위

결정: `A → B`

- 단계 A: Patreon CTA를 먼저 공개한다.
- 단계 B: 실제 글과 운영 규칙을 검증한 뒤 자동 동기화를 구현한다.

정적 링크로 브랜드·문구·전환을 먼저 검증하면서, 자동 동기화는 실제 Patreon 데이터로 설계하고 시험한다.

### `#now`와 hero의 관계

현재 두 UI는 같은 `UpdateItem[]`을 공유한다. Patreon 글을 그대로 기존 배열에 합치면 모든 공개 글이 hero carousel에도 들어갈 수 있다.

권장 기본값:

- hero showcase: 브랜드 대표 업데이트를 수동 큐레이션
- `#now`: Patreon 공개 제작로그를 최신순으로 표시

이 선택이 확정되면 Patreon feed를 실제 두 번째 콘텐츠 축으로 분리한다. 전역 Context나 새 상태 라이브러리는 추가하지 않는다.

### 공개 선택 규칙

단순히 Patreon에서 공개된 모든 글을 가져오지 않는다. 운영 실수를 막기 위한 명시적 opt-in 규칙이 필요하다.

후보:

- 제목 prefix
- Patreon tag
- 운영자가 관리하는 allowlist

실제 Patreon API가 안정적으로 제공하는 필드를 공식 문서와 샘플 응답으로 검증한 뒤 가장 단순한 규칙 하나를 고른다.

### 다국어

다음 중 하나를 선택해야 한다.

- 한 게시물 안의 `한국어 / 日本語 / English` 블록에서 locale별 제목·요약 추출
- 모든 locale에서 공통 제목만 표시하고 Patreon에서 전체 언어 블록 제공
- 포트폴리오용 번역 요약을 별도로 수동 관리

자동 번역은 초기 범위에 넣지 않는다.

### 장애 시 화면

권장 기본값은 마지막 정상 snapshot을 계속 제공하는 것이다. Patreon 요청 실패를 방문자 요청 경로에 직접 연결하지 않는다. 저장된 항목이 전혀 없을 때만 정적 빈 상태와 Patreon 제작로그 링크를 표시한다.

## 6. 보안·정책 경계

- Patreon API token과 secret은 브라우저 번들, 저장소, 일반 공개 설정에 넣지 않는다.
- 로컬 `.env*`는 개발에서만 사용한다. production build는 dotenv를 `dist/server/.dev.vars`로 복사하지 않도록 차단하고, `.dev.vars*`가 있으면 fail-closed로 중단한다.
- Webhook을 도입하면 서명 검증 전 payload를 신뢰하거나 처리하지 않는다.
- 서명 검증에는 제공자가 요구하는 원본 request body를 사용한다.
- 외부 HTML을 `dangerouslySetInnerHTML`로 렌더링하지 않는다.
- 사이트에는 공개 글의 최소 메타데이터만 노출한다.
- 회원, 이메일, 결제, 댓글 데이터는 수집하지 않는다.
- 공개 CTA와 제작로그는 SFW 브랜드 경로로 설계한다.
- Patreon 정책, API v2 endpoint, Webhook 이벤트·서명, token 갱신, rate limit, custom domain 지원은 구현 직전 공식 자료로 다시 확인한다.

## 7. 구현 전 인터뷰 순서

한 번에 한 결정만 확정하고 이 문서의 결정표와 단계별 계약을 갱신한다.

1. 첫 배포 완료 범위
2. Patreon 페이지와 공개 글의 준비 상태
3. 사이트에 노출할 글의 선택 규칙과 카드 정보
4. `#now`와 hero의 콘텐츠 분리 여부
5. 세 언어 게시·표시 방식
6. 허용 가능한 반영 지연과 장애 fallback
7. 클릭 측정, 운영 알림, 개인정보 경계
8. 구현·마이그레이션·배포 순서와 완료 검증

## 8. 결정 로그

| 날짜 | ID | 질문 | 결정 | 영향 |
| --- | --- | --- | --- | --- |
| 2026-08-25 | D-001 | Patreon의 역할은 무엇인가? | 후원·관계 관리 레이어 | 사이트 내 결제·댓글·회원 시스템 제외 |
| 2026-08-25 | D-002 | 게시의 기준 원본은 어디인가? | Patreon에서 작성하고 Portfolio로 반영 | 역방향 자동 게시 제외 |
| 2026-08-25 | D-003 | 첫 배포 범위는 어디까지인가? | `A → B` | CTA 완료 후 자동 동기화 착수 |
| 2026-08-25 | D-004 | 단계 A에서 어떤 Patreon 상태를 표시하는가? | 공개 페이지와 Free 티어의 현재 상태만 표시 | 존재하지 않는 유료 가격·혜택을 표시하지 않음 |
| 2026-08-25 | D-005 | 로컬 Patreon secret을 build에 어떻게 격리하는가? | 개발에서는 `.env*`를 사용하고 production build에서는 dotenv 로드를 차단하며 `.dev.vars*`가 있으면 실패 | Sites 패키지에 로컬 secret이 포함되지 않도록 fail-closed |

## 9. 단계별 완료 계약

모든 구현 단계에서 공통으로:

```text
npm run lint
npm test
npm run build
```

- support DOM 순서와 update DOM 순서를 회귀 테스트한다.
- 세 locale의 문구와 링크를 함께 검증한다.
- reduced-motion과 `52rem` 반응형 경계를 확인한다.
- 배포 단계에서는 canonical, Open Graph, 정적 자산과 실제 응답 origin이 모두 `https://about.bluehair.blue`인지 확인한다.
- D1이나 runtime secret을 추가하는 단계에서는 `wrangler.jsonc`, Sites metadata, 기술 문서, 로컬·배포 환경 계약을 같은 변경에서 맞춘다.

## 10. 다음 인터뷰 질문

**Q2. 단계 B의 첫 동기화 검증에 실제 공개 게시물을 사용할까?**

- `실게시물` (권장): 다음 인터뷰에서 제목, 언어 블록, 사이트 노출 마커를 정한 뒤 Patreon에 첫 공개 제작로그를 발행하고 실제 API 응답으로 구현한다.
- `fixture 우선`: 로컬 테스트 데이터로 동기화 코드를 먼저 만들고 실제 게시물은 나중에 연결한다.

현재 API에서 확인되는 게시물은 0개다. 실게시물을 선택해도 게시 전까지는 fixture를 최소한의 자동 테스트에만 사용한다.
