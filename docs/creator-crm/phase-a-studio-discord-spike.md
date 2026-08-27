# Phase A — Studio Console ↔ Discord vertical slice

> 상태: 착수 전
>
> 목적: 관리자 전용 test 환경에서 Studio 입력 한 건이 Discord Forum에 생성·수정·삭제되는 실제 delivery 계약을 증명한다.
>
> 범위 원본: [`creator-crm-hub-plan.md`](../creator-crm-hub-plan.md). 구현 중 결정이 비어 있을 때만 원문을 확인한다.

## 1. 완료 결과

다음 한 문장이 실제 test 환경에서 성립해야 한다.

> 보호된 Studio form에서 한국어 fixture와 이미지 0–10장을 입력하면 test Bot이 지정 Forum에 같은 제목·본문·tag·attachment로 게시하고, 같은 mapping을 수정·삭제하며, 실패는 Queue 상태로 확인할 수 있다.

Phase A는 외부 API·권한·이미지 한도를 검증하는 최소 vertical slice다. 범용 Console 목록, 공개 Portfolio feed와 전체 복구 UI는 만들지 않는다.

## 2. 시작 조건

- `npm run lint`와 `npm test`가 현재 기준에서 통과한다.
- `Studio Bot Test` application·Bot과 관리자 전용 `BOT TEST` category가 준비되어 있다.
- test Bot은 production channel을 볼 수 없고 production 알림 role을 관리할 수 없다.
- staging D1·R2·Queue·DLQ는 production과 물리적으로 분리되어 있다.
- secret 값은 Cloudflare environment에만 있으며 Git·문서·client bundle에 없다.
- 기존 Patreon `CLIENT_SECRET`·creator token은 이 Phase에서 읽지 않는다.

필수 environment 이름:

- secret: `DISCORD_BOT_TOKEN`
- Access: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `STUDIO_ADMIN_EMAIL`
- Discord: `DISCORD_APPLICATION_ID`, `DISCORD_APPLICATION_PUBLIC_KEY`, `DISCORD_GUILD_ID`
- test surface: `DISCORD_START_CHANNEL_ID`, `DISCORD_ROLE_PANEL_MESSAGE_ID`, `DISCORD_FORUM_CHANNEL_ID`, `DISCORD_ANNOUNCEMENTS_CHANNEL_ID`, `DISCORD_NOTIFY_ROLE_ID`
- logical binding: `STUDIO_DB`, `STUDIO_MEDIA`, `PUBLISH_QUEUE`

staging과 production은 변수 이름만 같고 값과 physical resource를 공유하지 않는다. `DISCORD_TEST_*` 병렬 변수군이나 runtime `MODE` switch는 만들지 않는다.

## 3. 읽을 파일과 소유 범위

먼저 읽을 파일:

- [`AGENTS.md`](../../AGENTS.md)
- [`architecture.md`](../architecture.md)
- [`technical-index.md`](../technical-index.md)의 런타임·빌드·배포 계약
- [`package.json`](../../package.json), [`vite.config.ts`](../../vite.config.ts)
- [`worker/index.ts`](../../worker/index.ts), [`wrangler.jsonc`](../../wrangler.jsonc), [`.openai/hosting.json`](../../.openai/hosting.json)

이 Phase가 소유하는 범위:

- `/studio*` Access guard와 최소 test form
- `/studio/api/*` same-origin write 경계
- `/api/discord/interactions` signature 검증과 role button
- staging D1·R2·Queue·DLQ binding과 최소 migration
- 이미지 ingest·derivative worker와 Discord REST delivery
- test/production application 격리와 promotion preflight

`app/page.tsx`의 공개 섹션 DOM, 공개 feed와 범용 UI primitive는 수정하지 않는다. Phase A의 D1 row는 Phase B가 이어서 쓰는 최종 table 이름을 사용하며 폐기용 병렬 schema를 만들지 않는다.

## 4. 고정 입력 계약

- 제목: 1–100자
- 본문: 한국어 Markdown 2,000자 이하
- kind: `update` 또는 `work` 정확히 하나
- topic: `character / world / illustration / development` 중 0–4개
- 이미지: JPEG·PNG·static WebP 0–10장
- 이미지 제한: 한 변 8,192px 이하, 40MP 이하
- alt: 이미지마다 공백 제외 1–1,000자
- 거부: SVG·HEIC·PSD·ZIP·video·animated image

Markdown은 문단·줄바꿈·굵게·기울임·취소선·목록·인용·inline/fenced code·`https` link·Unicode emoji만 허용한다. raw HTML, inline image, Discord mention·timestamp·custom emoji와 platform 전용 문법은 거부한다.

모든 starter create·edit에는 `allowed_mentions: { parse: [] }`를 적용한다. 알림 fixture만 정확한 test role ID 하나를 allowlist한다.

## 5. 구현 순서

1. **baseline 고정**
   - 현재 commit, Node·npm version과 lint/test 결과를 기록한다.
   - 기존 build output 계약을 바꾸지 않는다.
2. **environment preflight**
   - staging binding과 Discord target ID가 test resource인지 확인한다.
   - 누락·중복·production ID가 하나라도 있으면 시작을 거부한다.
3. **Access 보호**
   - `/studio`, `/studio/*`, `/studio/api/*`에서 Access JWT signature·`iss`·`aud`·expiry·정확한 관리자 email을 server에서 검증한다.
   - write는 same-origin JSON과 custom request header만 허용하고 CORS를 열지 않는다.
4. **Discord interaction 경계**
   - raw body parse 전에 Ed25519 signature와 timestamp를 검증한다.
   - PING과 test role add·remove button만 구현하고 3초 안에 ephemeral 응답한다.
   - guild·channel·message·component·role ID allowlist 밖의 요청은 거부한다.
5. **최소 Studio form과 draft**
   - title·body·kind·topic·alt·image order를 입력한다.
   - IME, 1.5초 debounce, `Ctrl/Cmd+S`, native undo/redo와 revision 충돌을 검증한다.
6. **이미지 pipeline**
   - browser는 `/studio/api/assets/*`로 source를 한 번 업로드한다.
   - private source, Portfolio derivative, Discord derivative를 만들고 D1 manifest에 exact R2 key·hash·dimension·status를 기록한다.
   - 모든 asset이 `ready`이고 alt가 유효하기 전에는 게시하지 않는다.
7. **Queue delivery**
   - idempotency key로 Forum thread·starter·tag·attachment를 생성한다.
   - 같은 mapping에서 title·body·attachment·tag를 교체하고 thread delete의 404를 성공으로 처리한다.
   - 명시적 실패만 retry하고 create/update 결과 불명은 자동 재전송하지 않는다.
8. **실제 fixture 검증**
   - 이미지 0장, 동일 비율 여러 장, 혼합 비율·용량 fixture를 각각 확인한다.
   - Discord 응답에서 thread·starter ID, delivered hash와 attachment 집합을 다시 읽는다.
   - 실제 보수 attachment byte budget을 측정값으로 확정한다.
9. **role panel 검증**
   - add·remove button이 test role 하나만 idempotent하게 변경하고 회원 row·token·user log를 남기지 않는지 확인한다.
10. **승격 준비**
   - 검증된 commit을 수정하지 않고 production environment에 넣을 수 있는지 preflight한다.
   - production write와 endpoint 연결은 Go/No-Go 통과 후 명시적 promotion 승인에서만 수행한다.

## 6. 반드시 실패해야 하는 경우

- Access JWT 또는 관리자 email 불일치
- Discord signature·timestamp·application·guild·channel·message·role 불일치
- test Bot이 production channel이나 role에 접근 가능함
- 이미지 MIME·dimension·alt·개수·총 request budget 위반
- 아직 `ready`가 아닌 asset 포함
- 같은 request 재시도에서 Forum post·알림이 중복됨
- Discord create/update 결과가 불명확한데 자동 재전송하려 함
- staging 작업이 production D1·R2·Queue에 변화를 만듦

## 7. 완료 증거

- [ ] Access 비인증 page·write 요청이 거부됨
- [ ] PING, 유효·무효 signature, 3초 이내 ephemeral 응답 확인
- [ ] role add·remove와 정확한 role allowlist 확인
- [ ] 한 fixture의 create → update → attachment/tag 교체 → delete 확인
- [ ] delete 재시도 404와 Queue retry·DLQ 확인
- [ ] R2 날짜·post ID·제목 prefix 검색과 D1 exact-key 삭제 확인
- [ ] test resource 밖의 D1 row·R2 object·Queue depth가 변하지 않음
- [ ] `npm run lint`와 `npm test` 통과
- [ ] `dist/server/index.js`, `dist/client`, `dist/.openai/hosting.json` 존재
- [ ] secret과 `.dev.vars`가 build output에 없음

## 8. 완료 기록

- commit: 미기록
- staging origin: 미기록
- Discord fixture/thread: 미기록
- attachment budget: 미확정
- Go/No-Go: 미통과

## 다음 Phase

위 체크가 모두 통과한 뒤 [Phase B — canonical publishing backend](./phase-b-canonical-backend.md)로 이동한다. 하나라도 실패하면 Phase B를 시작하지 않고 이 Phase의 공통 경계에서 원인을 해결한다.
