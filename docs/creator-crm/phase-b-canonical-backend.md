# Phase B — canonical publishing backend

> 상태: 진행 중 — 1–2. schema·migration과 D1 domain helper local 완료, staging 적용 대기
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
3. **taxonomy**
   - 초기 kind·topic seed와 Discord tag ID mapping을 넣는다.
   - add·rename·reorder·archive를 구현하되 stable key는 바꾸지 않는다.
4. **asset manifest와 cleanup**
   - upload 상태 `uploading / processing / ready / orphan / failed / deleting`을 복원 가능하게 저장한다.
   - exact-key delete, prefix empty 검증과 public cache purge를 구현한다.
5. **draft autosave**
   - 1.5초 debounce, IME `compositionend`, 한 번에 save 하나, revision compare-and-swap을 구현한다.
   - `Ctrl/Cmd+S`, native undo/redo와 409 충돌을 검증한다.
6. **안전한 작업 이동**
   - `/studio/posts/{post_id}` 안정 URL과 `전체 / 작업 중 / 확인 필요` URL filter를 사용한다.
   - 이동 전 최신 revision과 private upload 접수를 flush하고, 실패·충돌·PIN 만료에서는 route를 유지한다.
   - active draft는 자동 만료하지 않으며 `작업 중` 목록에서 재개한다.
7. **Studio UI**
   - 목록, 편집기, 두 surface preview, Media 검색, 상태·재시도만 구현한다.
   - 색상 외에 상태 text·원인·마지막 확인 시각을 제공하고 action을 한 화면에 펼치지 않는다.
8. **새 게시 saga**
   - ready asset → candidate와 create job 기록 → Discord create·fresh verify → current pointer와 `published` finalization 순서를 강제한다.
   - 결과 불명은 `outcome_unknown`으로 멈추고 자동 create를 반복하지 않는다.
   - 최초 게시 finalization 뒤에만 deduped opt-in notification을 enqueue한다.
9. **수정 saga**
   - 기존 current를 유지한 채 candidate와 update job을 만들고 Discord hash·attachment·tag가 일치한 뒤 pointer를 교체한다.
   - update 불명은 remote hash를 먼저 대조하며 Discord 성공 뒤 finalization만 실패하면 edit를 반복하지 않는다.
10. **공개 중지·archive·restore·purge**
    - 공개 중지는 Portfolio만 숨기고 Discord thread를 유지한다.
    - archive는 Portfolio·media를 먼저 차단한 뒤 Discord thread를 삭제하고 private source를 보존한다.
    - restore는 private source로 새 Discord thread를 만들고 `SUPPRESS_NOTIFICATIONS` 검증 뒤 같은 slug를 공개한다.
    - permanent purge는 제목 재입력 뒤 exact R2 key를 삭제하고 최소 tombstone만 남긴다.
11. **pin·Hero**
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
- [ ] 새 게시·수정 실패 중 이전 정상 current 유지
- [ ] create/update 결과 불명에서 자동 재전송 없음
- [ ] archive 뒤 public route·media 차단, private source 보존
- [ ] restore가 새 Discord mapping과 같은 slug를 사용하고 알림을 보내지 않음
- [ ] purge가 exact key·prefix empty·cache purge를 검증하고 tombstone을 남김
- [ ] taxonomy archive가 새 선택지와 Discord available tag에서 제거됨
- [ ] 비인증 Studio page·API와 잘못된 same-origin write 거부
- [x] `npm run lint`와 `npm test` 통과
- [x] `technical-index.md`와 generated binding·migration 계약 동기화

## 9. 완료 기록

- commit: 미기록
- migration: `0004_phase_b_canonical_schema.sql`. Phase A 7-table row를 보존하는 outbox rebuild와 notification·cache 작업 pair, pointer·outbox post ownership, 승인본과 job-bound candidate snapshot·state·delete 및 outbox identity 불변성, active delivery 중 비검증 current·Discord mapping 이동 차단, topic·asset 상한과 같은-post asset, 단일 pin·Hero rank, lowercase SHA-256, version·asset cleanup·reverse asset·delivery query index를 추가함. fresh `0001`–`0004`와 기존 `0001`–`0003` 정상 row upgrade를 local SQLite에서 재현하고, 기존 비정상 hash·taxonomy·asset/outbox ownership row와 진행 중인 구형 Discord create/update job은 rebuild 전에 fail closed함. `PRAGMA foreign_key_check`와 representative `EXPLAIN QUERY PLAN`을 통과했고 Wrangler local migration ledger에서도 적용 뒤 재실행이 `No migrations to apply`로 끝남. remote staging·production에는 아직 미적용
- D1 domain helper: `worker/studio-domain.ts`가 draft create·revision CAS, exact draft/topic/asset snapshot 기반 candidate와 outbox 생성, archive 시작, 검증 완료 delivery의 current pointer finalization만 소유함. Discord·R2·Queue I/O는 기존 runtime에 유지함. 게시 준비와 no-change 판정 중 revision/source/topic/asset 또는 mapping이 바뀌면 candidate·job·`publishing` 전이를 모두 거부하고, active delivery 중 검증 job과 일치하지 않는 current/mapping 이동을 DB에서도 막음. job payload의 exact asset manifest를 처리 전에 다시 대조하며, Queue send와 실패 기록이 함께 실패해 `queued` outbox만 남아도 관리자 retry로 다시 enqueue할 수 있음. `finalizing` 재시도는 delivery 상태를 `queued`로 되돌리지 않아 Discord create/update/delete를 반복하지 않고 D1 finalization만 다시 수행함
- rollback: Wrangler migration ledger로 한 번만 적용한다. 원격 적용 뒤 `0004`를 수정·삭제하거나 이전 migration을 재실행하지 않고, 문제가 생기면 영향 trigger·index 또는 outbox CHECK를 되돌리는 새 forward migration을 작성한다
- staging publish/update fixture: 미기록
- archive/restore/purge fixture: 미기록
- Go/No-Go: schema·D1 domain helper 단계 local Go. Phase B 전체와 staging migration은 미통과

## 다음 Phase

backend invariant와 Studio workflow가 모두 통과한 뒤 [Phase C — Portfolio projection](./phase-c-portfolio-projection.md)으로 이동한다. 공개 UI에서 backend 결함을 가리지 말고 Phase B에서 먼저 해결한다.
