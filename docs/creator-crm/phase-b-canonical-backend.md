# Phase B — canonical publishing backend

> 상태: local 구현 완료 — 1–11. canonical backend·Studio workflow·게시 lifecycle 자동화 검증 완료, staging migration·browser acceptance 대기
>
> 목적: D1/R2를 유일한 기준 원본으로 만들고 Studio Console의 초안·이미지·게시·수정·보관 작업을 완성한다.
>
> 선행 문서: [`phase-a-studio-discord-spike.md`](./phase-a-studio-discord-spike.md)

## 1. 완료 결과

관리자는 `/studio`에서 글과 이미지를 한 번만 관리한다. Discord는 승인본 delivery이고, 공개 current pointer는 Discord 결과가 검증된 뒤에만 이동한다. 실패 중에는 이전 정상 version 또는 비공개 상태를 유지한다.

Phase B는 backend와 관리자 workflow를 완성한다. 공개 SNS feed·gallery UI는 Phase C가 소유한다.

## 2. 시작 조건

- Phase A의 Access·test isolation·Discord create/update/delete·이미지 fixture·Queue evidence가 모두 통과했다.
- Phase A에서 측정한 Discord attachment budget이 기록되어 있다.
- staging과 production의 D1·R2·Queue·DLQ가 물리적으로 분리되어 있다.
- Phase A schema를 버리지 않고 additive migration으로 이어갈 수 있다.

## 3. 읽을 파일과 소유 범위

먼저 읽을 파일:

- 이 문서와 Phase A 완료 기록
- [`AGENTS.md`](../../AGENTS.md)
- [`architecture.md`](../architecture.md)의 모듈 규칙
- [`technical-index.md`](../technical-index.md)의 D1/R2 도입 시 함께 갱신할 계약
- Phase A가 추가한 Studio route·Access guard·Discord client·Queue consumer·image worker
- `db/schema.ts`, `migrations/`, `wrangler.jsonc`, `.openai/hosting.json`이 존재하면 해당 파일

이 Phase가 소유하는 범위:

- 일곱 D1 table과 migration
- D1 query helper, version pointer와 lifecycle invariant
- R2 manifest·retention·cleanup
- Studio 목록·편집기·Media·preview·상태·재시도
- taxonomy·pin·Hero 관리 API
- publish·update·unpublish·archive·restore·permanent purge saga

공개 `#now` feed, 카드·lightbox·상세 페이지와 운영용 daily reconciliation은 수정하지 않는다.

## 4. 저장 계약

| table | 책임 | 필수 제약 |
| --- | --- | --- |
| `studio_posts` | 안정 ID, lifecycle, current mapping | unique slug·Discord mapping; draft/current pointer; nullable `pinned_at`·`hero_rank` |
| `studio_post_versions` | mutable draft와 immutable 승인본 | post당 active draft 하나; revision 조건부 save; source hash |
| `studio_post_version_topics` | version별 topic snapshot | `(version_id, taxonomy_id)` primary key |
| `studio_taxonomy` | kind·topic과 Discord tag mapping | unique stable key; label·status·ordinal 분리 |
| `studio_assets` | source·derivative manifest | UUID identity; SHA-256; exact private/public/Discord R2 key |
| `studio_post_version_assets` | 이미지 순서·alt snapshot | `(version_id, asset_id)`와 `(version_id, ordinal)` unique |
| `delivery_jobs` | Discord·notification·archive 등 outbox | unique dedupe key; target·action·remote ID·attempt·error |

post lifecycle:

`draft / publishing / published / withheld / unpublished / archiving / archived / restoring / purging / purged`

고정 invariant:

- 승인된 version은 불변이다.
- post마다 mutable draft는 하나만 둔다.
- 같은 content hash 재게시로 version·Discord post를 늘리지 않는다.
- D1에는 searchable state·metadata, R2에는 bytes만 둔다.
- raw D1 binding은 작은 helper 뒤에서 prepared statement와 필요한 `batch()`로만 사용한다.
- schema source는 `db/schema.ts`, 검토된 생성 SQL은 `migrations/`에 저장한다.
- 실제 D1/R2 binding을 추가하는 변경에서 `wrangler.jsonc`, `.openai/hosting.json`, generated types와 `technical-index.md`를 함께 갱신한다.
- 새 index는 실제 query predicate·unique 계약에만 추가하고 representative query plan으로 확인한다.

## 5. 콘텐츠·이미지 계약

콘텐츠:

- 한국어 원문 하나, 제목 1–100자, Markdown 2,000자 이하
- kind 정확히 하나: `update / work`
- topic 0–4개: `character / world / illustration / development`
- CRLF를 LF로 정규화하고 server에서 길이·Markdown allowlist를 재검증
- Discord mention·raw HTML·inline image·안전하지 않은 URL scheme 거부

이미지:

- JPEG·PNG·static WebP, 0–10장, alt 필수
- private source는 공개 URL이 없고 한 번이라도 게시되면 자동 삭제하지 않음
- Portfolio·Discord derivative만 각각의 surface에 전달
- public media route는 `published` current version이 참조한 Portfolio derivative만 반환
- R2 key identity는 D1 manifest의 exact key이며 title prefix로 재조합하지 않음
- orphan upload 7일, superseded metadata·derivative 30일; 값이 없거나 잘못되면 cleanup 중단
- global single-file purge에 필요한 public origin·Cloudflare zone ID·API token이 없거나 잘못되면 cleanup 중단

R2 key:

```text
posts/{YYYY}/{MM}/{DD}/{timestamp}--{post_id}--{title_snapshot}/
  private/{asset_id}/source.{decoded_ext}
  private/{asset_id}/discord-v1.webp
  public/{asset_id}/portfolio-v1.webp
```

## 6. 구현 순서

1. **schema와 migration — local 완료**
   - 일곱 table, foreign key, unique·check constraint와 실제 query index를 추가한다.
   - staging migration 생성 SQL을 검토하고 재적용·rollback 전략을 기록한다.
2. **D1 domain helper — local 완료**
   - draft revision save, candidate 생성, pointer finalization, lifecycle 변경을 공통 transaction 경계로 만든다.
   - route마다 binding을 직접 읽거나 범용 repository/factory를 만들지 않는다.
3. **taxonomy — local 완료**
   - 초기 kind·topic seed와 Discord tag ID mapping을 넣는다.
   - add·rename·reorder·archive를 구현하되 stable key는 바꾸지 않는다.
4. **asset manifest와 cleanup — local 완료**
   - upload 상태 `uploading / processing / ready / orphan / failed / deleting`을 복원 가능하게 저장한다.
   - exact-key delete, prefix empty 검증과 public cache purge를 구현한다.
5. **draft autosave — local 완료**
   - 1.5초 debounce, IME `compositionend`, 한 번에 save 하나, revision compare-and-swap을 구현한다.
   - `Ctrl/Cmd+S`, native undo/redo와 409 충돌을 검증한다.
6. **안전한 작업 이동 — local 완료**
   - `/studio/posts/{post_id}` 안정 URL과 `전체 / 작업 중 / 확인 필요` URL filter를 사용한다.
   - 이동 전 최신 revision과 private upload 접수를 flush하고, 실패·충돌·PIN 만료에서는 route를 유지한다.
   - active draft는 자동 만료하지 않으며 `작업 중` 목록에서 재개한다.
7. **Studio UI — local 완료**
   - 목록, 편집기, 두 surface preview, Media 검색, 상태·재시도만 구현한다.
   - 색상 외에 상태 text·원인·마지막 확인 시각을 제공하고 action을 한 화면에 펼치지 않는다.
8. **새 게시 saga — local 완료**
   - ready asset → candidate와 create job 기록 → Discord create·fresh verify → current pointer와 `published` finalization 순서를 강제한다.
   - 결과 불명은 `outcome_unknown`으로 멈추고 자동 create를 반복하지 않는다.
   - 최초 게시 finalization 뒤에만 deduped opt-in notification을 enqueue한다.
9. **수정 saga — local 완료**
   - 기존 current를 유지한 채 candidate와 update job을 만들고 Discord hash·attachment·tag가 일치한 뒤 pointer를 교체한다.
   - update 불명은 remote hash를 먼저 대조하며 Discord 성공 뒤 finalization만 실패하면 edit를 반복하지 않는다.
10. **공개 중지·archive·restore·purge — local 완료**
    - 공개 중지는 Portfolio만 숨기고 Discord thread를 유지한다.
    - archive는 Portfolio·media를 먼저 차단한 뒤 Discord thread를 삭제하고 private source를 보존한다.
    - restore는 private source로 새 Discord thread를 만들고 `SUPPRESS_NOTIFICATIONS` 검증 뒤 같은 slug를 공개한다.
    - permanent purge는 제목 재입력 뒤 exact R2 key를 삭제하고 최소 tombstone만 남긴다.
11. **pin·Hero — local 완료**
    - pin 하나와 nullable `hero_rank`만 관리한다. 별도 큐레이션 table은 만들지 않는다.

## 7. Studio UX 완료 계약

- 목록: 제목·분류·저장 시각·Portfolio/Discord 상태와 `작업 중`·`확인 필요` filter
- 편집기: 제한 Markdown toolbar, counter, preview, topic·이미지 reorder·alt
- 저장 상태: `저장 중 / 저장됨 / 저장 실패 / 다시 로그인 필요 / 다른 창에서 수정됨`
- 이동 실패 dialog: `다시 저장 / 현재 화면 유지 / 변경 내용 복사`; `저장하지 않고 이동` 없음
- upload 미접수 이미지는 이동 차단, 접수 후 Queue derivative는 background 진행
- Media: post·날짜·상태 검색, source/derivative 상태, owner editor 이동, 안전한 orphan 삭제
- 공개 action: update, pin, Hero, unpublish, archive, restore, purge, retry

초기에는 page builder, WYSIWYG block editor, 회원 table, 예약 게시, 협업 승인, 실시간 dashboard와 외부 workflow SaaS를 만들지 않는다.

## 8. 완료 증거

- [x] local migration 재현과 unique·foreign key·revision 충돌 검사 통과
- [ ] browser 재시작·재로그인 뒤 draft·asset 상태 복원
- [ ] 저장 실패·409·PIN 만료에서 작업 이동 차단과 내용 보존
- [x] local 통합 검사에서 새 게시·수정 실패 중 이전 정상 current 유지
- [x] local 통합 검사에서 create/update/notification 결과 불명 자동 재전송 없음
- [ ] 실제 public route·media에서 archive 차단 확인; local lifecycle과 private source 보존 검사는 통과
- [x] local 통합 검사에서 restore가 새 Discord mapping과 같은 slug를 사용하고 알림을 보내지 않음
- [x] local 통합 검사에서 purge가 exact key·prefix empty·cache purge를 검증하고 tombstone을 남김
- [x] local fake Forum 검사에서 taxonomy archive가 새 선택지와 Discord available tag에서 제거됨
- [x] 비인증 Studio page·API와 잘못된 same-origin write 거부
- [x] `npm run lint`와 `npm test` 통과
- [x] `technical-index.md`와 generated binding·migration 계약 동기화

## 9. 완료 기록

- commit: schema·D1 domain helper `b5d2a33`; taxonomy `e58dbfa`; asset manifest/retention `e040f31`; draft autosave `c06634e`; 안전한 작업 이동 `b013038`; Studio UI `d46f49a`; 최초 게시 알림 `a4ddae7`; update 결과 불명 복구 `0afd45f`; 공개 lifecycle·permanent purge `4ff82a9`; pin·Hero `a218acc`
- migration: `0004_phase_b_canonical_schema.sql`. Phase A 7-table row를 보존하는 outbox rebuild와 notification·cache 작업 pair, pointer·outbox post ownership, 승인본과 job-bound candidate snapshot·state·delete 및 outbox identity 불변성, active delivery 중 비검증 current·Discord mapping 이동 차단, topic·asset 상한과 같은-post asset, 단일 pin·Hero rank, lowercase SHA-256, version·asset cleanup·reverse asset·delivery query index를 추가함. fresh `0001`–`0004`와 기존 `0001`–`0003` 정상 row upgrade를 local SQLite에서 재현하고, 기존 비정상 hash·taxonomy·asset/outbox ownership row와 진행 중인 구형 Discord create/update job은 rebuild 전에 fail closed함. `PRAGMA foreign_key_check`와 representative `EXPLAIN QUERY PLAN`을 통과했고 Wrangler local migration ledger에서도 적용 뒤 재실행이 `No migrations to apply`로 끝남. remote staging·production에는 아직 미적용
- D1 domain helper: `worker/studio-domain.ts`가 draft create·revision CAS, exact draft/topic/asset snapshot 기반 candidate와 outbox 생성, archive 시작, 검증 완료 delivery의 current pointer finalization만 소유함. Discord·R2·Queue I/O는 기존 runtime에 유지함. 게시 준비와 no-change 판정 중 revision/source/topic/asset 또는 mapping이 바뀌면 candidate·job·`publishing` 전이를 모두 거부하고, active delivery 중 검증 job과 일치하지 않는 current/mapping 이동을 DB에서도 막음. job payload의 exact asset manifest를 처리 전에 다시 대조하며, Queue send와 실패 기록이 함께 실패해 `queued` outbox만 남아도 관리자 retry로 다시 enqueue할 수 있음. `finalizing` 재시도는 delivery 상태를 `queued`로 되돌리지 않아 Discord create/update/delete를 반복하지 않고 D1 finalization만 다시 수행함
- taxonomy: forward migration `0005_phase_b_taxonomy.sql`이 `stable_key`·dimension 불변, kind lifecycle의 명시적 migration 요구, active label·Discord snowflake 제약과 post 없는 전역 taxonomy outbox 한 건의 직렬화를 추가함. `/studio/api/taxonomy`는 기존 Access·same-origin write 경계를 재사용해 list·topic add·label rename·dimension reorder·topic archive·sync retry를 제공하고, 동적 active topic을 draft save에서도 허용함. Queue consumer는 D1 active catalog 전체를 Discord Forum `available_tags` 한 묶음으로 PATCH한 뒤 fresh GET의 ID·label·순서를 검증하고 mapping과 job을 함께 완료함. archive된 topic은 새 draft와 Forum 선택지에서는 제외하되 과거 version link와 마지막 tag ID는 보존함. publish는 label 추측 대신 저장된 tag ID와 fresh remote label이 모두 일치할 때만 진행함. local SQLite와 fake Forum에서 add → rename → reorder → archive, Queue send 실패, 429, processing 중복·stale lease 복구를 검증했으며 remote staging에는 아직 미적용
- asset manifest/retention: forward migration `0006_phase_b_asset_manifest_cleanup.sql`이 세 R2 key의 asset ID 기반 exact identity와 cross-role collision 차단, `ready` 파생본 manifest 완전성, 승인 snapshot의 manifest 불변성, 최초 게시 시각의 비가역 marker와 current pointer gate를 추가함. 게시 payload는 public·Discord key/bytes/SHA-256을 함께 고정하고 Queue 처리 전과 Discord 검증 뒤 finalization 직전에 두 R2 object를 다시 읽어 byte/hash를 검증하므로 public 파생본이 없거나 바뀌면 기존 current를 유지함. 편집기 삭제는 미게시·무참조 asset을 즉시 지우지 않고 `orphaned_at`을 기록하며, `/studio/api/assets/cleanup`은 검증된 7일·30일 environment value로 미게시 orphan과 superseded version 후보를 outbox에만 등록함. consumer는 삭제 직전 D1 reference·active job·retention을 재검증하고 exact R2 delete → strong read → asset prefix 검사 → Cloudflare global single-file purge 뒤에만 manifest 또는 rollback metadata를 완료함. 30일 superseded cleanup은 old public·Discord derivative와 version snapshot만 제거하고 `first_published_at`이 있는 private source와 exact key manifest는 private archive로 보존하며, version metadata 삭제 뒤 R2 실패도 surviving job payload로 재개함. local SQLite/fake R2/Cloudflare API에서 missing public derivative, conditional derivative collision, 7일 이전 보존, 잘못되거나 누락된 cleanup configuration의 fail-closed, residual prefix, R2 실패·재시도, 보존기간 연장 후 재개 차단과 30일 version cleanup 재개를 검증함. Wrangler local ledger에서도 fresh `0001`–`0006` 적용과 재실행 `No migrations to apply`를 확인함. `STUDIO_PUBLIC_ORIGIN`, `CLOUDFLARE_ZONE_ID`, secret `CLOUDFLARE_CACHE_PURGE_TOKEN`의 staging 설정과 global purge·scheduled trigger·remote D1/R2 실행 증거는 staging 운영 단계에 남김
- draft autosave: Phase A에서 실제 staging browser로 검증한 `DraftEditor` coordinator를 중복 구현 없이 재사용함. 1.5초 debounce와 IME 조합 종료 후 저장, `Ctrl/Cmd+S`, uncontrolled title/body의 native undo/redo, `savingRef` 단일 in-flight와 최신 snapshot 1회 후속 저장을 source 회귀 계약으로 고정함. Worker는 mutable draft의 expected revision에만 `UPDATE`하고 stale revision은 현재 값을 덮지 않은 채 `409 revision_conflict`를 반환하며 local SQLite에서 revision 2 이후 stale revision 1의 title·body·kind·topic 불변성을 재검증함. Access `401/403`에서는 입력과 dirty state를 유지하고 `다시 로그인 필요`, conflict에서는 자동 저장을 멈추고 `다른 창에서 수정됨`을 `aria-live` status로 표시함. client는 backend가 반환한 동적 topic stable key를 네 개 상한 안에서 그대로 복원해 아직 UI에 없는 canonical 선택을 후속 저장에서 유실하지 않으며, 동적 taxonomy의 전체 선택·관리 UI는 7단계가 소유함
- 안전한 작업 이동: `/studio?filter=all|working|attention` 목록과 `/studio/posts/{post_id}` 안정 URL을 추가하고, 명시한 post ID가 없을 때는 새 초안으로 오인하지 않고 `404`로 닫음. 첫 초안 저장은 승인된 ID로 현재 history entry만 교체하며, 오래된 active draft도 기간 조건 없이 `작업 중`에서 복원함. 내부 목록 이동은 현재 save cycle의 최종 change ID가 D1 revision으로 승인되고 선택한 이미지의 private source 접수가 끝난 뒤에만 `location.assign`을 실행함. 저장 실패·409·Access 만료·미접수 원본에서는 route와 uncontrolled 입력을 유지하고 native dialog에 `다시 저장 / 현재 화면 유지 / 변경 내용 복사`만 제공하며, dirty·saving·미접수 파일의 browser unload는 native 경고로 보호함. private R2 저장 실패 응답의 로컬 `File`은 제거하지 않고 실패 manifest를 정리한 뒤 같은 화면에서 재접수할 수 있게 하며, 응답 자체가 불명확한 source upload는 자동 재전송하지 않음. lifecycle 전이 중 남은 draft는 안정 URL에서 읽기 전용으로 복원하되 기존 publish candidate freeze를 넓히지 않음. local build·SQLite에서 stable ID 404, URL filter/count/attention 우선 정렬, 2001년 active draft 보존, withheld 읽기 전용과 save 거부를 검증했으며 실제 staging browser의 save 실패·409·PIN 만료 이동 차단 증거는 아직 미기록
- Studio UI: worker와 client가 같은 제한 Markdown validator를 사용하고 native textarea selection을 보존하는 toolbar와 오류 위치 표시를 추가함. React node만으로 Portfolio card/detail과 Discord starter 두 미리보기를 만들고 Access 보호 asset preview가 ready derivative 또는 private source fallback만 반환하게 함. taxonomy는 canonical catalog·동기화 상태·원인·확인 시각과 add·rename·reorder·archive를 접힌 관리 영역에서 제공하며, 보관 topic은 새 선택에서 제외하되 같은 mutable draft의 기존 선택만 저장·해제할 수 있게 D1 helper까지 맞춤. 이미지 manifest는 upload·detach·alt·순서 모두 같은 draft revision CAS를 사용하고, drag와 위·아래 button, 1.5초 autosave, 이동 전 manifest flush를 제공함. `/studio/media`는 post 제목·upload 날짜·asset 상태 검색, source·Portfolio·Discord 상태와 owner editor 이동, retention·참조를 서버에서 다시 확인하는 특정 orphan cleanup만 제공함. 목록과 전달 영역은 Portfolio·Discord 상태·원인·마지막 확인 시각을 text로 표시하고 오래된 응답의 action을 막으며, finalizing retry가 Discord mutation을 반복하지 않는다는 점을 명시함. 새 dependency·Context·table·migration 없이 기존 D1·R2·Queue 계약을 재사용했고 local build·21개 Studio runtime fixture에서 보관 topic 유지·해제·재선택 거부, manifest reorder·alt·stale revision·exact membership, 두 surface preview, Media filter와 특정 orphan cleanup을 검증함. 실제 staging browser 재시작·재로그인 증거는 아직 미기록
- 최초 게시와 알림: Discord create는 candidate와 outbox를 먼저 기록하고 fresh verify 뒤에만 current pointer를 이동함. 최초 게시 finalization transaction이 dedupe key `notify:{post_id}:{version_id}`의 `notification/send` job을 한 번만 만들며 update·republish·restore는 만들지 않음. 알림은 고정 문구, 지정 role만 포함한 `allowed_mentions`, dedupe key SHA-256 기반 nonce와 `enforce_nonce`를 사용하고 remote message ID를 저장함. Queue 전달 실패는 같은 job을 재개하되 network·5xx·응답 불일치는 `outcome_unknown`에서 멈춰 자동 재전송하지 않으며, local integration fixture로 최초 게시 한 번·update 무알림·Queue 재개·결과 불명 무재생을 검증함
- update 결과 불명 복구: update candidate를 검증하기 전까지 이전 current와 `published` 상태를 유지하고 새 publish를 막음. 결과 불명 job의 `reconcile` action은 Discord starter를 fresh GET으로 읽기만 하며 remote가 candidate와 일치할 때 D1 finalization만 수행하고 PATCH를 반복하지 않음. Discord PATCH 적용 뒤 응답 손실 fixture에서 mutation 1회, 기존 current 유지, reconcile 뒤 pointer 교체를 검증함
- 공개 lifecycle과 purge: unpublish는 Portfolio current만 숨기고 Discord mapping을 보존하며 republish는 같은 mapping을 mutation·알림 없이 복구함. archive는 local visibility를 먼저 차단한 뒤 Discord thread를 삭제하고 private source와 archive snapshot을 보존함. restore는 새 thread를 `SUPPRESS_NOTIFICATIONS` flag로 만들고 fresh verify 뒤 같은 slug에 새 mapping을 연결함. permanent purge는 exact NFC 제목 확인 뒤 asset별 기존 `asset/delete` outbox를 fan-out하고 exact private·Discord·public R2 key 삭제, strong absence·prefix empty·cache purge를 모두 확인한 뒤 최소 tombstone만 남김. local lifecycle fixture에서 잘못된 제목 거부, R2 실패·동일 job 재개, 새 mapping·같은 slug·무알림과 tombstone을 검증함
- pin·Hero: 기존 `pinned_at`과 nullable `hero_rank` partial unique index를 그대로 사용하며 별도 table·migration을 추가하지 않음. action은 Studio status 응답의 `updatedAt`을 CAS token으로 사용하고 기존 owner 해제와 새 owner 지정을 한 transaction에서 처리함. published current만 큐레이션할 수 있고 unpublish에서 pin·Hero를 함께 해제함. 두 post fixture로 stale pin `409`, 단일 pin·rank, rank 이동과 unpublished 거부를 검증함
- rollback: Wrangler migration ledger로 한 번만 적용한다. 원격 적용 뒤 `0004`–`0006`을 수정·삭제하거나 이전 migration을 재실행하지 않고, 문제가 생기면 영향 trigger·index 또는 outbox CHECK를 되돌리는 새 forward migration을 작성한다
- staging publish/update fixture: remote 미기록; local create·update·notification·결과 불명 fixture 통과
- archive/restore/purge fixture: remote 미기록; local lifecycle·R2·cache purge fixture 통과
- Go/No-Go: Phase B 1–11 구현과 36개 automated contract는 local Go. 실제 staging migration·publish lifecycle·browser 재시작/재로그인·이동 실패 fixture와 public route/media archive 증거는 미통과이며 production 승인은 하지 않음

## 다음 Phase

backend invariant와 Studio workflow가 모두 통과한 뒤 [Phase C — Portfolio projection](./phase-c-portfolio-projection.md)으로 이동한다. 공개 UI에서 backend 결함을 가리지 말고 Phase B에서 먼저 해결한다.
