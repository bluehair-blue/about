# 기술 계약·의존성 인덱스

> 기준 패치: `be8c2a8` (`feat(ops): promotion migration preflight 추가`)
>
> 설정 파일이 최종 진실이다. 아래 계약을 바꾸는 커밋은 이 문서도 함께 갱신한다.

## 빠른 진입점

| 찾는 내용 | 단일 출처 |
| --- | --- |
| 실행 명령·직접 의존성 | [`package.json`](../package.json) |
| 재현 가능한 설치 버전 | [`package-lock.json`](../package-lock.json) |
| 모듈·DOM·에이전트 경계 | [`architecture.md`](./architecture.md) |
| Creator CRM 구현 순서 | [`creator-crm-hub-plan.md`의 Phase A–D 실행 문서](./creator-crm-hub-plan.md#구현-실행-문서) |
| 저장소 작업 규칙 | [`AGENTS.md`](../AGENTS.md) |
| root 공개 조회 | [`app/page.tsx`](../app/page.tsx), [`lib/public-projection.ts`](../lib/public-projection.ts) |
| 페이지 조합 | [`app/home.tsx`](../app/home.tsx) |
| 콘텐츠·locale 타입 | [`app/content.ts`](../app/content.ts) |
| CSS import 순서 | [`app/globals.css`](../app/globals.css) |
| Vite·Vinext·Worker 결합 | [`vite.config.ts`](../vite.config.ts) |
| Worker 공개 배포 | [`wrangler.jsonc`](../wrangler.jsonc) |
| Sites 프로젝트 연결 | [`.openai/hosting.json`](../.openai/hosting.json) |
| 렌더·DOM·motion 회귀 | [`tests/rendered-html.test.mjs`](../tests/rendered-html.test.mjs) |
| 공개 projection·media 회귀 | [`tests/public-projection.test.mjs`](../tests/public-projection.test.mjs) |

## 런타임 계약

- 패키지 관리자: npm과 `package-lock.json` v3
- Node.js: `>=22.13.0`
- 모듈 형식: ESM (`"type": "module"`)
- TypeScript: `strict`, `noEmit`, `moduleResolution: bundler`, `jsx: react-jsx`
- 경로 alias: `@/*` → 저장소 루트 `./*`
- 서버 렌더 entry: `vinext/server/app-router-entry`
- 브라우저 상태: locale만 `localStorage`의 `hanparan-locale` 키에 저장
- 공개 route 인증: 없음
- 공개 데이터: `published` post의 `current_version_id`가 가리키는 `published` version만 server에서 읽으며, `/media/{assetId}/portfolio-v1.webp`는 그 current 승인본이 참조한 ready public derivative만 R2에서 제공
- Studio 인증: `worker/index.ts`가 `/studio*`의 Cloudflare Access JWT와 `/api/discord/interactions`의 Discord Ed25519 signature를 server에서 검증
- 서버 저장소: direct Cloudflare의 production·staging D1·R2·Queue physical resource는 `wrangler.jsonc`에 분리 연결됨. staging D1에는 Phase A draft·asset·delivery migration, Worker에는 Images info/transform, private source·두 파생본 R2 저장, Queue consumer·DLQ routing과 Discord Forum delivery가 연결됨. Phase B canonical schema `0004`, taxonomy `0005`, asset manifest/retention `0006`, stable canonical slug `0007`과 `worker/studio-domain.ts`의 draft CAS·exact candidate/outbox·archive·verified current pointer 경계를 local·staging에서 검증했다. job-bound candidate snapshot·state·delete와 outbox identity는 불변이고 active delivery 중 비검증 current·Discord mapping 이동을 거부한다. 최초 publish batch는 NFC Unicode slug와 post ID suffix를 한 번만 배정하고 DB trigger가 형식과 이후 불변성을 강제한다. `/studio/api/taxonomy` 변경은 post 없는 전역 outbox 한 건으로 직렬화하고 Queue consumer가 Discord Forum 전체 tag를 fresh verify한다. asset publish payload는 public·Discord key/bytes/SHA-256을 고정하고 두 R2 object를 처리 전·finalization 전에 다시 검증한다. retention endpoint는 미게시 orphan 7일과 superseded snapshot·public/Discord derivative 30일 후보를 Queue에 넣으며 consumer가 reference·active job·현재 environment 값을 재검증하고 exact delete·strong read·prefix 검사·Cloudflare global single-file purge를 통과한 뒤에만 D1 cleanup을 완료한다. 한 번이라도 게시된 private source는 비가역 marker와 exact key manifest로 남고, version metadata 삭제 뒤 실패한 cleanup도 version 비종속 job payload로 재개한다. 코드상 purge는 exact media URL과 zone-scoped API token을 요구하며 누락·오류에서는 fail closed한다. staging에는 2026-08-31 `0004`–`0007`과 implementation commit `be8c2a8`까지 배포했고 create/update/notification·unpublish/republish·archive/restore·stable slug·public revocation을 검증했다. zone 소유 purge origin과 zone ID는 staging에 배포됐으며 secret token과 실제 global purge만 미검증이다. production에는 `0004`–`0007`을 적용하지 않았고 production D1 migration count와 Queue/DLQ producer·consumer가 모두 0이다

## 직접 의존성

모든 직접 의존성은 범위 기호 없이 정확한 버전으로 고정한다.

### 애플리케이션

| 패키지 | 버전 | 역할 |
| --- | ---: | --- |
| `next` | `16.3.2` | App Router API와 Metadata 타입 |
| `react` | `19.2.8` | 클라이언트 UI와 상태 |
| `react-dom` | `19.2.8` | DOM 렌더링 |

### 빌드·배포·검사

| 패키지 | 버전 | 역할 |
| --- | ---: | --- |
| `vinext` | `1.0.0-beta.8` | Next 호환 Vite 빌드·서버 |
| `vite` | `8.2.2` | 빌드 오케스트레이션 |
| `@vitejs/plugin-react` | `6.1.0` | React 변환 |
| `@vitejs/plugin-rsc` | `0.5.34` | React Server Components |
| `react-server-dom-webpack` | `19.2.8` | React RSC 프로토콜 |
| `@cloudflare/vite-plugin` | `1.53.1` | Worker/RSC 빌드 환경 |
| `wrangler` | `4.125.0` | Cloudflare 배포 |
| `typescript` | `5.9.3` | 정적 타입 검사 |
| `eslint` | `9.39.4` | 정적 품질 검사 |
| `eslint-config-next` | `16.3.2` | Next·React lint 규칙 |
| `@types/node` | `22.19.19` | Node 타입 |
| `@types/react` | `19.2.18` | React 타입 |
| `@types/react-dom` | `19.2.5` | React DOM 타입 |

## 함께 갱신할 버전 묶음

| 묶음 | 현재 계약 | 갱신 규칙 |
| --- | --- | --- |
| React RSC | `react`, `react-dom`, `react-server-dom-webpack` = `19.2.8` | 세 런타임 버전을 동일하게 유지하고 한 번에 검증한다. |
| Next lint | `next`, `eslint-config-next` = `16.3.2` | 동일 버전을 유지한다. |
| Vinext/Vite | Vinext `beta.8`, Vite `8.2.2`, React plugin `6.1.0`, RSC plugin `0.5.34` | Vinext peer 범위 안에서 묶어서 올리고 RSC build와 Worker render를 함께 확인한다. |
| Cloudflare | Cloudflare Vite plugin `1.53.1`, Wrangler `4.125.0` | Vite 호환성과 `dist/server`·`dist/client` 배포를 함께 확인한다. lockfile의 Workerd/Miniflare는 직접 수정하지 않는다. |
| Node 타입 | Node `>=22.13.0`, `@types/node 22.19.19` | Node major 계약을 바꿀 때 엔진과 타입을 함께 검토한다. |

의존성 변경은 `package.json`과 `package-lock.json`을 같은 커밋에서 갱신하고 `npm run lint`, `npm test`를 통과시킨다.

## 실행 명령

| 명령 | 계약 |
| --- | --- |
| `npm run dev` | `vinext dev` 개발 서버 |
| `npm run build` | `vinext build`; Worker·client·Sites metadata 생성 |
| `npm run build:staging` | `vinext build --mode staging`; `env.staging`을 선택한 Worker 산출물 생성 |
| `npm run start` | 사전 빌드된 Vinext 서버 실행 |
| `npm run lint` | `dist`, `.next`를 제외한 ESLint |
| `npm test` | 먼저 전체 build 후 Node 내장 test runner 실행 |
| `npm run deploy` | 승인 manifest 없는 production 직접 배포를 명시적으로 거부 |
| `npm run preflight:promotion` | clean commit에서 migration 연속성·fresh local 적용·staging/production remote ledger·migration/lockfile/Wrangler hash를 읽기 전용 검증 |
| `npm run deploy:staging:dry-run` | staging target·physical binding을 검증하고 업로드 없이 종료 |
| `npm run migrate:staging:local` | staging D1 migration을 Wrangler 로컬 DB에 적용 |
| `npm run deploy:staging` | staging target·physical binding을 검증하고 pending D1 migration을 적용한 뒤 `about-staging`에 배포 |

## 빌드 파이프라인

Vite plugin 순서는 실행 계약이다.

```text
vinext()
→ sites()
→ cloudflare({ rsc + ssr, worker/index.ts, nodejs_compat })
→ dist/server/index.js
   dist/client/**
   dist/.openai/hosting.json
```

- [`worker/index.ts`](../worker/index.ts)는 Vinext App Router handler 앞에서 exact public media route와 `/updates/{slug}` 404/410 lifecycle guard를 처리한다. lifecycle guard와 Vinext가 보는 route param의 인코딩 경계가 다르므로 [`app/updates/[slug]/page.tsx`](../app/updates/[slug]/page.tsx)가 param을 한 번 안전하게 decode한 뒤 canonical D1 slug를 조회한다. 나머지 공개 RSC render에는 request별 Cloudflare binding을 전달하고, `/studio*` Access·same-origin 경계, `/api/discord/interactions`, Queue batch dispatch는 기존 runtime handler로 보낸다.
- [`tooling/sites-vite-plugin.ts`](../tooling/sites-vite-plugin.ts)는 build 종료 시 `.openai/hosting.json`을 `dist/.openai/hosting.json`으로 복사한다.
- `--mode staging` build는 Cloudflare Vite plugin이 `env.staging`을 직렬화하도록 `CLOUDFLARE_ENV=staging`을 설정한다. [`tooling/verify-deploy-target.mjs`](../tooling/verify-deploy-target.mjs)는 redirected Wrangler config의 target·Worker 이름·exact D1 ID/name·R2 bucket·Queue/DLQ·`IMAGES` binding·zone 소유 custom domain·retention/purge 설정이 맞지 않거나 token이 산출물에 직렬화되면 배포를 거부한다. Wrangler environment는 `images`와 `vars`를 상속하지 않으므로 production과 `env.staging`에 각각 명시한다.
- `CODEX_SANDBOX=seatbelt`일 때만 HMR polling을 켠다.
- [`next.config.ts`](../next.config.ts)는 현재 활성 옵션이 없는 빈 계약이다.
- `dist`, `.vinext`, `.wrangler`, `.next`, `node_modules`, `.env*`는 Git 추적 대상이 아니다.

## 현재 비차단 경고

- Vite `8.2.2`는 `vite.config.ts`의 extension 없는 `./tooling/sites-vite-plugin` import가 미래 기본값인 native config loader와 호환되지 않는다고 알린다. 현재 build는 통과한다. native loader를 켜거나 Vite major를 올리기 전에 명시적 `.ts` import와 TypeScript 설정의 조합을 한 변경에서 검증한다.
- build 중 Node의 `punycode` deprecation warning이 발생한다. 애플리케이션 실패는 아니며 직접 의존성을 임의 추가해 덮지 않고 상위 빌드 의존성 갱신으로 해소한다.
- Vinext는 현재 `/` route를 정적 분석에서 `Unknown`으로 표시할 수 있다. 빌드된 Worker render 테스트가 HTTP 200과 HTML 계약을 별도로 보증한다.

## 애플리케이션 계약

| 모듈 | 책임 | 바꾸면 같이 볼 파일 |
| --- | --- | --- |
| `app/layout.tsx` | 서버 layout, 한국어 초기 metadata, canonical/OG/X origin | `wrangler.jsonc`, README, 렌더 테스트 |
| `app/page.tsx` | 공개 query 정규화·D1 initial projection을 읽는 얇은 server 진입점 | `lib/public-projection.ts`, `app/home.tsx`, 공개 projection 테스트 |
| `app/home.tsx` | locale copy와 여섯 섹션을 연결하는 얇은 client 조합 | `architecture.md`, 렌더 테스트 |
| `app/use-portfolio-locale.ts` | 저장 locale → 브라우저 언어 → 한국어 순서로 감지; 문서 lang/title/description 동기화 | `content.ts`, locale 테스트 |
| `app/content.ts` | `Locale`, `SiteCopy`, 언어 옵션과 ko/ja/en chrome·feed copy | 사용하는 섹션 컴포넌트 |
| `lib/public-projection.ts` | allowlist URL/query, published-current D1 read, pin/Hero/topic/asset/Discord summary | root/detail/community route, 공개 projection 테스트 |
| `worker/public-media.ts` | 승인된 public derivative exact R2 read, D1 byte/SHA-256 대조, revocation-safe `private, no-store`와 ETag | Worker wrapper, 공개 projection 테스트 |
| `app/updates/[slug]/page.tsx` | 승인본 전체 Markdown·gallery와 record canonical/OG/X metadata | projection, Markdown/gallery, metadata 테스트 |
| `app/community/page.tsx` | active verified Discord thread 참여 경로 | projection, 공개 projection 테스트 |
| `app/components/*` | 섹션별 시맨틱 DOM | 대응 CSS 구간과 DOM 테스트 |
| `update-showcase.tsx` | 2.6초 slide, hover/focus/reduced-motion pause | hero/motion/responsive CSS |

`siteContent`는 `satisfies Record<Locale, SiteCopy>`로 모든 locale의 필드 완전성을 검사한다. 공개 글 원문은 번역하지 않고 D1의 한국어 승인본을 card와 detail에 `lang="ko"`로 표시한다.

## DOM·스타일 계약

상세 DOM 순서와 에이전트별 최소 컨텍스트는 [`architecture.md`](./architecture.md#dom스타일-계약)를 따른다.

- CSS import 순서: `foundation → hero → sections → motion → responsive`
- desktop sticky scene과 mobile fallback의 공통 경계: `52rem` / `52.001rem`
- 기본 header 높이: `4.5rem`; mobile: `4rem`
- `prefers-reduced-motion: reduce`가 마지막 animation override여야 함
- 전역 `nav`, `footer` 선택자를 다시 만들지 않음
- raw `<img>`는 Cloudflare가 제공하는 사전 최적화 정적 자산 계약이므로 Next lint 규칙을 프로젝트에서 끈 상태

## 배포 계약

### Cloudflare 공개 서비스

- Worker 이름: `about`
- staging Worker 이름: `about-staging` (`env.staging`; implementation commit `be8c2a8` acceptance version `eac4da09-8f0d-4b1a-b5da-6f67af9613f0`; Phase B Access 보호 Studio editor, canonical D1/R2/Queue publishing lifecycle과 Discord role panel·Forum action, exact target guard와 promotion preflight가 배포됨)
- staging purge origin: `https://about-staging.bluehair.blue` custom domain. `workers.dev`는 preview 접근용이고 `bluehair.blue` zone purge URL로 사용하지 않는다.
- Worker entry: `dist/server/index.js`
- 정적 자산: `dist/client`
- compatibility date: `2026-05-15`
- 최종 origin: `https://about.bluehair.blue`
- preview: `https://about.odeye3217.workers.dev`
- `workers_dev`, preview URL, observability 활성화
- `STUDIO_DB`: `about-studio-production` / staging `about-studio-staging`
- `STUDIO_MEDIA`: `about-studio-media-production` / staging `about-studio-media-staging`
- `IMAGES`: production / staging 환경에 각각 명시한 Cloudflare Images binding
- `PUBLISH_QUEUE`: `about-studio-publish-production` / staging `about-studio-publish-staging`
- 각 publish Queue consumer는 `max_retries: 3`과 environment별 dead-letter Queue를 사용한다. staging producer·consumer만 배포되어 있고 production Queue와 DLQ는 producer·consumer 0개를 유지한다.

### OpenAI Sites 연결

- 기존 `.openai/hosting.json`의 `project_id`를 재사용하며 새 ID를 만들지 않는다.
- D1·R2 logical binding은 모두 `null`이다.
- 설정 파일에는 `project_id`, `d1`, `r2` 외 런타임 값이나 secret을 넣지 않는다.

도메인을 바꿀 때는 `app/layout.tsx`, `wrangler.jsonc`, `README.md`, `docs/architecture.md`, 이 문서, 렌더 테스트의 origin을 같은 변경에서 맞춘다.

## 테스트·완료 계약

`tests/rendered-html.test.mjs`, `tests/public-projection.test.mjs`, `tests/studio-runtime.test.mjs`는 빌드된 Worker를 직접 import한다. 렌더 테스트는 빈 공개 DB에서도 기존 root DOM·locale·motion 계약이 유지되는지 확인한다. 공개 projection 테스트는 실제 SQLite migration adapter와 in-memory R2로 query 정규화, feed/pin/Hero, gallery, detail metadata, public media, lifecycle와 Discord mapping을 검증한다. Studio runtime 테스트는 mock binding·서명 key와 같은 SQLite 경로로 보안·draft revision CAS·taxonomy outbox·exact publish snapshot·current pointer·image pipeline·asset retention·Queue/Discord delivery 경계를 검증한다. `tests/studio-schema.test.mjs`는 Phase A row를 보존한 `0004`–`0007` upgrade, 일곱 table·foreign key·unique/check/trigger invariant와 representative query plan을 전담한다.

- HTTP 200과 HTML content type
- 기본 `<html lang="ko">`와 ko/ja/en copy
- `#work`, `#support`, `#now`, Prime City image/link
- `about.bluehair.blue` canonical과 OG image
- `page.tsx`가 server loader만 소유하고 `home.tsx`가 여섯 섹션만 조합하며 raw section DOM을 소유하지 않는지
- CSS import, sticky work, view timeline, mobile fallback, reduced motion
- starter placeholder가 다시 나타나지 않는지
- unknown·archived·overflow query canonical 정규화, 최신/오래된 sort, kind/topic 결합, 일반 글 10개 pagination과 page 1 별도 pin
- published current 승인본만 feed/detail/Hero에 노출되고 nullable `hero_rank` 오름차순이 pin과 독립인지
- 0/1/동일 비율/mixed 2–4/mixed 5+ gallery markup, native dialog·keyboard·touch·focus 복귀와 reduced-motion source 계약
- record별 canonical·description·OG/X media, no-image metadata 비움, safe Markdown와 public output의 private/Discord media key 부재
- withheld·archived 404, purged 410, public derivative GET/HEAD/304/405, D1 byte/SHA-256 대조, `private, no-store`와 detach 뒤 Discord CTA 제거
- Phase A 필수 environment·binding이 없을 때 `/studio*`가 `503`으로 fail closed하는지
- Access JWT signature·issuer·audience·expiry·관리자 email과 same-origin JSON write 경계
- Discord Ed25519 signature·5분 timestamp·PING·role add/remove·guild/channel/message/component allowlist
- Phase A migration SQL, draft create·restore·update, 1.5초 debounce·IME·single-flight·`Ctrl/Cmd+S`·native undo/redo와 동적 topic 보존 client 계약, Access 만료 상태, stale revision 409 후 불변성과 active draft 고유 제약
- Phase B `0004` 정상 row 보존과 legacy invariant fail-closed preflight, canonical pointer/outbox ownership·승인본 state/snapshot·topic/asset 상한·single pin/Hero·SHA 제약과 query index plan
- Phase B `0005` stable taxonomy identity·kind lifecycle·active label·Discord ID 제약, post 없는 global outbox 직렬화, 동적 topic draft, add·rename·reorder·archive의 Forum full-tag fresh verification과 Queue/429/processing lease 복구
- Phase B `0006` asset ID 기반 exact three-key identity·cross-role collision 차단, ready manifest 완전성·승인 snapshot 불변성·비가역 first-published marker, superseded cleanup 전용 outbox와 query plan
- Phase B `0007` 비초안 stable slug 필수·NFC Unicode 생성과 post ID suffix 형식, 최초 배정 뒤 불변성, 기존 row fail-closed preflight
- 게시 준비와 no-change 판정 중 draft·topic·asset drift의 candidate/outbox 원자적 거부, public·Discord object fresh byte/hash 검증, active delivery 중 competing current 차단, update 준비·파생본 불일치 중 이전 current 유지, `queued` notification outbox 재enqueue, finalization-only retry의 Discord 무재전송
- source MIME·EXIF 적용 dimension·animation·alt·order·request size, 실제 WebP 출력 dimension, private R2 exact key·SHA·metadata, conditional derivative put collision 검증, 삭제 재정렬과 R2 put 실패 복구 상태
- 7일 미게시 orphan과 30일 superseded snapshot/derivative cleanup의 fail-closed config, reference 재검증, exact delete·strong read·prefix 검사·exact media cache URL, private source 보존과 metadata-delete 뒤 재시도
- Portfolio·Discord WebP 파생본 byte/hash, attachment budget과 publish-ready gate
- Forum create·same-mapping update·attachment/tag 교체·delete/404 read-after-write
- Queue retry exhaustion·malformed payload DLQ·누락 notification enqueue 복구, Discord 429 retry와 outcome-unknown create 무재전송

완료 조건:

1. `npm run lint`
2. `npm test`
3. `dist/server/index.js`, `dist/client`, `dist/.openai/hosting.json` 존재
4. 배포 작업이면 `https://about.bluehair.blue`와 핵심 정적 자산의 HTTP 200 확인

## 변경별 최소 확인 범위

| 변경 | 먼저 읽을 파일 | 필수 검증 |
| --- | --- | --- |
| dependency | `package.json`, lockfile, 이 문서의 버전 묶음 | lint + test |
| locale | `content.ts`, locale hook, 관련 섹션 | locale + render 테스트 |
| DOM | 해당 component, 대응 CSS, architecture packet | lint + test |
| motion/responsive | `motion.css`, `responsive.css`, 대상 기본 CSS | motion 회귀 테스트 |
| domain/metadata | layout, Wrangler, README, 관련 docs/tests | build + 공개 origin 확인 |
| deployment | package scripts, Vite, Wrangler, hosting metadata | 전체 완료 조건 |
| Studio/Discord runtime | 현재 Phase 문서, `worker/`, `app/studio/` | lint + build된 Worker 보안 경계 테스트 |
