# 기술 계약·의존성 인덱스

> 기준 패치: `35dee61` (`fix(deps): Dependabot 취약 의존성 갱신`)
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
| 페이지 조합 | [`app/page.tsx`](../app/page.tsx) |
| 콘텐츠·locale 타입 | [`app/content.ts`](../app/content.ts) |
| CSS import 순서 | [`app/globals.css`](../app/globals.css) |
| Vite·Vinext·Worker 결합 | [`vite.config.ts`](../vite.config.ts) |
| Worker 공개 배포 | [`wrangler.jsonc`](../wrangler.jsonc) |
| Sites 프로젝트 연결 | [`.openai/hosting.json`](../.openai/hosting.json) |
| 렌더·DOM·motion 회귀 | [`tests/rendered-html.test.mjs`](../tests/rendered-html.test.mjs) |

## 런타임 계약

- 패키지 관리자: npm과 `package-lock.json` v3
- Node.js: `>=22.13.0`
- 모듈 형식: ESM (`"type": "module"`)
- TypeScript: `strict`, `noEmit`, `moduleResolution: bundler`, `jsx: react-jsx`
- 경로 alias: `@/*` → 저장소 루트 `./*`
- 서버 렌더 entry: `vinext/server/app-router-entry`
- 브라우저 상태: locale만 `localStorage`의 `hanparan-locale` 키에 저장
- 공개 route 인증: 없음
- Studio 인증: `worker/index.ts`가 `/studio*`의 Cloudflare Access JWT와 `/api/discord/interactions`의 Discord Ed25519 signature를 server에서 검증
- 서버 저장소: direct Cloudflare의 production·staging D1·R2·Queue physical resource는 `wrangler.jsonc`에 분리 연결됨. staging D1에는 Phase A draft·asset·delivery migration, Worker에는 Images info/transform, private source·두 파생본 R2 저장, Queue consumer·DLQ routing과 Discord Forum delivery가 연결됨. Phase B canonical schema `0004`, taxonomy `0005`, asset manifest/retention `0006`과 `worker/studio-domain.ts`의 draft CAS·exact candidate/outbox·archive·verified current pointer 경계는 local 검증을 마쳤다. job-bound candidate snapshot·state·delete와 outbox identity는 불변이고 active delivery 중 비검증 current·Discord mapping 이동을 거부한다. `/studio/api/taxonomy` 변경은 post 없는 전역 outbox 한 건으로 직렬화하고 Queue consumer가 Discord Forum 전체 tag를 fresh verify한다. asset publish payload는 public·Discord key/bytes/SHA-256을 고정하고 두 R2 object를 처리 전·finalization 전에 다시 검증한다. retention endpoint는 미게시 orphan 7일과 superseded snapshot·public/Discord derivative 30일 후보를 Queue에 넣으며 consumer가 reference·active job·현재 environment 값을 재검증하고 exact delete·strong read·prefix 검사·Cloudflare global single-file purge를 통과한 뒤에만 D1 cleanup을 완료한다. 한 번이라도 게시된 private source는 비가역 marker와 exact key manifest로 남고, version metadata 삭제 뒤 실패한 cleanup도 version 비종속 job payload로 재개한다. 코드상 purge는 exact media URL과 zone-scoped API token을 요구하며 누락·오류에서는 fail closed한다. staging의 origin·zone ID·secret token 설정, scheduled trigger와 실제 global purge 증거는 Phase D/staging 운영 범위다. staging·production에는 `0004`–`0006`을 아직 적용하지 않았고 production Queue에는 배포된 producer·consumer가 없음

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
| `npm run deploy` | production target·physical binding을 검증한 뒤 공개 배포 |
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

- [`worker/index.ts`](../worker/index.ts)는 공개 route의 Vinext App Router handler를 보존하는 얇은 wrapper다. `/studio*` Access·same-origin 경계, `/api/discord/interactions`, Queue batch dispatch만 각 runtime handler로 전달한다.
- [`tooling/sites-vite-plugin.ts`](../tooling/sites-vite-plugin.ts)는 build 종료 시 `.openai/hosting.json`을 `dist/.openai/hosting.json`으로 복사한다.
- `--mode staging` build는 Cloudflare Vite plugin이 `env.staging`을 직렬화하도록 `CLOUDFLARE_ENV=staging`을 설정한다. [`tooling/verify-deploy-target.mjs`](../tooling/verify-deploy-target.mjs)는 redirected Wrangler config의 target·Worker 이름·세 physical binding·`IMAGES` binding·staging 무경로 계약이 맞지 않으면 배포를 거부한다. Wrangler environment는 `images`를 상속하지 않으므로 production과 `env.staging`에 각각 명시한다.
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
| `app/page.tsx` | locale copy와 여섯 섹션을 연결하는 얇은 client 조합 | `architecture.md`, 렌더 테스트 |
| `app/use-portfolio-locale.ts` | 저장 locale → 브라우저 언어 → 한국어 순서로 감지; 문서 lang/title/description 동기화 | `content.ts`, locale 테스트 |
| `app/content.ts` | `Locale`, `UpdateItem`, `SiteCopy`, 언어 옵션과 ko/ja/en 전체 copy | 사용하는 섹션 컴포넌트 |
| `app/components/*` | 섹션별 시맨틱 DOM | 대응 CSS 구간과 DOM 테스트 |
| `update-showcase.tsx` | 2.6초 slide, hover/focus/reduced-motion pause | hero/motion/responsive CSS |

`siteContent`는 `satisfies Record<Locale, SiteCopy>`로 모든 locale의 필드 완전성을 검사한다. `UpdateItem.id`는 React key, `dateTime`은 ISO 날짜, `date`는 표시 문자열이다.

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
- staging Worker 이름: `about-staging` (`env.staging`; Phase A Access 보호 Studio editor, private source·Images 파생본, Queue delivery, Discord role panel·Forum action 배포됨)
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

`tests/rendered-html.test.mjs`와 `tests/studio-runtime.test.mjs`는 빌드된 Worker를 직접 import한다. 전자는 `/` HTML을 렌더하고 후자는 mock binding·서명 key와 실제 SQLite migration adapter로 Studio 보안·draft revision CAS·taxonomy outbox·exact publish snapshot·current pointer·image pipeline·asset retention·Queue/Discord delivery 경계를 검증한다. `tests/studio-schema.test.mjs`는 Phase A row를 보존한 `0004`–`0006` upgrade, 일곱 table·foreign key·unique/check/trigger invariant와 representative query plan을 전담한다.

- HTTP 200과 HTML content type
- 기본 `<html lang="ko">`와 ko/ja/en copy
- `#work`, `#support`, `#now`, Prime City image/link
- `about.bluehair.blue` canonical과 OG image
- `page.tsx`가 여섯 섹션만 조합하고 raw section DOM을 소유하지 않는지
- CSS import, sticky work, view timeline, mobile fallback, reduced motion
- starter placeholder가 다시 나타나지 않는지
- Phase A 필수 environment·binding이 없을 때 `/studio*`가 `503`으로 fail closed하는지
- Access JWT signature·issuer·audience·expiry·관리자 email과 same-origin JSON write 경계
- Discord Ed25519 signature·5분 timestamp·PING·role add/remove·guild/channel/message/component allowlist
- Phase A migration SQL, draft create·restore·update, stale revision 409 후 불변성, active draft 고유 제약
- Phase B `0004` 정상 row 보존과 legacy invariant fail-closed preflight, canonical pointer/outbox ownership·승인본 state/snapshot·topic/asset 상한·single pin/Hero·SHA 제약과 query index plan
- Phase B `0005` stable taxonomy identity·kind lifecycle·active label·Discord ID 제약, post 없는 global outbox 직렬화, 동적 topic draft, add·rename·reorder·archive의 Forum full-tag fresh verification과 Queue/429/processing lease 복구
- Phase B `0006` asset ID 기반 exact three-key identity·cross-role collision 차단, ready manifest 완전성·승인 snapshot 불변성·비가역 first-published marker, superseded cleanup 전용 outbox와 query plan
- 게시 준비와 no-change 판정 중 draft·topic·asset drift의 candidate/outbox 원자적 거부, public·Discord object fresh byte/hash 검증, active delivery 중 competing current 차단, update 준비·파생본 불일치 중 이전 current 유지, `queued` outbox 복구, finalization-only retry의 Discord 무재전송
- source MIME·dimension·animation·alt·order·request size, private R2 exact key·SHA·metadata, conditional derivative put collision 검증, 삭제 재정렬과 R2 put 실패 복구 상태
- 7일 미게시 orphan과 30일 superseded snapshot/derivative cleanup의 fail-closed config, reference 재검증, exact delete·strong read·prefix 검사·exact media cache URL, private source 보존과 metadata-delete 뒤 재시도
- Portfolio·Discord WebP 파생본 byte/hash, attachment budget과 publish-ready gate
- Forum create·same-mapping update·attachment/tag 교체·delete/404 read-after-write
- Queue retry exhaustion·DLQ 기록, Discord 429 retry와 outcome-unknown create 무재전송

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
