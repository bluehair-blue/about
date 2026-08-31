# Phase D staging 수동 검증 runbook

> 범위: `about-staging`과 test Discord만 사용한다. production migration·배포·secret·Discord에는 쓰기 작업을 하지 않는다.
>
> 실행 위치: 이 저장소 루트의 PowerShell과 Cloudflare Dashboard, Access로 보호된 Studio UI.

이 절차는 한 개의 disposable post로 Access 재인증, 3장 touch gallery, Discord 게시·보관, R2 exact-key 삭제와 global cache purge를 순서대로 검증한다. 실패·결과 불명 상태를 만들려고 D1·R2·Discord를 직접 수정하지 않는다.

## 0. 중단 조건

- 쓰기 대상은 Worker `about-staging`, D1 `about-studio-staging`, R2 `about-studio-media-staging`, Queue `about-studio-publish-staging`, Discord BOT TEST뿐이다.
- `npm run deploy`, environment 없는 `wrangler deploy`, production migration apply는 실행하지 않는다.
- 명령 출력의 대상 이름이나 D1 ID가 [`wrangler.jsonc`](../../wrangler.jsonc)의 `env.staging`과 다르면 즉시 중단한다.
- UI가 `publishing`, `archiving`, `purging`, `queue_failed`, `outcome_unknown`에 머물면 같은 버튼을 다시 누르지 않는다. 먼저 D1 post와 delivery job을 조회한다.
- token, Access JWT, PIN, attachment URL을 문서·Git·shell history·채팅에 남기지 않는다.

## 1. 시작 상태 기록

아래 명령은 읽기 전용이다.

```powershell
git status --short --branch
git rev-parse HEAD
npx wrangler deployments list --name about-staging
npx wrangler deployments list --name about
npx wrangler d1 migrations list STUDIO_DB --env staging --remote
npx wrangler d1 migrations list STUDIO_DB --remote
npx wrangler secret list --env staging
npx wrangler secret list
```

2026-08-31 기준 시작점은 staging version `eac4da09-8f0d-4b1a-b5da-6f67af9613f0`, production version `6ec4757e-36f6-4980-84d5-cb1812928858`, staging pending migration 0, production applied migration 0이다. secret 등록 뒤 staging version은 바뀌므로 새 ID를 기록한다.

## 2. 최소 권한 cache purge token

Cloudflare Dashboard의 `내 프로필 → API 토큰 → 토큰 생성 → 사용자 설정 토큰`에서 다음 값만 선택한다.

| 항목 | 값 |
| --- | --- |
| 이름 | `hanparan staging cache purge` |
| 권한 | `영역 → 캐시 제거 → 제거` |
| 영역 리소스 | `포함 → 특정 영역 → bluehair.blue` |
| 다른 권한·영역 | 추가하지 않음 |

Cloudflare는 Cache Purge를 zone 권한으로 제공한다. 권한 목록은 [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)에서 확인한다.

생성된 값은 한 번만 표시된다. 파일이나 환경 변수에 저장하지 말고 아래 대화형 prompt에 바로 붙여넣는다.

```powershell
npx wrangler secret put CLOUDFLARE_CACHE_PURGE_TOKEN --env staging
Set-Clipboard -Value ""
npx wrangler secret list --env staging
npx wrangler deployments list --name about-staging
```

`secret put`은 staging Worker의 새 version을 즉시 배포한다. secret 목록에는 값이 아니라 `DISCORD_BOT_TOKEN`, `CLOUDFLARE_CACHE_PURGE_TOKEN` 이름만 보여야 한다. production에 같은 secret을 등록하지 않는다. 자세한 동작은 [Cloudflare Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)를 따른다.

## 3. disposable draft와 Access 재인증

1. `https://about-staging.odeye3217.workers.dev/studio/posts/new`에서 새 초안을 연다.
2. 제목은 40자 이하의 고유 값으로 쓴다. 예: `Phase D purge 검증 2026-08-31 1430`.
3. 본문에 목적과 실행 시각을 적고 `저장됨`을 확인한다.
4. `/studio/posts/{postId}`가 된 현재 URL과 정확한 제목을 별도 메모한다.
5. 별도 탭에서 `https://about-staging.odeye3217.workers.dev/cdn-cgi/access/logout`을 연다. Access token이 거부되기까지 20–30초 기다린다.
6. 편집기 탭으로 돌아와 본문 끝에 `PIN 재인증 복구 확인`을 추가하고 `지금 저장`을 누른다.
7. 다음을 확인한다.
   - `다시 로그인 필요`가 표시된다.
   - URL과 입력 내용이 그대로 남는다.
   - `작업 목록`을 누르면 `저장하지 못해 이동을 멈췄어요` dialog가 열린다.
   - dialog에 `다시 저장 / 현재 화면 유지 / 변경 내용 복사`만 있다.
8. `현재 화면 유지`를 누르고 새 탭에서 Studio에 다시 로그인한다.
9. 편집기 탭에서 `지금 저장`을 누른 뒤 `저장됨`을 확인한다.
10. 같은 stable editor URL을 새로 열어 변경 내용이 복원되는지 확인한다.

Access logout은 모든 Access application session을 해제한다. application logout URL과 전파 시간은 [Cloudflare Access session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)를 따른다. 이 검사는 자연 만료를 기다리는 대신 같은 401/403 복구 경계를 재현한다.

## 4. 이미지 3장과 Discord 게시

같은 post에 저장소가 소유한 아래 세 파일을 올린다.

```text
public/works/prime-city.webp
public/smoke-ribbon.png
public/og.png
```

현재 파일 크기는 각각 `832×1216`, `948×1659`, `1731×909`라 세로·가로 혼합 gallery를 함께 검증한다.

1. 각 이미지에 서로 구분되는 alt를 입력한다.
2. 세 항목 모두 `준비 완료`와 Portfolio·Discord byte를 표시할 때까지 기다린다.
3. alt·순서가 `저장됨`인지 확인한다.
4. `게시·Forum 작업 → BOT TEST에 게시`를 한 번 누른다.
5. Studio의 post 상태가 `published`, Discord delivery가 `succeeded`인지 확인한다.
6. BOT TEST Forum에서 제목·본문·tag·첨부 3장 순서가 Studio와 같은지 확인한다.

`postId`는 editor URL에서 복사한다. 아래 조회로 slug, thread, asset exact key와 job을 기록한다.

```powershell
$phaseDPostId = "<editor URL의 UUID>"
npx wrangler d1 execute STUDIO_DB --env staging --remote --command "SELECT p.id,p.slug,p.status,p.current_version_id,p.discord_thread_id,p.discord_starter_message_id,p.discord_delivery_state,p.discord_checked_at,v.title FROM studio_posts p LEFT JOIN studio_post_versions v ON v.id=p.current_version_id WHERE p.id='$phaseDPostId'"
npx wrangler d1 execute STUDIO_DB --env staging --remote --command "SELECT id,status,created_prefix,private_source_key,discord_r2_key,public_r2_key,source_bytes,public_bytes,discord_bytes FROM studio_assets WHERE post_id='$phaseDPostId' ORDER BY created_at,id"
npx wrangler d1 execute STUDIO_DB --env staging --remote --command "SELECT id,target,action,status,attempts,error_code,remote_id,updated_at FROM delivery_jobs WHERE post_id='$phaseDPostId' ORDER BY created_at,id"
```

slug와 첫 asset ID를 변수로 옮겨 공개 경로를 확인한다.

```powershell
$phaseDSlug = "<조회된 slug>"
$phaseDAssetId = "<조회된 asset UUID>"
$phaseDEncodedSlug = [Uri]::EscapeDataString($phaseDSlug)
$phaseDDetailUrl = "https://about-staging.bluehair.blue/updates/$phaseDEncodedSlug"
$phaseDMediaUrl = "https://about-staging.bluehair.blue/media/$phaseDAssetId/portfolio-v1.webp"
curl.exe -sS -D - -o NUL $phaseDDetailUrl
curl.exe -sS -D - -o NUL $phaseDMediaUrl
```

두 경로 모두 `200`이어야 한다. media에는 `cache-control: private, no-store`와 ETag가 있어야 한다.

## 5. 실제 touch swipe

이 단계는 mouse drag나 개발자 도구의 viewport 변경으로 대체하지 않는다.

1. 실제 touch 장치에서 `$phaseDDetailUrl`을 연다.
2. 첫 이미지를 눌러 lightbox를 연다.
3. 왼쪽 swipe로 `1 / 3 → 2 / 3`, 오른쪽 swipe로 `2 / 3 → 1 / 3`을 확인한다.
4. 닫기 뒤 배경 scroll과 다음 조작이 정상인지 확인한다.
5. 장치·브라우저·viewport·검증 시각을 완료 기록에 남긴다.

실제 touch event를 사용하지 못했다면 이 항목은 통과로 표시하지 않는다.

## 6. archive와 permanent purge

### 6.1 archive

1. editor의 `게시·Forum 작업`을 펼친다.
2. `양쪽 공개 보관`을 한 번 누르고 확인 dialog를 승인한다.
3. Discord delete job이 `succeeded`, post가 `archived`가 될 때까지 기다린다.
4. BOT TEST thread가 사라졌는지 확인한다.
5. detail과 세 media URL이 `404`이며 `cache-control: no-store`인지 확인한다.
6. root와 `/community`에 post와 Discord CTA가 없는지 확인한다.

상태가 오래 `archiving`이면 버튼을 다시 누르지 않고 다음 조회만 실행한다.

```powershell
npx wrangler d1 execute STUDIO_DB --env staging --remote --command "SELECT id,slug,status,discord_thread_id,discord_delivery_state,archived_at,updated_at FROM studio_posts WHERE id='$phaseDPostId'"
npx wrangler d1 execute STUDIO_DB --env staging --remote --command "SELECT id,target,action,status,attempts,error_code,updated_at FROM delivery_jobs WHERE post_id='$phaseDPostId' ORDER BY created_at,id"
```

### 6.2 permanent purge

1. archive 전 기록한 정확한 제목을 `permanent purge 제목 재입력`에 붙여넣는다.
2. `원본까지 영구 삭제`를 한 번 누르고 비가역 삭제 확인 dialog를 승인한다.
3. post가 `purged`가 될 때까지 기다린다. `purging`이나 `queue_failed`면 재클릭하지 않는다.
4. 다음 D1 tombstone을 확인한다.

```powershell
npx wrangler d1 execute STUDIO_DB --env staging --remote --command "SELECT id,slug,status,draft_version_id,current_version_id,discord_thread_id,discord_starter_message_id,discord_delivery_state,purged_at,(SELECT count(*) FROM studio_assets WHERE post_id=studio_posts.id) AS asset_count,(SELECT count(*) FROM studio_post_versions WHERE post_id=studio_posts.id) AS version_count FROM studio_posts WHERE id='$phaseDPostId'"
```

정상 결과는 `status=purged`, draft/current pointer `NULL`, delivery state `NULL`, `purged_at` 존재, asset/version count `0`이다. tombstone의 post ID·slug·Discord ID는 재생성 방지를 위해 남으므로 직접 삭제하지 않는다.

5. Cloudflare Dashboard의 R2 `about-studio-media-staging`에서 앞서 기록한 각 `created_prefix`를 검색해 object가 0개인지 확인한다.
6. 더 강한 확인이 필요하면 기록한 세 exact key를 각각 조회한다. 모두 `Object not found`로 실패해야 한다.

```powershell
npx wrangler r2 object get "about-studio-media-staging/<private_source_key>" --remote --pipe > $null
npx wrangler r2 object get "about-studio-media-staging/<discord_r2_key>" --remote --pipe > $null
npx wrangler r2 object get "about-studio-media-staging/<public_r2_key>" --remote --pipe > $null
```

각 asset의 세 key에 반복한다. D1은 R2 exact delete, prefix empty와 Cloudflare single-file purge가 모두 성공하기 전에는 `purged`로 전환되지 않는다.

7. detail은 `410`, 세 media URL은 `404`와 `no-store`인지 확인한다.

```powershell
curl.exe -sS -D - -o NUL $phaseDDetailUrl
curl.exe -sS -D - -o NUL $phaseDMediaUrl
```

## 7. 종료 상태와 production 불변 확인

아래 명령은 읽기 전용이다.

```powershell
npx wrangler secret list --env staging
npx wrangler deployments list --name about-staging
npx wrangler deployments list --name about
npx wrangler d1 migrations list STUDIO_DB --env staging --remote
npx wrangler d1 migrations list STUDIO_DB --remote
npx wrangler secret list
git status --short --branch
```

- production deployment ID, migration ledger와 secret 목록이 시작 상태와 같아야 한다.
- staging에는 cache purge secret 이름과 새 deployment ID가 있어야 한다.
- disposable post는 tombstone만 남고 Discord thread와 R2 object는 없어야 한다.
- 완료 기록에는 token 이름만 쓰고 값은 쓰지 않는다.

## 8. 완료 기록 형식

[`phase-d-recovery-operations.md`](./phase-d-recovery-operations.md)의 완료 기록에 다음만 추가한다.

```text
실행 시각 / 실행자
검증 commit / staging deployment ID / production deployment ID 불변
post ID / slug / asset ID와 prefix / Discord thread ID
publish·delete job ID, attempts, 최종 status
Access logout 뒤 보존된 URL·입력과 재로그인 뒤 저장·재오픈 결과
실제 touch 장치·브라우저·1/3↔2/3 결과
archive 뒤 detail/media 404·no-store
purge 뒤 tombstone, R2 prefix 0, detail 410, media 404·no-store
```

## 9. 현재 수동 검증으로 통과시킬 수 없는 항목

현재 runtime에는 daily drift check, drift review dialog, detach, reconnect, withheld 수동 resume가 없다. 실패·`outcome_unknown`·drift·detached fixture를 만들려고 remote D1 row, Discord thread나 R2 object를 직접 고치지 않는다.

- 실제 update가 자연스럽게 `outcome_unknown`이 된 경우에만 `Discord mutation 없이 원격 대조`를 사용한다.
- create 결과 불명, notification 결과 불명, remote mismatch는 자동 재전송하지 않고 상태와 ID를 기록한 뒤 중단한다.
- `drift`·`detached`는 해당 Phase D runtime action이 구현되기 전까지 No-Go다.

이 제한은 fixture가 없다는 사실을 숨기지 않으면서 staging source-of-truth를 훼손하지 않는 경계다.
