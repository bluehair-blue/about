# Phase D — recovery and operations

> 상태: runtime·local QA 완료, staging full smoke와 사용자가 직접 수행할 global purge 대기 — production No-Go
>
> 목적: 불명 결과·Discord drift·DLQ·retention·배포 중단을 fail closed로 복구하고, 검증된 동일 commit을 production에 승격한다.
>
> 선행 문서: [`phase-c-portfolio-projection.md`](./phase-c-portfolio-projection.md)

## 1. 완료 결과

외부 API·Queue·배포가 중단되어도 공개 원본과 private source가 보존된다. 관리자는 Studio Console에서 어떤 post가 `확인 필요`인지 식별하고, 자동 중복 게시 없이 재시도·차단·연결 해제·재연결·archive·purge를 끝낼 수 있다.

staging에서 검증된 불변 commit과 migration만 수동 승인 한 번을 거쳐 production으로 이동한다. production smoke는 read-only다.

## 2. 시작 조건

- [ ] Phase A–C의 완료 기록과 Go/No-Go가 모두 통과했다. — Phase B/C의 remote purge·일부 실제 browser failure path가 남음
- [ ] staging에 정상·실패·결과 불명·drift·detached·archived fixture가 준비되어 있다. — 정상·archived는 통과, 실패·결과 불명·drift·detached는 없음
- [x] production D1·R2·Queue·DLQ와 Discord target이 staging에서 물리적으로 격리되어 있다. — environment별 physical name/ID가 다르고 production Discord vars는 비어 fail closed함
- [x] 모든 production schema change가 현재 Worker와 호환되는 additive migration이다. — `0001`–`0010` fresh local 적용·재적용 없음과 upgrade fixture를 통과했으며 staging 배포 때 remote suffix를 다시 확인함
- [x] public origin과 기존 build output 계약이 유지된다.

## 3. 읽을 파일과 소유 범위

먼저 읽을 파일:

- 이 문서와 Phase A–C 완료 기록
- [`AGENTS.md`](../../AGENTS.md)
- [`technical-index.md`](../technical-index.md)의 전체 완료·배포 계약
- `db/schema.ts`, `migrations/`, Queue·scheduled·Discord reconciliation module
- [`package.json`](../../package.json), [`vite.config.ts`](../../vite.config.ts)
- [`worker/index.ts`](../../worker/index.ts), [`wrangler.jsonc`](../../wrangler.jsonc), [`.openai/hosting.json`](../../.openai/hosting.json)
- Phase B의 Studio 상태 UI와 Phase C의 cache invalidation 경로

이 Phase가 소유하는 범위:

- fresh check·daily Discord reconciliation
- `withheld`·수동 공개 재개·불일치 resolution
- Discord 연결 해제·재연결
- retry·DLQ·compensation
- scheduled retention cleanup
- export·runbook·privacy 삭제 경로·운영 지표
- local promotion runner, approval gate와 CI migration seam

새 storage provider adapter, microservice, deployment dashboard와 외부 workflow SaaS는 만들지 않는다.

## 4. Discord 점검 계약

fresh check 실행 시점:

- `차이 검토` 직전
- Discord update 직전
- `공개 재개` 직전
- detach thread 재연결 직전

daily check:

- 하루 한 번 `published`이면서 active Discord mapping이 있는 post만 안정 ID 순서의 작은 batch로 Queue에 넣는다.
- thread 존재, starter content hash, attachment 집합과 applied tag를 읽기 전용으로 확인한다.
- draft·withheld·unpublished·archived·purged·detached post는 제외한다.
- remote 응답 불명은 drift로 단정하지 않고 `확인 실패`로 retry한다.
- 설정 UI를 만들지 않고 code의 daily constant 하나를 사용한다.

공개 중인 post의 Discord drift는 delivery state·remote hash·`discord_checked_at`만 `확인 필요`로 바꾼다. Portfolio status·current pointer·pin·Hero·media와 cache는 유지한다. thread를 자동 삭제·재생성·덮어쓰기하지 않는다.

## 5. `확인 필요` UX

- Console 상단 `확인 필요 n` filter와 전체 목록 상단 row만 사용한다.
- row에는 제목·영향 표면·구체적 원인·마지막 확인 시각과 `차이 검토` 하나를 표시한다.
- 색상에만 의존하지 않으며 외부 email·Discord 경고 channel·별도 알림함은 만들지 않는다.
- fresh 성공 또는 명시적인 연결 해제 전에는 경고를 자동 제거하지 않는다.

`차이 검토` native dialog:

- 변경된 본문·이미지·분류 section만 표시
- 기본 보기에는 사람이 읽는 preview, hash·remote ID는 `기술 정보` disclosure
- mismatch의 주 action은 `Discord를 원본에 맞추기`
- `양쪽에서 보관하기…`는 `다른 처리` danger action
- 원본 재적용 뒤 fresh 일치가 확인되어야 `공개 재개` 하나로 전환
- stale snapshot·실패·불명 결과에서는 mutation 없이 같은 화면에 남음

별도 diff dependency, conflict table과 recovery wizard를 만들지 않는다.

## 6. 불명 candidate와 수동 공개 재개

`withheld`는 결과 불명 candidate가 Portfolio current로 노출된 invariant 위반에만 사용한다.

1. remote 조회보다 먼저 D1 batch로 `withheld` 전환
2. public feed·detail·Hero·media에서 즉시 제외
3. post·asset cache purge
4. current pointer·version·pin·Hero·private source·delivery job 보존
5. Discord remote ID·hash·attachment를 대조

자동 재공개하지 않는다. `공개 재개` 직전에 post status·current version·delivery job snapshot과 fresh Discord hash·attachment를 다시 검사한다. 일치할 때만 같은 pointer·mapping으로 `published`를 복원한다. 이미 성공한 notification은 다시 보내지 않고, 결과 불명 notification은 remote부터 대조한다.

## 7. Discord 연결 해제·재연결

연결 해제:

- active mapping을 비우고 delivery state를 `detached`로 변경
- remote ID·hash·해제 시각·사유는 `detach` delivery job에 보존
- 기존 thread·댓글·Portfolio 공개본·pin·Hero·media 유지
- feed·detail·community cache를 purge해 Discord CTA만 제거
- daily check와 `확인 필요`에서 제외
- remote thread mutation과 알림 없음

재연결:

- 과거 remote ID를 fresh 조회하고 Bot starter 소유·정확한 Forum parent·수정 권한·mapping unique를 확인
- 조건을 통과한 기존 thread만 승인본으로 update하고 fresh hash·attachment·tag 검증 뒤 mapping·CTA 복원
- 알림 role ping 없음
- 실패·불명에서는 `detached` 유지
- 재사용 불가일 때만 별도 승인 `새 Discord 글 만들기…`를 표시하며 자동 fallback과 remote ID 직접 입력 UI는 없음

## 8. DLQ·retention·삭제

DLQ:

- delivery job은 dedupe key와 마지막 성공 phase를 보존한다.
- create/update 결과 불명은 remote 대조 전 재전송하지 않는다.
- Discord 성공 뒤 D1 finalization 실패는 external call 없이 finalization만 retry한다.
- restore finalization이 끝내 실패하면 새 thread 삭제 compensation을 검증한 뒤 archive로 돌아간다.

retention:

- `ASSET_ORPHAN_RETENTION_DAYS=7`
- `VERSION_ROLLBACK_RETENTION_DAYS=30`
- 값은 1–3,650 정수만 허용; 누락·오류면 cleanup 전체 중단
- scheduled handler는 candidate만 Queue에 넣고 consumer가 삭제 직전 reference·active job·현재 retention을 다시 검사
- published private source와 private archive source는 자동 삭제하지 않음

permanent purge:

- private archive danger zone과 제목 재입력 확인에서만 시작
- manifest exact key 삭제, public cache purge와 prefix empty 검증
- 모든 R2 object가 사라지기 전에는 `purged` 금지
- 재생성 방지용 최소 tombstone ID·slug·Discord ID·`purged_at`만 유지

## 9. export·privacy·운영 상태

- post·version·taxonomy·delivery 상태 JSON export
- asset exact-key·hash·MIME·dimension manifest export
- private source bytes는 export manifest와 별도 명시적 작업으로 취급
- rollback·archive·restore·retention·DLQ·promotion runbook
- staging token·Access 재인증·touch·archive·purge 수동 검증은 [`phase-d-staging-operator-runbook.md`](./phase-d-staging-operator-runbook.md)를 따른다.
- privacy policy와 원본 삭제 요청 경로
- 마지막 성공 시각, 실패율, 처리 시간만 운영 상태로 표시
- Discord profile·member list·댓글·reaction·DM·Patreon supporter data와 방문자-Discord 결합 정보는 저장하지 않음
- token·Access JWT·attachment URL·Discord user ID를 log에 남기지 않음

export는 provider migration seam일 뿐 다른 storage adapter나 자동 cutover를 구현하지 않는다.

## 10. environment와 promotion 계약

| logical binding | staging | production |
| --- | --- | --- |
| `STUDIO_DB` | `about-studio-staging` | `about-studio-production` |
| `STUDIO_MEDIA` | `about-studio-media-staging` | `about-studio-media-production` |
| `PUBLISH_QUEUE` | `about-studio-publish-staging` | `about-studio-publish-production` |
| publish DLQ | `about-studio-publish-dlq-staging` | `about-studio-publish-dlq-production` |

- code는 logical binding만 사용하고 Queue payload·D1 row에 environment·resource ID를 넣지 않는다.
- `wrangler.jsonc`가 physical resource를 소유하고 `.openai/hosting.json`에는 project ID와 logical D1/R2 declaration만 둔다.
- OpenAI Sites preview와 직접 Cloudflare environment가 같은 physical resource라고 가정하지 않는다.
- production은 `about`·`about.bluehair.blue`, staging은 `about-staging`과 해당 `workers.dev` origin을 사용한다.

초기 runner:

- `npm run promote` → Node 표준 기능의 `tooling/promote.mjs` 하나
- phase는 `staging / production` 두 개만 존재하며 같은 함수·검증을 재사용
- staging이 secret 없는 `studio-promotion/v1` manifest 생성
- manifest: commit SHA, migration·lockfile·Wrangler hash, target resource 이름, staging deployment ID와 smoke 결과
- production은 manifest와 현재 commit·hash·target이 하나라도 다르면 거부
- local state는 Git 제외된 `.wrangler/promotions/`에 저장

승격 순서:

1. lint·test 통과 commit 고정
2. staging resource preflight
3. staging migration·deploy
4. test Bot create·update·delete·restore·role·Queue smoke
5. commit·migration·smoke·production target 표시 후 수동 승인
6. production에 같은 migration·commit 적용
7. production deployment·binding·application을 read-only smoke로 대조

staging 실패 시 production 명령은 한 번도 실행하지 않는다. production smoke는 post·thread·notification을 만들지 않는다.

## 11. 승인 폐기와 runner migration

- 승인 대기 run이 거부·중단·종료되면 `approval_revoked`로 폐기하고 새 run은 staging부터 다시 시작한다.
- 처리 가능한 종료는 즉시, 강제 종료는 다음 실행의 첫 단계에서 `history.jsonl`에 기록한다.
- event에는 run ID·commit·시각·사유·마지막 phase만 기록하고 secret·email·Discord user를 넣지 않는다.
- production concurrency는 하나다.

CI로 옮길 때도 `tooling/promote.mjs staging/production`과 manifest schema·exit code를 그대로 사용한다. 바뀌는 것은 checkout, artifact 전달, approval UI와 credential 주입뿐이다. application code·migration·Queue·Bot handler는 CI provider를 import하지 않는다.

## 12. 구현 순서

1. fresh check와 daily reconciliation — 구현·local fixture 완료
2. `확인 필요` filter·dialog·manual resume — 구현·local fixture 완료
3. detach·reconnect — 구현·local fixture 완료
4. delivery retry·DLQ·compensation — 구현·local fixture 완료
5. scheduled retention cleanup — 구현·local fixture 완료
6. archive·restore·purge destructive-path 검증 — local fixture 완료, remote purge는 사용자 실행 대기
7. JSON·asset manifest export와 runbook — 완료
8. promotion runner·manifest·approval revocation — 구현·local fixture 완료
9. staging full smoke — 실행 대기
10. 명시적 승인 뒤 production promotion과 read-only verification — 승인 없음, 실행 금지

## 13. 최종 Go/No-Go

- [x] staging 작업이 production D1·R2·Queue·Discord를 바꾸지 않음
- [x] daily drift가 정상 Portfolio를 내리거나 Discord를 자동 덮어쓰지 않음 — local integration fixture
- [x] `확인 필요` post가 제목·원인·시각으로 식별됨 — UI contract와 local integration fixture
- [x] `withheld` media 차단과 수동 fresh resume 통과 — local public/runtime fixture
- [x] detach가 remote 대화를 보존하고 CTA·daily check만 제거함 — local runtime fixture; 공개 응답은 no-store
- [x] reconnect가 안전한 기존 thread만 재사용하고 실패 시 자동 create하지 않음 — local runtime fixture
- [x] duplicate Queue delivery에도 post·version·notification 중복 없음 — local runtime fixture
- [ ] archive·restore·purge·retention·DLQ fixture 통과 — local 5개 경로 통과, remote purge와 실제 DLQ는 대기
- [x] 잘못된 retention 값에서 cleanup 중단 — scheduled local fixture
- [x] promotion manifest가 commit·migration·target 변경을 거부함 — promotion unit fixture
- [x] 중단된 승인이 폐기되고 production 명령이 실행되지 않음 — approval/unknown state unit fixture; production 명령 미실행
- [ ] production smoke가 read-only임
- [x] `npm run lint`와 `npm test` 통과 — 2026-08-31, 60/60
- [x] build output 세 항목과 public origin `https://about.bluehair.blue` 확인 — production exact-target build 검증

## 14. 완료 기록

- commit: Phase A–C intent 보정·Phase C projection `596f5ba`; staging 발견 결함 복구 `a41bf3b`; production 직접 배포·target 경계 차단 `85e1ecb`; promotion migration preflight `be8c2a8`; fresh check `5e49f37`; daily check `e0a9f77`; 수동 복구 `83a942c`; 보존·운영 복구 `1c89630`; promotion runner `bba8d93`
- 2026-08-31 진입 감사: Phase A–C의 intent와 자동 계약을 재검토하고 local migration drift·Queue/notification·역할 패널·이미지 dimension/checksum·public cache·public route runtime 결함을 보정함. 적용된 migration은 수정하지 않았고 `npx tsc --noEmit`, `npm run lint`, `npm test` 52/52 뒤 exact staging target과 custom purge origin을 Worker version `eac4da09-8f0d-4b1a-b5da-6f67af9613f0`에 배포함
- 시작 조건 No-Go: 정상 restore와 archived revocation acceptance, exact target guard, additive migration promotion preflight는 통과했으나 실패·결과 불명·drift·detached staging fixture와 remote global cache purge가 없음
- promotion preflight evidence: clean commit `be8c2a879f996e3f228eb5e004a275c219a9749b`에서 migration `0001`–`0007`을 fresh local D1에 적용한 뒤 pending 0을 재확인했다. staging pending 0, production applied 0/pending 7이며 mutation은 없었다. SHA-256은 migrations `f2ccc301289d91890792a1b9bf6adbb24ce2d326a0ebb4a1d0f3e5a62f8a06a3`, lockfile `c53e98a74b7a5b2b9249161b4162f5b5c40c1e4b5f41079362be2db7f209fa2d`, Wrangler `964789bb1f1f3cf791f6b6fba1b963cb217c2b830a7acdb150c3c3e44928a982`다
- curation CAS follow-up: 같은 밀리초의 연속 pin·Hero 변경에서도 stale 요청을 거부하도록 additive `0008_phase_d_curation_revision.sql`이 정수 revision과 lifecycle trigger를 추가한다. API는 `updated_at`을 충돌 토큰으로 받지 않으며 production에는 명시적 승인 전 이 migration을 적용하지 않는다
- physical isolation evidence: staging/production D1 ID, R2 bucket, publish Queue와 DLQ가 모두 분리됨. staging Queue producer/consumer는 1/1, production Queue와 DLQ는 0/0이며 production D1 migration count 0, production Worker version `6ec4757e-36f6-4980-84d5-cb1812928858`은 유지됨. production Discord vars가 없어 production runtime은 fail closed함
- reconciliation/DLQ evidence: local integration에서 outcome-unknown update fresh reconciliation, duplicate 방지, malformed payload DLQ와 missed notification enqueue 복구는 통과했으나 해당 remote staging fixture는 없음
- archive/restore/purge evidence: post `e222f213-7a71-499d-ad90-588a93aaad45`의 restore create `31050261-7f40-484e-918a-4d714e49777b`과 archive delete `0f991cef-2936-4315-8217-fcf9bbb79156`가 각 1회 succeeded. restore 중 detail/media/CTA 공개와 archive 뒤 detail·media `404`·`no-store`, root/community 비노출을 확인하고 최종 archived로 정리함. purge는 staging token·실제 호출 증거 부재로 미실행
- Phase D local evidence: `npm run lint -- --no-cache`, `npx tsc --noEmit`, production exact-target build와 `npm test` 60/60. fresh drift/align, daily dedupe·제외 상태, withheld fresh resume, detach/reconnect, outcome-unknown·DLQ, scheduled retention·invalid config, restore compensation, secret-free export·운영 지표, approval revocation·production unknown 차단 fixture가 통과함
- 운영자 실행 경계: cache purge token 생성·staging 등록·global purge는 사용자가 직접 수행하며, 정확한 순서와 확인 명령은 [`phase-d-staging-operator-runbook.md`](./phase-d-staging-operator-runbook.md)에 기록함. production 승인과 mutation은 없음
- promotion run ID: 미기록
- production read-only smoke: 미기록
- Go/No-Go: 미통과

## 다음 Phase

다음 구현 Phase는 없다. 이 문서의 최종 Go/No-Go와 production verification이 통과하면 정기 운영은 여기서 작성한 runbook을 따른다. 새 기능은 실제 두 번째 요구가 생겼을 때 별도 Phase로 추가한다.
