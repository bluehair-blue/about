# 한파란 포트폴리오 초기 아키텍처

## 목표

이 저장소는 `https://about.bluehair.blue`의 단일 포트폴리오 페이지를 운영한다. 구조의 목표는 기능 수를 미리 늘리는 것이 아니라, 한 파트를 수정하는 에이전트가 그 파트의 컴포넌트·콘텐츠 타입·스타일만 읽고 안전하게 작업할 수 있게 하는 것이다.

## 모듈 규칙

1. `app/page.tsx`는 URL allowlist 정규화와 D1 공개 projection 조회 뒤 `Home`에 직렬화 가능한 결과를 넘기는 server 진입점이다.
2. 여섯 섹션 조합과 현재 locale 연결은 `app/home.tsx`가 담당하고, 브라우저 locale 탐지·저장·문서 언어 동기화는 `app/use-portfolio-locale.ts` 한 곳에서 담당한다.
3. 각 섹션 컴포넌트는 `SiteCopy` 전체가 아니라 자신이 쓰는 조각만 props로 받는다.
4. 자체 상태가 있는 동작은 가장 가까운 컴포넌트 안에 둔다. Hero 전환은 `UpdateShowcase`, 본문 펼침과 feed 공용 lightbox는 `UpdatesSection`, 상세 gallery lightbox는 `StandalonePublicGallery`가 소유한다.
5. 콘텐츠 계약과 번역은 `app/content.ts`가 단일 출처다. 실제로 두 번째 콘텐츠 축이 생기기 전에는 파일을 더 나누지 않는다.
6. 컴포넌트 분리는 DOM wrapper 추가를 뜻하지 않는다. 기존 시맨틱 태그, 직계 자식 순서, class와 `data-*` 속성은 스타일 계약이다.
7. 범용 UI primitive, Context, factory, CSS-in-JS, 새 상태 라이브러리는 실제 두 번째 사용처가 생기기 전에는 만들지 않는다.

## 런타임 트리

```text
RootLayout (server)
├─ PortfolioPage (server public projection loader)
│  └─ Home (client composition)
│     ├─ SiteHeader
│     ├─ HeroSection
│     │  └─ UpdateShowcase (client-owned interaction)
│     ├─ ProjectIndexSection
│     ├─ SupportSection
│     ├─ UpdatesSection
│     │  ├─ PublicGallery
│     │  └─ PublicLightbox (one shared native dialog)
│     └─ SiteFooter
├─ PublicPostPage (server detail + record metadata)
│  └─ StandalonePublicGallery
└─ CommunityPage (server active Discord mapping list)
```

데이터 흐름은 단방향이다.

```text
D1 published current version → PublicProjection → PortfolioPage → Home
siteContent[locale] ─────────────────────────────────────────────┤
usePortfolioLocale ──────────────────────────────────────────────┘

D1 approved asset manifest → /media/{assetId}/portfolio-v1.webp → R2 public key
```

`lib/public-projection.ts`는 공개 읽기 계약의 단일 출처다. query 값은 allowlist branch로만 SQL에 반영하고, 반환값에는 public media URL을 조립하는 데 필요한 asset ID·dimension·alt만 포함한다. private source key, Discord derivative key와 CDN URL은 server projection 밖으로 보내지 않는다.

## DOM·스타일 계약

`app/globals.css`의 import 순서 `foundation → hero → sections → motion → responsive`는 캐스케이드 계약이므로 바꾸지 않는다.

- Header: `.header-inner`의 wordmark → nav → actions 순서를 유지한다.
- Hero: `.hero` 바로 아래에는 `.hero-copy`와 `.hero-updates`만 둔다.
- Project: `.featured-work`의 visual → copy 순서를 유지한다.
- Support: `.support-row`는 panel의 직접 자식이며 행 순서가 animation range를 결정한다.
- Updates: `.update-copy`의 번호 문단 → 제목 → `.public-post-body` → 펼침 button → optional `.post-media` → `.post-actions` 순서를 유지한다. feed의 native `.public-lightbox`는 `.updates-list` 밖에서 section 끝에 한 번만 둔다.
- Footer: `.site-footer`의 세 직접 자식은 reveal animation 대상이다.
- `52rem`은 desktop sticky scene과 mobile fallback이 교대하는 공통 경계다.
- `prefers-reduced-motion` 최종 override 뒤에 animation 규칙을 추가하지 않는다.

## 에이전트 컨텍스트 패킷

각 작업은 아래 행 하나를 기본 컨텍스트로 사용한다. 다른 파트까지 바꿔야 할 근거가 생기면 먼저 조합 루트에서 호출 경로를 확인한다.

| 작업 파트 | 기본 파일 | 필요한 스타일 | 최소 검증 |
| --- | --- | --- | --- |
| locale 상태 | `app/use-portfolio-locale.ts`, `app/content.ts`, `app/home.tsx` | `foundation.css`의 locale control | locale 계약 테스트 |
| header | `app/components/site-header.tsx`, `app/content.ts`의 nav 필드 | `foundation.css`, header 구간의 `responsive.css` | lint + 렌더 테스트 |
| hero/showcase | `hero-section.tsx`, `update-showcase.tsx`, `content.ts`의 hero/updates 필드 | `hero.css`, 관련 `motion.css`·`responsive.css` | reduced-motion + 렌더 테스트 |
| project index | `project-index-section.tsx`, `content.ts`의 work 필드 | `sections.css`, work 구간의 `motion.css`·`responsive.css` | 링크·이미지·sticky 계약 테스트 |
| support | `support-section.tsx`, `content.ts`의 support 필드 | `sections.css`, support 구간의 `motion.css`·`responsive.css` | DOM 순서 + 렌더 테스트 |
| public projection | `lib/public-projection.ts`, `app/page.tsx`, `app/home.tsx`, `worker/public-media.ts` | 없음 | `public-projection.test.mjs`의 query·lifecycle·media 검사 |
| updates | `updates-section.tsx`, `public-gallery.tsx`, `markdown-body.tsx`, `content.ts`의 notes/feed 필드 | `sections.css`, updates 구간의 `motion.css`·`responsive.css` | feed·gallery·lightbox 계약 테스트 |
| public detail/community | `app/updates/[slug]/page.tsx`, `app/community/page.tsx`, `lib/public-projection.ts` | detail/community 구간의 `sections.css`·`responsive.css` | metadata·404/410·Discord mapping 테스트 |
| footer | `site-footer.tsx`, `content.ts`의 footer 필드 | footer 구간의 `sections.css`·`motion.css`·`responsive.css` | 렌더 테스트 |
| 배포 | `package.json`, `vite.config.ts`, `wrangler.jsonc`, `.openai/hosting.json` | 없음 | build + 공개 도메인 확인 |

Creator CRM 구현은 [`creator-crm-hub-plan.md`의 실행 문서 표](./creator-crm-hub-plan.md#구현-실행-문서)에서 현재 Phase 하나를 선택한다. 해당 Phase 문서와 그 문서가 지정한 파일만 기본 컨텍스트로 사용하고, 전체 설계 기록이나 다음 Phase 문서는 현재 계약이 비어 있을 때만 확인한다.

## 확장 순서

- 새 locale: `Locale`, `localeOptions`, `siteContent` 항목을 같은 변경에서 추가한다.
- 새 섹션: 콘텐츠 계약 → 섹션 컴포넌트 → `Home` 조합 → 전용 스타일 → 회귀 테스트 순서로 추가한다.
- 두 번째 프로젝트: 실제 콘텐츠가 준비됐을 때 `work`를 배열 계약으로 바꾸고 `ProjectIndexSection`과 work motion을 함께 확장한다. 현재 한 장면용 sticky motion을 여러 카드에 그대로 복제하지 않는다.
- 새 상호작용: 해당 섹션 내부 상태로 시작한다. 둘 이상의 먼 컴포넌트가 같은 상태를 실제로 공유할 때만 상위 상태나 Context를 검토한다.

## 완료 기준

`npm run lint`, `npm test`가 통과하고 `dist/server/index.js`, `dist/client`, `dist/.openai/hosting.json`이 생성되어야 한다. 배포 시 canonical, Open Graph, X 이미지 기준 origin과 실제 응답 URL은 모두 `https://about.bluehair.blue`여야 한다.
