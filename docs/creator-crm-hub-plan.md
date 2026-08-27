# Bluehair Studio Console + Discord Community + Patreon Support + Portfolio Publishing Plan

> 공개 브랜드: **Bluehair Community**
>
> 운영 도구: **Studio Console**
>
> 상태: 설계 결정 기록 완료 · Phase A–D 실행 패킷 분리 완료 · D0 Q43 Phase A 전환 확인 중
>
> 최종 갱신: 2026-08-27
>
> 공개 origin: `https://about.bluehair.blue`
>
> 문서 목적: 비공개 Studio Console에서 콘텐츠를 한 번 작성·승인하면 Portfolio와 Discord Forum에 자동 반영하고, Patreon은 혜택을 약속하지 않는 순수 후원 결제 경로로만 사용한다.

## 구현 실행 문서

이 문서는 결정 배경과 전체 계약을 보존하는 **설계 기록**이다. 실제 구현에서는 전체 문서를 컨텍스트로 넣지 않고 현재 Phase 문서 하나와 그 문서가 지정한 저장소 파일만 읽는다.

| 순서 | 실행 문서 | 완료 결과 |
| --- | --- | --- |
| A | [`Phase A — Studio Console ↔ Discord vertical slice`](./creator-crm/phase-a-studio-discord-spike.md) | 관리자 전용 test 환경에서 create·update·delete·role·image delivery 증명 |
| B | [`Phase B — canonical publishing backend`](./creator-crm/phase-b-canonical-backend.md) | D1/R2 기준 원본, Studio workflow와 publish lifecycle 완성 |
| C | [`Phase C — Portfolio projection`](./creator-crm/phase-c-portfolio-projection.md) | 공개 SNS feed·Hero·gallery·상세 route 완성 |
| D | [`Phase D — recovery and operations`](./creator-crm/phase-d-recovery-operations.md) | reconciliation·DLQ·retention·promotion과 production 검증 완성 |

각 Phase의 완료 증거가 모두 채워지기 전에는 다음 문서를 구현하지 않는다. 현재 Phase에서 결정이 비어 있을 때만 이 설계 기록의 해당 항목을 찾아보고, 긴 결정 로그·비교안·미래 범위는 구현 컨텍스트에 포함하지 않는다.

## 1. 결론

**후방 운영 허브를 따로 두는 편이 더 효율적이다.**

다만 이 도구는 회원 생애주기·영업·이메일 캠페인을 다루는 범용 CRM이 아니다. 초기 범위는 다음 세 가지뿐인 작은 CMS 겸 배포 콘솔이다.

1. 게시물과 이미지의 기준 원본 관리
2. Portfolio·Discord 배포와 상태 확인
3. category·topic·고정 post·Hero 큐레이션 관리

이 구조로 전환하면 Discord에 글을 쓴 뒤 별도 명령으로 Portfolio에 승인하는 절차가 사라진다. 운영자는 Studio Console에서만 생성·수정·내리기·삭제하고, Discord와 Portfolio는 같은 승인본을 서로 다른 방식으로 보여준다.

### 왜 Discord-first보다 나은가

Discord-first는 초기 개발량이 작지만, 운영 수명이 길어질수록 다음 문제가 생긴다.

- Discord Forum 글, tag, 첨부 파일과 Portfolio 공개본 사이에 두 개의 편집 상태가 생긴다.
- Discord의 일반 HTTP Webhook Events에는 guild `THREAD_DELETE`나 `CHANNEL_UPDATE`가 없다. native 삭제·tag 변경을 즉시 감지하려면 상시 Gateway 연결과 heartbeat·reconnect 운영이 필요하다.
- Discord에서 삭제가 먼저 일어나면 Portfolio·D1·R2를 정리하는 별도 reconciliation이 필요하다.
- 장문, 예약 게시, 초안, Hero 순서와 배포 실패 복구를 Discord UI에 계속 얹기 어렵다.

반대로 Studio Console-first에서는 Discord가 기준 원본이 아니므로 Discord 쪽 변경을 전부 감시할 필요가 없다. Discord API는 Console이 요청한 create·update·delete를 수행하는 **하향 배포 API**로만 사용한다.

공식 계약:

- [Discord Webhook Events](https://docs.discord.com/developers/events/webhook-events)
- [Discord Gateway Events](https://docs.discord.com/developers/events/gateway-events)
- [Discord Channel Resource — Forum thread 생성·수정·삭제](https://docs.discord.com/developers/resources/channel)
- [Discord Message Resource — bot message 수정과 attachment 교체](https://docs.discord.com/developers/resources/message)

## 2. 비교와 채택 기준

| 항목 | Discord-first | Studio Console-first |
| --- | --- | --- |
| 최초 구현량 | 작음 | 중간 |
| 작성 위치 | Discord Forum | 비공개 Console |
| 기준 원본 | Discord + D1 이중 원본 | D1/R2 단일 원본 |
| Portfolio 게시 | 별도 승인 command | Publish 한 번 |
| Discord 게시 | 사람이 먼저 작성 | Bot이 자동 작성 |
| 수정·삭제 | 두 표면 동기화가 핵심 문제 | Console의 단일 작업으로 fan-out |
| tag 관리 | Discord tag가 원본 | Console taxonomy가 원본 |
| 초안·미리보기 | 제한적 | 자연스럽게 제공 |
| 장애 복구 | Discord 상태 역추적 | delivery job 재시도 |
| 상시 Gateway | native 변경 감지 시 필요 | 불필요 |

사용자가 가장 중요하게 둔 조건은 “각 업로드 표면을 따로 관리하지 않는 것”이다. 따라서 추가되는 작은 관리자 화면의 비용보다 단일 원본과 단일 운영 동작의 이득이 크다.

## 3. 플랫폼별 역할

| 계층 | 책임 | 맡지 않는 일 |
| --- | --- | --- |
| Studio Console | 초안, 미리보기, 승인, 수정, 삭제, 분류, pin·Hero, 배포 상태 | 회원 CRM, 댓글, 결제 |
| D1 | post·version·taxonomy·delivery 상태의 기준 원본 | 이미지 bytes |
| R2 | private source와 public·Discord derivative | 콘텐츠 상태 결정 |
| Queue consumer | 이미지 처리, Discord create·update·delete, retry·DLQ | 별도 제품·microservice |
| Portfolio | 공개 feed, 필터, 상세 URL, 브랜드 경험 | 편집 UI, 댓글, 회원 역할 |
| Discord Forum | Bot이 게시한 글, 댓글, 알림, 무료 커뮤니티 | 콘텐츠 기준 원본, 운영자 CMS |
| Patreon | 자발적 순수 후원 결제 | CMS, 초기 유료 권한·혜택 |
| 향후 email opt-in | 플랫폼 독립 연락처 | 현재 구현 범위 |

공개 팬에게는 다음 두 갈래만 보인다.

~~~text
AI 채팅 플랫폼
        ↓
Portfolio
        ├─ 무료 관계 시작 → Discord Community
        └─ 순수 제작 후원  → Patreon
~~~

운영 흐름은 다음과 같다.

~~~text
Cloudflare Access
        │
        ▼
Studio Console
초안 · preview · publish · update · unpublish · delete
        │
        ▼
Worker write API
        ├──→ R2: private source · public/Discord derivative
        └──→ D1 transaction: post · version · taxonomy · delivery job
                         │
                         ├──→ Portfolio: D1/R2의 승인본을 즉시 읽음
                         └──→ Cloudflare Queue
                                      │
                                      ▼
                              Discord Bot REST API
                              Forum thread · starter · tag
~~~

한 문장으로는 다음과 같다.

> Studio Console은 편집실, Portfolio는 영구 전시장, Discord는 대화가 이어지는 커뮤니티, Patreon은 작업실의 후원함이다.

## 4. 기준 원본과 일관성 계약

### 기준 원본

- 콘텐츠·분류·큐레이션의 유일한 기준 원본은 D1/R2다.
- Studio Console은 이 원본을 변경하는 유일한 지원 UI다.
- Portfolio는 D1/R2의 현재 승인 version을 읽는 projection이다.
- Discord Forum은 Bot이 만든 community projection이다.
- Patreon은 게시 파이프라인에 들어오지 않는다.

### “동시에 반영”의 정확한 의미

D1 transaction과 외부 Discord API를 하나의 원자적 transaction으로 묶을 수는 없다. 따라서 약속하는 것은 물리적으로 같은 millisecond의 반영이 아니라 다음 운영 계약이다.

- 운영자는 한 번만 동작한다.
- 새 게시·복원과 수정 candidate는 Discord delivery가 검증될 때까지 Portfolio에 공개하지 않는다. 수정 중에는 기존 정상 version을 유지한다.
- Portfolio 공개 상태를 바꿀 때는 D1에서 즉시 일관되게 바꾸며, 불명 결과가 이미 노출된 경우 public query에서 먼저 차단한다.
- Discord 작업은 idempotent Queue job으로 자동 수행·재시도한다.
- 실패가 남으면 Console에 `재시도 필요` 상태와 원인을 표시한다.
- 운영자가 Discord나 Portfolio에서 같은 작업을 다시 손으로 할 필요가 없다.

이를 **단일 운영 동작 + 추적 가능한 eventual consistency**로 정의한다. 외부 API 오류를 숨기며 성공으로 표시하거나, 무한 재시도로 영구 장애를 가리지 않는다.

### Discord drift

- Bot이 Forum starter의 작성자이므로 본문과 첨부 수정은 Console만 수행한다.
- moderator가 Discord thread를 직접 삭제하거나 tag를 바꾸면 drift로 간주한다.
- `차이 검토`, Discord update와 `공개 재개` 직전에는 공통 fresh-check 경로가 mapping된 thread의 존재, starter content, attachment 집합과 applied tag를 즉시 다시 읽는다.
- 별도 daily trigger는 `published`이면서 Discord mapping이 있는 post만 안정 ID 순서의 작은 batch로 Queue에 넣고, 같은 consumer가 하루 한 번 위 항목을 읽기 전용으로 점검한다. draft·archive·purged post는 제외한다.
- Console 목록은 Discord를 직접 조회하지 않고 D1의 마지막 delivery state·remote hash·`discord_checked_at`을 즉시 표시한다. 원격 응답이 불명확하면 drift로 단정하거나 Discord를 변경하지 않고 `확인 실패`로 남겨 Queue 재시도한다.
- 초기 점검 주기는 code의 daily constant 하나로 두며 설정 UI, scheduler builder와 별도 reconciliation service는 만들지 않는다.
- 공개 중인 post에서 drift가 확정되면 Discord delivery state·remote hash·확인 시각만 `확인 필요`로 갱신한다. post의 `published` status, current version, pin·Hero, Portfolio cache와 public media는 바꾸지 않는다.
- `withheld`는 결과 불명 candidate가 실제 Portfolio current로 노출된 경우에만 사용한다. 정상 D1/R2 공개본과 다른 Discord projection만으로 Portfolio lifecycle을 강등하지 않는다.
- Discord thread가 사라져도 canonical post를 자동 삭제하지 않는다.
- Console은 `Discord 연결 끊김`을 표시하고 운영자가 `Discord에 다시 게시` 또는 `Discord 연결 해제`를 선택하게 한다.
- 삭제된 thread를 자동 재생성해 운영자의 의도적 삭제를 되돌리지 않는다.
- Discord 댓글은 D1에 복제하지 않는다. thread 삭제·재생성 전에는 댓글이 함께 사라진다는 경고를 표시한다.

상시 Gateway process, message polling, 비공식 endpoint와 HTML scraping은 사용하지 않는다.

#### Discord 연결 해제

- UI에는 의미가 모호한 `Discord 없이 유지` 대신 `Discord 연결 해제`를 사용하고, 확인 dialog에 `기존 Discord 글과 댓글은 남지만 더 이상 자동 수정·점검하지 않습니다`를 표시한다.
- 확인하면 한 D1 batch에서 active Discord mapping을 비우고 delivery state를 `detached`로 바꾼다. 기존 remote ID·마지막 hash·해제 시각과 사유는 `detach` delivery job에 남긴다.
- post의 `published` status, current version, pin·Hero와 media는 유지한다. 해당 post가 포함된 Portfolio feed·detail·community cache만 purge해 검증되지 않은 Discord CTA를 즉시 제거한다.
- active mapping이 없으므로 daily drift query에서 자연스럽게 제외한다. remote thread를 update·archive·delete하거나 알림을 보내지 않는다.
- Console row에는 경고가 아닌 중립 `Discord 연결 해제됨` badge와 `Discord 다시 연결` action을 표시한다. 과거 thread 바로가기는 delivery 이력 안에서만 제공한다.

별도 detached-post table이나 새 post lifecycle은 만들지 않는다. 현재 mapping은 `studio_posts`, 과거 remote 이력은 기존 `delivery_jobs`라는 경계를 그대로 사용한다.

#### Discord 재연결

1. `Discord 다시 연결`은 과거 detach job의 remote ID를 대상으로 fresh 검증부터 수행한다.
2. 재사용 가능 조건은 Bot이 starter 작성자이고, production Forum의 정확한 child thread이며, 현재 접근·수정 가능하고, 다른 post의 active mapping으로 사용되지 않는 것이다. 하나라도 불명확하면 재사용 불가로 멈춘다.
3. 재사용 가능하면 dialog에는 thread 제목·댓글 보존 안내와 `기존 대화 다시 연결` 하나만 표시한다. 승인 뒤 기존 update delivery 경로로 제목·본문·attachment·tag를 current version에 맞춘다.
4. update에는 role mention을 넣지 않고 opt-in 알림 job도 만들지 않는다. fresh read에서 content hash·attachment·tag가 모두 맞아야 한 D1 batch로 active mapping과 healthy delivery state를 복원한다.
5. mapping이 복원된 뒤 해당 post가 포함된 feed·detail·community cache를 purge해 `Discord에서 댓글 보기` CTA를 다시 노출한다.
6. 검증·update 결과가 실패하거나 불명확하면 `detached`를 유지하며 새 post로 자동 fallback하지 않는다. 재사용 불가일 때만 이유와 `새 Discord 글 만들기…`라는 별도 승인 action 하나를 보여준다.

검증 결과에 맞는 action 하나만 노출하고 remote ID 직접 입력 UI나 범용 mapping manager는 만들지 않는다.

## 5. 콘텐츠 계약

### 초기 게시물

- 한 post = 한국어 원문 하나
- 제목: Discord Forum 호환을 위해 1–100자
- 본문: 2,000자 이하의 Markdown
- 이미지: 0–10장
- 이미지마다 alt text 필수
- 이미지 순서 변경 가능
- 초기 공개 범위: 모두 public
- 공개 `#studio-feed`와 Portfolio: SFW
- 예외적인 장문은 별도 원본과 요약 링크 방식으로 운영하며 초기 schema에 장문 engine을 미리 만들지 않음

### Discord-compatible Markdown

`body_markdown`은 Discord Bot이 starter message의 `content`로 그대로 보낼 수 있는 제한된 Markdown을 canonical format으로 사용한다. WYSIWYG HTML을 만든 뒤 Markdown으로 변환하지 않는다.

허용하는 공통 문법:

- 일반 문단과 줄바꿈
- 굵게, 기울임, 취소선
- 순서 없는 목록과 번호 목록
- 인용문
- inline code와 fenced code block
- `https` URL과 masked link
- 일반 Unicode emoji

초기에는 제외한다.

- raw HTML
- 본문 안의 Markdown image 문법; 이미지는 전용 upload·alt·순서 영역에서 관리
- Discord user·role·channel mention, `@everyone`, `@here`
- Discord timestamp·custom emoji 같은 platform 전용 token
- underline, spoiler, heading과 subtext처럼 두 renderer의 의미나 UI가 달라지기 쉬운 확장 문법

저장 전에 CRLF를 LF로 정규화하고, server가 Discord의 2,000자 한도를 다시 검사한다. Bot에는 저장된 문자열을 내용 변환 없이 전달한다. Portfolio는 같은 allowlist parser로만 렌더링하고 raw HTML과 안전하지 않은 URL scheme을 허용하지 않는다.

Forum starter와 운영 메시지는 본문 검증과 별개로 항상 `allowed_mentions: { parse: [] }`를 보낸다. 따라서 validation 누락이나 일반 문자열의 `@`가 있어도 user·role·everyone ping을 발생시키지 않는다. 유일한 예외는 별도 `#announcements` 알림 메시지이며, 이때도 고정 template 안의 정확한 알림 역할 ID 하나만 `allowed_mentions.roles`로 허용한다.

### category와 topic

taxonomy의 기준 원본은 Discord가 아니라 D1이다.

| 차원 | 초기 표시 | 안정 key | 선택 규칙 |
| --- | --- | --- | --- |
| `kind` | `근황` | `update` | 정확히 1개 |
| `kind` | `작품 소식` | `work` | 정확히 1개 |
| `topic` | `캐릭터` | `character` | 전체 topic 중 0–4개 |
| `topic` | `세계관` | `world` | 전체 topic 중 0–4개 |
| `topic` | `일러스트` | `illustration` | 전체 topic 중 0–4개 |
| `topic` | `개발` | `development` | 전체 topic 중 0–4개 |

Discord Forum의 thread당 최대 5개 applied tag 안에서 kind 1개 + topic 최대 4개를 그대로 반영한다. 각 taxonomy row는 Console의 안정 key와 해당 Discord Forum의 `discord_tag_id`를 함께 보관한다.

### taxonomy 운영

- 추가: Console에서 label·stable key·차원·순서를 만들고 Discord Forum tag 생성 job을 실행한다.
- rename: label만 변경한다. stable key와 URL은 유지하고 Discord tag 이름을 갱신한다.
- reorder: D1 ordinal과 Discord available tag 순서를 갱신한다.
- archive: 새 글 선택지·Portfolio chip·현재 카드에서 즉시 숨기고 Discord Forum의 선택 가능한 tag에서 제거한다.
- archive된 topic은 현재 공개 조회에서 제외하지만 과거 version의 내부 감사 연결은 유지한다.
- archive된 `?tag=<stable-key>` URL은 tag query를 제거한 기본 feed로 정규화한다.
- 현재 Discord thread에 붙은 archive tag는 Queue가 순차 제거한다. 새 콘텐츠 version을 대량 생성하지 않는다.
- 한 번도 사용하지 않은 taxonomy만 hard delete할 수 있다.
- kind 추가·삭제는 “post마다 정확히 하나”라는 검증 의미가 바뀌므로 migration·회귀 검사를 포함한 명시적 변경으로 처리한다.

taxonomy dashboard를 범용화하거나 locale·project·offer 차원을 미리 만들지 않는다. 두 번째 실제 사용 요구가 생길 때 같은 안정 key 계약으로 확장한다.

## 6. 이미지 계약

### 원본과 파생본

브라우저는 Studio Console에서 원본을 한 번만 업로드한다.

~~~text
private source
- R2 비공개 key
- 공개 URL 없음
- hash·dimension·검증 metadata

Portfolio derivative
- 원래 구도와 비율을 보존한 web image
- EXIF/GPS와 허용하지 않은 metadata 제거
- Portfolio와 lightbox가 사용하는 유일한 bytes

Discord derivative
- Discord request 한도 안의 별도 최적화본
- Bot이 Forum starter attachment로 upload
- Discord CDN copy는 배포 결과일 뿐 기준 원본이 아님
~~~

Patreon이나 Discord API가 이미지 관계를 되돌려 주는지에 더는 의존하지 않는다. Studio Console 업로드가 원본이므로 이미지 누락은 게시 단계에서 fail closed할 수 있다.

Discord Bot 게시에는 사용자의 Nitro 혜택이 상속되지 않는다. Forum post create request는 공식 API의 총 요청 한도 안에 들어가야 하므로, 원본은 R2에 보존하고 Discord용 파생본 묶음은 별도 byte budget을 강제한다. 실제 보수 한도는 D1 vertical spike에서 여러 비율·용량 fixture로 확정한다.

### 입력과 검증

| 항목 | 초기 계약 |
| --- | --- |
| 허용 | JPEG, PNG, static WebP |
| 거부 | SVG, HEIC, PSD, ZIP, video, animated image |
| 개수 | 0–10장 |
| 해상도 | 한 변 최대 8,192px, 이미지당 최대 40MP |
| alt | 공백 제외 1–1,000자 |
| 방향 | EXIF orientation을 적용한 decode 결과 사용 |
| 공개 | 검증·재인코딩이 끝난 파생본만 |

모든 이미지가 준비되기 전에는 current published version pointer를 바꾸지 않는다. 실패하면 이전 정상 version을 계속 공개한다.

### background upload

- 이미지를 선택하면 post·draft ID를 먼저 확보하고 private R2 source upload를 즉시 시작
- 이미지별 `대기 / 업로드 중 / 처리 중 / 완료 / 실패`와 byte progress 표시
- 실패한 이미지만 개별 재시도
- source upload 뒤 metadata 검증과 Portfolio·Discord derivative 생성을 Queue에 전달
- 모든 asset이 `ready`이고 alt가 유효하기 전에는 `게시` button 비활성화
- upload·처리 중 editor를 닫아도 다음 진입에서 D1 asset 상태와 Queue 결과를 복원
- browser는 R2 credential을 받지 않고 Access가 보호한 `/studio/api/assets/*`를 통해 upload

### R2 key와 검색 계약

R2 object key는 사람이 dashboard에서 찾을 수 있는 prefix와 자동화가 신뢰하는 불변 ID를 함께 사용한다.

~~~text
posts/{YYYY}/{MM}/{DD}/
  {YYYYMMDDTHHMMSSZ}--{post_id}--{title_snapshot}/
    private/{asset_id}/source.{decoded_ext}
    private/{asset_id}/discord-v1.webp
    public/{asset_id}/portfolio-v1.webp
~~~

예시:

~~~text
posts/2026/08/27/
  20260827T143015Z--7f4...--새-캐릭터-작업-근황/
    private/8a2.../source.png
    private/8a2.../discord-v1.webp
    public/8a2.../portfolio-v1.webp
~~~

- 시간은 UTC의 filename-safe compact timestamp를 사용
- `post_id`와 `asset_id`는 `crypto.randomUUID()`로 만들고 삭제·참조의 실제 identity로 사용
- `title_snapshot`은 최초 upload 시 제목을 Unicode NFC로 정규화하고 slash·backslash·URL reserved·control character를 제거해 최대 40자로 저장; 빈 제목은 `untitled`
- `decoded_ext`는 client filename이 아니라 실제 decode한 MIME에서 결정
- title rename, 이미지 reorder와 alt 변경 때 R2 key를 rename하지 않음
- 제목 snapshot은 검색 힌트일 뿐 identity·URL·권한 판단에 사용하지 않음
- R2 custom metadata에는 `post_id`, `asset_id`, `created_at`, `title_snapshot`, source SHA-256만 기록
- D1 `studio_assets`가 세 exact key와 object 상태의 canonical manifest를 보관

R2 bucket 자체에는 `r2.dev` 공개 접근이나 직접 custom domain을 붙이지 않는다. key의 `public/`은 공개 가능한 derivative 분류를 뜻할 뿐 bucket ACL이 아니다.

- browser URL: `https://about.bluehair.blue/media/{asset_id}/portfolio-v1.webp`
- Worker가 D1에서 `post.status = published`와 current version의 asset 참조를 확인한 뒤에만 R2 object 반환
- 현재 version에서 빠진 asset, unpublished·archiving·archived·purging post는 `404` 또는 이미 공개됐던 URL이면 정책에 따라 `410`
- private source와 Discord derivative는 어떤 public media route에서도 반환하지 않음
- cache key는 public media URL로 고정하고 current 참조 해제 transaction 뒤 해당 URL을 purge

영구 삭제는 key 이름을 다시 조합하거나 prefix listing 결과만 믿지 않고 D1 manifest의 exact key를 사용한다. permanent purge 때는 해당 post의 key들을 한 번에 batch delete하고, 저장된 immutable post prefix를 다시 list해 누락된 orphan이 없는지 검증한다. public derivative는 R2 삭제와 함께 edge cache를 purge하고 공개 URL이 더 이상 성공 응답을 주지 않는지 확인한다. R2 dashboard의 날짜·제목 prefix는 수동 조사 경로로만 사용한다.

### retention과 cleanup

초기 기본값:

| 대상 | 기준 시각 | 기본 보존 |
| --- | --- | ---: |
| 한 번도 게시되지 않고 모든 참조가 끊긴 upload | `orphaned_at` | 7일 |
| current에서 교체된 published version metadata와 public·Discord derivative | `superseded_at` | 30일 |
| 한 번이라도 게시된 asset의 private source | 해당 없음 | 자동 삭제하지 않음 |
| 양쪽 공개 표면에서 삭제해 private archive가 된 post의 current snapshot과 source | 해당 없음 | 자동 삭제하지 않음 |
| current draft·current published version·active delivery job이 참조 | 해당 없음 | 자동 삭제하지 않음 |
| 운영자의 `원본까지 영구 삭제` | 확인 시각 | retention 없이 즉시 purge job |

기간은 schema나 D1 settings table에 박지 않고 server-side environment value로 관리한다. 초기 배포가 아래 값을 명시한다.

~~~text
ASSET_ORPHAN_RETENTION_DAYS=7
VERSION_ROLLBACK_RETENTION_DAYS=30
~~~

- 값은 1–3,650 범위의 정수만 허용
- 값이 없거나 잘못되면 짧은 기본값으로 fallback하지 않고 scheduled cleanup 전체를 중단해 데이터 보존 쪽으로 fail safe
- expiry timestamp를 미리 고정하지 않고 기준 시각과 현재 environment value로 매 cleanup 때 계산
- 기간을 늘리면 아직 삭제되지 않은 기존 후보에도 즉시 새 기간 적용
- 이미 삭제가 완료된 object는 기간을 늘려도 복구되지 않음
- 한 번이라도 게시된 private source는 retention 숫자와 무관하게 보존하며 명시적인 영구 삭제만 허용
- scheduled handler는 후보를 직접 삭제하지 않고 reference와 현재 retention을 다시 검증하는 idempotent cleanup job을 Queue에 등록
- Queue consumer도 삭제 직전에 current reference·active job·retention을 다시 검사
- Media 화면은 현재 설정과 다음 cleanup 후보 수를 보여주되 초기에는 retention 편집 UI를 만들지 않음

## 7. Studio Console UX

초기 Console은 다음 화면만 갖는다.

### 목록

- `초안 / 게시 중 / 게시됨 / 수정 동기화 중 / 일부 실패 / 공개 중지 / 양쪽에서 삭제 중 / private archive / 복원 중 / 영구 삭제 중` 상태
- 제목, category, topic, 마지막 수정 시각
- Portfolio와 Discord의 개별 delivery 상태
- `새 글`, `편집`, `재시도`, `공개 중지`, `양쪽에서 삭제`, `복원`
- 최신 상태가 아닌 Discord projection은 눈에 띄는 warning으로 표시
- 불일치 row에는 여러 해결 button을 펼치지 않고 `확인 필요` badge, `본문 1 · 이미지 2 · 태그 1`처럼 달라진 항목 수와 `차이 검토` 하나만 표시
- 목록 상단에는 같은 목록을 거르는 `전체 / 작업 중 n / 확인 필요 n` 세 filter만 둔다. filter·정렬은 URL query에 남겨 상세 화면에서 browser Back으로 돌아와도 같은 위치를 복원한다.
- `전체`에서도 `확인 필요` post를 먼저 묶고, 각 row에 제목·영향받은 표면·사람이 이해할 수 있는 원인(`Discord 글이 삭제됨`, `이미지 2장 다름`, `점검 실패`)·마지막 확인 시각을 표시한다.
- 경고는 색상만으로 구분하지 않고 badge text와 원인 문장을 함께 사용한다. row의 해결 진입점은 `차이 검토` 하나로 유지한다.
- 문제의 fresh 재검증 성공이나 명시적인 Discord 연결 해제 전에는 `확인 필요`에서 자동으로 사라지지 않는다.

### 불일치 검토

`차이 검토`는 현재 화면 위의 native `<dialog>`로 연다. 초기에는 별도 복구 route나 범용 diff 화면을 만들지 않는다.

- dialog 상단에는 post 제목, 계속 숨겨져 있다는 상태와 마지막 확인 시각을 짧게 표시한다.
- 본문·이미지·분류 중 실제로 달라진 section만 보여준다. 본문은 `Studio 원본 / Discord 현재` 두 preview를 desktop에서 나란히, 좁은 화면에서 위아래로 배치하고 초기에는 글자 단위 diff dependency를 넣지 않는다.
- 이미지 차이는 thumbnail·순서·누락 여부, 분류 차이는 label만 보여주며 hash·remote ID 같은 진단값은 `기술 정보` disclosure 안에 둔다.
- mismatch 상태의 주 button은 `Discord를 원본에 맞추기` 하나다. 누르면 `Discord에서 직접 바꾼 내용은 사라집니다`라는 짧은 재확인 뒤 기존 thread를 update한다.
- `양쪽에서 보관하기…`는 `다른 처리` disclosure 안의 danger action으로만 둔다. Discord 내용을 Studio 원본으로 가져오는 선택지는 제공하지 않는다.
- update 뒤 fresh remote 대조가 일치하면 같은 dialog가 `일치 확인됨`과 단일 `공개 재개` button으로 바뀐다. 별도 화면으로 이동하거나 두 action을 동시에 보여주지 않는다.
- 실패하면 계속 `withheld`를 유지하고 같은 자리에서 원인과 `다시 시도`만 보여준다. 닫기·`Esc`는 아무 상태도 바꾸지 않으며 닫힌 뒤 focus는 `차이 검토`로 돌아간다.

이 UI 상태는 기존 post·version·delivery job에서 계산한다. 별도 conflict table, 범용 diff engine이나 복구 wizard는 두 번째 실제 요구가 생기기 전에는 만들지 않는다.

### Media 관리

- route: `/studio/media`
- current post 제목, upload 날짜 범위와 `uploading / processing / ready / orphan / failed / deleting` 상태로 검색
- thumbnail, 최초 제목 snapshot, 현재 소유 post, 생성 시각, bytes와 derivative 상태 표시
- asset에서 소유 post editor로 이동
- 실패한 처리 재시도와 참조 없는 orphan 영구 삭제 제공
- published 또는 rollback version이 참조하는 asset은 Media 화면에서 즉시 삭제하지 않고 소유 post의 새 version·원본까지 영구 삭제 흐름으로 안내
- private archive의 source는 계속 검색 가능하되 public URL과 Discord attachment 상태는 `제거됨`으로 표시
- `원본까지 영구 삭제`는 post detail의 별도 danger zone에서만 제공
- 초기에는 folder builder, album, bulk rename과 범용 DAM 기능을 만들지 않음

### 편집기

- 제목
- Discord-compatible Markdown textarea
- 굵게·기울임·취소선·목록·인용·link·code만 넣는 작은 native formatting toolbar
- 2,000자 counter와 server validation
- Portfolio 카드·상세와 Discord 본문을 전환해 보는 실시간 preview
- 지원하지 않는 mention·HTML·inline image 문법의 위치별 오류 표시
- kind 단일 선택
- topic 최대 4개 복수 선택
- 이미지 drag reorder
- 이미지별 alt 입력
- 자동 저장과 `게시`를 분리

### 자동 저장과 keyboard 계약

- 제목·본문·kind·topic·alt·이미지 순서가 바뀌고 입력이 1.5초 멈추면 현재 mutable draft 하나를 D1에 갱신
- 한국어 IME 조합 중에는 저장·shortcut 처리를 시작하지 않고 `compositionend` 이후 debounce
- save request는 한 번에 하나만 전송; 저장 중 새 입력이 생기면 현재 요청 완료 직후 최신 snapshot 한 번만 다시 저장
- 각 request는 `draft_version_id`, 현재 `revision`, idempotency key를 전송
- D1은 해당 revision이 현재 값일 때만 update하고 revision을 1 증가; 불일치하면 `409`로 조용한 덮어쓰기를 금지
- 다른 tab의 변경으로 `409`가 나면 현재 입력을 유지하고 `다른 창에서 수정됨`을 표시; 운영자가 내용을 복사하거나 server draft를 다시 불러오도록 함
- `저장 중 / 저장됨 / 저장 실패 / 다시 로그인 필요 / 다른 창에서 수정됨` 상태를 눈에 띄게 표시하고 `aria-live="polite"`로 알림
- dirty·saving·failed 상태에서 창 닫기·browser unload를 시도하면 native unsaved-change 경고를 사용하고, 내부 route 이동은 아래의 저장 확인 절차를 사용
- PIN session 만료로 save가 거부되면 입력을 화면에 유지하고 새 tab 인증 후 같은 draft를 재시도

#### 작업 이동과 복귀

- 각 draft는 `/studio/posts/{post_id}`의 안정 URL과 D1 mutable draft를 가진다. 제목·본문·kind·topic·alt·이미지 순서와 연결된 asset은 명시적으로 초안을 버리기 전까지 자동 만료하지 않는다.
- 다른 post·Media·목록으로 이동하면 debounce를 기다리지 않고 최신 snapshot을 flush한다. D1이 새 revision을 승인한 뒤에만 route를 바꾸며 저장 중이면 `저장 후 이동 중`을 표시한다.
- save 실패·revision 충돌·PIN 만료이면 이동을 멈추고 `저장하지 못해 이동을 멈췄어요` dialog에서 `다시 저장 / 현재 화면 유지 / 변경 내용 복사`만 제공한다. navigation 경고 안에는 `저장하지 않고 이동`을 두지 않는다.
- 선택한 이미지가 private R2 upload 접수와 asset ID 발급을 마치지 않았다면 이동을 멈추고 남은 upload를 표시한다. 접수가 끝난 derivative 처리는 Queue에서 계속되므로 이동을 허용한다.
- 목록의 `작업 중` filter는 모든 active draft의 제목·마지막 저장 시각·upload 상태와 `작업 재개`를 보여준다. browser를 닫거나 다시 로그인해도 같은 URL 또는 이 목록에서 D1 draft를 다시 연다.
- 이미 공개된 post를 편집 중이어도 current published version과 mutable draft는 분리되어 있으므로 작업 이동·복귀가 공개본을 바꾸지 않는다.

별도 multi-document tab workspace, client-only 복구 저장소와 전역 editor Context는 만들지 않는다. 안정 URL, 기존 D1 draft와 native browser history만 재사용한다.

shortcut은 Windows의 `Ctrl`과 macOS의 `Cmd`를 같은 의미로 지원한다.

| shortcut | 동작 |
| --- | --- |
| `Ctrl/Cmd + S` | browser의 페이지 저장 dialog를 막고 최신 draft를 즉시 flush |
| `Ctrl/Cmd + Z` | native textarea undo; 별도 undo stack을 만들지 않음 |
| `Ctrl/Cmd + Shift + Z`, `Ctrl + Y` | native redo |
| `Ctrl/Cmd + B` | 선택 영역 굵게 |
| `Ctrl/Cmd + I` | 선택 영역 기울임 |
| `Ctrl/Cmd + K` | 선택 영역 link |

formatting toolbar와 shortcut으로 삽입한 텍스트도 native undo/redo stack에 포함되어야 한다. undo·redo가 만든 `input` event도 일반 입력처럼 autosave한다. 공개는 반드시 명시적인 `게시` button과 확인 동작으로만 실행하며 `Ctrl/Cmd + Enter` 같은 publish shortcut은 두지 않는다. 각 toolbar button에는 tooltip과 `aria-keyshortcuts`를 제공한다.

### 공개 후 동작

- 수정 후 `업데이트 게시`
- feed 상단 고정·해제
- Hero 포함·제외와 순서 변경
- Portfolio 공개 중지
- Discord·Portfolio 양쪽에서 삭제하고 private archive로 이동
- private archive 복원
- 원본까지 영구 삭제
- 실패 job 재시도
- Discord thread와 Portfolio detail 바로가기

초기에는 다음을 만들지 않는다.

- 범용 page builder
- 회원·후원자 table
- 역할·권한 builder
- WYSIWYG block editor
- 예약 게시
- 협업 승인 단계
- 실시간 dashboard
- 외부 workflow SaaS

### 접근 보호

Studio Console은 공개 site와 같은 Worker의 `https://about.bluehair.blue/studio`에 둔다. UI와 write endpoint를 모두 같은 보호 prefix 아래에 둬 별도 CORS·DNS·배포와 보호 누락 가능성을 줄인다.

| 용도 | route |
| --- | --- |
| Console UI | `GET /studio`, `GET /studio/*` |
| Console write API | `/studio/api/*` |
| Discord interaction | `POST /api/discord/interactions`; Access 대상이 아니며 Discord signature로 보호 |
| 공개 Portfolio | 기존 공개 route; Access 대상 아님 |

- Cloudflare Access self-hosted application으로 `about.bluehair.blue/studio*` 보호
- 한파란의 정확한 email 하나만 Access Allow policy에 등록
- 로그인 방식은 Cloudflare One-time PIN으로 고정하고 별도 OAuth provider를 연결하지 않음
- PIN은 Cloudflare가 허용된 email로만 발송하며 app은 PIN을 생성·저장·검증하지 않음
- Access application session duration은 초기 24시간으로 두고 실제 불편이나 기기 공유 위험이 있을 때 dashboard 설정으로 조정
- `/studio` 아래에 더 구체적인 Bypass application·policy를 만들지 않음
- Worker는 모든 `/studio` page·API 요청에서 `Cf-Access-Jwt-Assertion`을 검증
- JWT signature, `iss`, `aud`, 유효 시간을 검증하고 `email === STUDIO_ADMIN_EMAIL`도 다시 확인
- JWT header가 있다는 사실만 믿지 않고 Access JWKS로 signature를 검증
- app 자체 사용자·password·session table은 만들지 않음
- state-changing request는 same-origin JSON만 허용하고 `Origin`과 custom request header를 검증
- CORS를 열지 않음
- `/api/discord/interactions`는 Discord가 호출해야 하므로 Access와 same-origin 검사를 적용하지 않는다. 대신 raw body와 `X-Signature-Ed25519`·`X-Signature-Timestamp`를 application public key로 검증하고 실패하면 `401`을 반환한다.
- write마다 idempotency key 사용

공식 계약:

- [Cloudflare Access — application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

## 8. 게시·수정·내리기·삭제

### 새 게시

1. Console에서 draft와 이미지를 검증한다.
2. R2 private source와 두 종류의 derivative를 staging에 만든다.
3. 모든 자산이 준비된 뒤 D1 batch로 승인 candidate version·asset metadata·`publishing` status·Discord create job을 함께 기록한다. 이때 public current pointer는 아직 설정하지 않는다.
4. Queue가 Bot으로 Forum thread·starter·applied tags·attachments를 생성한다.
5. Discord thread ID, starter message ID, delivered hash와 attachment set을 검증해 D1에 기록한다.
6. 그 뒤 D1 batch로 candidate를 current pointer로 옮기고 status를 `published`로 바꾼다. Portfolio feed·detail·public media는 이 시점부터 공개한다.
7. Discord 성공 뒤 publish finalization만 실패하면 새 thread를 만들지 않고 D1 finalization만 retry한다.
8. Discord create 결과가 불명확하면 자동 재전송하지 않고 `outcome_unknown`으로 멈추며 Portfolio는 계속 숨긴다.
9. 최초 게시 finalization이 성공한 경우에만 Queue가 `#announcements`에 알림 역할 mention과 새 Forum thread 링크를 보낸다. 수정·재공개·private archive 복원은 다시 알리지 않는다.

### 수정

1. 현재 published version을 건드리지 않고 새 draft version을 만든다.
2. 검증과 derivative 생성이 성공하면 새 candidate와 Discord update job을 기록하되 current pointer와 Portfolio에는 기존 정상 version을 유지한다.
3. Queue가 Bot 소유 thread name·starter content·attachments·applied tags를 candidate hash에 맞게 수정하며 attachment 유지 목록에는 candidate version의 asset만 넣는다.
4. Discord API 응답의 attachment set과 delivered hash가 candidate와 일치한 뒤에만 D1 current pointer를 교체한다.
5. Portfolio feed·detail은 새 current version만 렌더링하고 public media route도 새 version이 참조하지 않는 asset을 즉시 거부한다. 빠진 asset URL과 post page cache도 함께 purge한다.
6. Discord 수정이 명시적으로 실패하면 기존 Portfolio version을 유지하고 retry한다. 결과가 불명확하면 자동 재전송하지 않고 `update_unknown`으로 멈춰 remote hash부터 대조한다.
7. Discord update 성공 뒤 D1 finalization만 실패하면 Discord edit를 반복하지 않고 current pointer finalization만 retry한다.

같은 content hash를 다시 게시하면 새 version이나 중복 Discord post를 만들지 않는다.

한 번이라도 게시된 private source는 이미지가 current version에서 빠져도 삭제하지 않는다. old public·Discord derivative와 rollback metadata만 30일 retention 대상이며, private source는 Media의 private archive로 남는다.

### 불명 결과의 공개 차단

local production code promotion과 콘텐츠 publish는 서로 다른 흐름이다.

- `npm run promote`의 production smoke는 read-only이며 실제 post·Discord thread·알림을 만들지 않는다. 이 process가 종료되면 특정 게시글을 삭제하지 않고 `production_unknown`으로 remote migration·deployment version·binding만 대조한다.
- 콘텐츠 publish·update Queue가 중단되거나 결과 불명 상태로 재개됐는데 affected candidate가 Portfolio current로 노출된 사실을 확인하면, 원격 조회보다 먼저 D1 batch로 post status를 `withheld`로 바꾼다. pin·Hero 값은 보존하되 모든 공개 feed·Hero query가 `published`만 읽게 해 잠금 중에는 노출하지 않는다.
- public feed·detail query와 media route는 `published`만 허용하므로 `withheld` 전환 즉시 글과 이미지를 거부한다. 이어서 post page·asset cache를 purge한다.
- 이 동작은 **공개 표면 삭제**이지 permanent purge가 아니다. current pointer, version, private R2 source와 delivery job은 검토·복구를 위해 보존한다.
- Discord thread는 remote ID와 content hash를 대조하기 전에 추정으로 삭제하지 않는다. 대조 뒤 Console에서 mapping, 재완료 또는 양쪽 archive를 선택한다.
- Console에는 `공개 차단됨 · 원격 대조 필요`와 affected version·마지막 성공 phase를 표시한다.

새 게시와 수정의 정상 순서 자체가 candidate 선행 공개를 금지하므로 `withheld`는 crash·legacy version·invariant 위반을 위한 작은 fail-closed 안전장치다. 별도 visibility table이나 삭제 service는 만들지 않는다.

#### 수동 `공개 재개`

remote Discord 내용이 candidate와 일치해도 자동 재공개하지 않는다.

1. Console에 D1 version·source hash, Discord remote ID·content hash, 양쪽 attachment 집합, 확인 시각과 마지막 성공 phase를 나란히 표시한다.
2. 관리자가 `공개 재개`를 누르면 post가 여전히 `withheld`이고 비교 화면의 `current_version_id`·`delivery_job_id`가 현재 값과 같은지 확인한다.
3. 변경 직전에 Discord를 다시 읽어 content hash와 attachment 집합이 candidate와 정확히 같은지 재검증한다. stale snapshot이나 불일치이면 mutation 없이 거부하고 새 비교 결과를 보여준다.
4. 일치하면 한 D1 batch에서 status를 `published`로 되돌리고 해당 delivery job을 reconciled 완료 처리한다. content, current pointer와 Discord mapping은 다시 쓰거나 재생성하지 않는다.
5. post·media cache를 purge한다. 보존해 둔 pin·Hero 값은 `published` query에 자연스럽게 다시 포함되므로 별도 복원 snapshot이나 table을 두지 않는다.
6. 같은 `notify:{post_id}:{version_id}` job이 성공했다면 다시 ping하지 않는다. 최초 게시의 알림이 아직 성공한 적 없을 때만 기존 dedupe key로 한 번 enqueue하며, 결과 불명 알림은 먼저 remote 결과를 대조한다.

#### remote 불일치 처리

- Discord 내용이 candidate와 다르면 post는 계속 `withheld`로 유지하고 D1/R2 승인본을 기준 원본으로 둔다.
- 관리자가 `Discord를 원본에 맞추기`를 승인하면 기존 thread와 update delivery 계약을 재사용한다. 새 Discord post를 만들거나 remote 변경을 D1/R2로 자동 수입하지 않는다.
- update 성공 뒤 content hash와 attachment 집합을 fresh read로 다시 확인한다. 일치해도 자동 공개하지 않고 앞의 수동 `공개 재개` 단계로 전환한다.
- `양쪽에서 보관하기…`를 선택하면 기존 private archive 흐름을 재사용한다.
- 두 선택 모두 기존 delivery job에 결과를 남기며 별도 conflict lifecycle이나 resolution table은 만들지 않는다.

### 공개 중지

- Portfolio에서 즉시 숨기고 pin·Hero도 같은 D1 batch에서 해제한다.
- Discord thread는 자동 삭제하지 않는다. 커뮤니티 대화를 남기기 위한 별도 상태다.
- Console에 `Discord 토론은 유지됨`을 명시한다.
- 다시 공개하면 같은 stable slug와 기존 Discord mapping을 재사용한다.

### 양쪽 공개 표면에서 삭제

1. 확인 dialog에서 Portfolio 공개본과 Discord thread·댓글이 사라지지만 private 원본은 보존됨을 명시한다.
2. D1 transaction으로 status를 `archiving`으로 바꾸고 public query에서 제외하며 pin·Hero를 즉시 해제한다. 마지막 current version pointer는 private archive 복원을 위해 유지한다.
3. public media route가 해당 post의 모든 asset을 즉시 거부하도록 하고 feed·detail·asset cache를 purge한다.
4. Queue가 Discord thread를 삭제한다. 이미 없는 404는 성공으로 취급한다.
5. Portfolio route가 비공개이고 Discord thread가 없음을 확인한 뒤 status를 `archived`로 바꾼다.
6. 일부 실패 시 Portfolio는 계속 숨긴 채 자동 retry하고 Console에 실패 표면을 표시한다.
7. DLQ에 도달하면 운영자가 같은 archive job을 재시도할 수 있다.

외부 시스템 때문에 물리적으로 같은 순간의 삭제는 약속하지 않는다. 대신 **한 번의 동작, Portfolio 즉시 차단, Discord 자동 삭제, 양쪽 검증 전에는 완료로 표시하지 않음**을 약속한다. Discord message에서 attachment를 제거하면 사용자에게 보이는 post 표면에서는 사라지지만 이미 알려진 Discord CDN URL의 별도 보존 시간까지 application이 통제한다고 약속하지 않는다.

### private archive 복원

복원은 Portfolio만 다시 켜는 상태 변경이 아니라 **private 원본에서 두 공개 projection을 다시 만드는 하나의 재게시 작업**이다.

1. 운영자가 `복원`을 누르면 `restore:{post_id}:{archived_at}` dedupe key로 job을 만들고 status를 `restoring`으로 바꾼다. 이 상태에서는 Portfolio post·media route를 계속 차단한다.
2. 보관된 current snapshot과 private source를 검증하고, retention으로 이미 정리된 Portfolio·Discord derivative가 있으면 private source에서 다시 만든다.
3. Queue가 보관본의 제목·본문·tag·attachment로 새 Discord Forum thread와 starter message를 생성한다. starter에는 `SUPPRESS_NOTIFICATIONS` flag를 고정 적용해 push·desktop 알림 없이 복원한다. 삭제된 thread와 댓글은 Discord에서 복구할 수 없으므로 새 토론으로 시작한다.
4. create 응답의 thread ID·starter ID·delivered hash·attachment set이 기대값과 일치하면 delivery job에 remote ID를 기록한다.
5. 그 뒤 D1 batch로 새 Discord mapping을 current mapping으로 옮기고, `archived_at`을 비우며 status를 `published`로 바꾼다. Portfolio는 같은 stable slug에서 다시 공개하고 이전 404/410 cache를 purge한다.
6. Discord가 명시적으로 실패하면 Portfolio는 계속 archive 상태로 두고 같은 job을 retry한다. Discord 성공과 remote ID 기록 뒤 publish finalization만 실패한 경우에는 새 thread를 만들지 않고 finalization만 retry한다.
7. Discord create 결과가 timeout 등으로 불명확하면 중복 thread를 만들 수 있으므로 자동 재전송하지 않고 `outcome_unknown`으로 멈춘다. Console에서 최근 Forum post를 대조해 기존 thread를 mapping하거나 제거한 뒤 같은 job을 계속한다.
8. finalization이 DLQ에서도 끝나지 않으면 새 Discord thread를 삭제하는 compensation을 먼저 수행하고 archive 상태로 되돌린다. compensation도 검증되기 전에는 복원 완료로 표시하지 않는다.

외부 Discord와 D1 사이의 물리적 원자성은 약속할 수 없다. 대신 **Discord 생성·검증 선행, Portfolio 공개 후행, 결과 불명 시 무작정 재전송 금지**로 반쪽 복원과 중복 Forum post를 막는다. 과거와 새 Discord ID의 이력은 각 archive·restore `delivery_jobs.remote_id`에 남기며 별도 history table은 만들지 않는다.

### 원본까지 영구 삭제

private archive의 danger zone에서만 실행한다.

1. post 제목을 다시 입력하는 확인과 `복구 불가` 경고
2. status를 `purging`으로 바꾸고 public·Discord가 이미 제거됐는지 재확인
3. D1 manifest의 exact key로 private source·모든 derivative를 R2에서 삭제
4. public cache purge와 R2 prefix empty 검증
5. 본문·version·asset metadata를 제거하고 재생성 방지에 필요한 최소 tombstone ID·slug·Discord ID·`purged_at`만 유지
6. 일부 실패는 자동 retry하며 모든 key가 사라지기 전에는 `purged`로 표시하지 않음

## 9. D1·R2 데이터 모델

초기 D1은 실제 version·asset 공유와 삭제 참조 확인에 필요한 일곱 테이블로 제한한다.

| 테이블 | 책임 | 핵심 필드 |
| --- | --- | --- |
| `studio_posts` | 안정 ID와 lifecycle·projection mapping | `id`, `slug`, `status` (`draft / publishing / published / withheld / unpublished / archiving / archived / restoring / purging / purged`), `draft_version_id`, `current_version_id`, `pinned_at`, `hero_rank`, Discord IDs·delivery state·remote hash·`discord_checked_at`, `archived_at`, `purged_at`, timestamps |
| `studio_post_versions` | mutable draft와 승인 snapshot | `id`, `post_id`, `state`, `revision`, `source_hash`, `title`, `body_markdown`, `kind`, `locale`, `superseded_at`, timestamps, `schema_version` |
| `studio_post_version_topics` | version별 topic 연결 | `version_id`, `taxonomy_id`; 복합 primary key |
| `studio_taxonomy` | category·topic catalog와 Discord mapping | `id`, `dimension`, `stable_key`, `label`, `status`, `ordinal`, `discord_tag_id`, timestamps |
| `studio_assets` | post별 upload와 source·derivative manifest | `id`, `post_id`, `status`, `created_prefix`, title snapshot, dimensions, MIME, bytes, SHA-256, private/public/Discord R2 keys, `orphaned_at`, timestamps |
| `studio_post_version_assets` | version별 이미지 순서·alt snapshot | `version_id`, `asset_id`, `ordinal`, `alt`; `(version_id, asset_id)`와 `(version_id, ordinal)` unique |
| `delivery_jobs` | prepare·Discord·notification·taxonomy·archive·restore·detach·reconnect 작업 | `id`, `dedupe_key`, `post_id`, `version_id`, `target`, `action`, `remote_id`, `status`, attempts, error, timestamps |

계약:

- published version은 불변이다.
- post마다 편집 중 mutable draft는 하나만 active pointer로 가지며 autosave마다 revision만 증가한다.
- draft save는 history row를 매번 추가하지 않고 revision 조건부 `UPDATE` 하나로 처리한다.
- version의 최대 10개 `asset_id / ordinal / alt`는 `studio_post_version_assets`가 ordered snapshot으로 보관한다.
- asset bytes와 변환 metadata는 `studio_assets`에 한 번만 저장하고 여러 version이 같은 asset을 참조할 수 있다.
- orphan 정리는 version-asset foreign key와 active job 참조가 모두 없는 asset만 대상으로 한다.
- 새 publish는 기존 정상 version을 보존한 채 준비한다.
- slug, stable taxonomy key, dedupe key와 Discord thread mapping은 DB가 unique하게 강제한다.
- `studio_posts`에는 현재 Discord mapping만 두고, 삭제·복원 때 교체된 remote ID의 감사 이력은 해당 `delivery_jobs`가 보관한다.
- Hero는 `hero_rank` nullable 값으로만 관리하며 전용 table을 만들지 않는다.
- 외부 delivery target이 Discord 외에 실제로 하나 더 생길 때만 별도 target-state table을 검토한다.
- 회원·후원·댓글·reaction·Discord profile은 저장하지 않는다.

R2 key는 post prefix 아래의 `private / public` segment로 분리한다. public media route는 post status가 `published`이고 current version이 참조하는 `public` derivative만 제공한다. private source는 한 번이라도 게시되면 자동 orphan cleanup에서 제외하며, 명시적인 영구 삭제 전에는 Studio Worker만 읽을 수 있다.

## 10. Discord 서버와 Bot 계약

초기 서버:

~~~text
START
├─ #start-here
└─ #rules

PUBLIC
├─ #announcements        Text · 새 글 알림 역할 ping · Bot만 게시
└─ #studio-feed          Forum · SFW · Bot만 post 생성

COMMUNITY
├─ #general
└─ #feedback

BOT TEST                Category · 한파란과 Studio Bot Test만 열람
├─ #bot-test-start       Text · 역할 button
├─ #bot-test-notify      Text · test 역할 ping
└─ #bot-test-feed        Forum · 게시·수정·삭제·이미지 검증
~~~

Discord application과 Bot은 정확히 두 벌만 둔다.

- `Studio Bot Test`는 staging Worker의 Interaction Endpoint만 사용하고 `BOT TEST` category와 test 알림 역할만 다룬다.
- `Studio Bot`은 production Worker의 Interaction Endpoint만 사용하고 `#start-here`·`#announcements`·`#studio-feed`와 production 알림 역할만 다룬다.
- 두 Bot은 같은 source·명령·handler를 사용한다. `test-*` 전용 명령이나 운영 명령 복사본을 만들지 않고, 검증된 commit을 code 수정 없이 production environment로 승격한다.

`BOT TEST` category는 `@everyone`의 `VIEW_CHANNEL`을 거부하고 한파란의 관리자 계정과 `Studio Bot Test`만 명시적으로 허용한다. moderator나 일반 알림 역할에는 보이지 않는다. 반대로 production channel은 `Studio Bot Test`의 `VIEW_CHANNEL`과 게시 권한을 명시적으로 거부한다. production `Studio Bot`도 `BOT TEST`를 볼 필요가 없다. test 알림 역할은 한파란 계정에만 부여하고 production 알림 역할과 ID를 공유하지 않는다.

권장 role hierarchy는 `한파란·관리자 > Studio Bot > 새 글 알림 > Studio Bot Test > Bot Test 알림 > @everyone`이다. 두 Bot에는 `ADMINISTRATOR`를 주지 않는다. 따라서 test Bot token이나 handler에 문제가 생겨도 production 알림 역할을 부여하거나 제거할 수 없다. production handler 역시 environment의 정확한 production role ID 하나만 허용한다.

권한:

| 역할 | Forum post 생성 | Bot post 댓글 | 파일 첨부 댓글 |
| --- | ---: | ---: | ---: |
| Studio Bot | `#studio-feed`만 허용 | 해당 없음 | 허용 |
| Studio Bot Test | `#bot-test-feed`만 허용 | 해당 없음 | 허용 |
| 한파란·moderator | 원칙상 Console 사용 | 허용 | 허용 |
| 일반 회원 | 거부 | Rules 통과 후 허용 | 초기 거부 |
| 신규 회원 | 거부 | 거부 | 거부 |

Bot은 지정 Forum에서만 다음 REST 동작을 한다.

- Forum thread와 starter 생성
- canonical Markdown을 변환 없이 보내고 `allowed_mentions.parse = []`로 자신이 만든 starter 생성·수정
- thread name과 applied tags 수정
- 양쪽 공개 표면에서 삭제할 때 thread 삭제
- taxonomy 변경 시 Forum available tags 동기화

추가로 최초 게시가 Discord에 성공하면 Bot은 `#announcements`에 다음 고정 형식의 메시지 하나를 보낸다.

~~~text
<@&DISCORD_NOTIFY_ROLE_ID> 새 글이 올라왔어요.
https://discord.com/channels/{guild_id}/{forum_thread_id}
~~~

- `allowed_mentions`는 `{ roles: [DISCORD_NOTIFY_ROLE_ID] }`만 보내며 `users`·`everyone`·`here`는 허용하지 않는다.
- 본문·제목 등 운영자 입력값을 알림 문구에 삽입하지 않아 mention injection을 막는다.
- `notify:{post_id}:{version_id}` dedupe key와 그 SHA-256 앞 25자를 Discord `nonce / enforce_nonce`에 함께 사용하고 성공 message ID를 delivery job의 `remote_id`에 기록한다.
- 전송 결과가 불명확하면 중복 ping을 피하기 위해 자동 재전송하지 않고 Console에서 대조·재시도한다.
- 알림 실패는 이미 성공한 Portfolio·Forum 게시를 되돌리지 않으며 Console에 `알림 실패`와 재시도를 표시한다.
- 사용자가 Discord client에서 해당 역할이나 서버 알림을 끈 경우 실제 push까지 강제할 수는 없다.

알림 역할은 일반 회원에게 mentionable로 열지 않는다. Studio Bot에만 `#announcements` channel override로 `SEND_MESSAGES`와 `MENTION_EVERYONE`을 허용하고, application payload는 위 역할 ID 하나로 더 좁게 제한한다. Bot은 그 밖의 `#general`, `#feedback`, DM, private member channel과 member list에는 접근하지 않는다. 상시 Gateway와 privileged intent도 사용하지 않는다.

### 알림 역할 self-service

`#start-here`에 Studio Bot 소유의 고정 안내 message 하나를 두고 Discord Components V2 button 두 개를 제공한다.

~~~text
새 글 알림
새 글이 올라오면 Discord 알림을 받을 수 있어요.

[알림 받기] [알림 끄기]
~~~

- 초기 notification key는 `all`, 표시 이름은 `새 글 알림` 하나다. `알림 받기`는 `notify-role:all:add:v1`, `알림 끄기`는 `notify-role:all:remove:v1` custom ID를 사용한다.
- 하나의 toggle button으로 현재 상태를 뒤집지 않고 add·remove를 분리한다. 같은 request가 다시 와도 Discord의 role PUT·DELETE가 같은 최종 상태를 만들며 회원 상태 table은 필요 없다.
- route path는 `POST /api/discord/interactions`로 고정하되 application별 endpoint를 분리한다. `Studio Bot`은 `https://about.bluehair.blue/api/discord/interactions`, `Studio Bot Test`는 staging 배포가 반환한 `workers.dev` origin의 같은 path를 사용한다. Discord application 하나에는 endpoint URL 하나만 설정하며 상시 Gateway는 열지 않는다.
- Worker는 raw body를 JSON parse하기 전에 native Web Crypto `Ed25519`로 signature를 확인하고, 5분보다 오래된 timestamp·다른 application·guild·channel·message·component ID를 거부한다.
- 유효한 button click은 Discord role PUT·DELETE API를 2초 request timeout으로 직접 호출하고, Discord의 3초 initial-response 제한 안에 `알림을 켰어요` 또는 `알림을 껐어요`라는 ephemeral response를 반환한다. 이 작은 작업에는 Queue나 `waitUntil()`을 사용하지 않는다.
- Bot에는 `MANAGE_ROLES`가 필요하다. Bot role은 알림 role 바로 위, 운영자·moderator role 아래에 두며 interaction handler는 `DISCORD_NOTIFY_ROLE_ID` 외의 role ID를 거부한다.
- interaction의 user ID와 token은 현재 HTTP request 안에서만 사용하고 D1 회원·역할 이력으로 저장하지 않는다. token·user ID는 log에 남기지 않는다.
- role API가 실패하거나 2초 안에 결과를 확인하지 못하면 성공을 추정하지 않고 `처리 상태를 확인하지 못했어요. 같은 버튼을 다시 눌러주세요.`라고 응답한다. add·remove가 idempotent하므로 같은 button 재시도는 안전하다.

role panel message는 각 environment의 Bot으로 setup 때 한 번 생성하고 반환된 message ID를 해당 environment에 고정한다. message가 삭제되거나 ID가 다르면 interaction을 거부하고 운영자가 같은 setup을 다시 실행해 새 ID로 교체한다.

초기에는 `DISCORD_NOTIFY_ROLE_ID` 하나만 server-side allowlist에 둔다. notification key를 custom ID에 포함하되 category와 role을 D1 schema로 결합하거나 범용 role routing table을 미리 만들지 않는다. 실제 두 번째 역할이 생기면 같은 allowlist에 `update`·`work` key와 role ID를 추가하고 button·알림 대상 선택만 확장한다. post·version·taxonomy schema와 기존 `all` button은 그대로 유지한다.

향후 실제 유료 콘텐츠가 생기기 전에는 Patreon role, private member channel과 잠금카드를 만들지 않는다.

## 11. Portfolio UI 계약

### feed·정렬·분류

- `#now`를 단일 열 SNS feed로 확장
- `전체 / 근황 / 작품 소식` category chip
- active topic chip
- `최신순 / 오래된순` 정렬
- category와 topic 하나를 조합 가능
- 번호형 pagination, 일반 post 10개
- URL로 `kind / tag / sort / page` 복원
- stable taxonomy key 사용: `?kind=work&tag=character&sort=oldest&page=2#now`
- 알 수 없는 값은 allowlist에서 제거하고 기본값으로 정규화
- archived tag URL은 tag를 제거한 기본 feed로 정규화
- raw query를 SQL `ORDER BY`나 식별자에 보간하지 않음

### 고정 post와 Hero

- 공개 post 하나만 feed page 1 최상단에 고정 가능
- 현재 filter와 맞을 때만 표시
- pin은 일반 10개와 page count에서 제외
- Hero와 pin은 독립
- Hero는 Console의 `hero_rank`로 포함·제외·순서 변경
- 공개 중지·삭제 시 pin과 Hero를 같은 D1 batch에서 해제
- reaction·댓글 수로 자동 승격하지 않음

### 카드와 이미지

- 이미지 0장: media 영역 없는 텍스트 카드
- 이미지 1장: 큰 thumbnail
- 같은 비율 2–10장: crop 없는 horizontal slider, button·swipe·keyboard
- 혼합 비율 2–4장: 일정 frame의 crop grid
- 혼합 비율 5–10장: 앞 4장 + `+N` overlay
- 비율 판정: EXIF 반영 후 `max(ratio) / min(ratio) <= 1.01`이면 동일 비율
- 이미지 선택: 현재 feed 위 공용 native `<dialog>` lightbox
- lightbox: contain, 이전·다음, 순번, Escape, swipe, focus 복귀, reduced motion
- 본문: 4줄 preview와 `더 보기`/접기
- 상세 CTA: `사이트에서 전체 보기`
- 댓글 CTA: `Discord에서 댓글 보기`

### 상세 route

- `/updates/[slug]`
- 현재 승인 version의 전체 본문과 0–10장 gallery
- title, description, canonical, OG image
- 게시글 원문에 `lang="ko"`
- private source와 Discord CDN URL을 browser에 보내지 않음

### Patreon CTA

- title: `작업실 연료 보급`
- CTA: `제작자 더 일하게 만들기 ↗`
- 월 5,000원 수준의 순수 후원
- 혜택·게시 일정·Discord role·독점 콘텐츠 약속 없음
- 실제 통화와 결제액은 Patreon checkout에서 확인
- 초기에는 blur·lock membership card 없음

## 12. 보안·개인정보 경계

- Studio Console과 `/studio/api/*`는 Cloudflare Access 뒤에 둔다.
- Access JWT가 없거나 signature·`iss`·`aud`·유효 시간·관리자 email이 맞지 않으면 page와 write API 모두 fail closed한다.
- Discord Bot token은 Cloudflare secret으로, Access team domain·AUD·관리자 email은 server-side environment value로 보관한다.
- client bundle, D1, R2 metadata, log와 문서에 secret을 넣지 않는다.
- 기존 Patreon creator token은 이 게시 파이프라인에서 사용하지 않는다.
- Patreon CTA에는 공개 URL만 필요하다.
- Discord member list를 조회하거나 profile·reaction·reply·DM과 Patreon supporter data를 저장하지 않는다. self-service interaction의 guild·user·role ID는 요청 처리 동안에만 사용한다.
- Portfolio 방문 기록과 Discord ID를 결합하지 않는다.
- Bot request·attachment URL·Access JWT를 log에 남기지 않는다.
- 측정이 필요해질 때도 post 조회와 CTA click 같은 집계 지표만 별도 consent·retention 계약 후 추가한다.

## 13. 구현 순서

### A — Studio Console vertical slice

목표는 “글 하나를 Console에서 작성해 Discord에 Bot post로 만들고 다시 수정·삭제할 수 있음”이다. Portfolio UI보다 먼저 외부 delivery 계약을 증명한다.

1. Console URL을 `https://about.bluehair.blue/studio`로 확정 — 완료
2. Cloudflare Access Email PIN과 Worker JWT·관리자 email guard 검증
3. test Discord application·`Studio Bot Test`·test Forum 준비
   - 실제 server의 private `BOT TEST` category와 test start·notify·Forum channel을 사용
   - staging environment에는 test application·Bot token·channel·message·role ID만 넣음
   - test Bot은 production channel을 볼 수 없고 production 알림 역할보다 role hierarchy가 낮음
4. title·body·kind·topic·이미지 0–10장 test form
5. IME·debounce·`Ctrl/Cmd+S`·native undo/redo·revision conflict 자동 저장 검증
6. 허용 Markdown fixture의 Portfolio·Discord 표현과 금지 mention fail-closed 검증
7. 선택 즉시 R2 private upload·진행률·재시도와 두 derivative 생성
8. 날짜·post ID·제목 snapshot prefix listing과 D1 exact-key batch delete 검증
9. Bot으로 Forum thread·starter·applied tags·attachments 생성
10. 같은 mapping의 edit·attachment 교체·tag 변경
11. thread delete와 404 idempotency
12. Queue retry·rate limit·실패 표시
13. 공개 interaction route의 PING·유효/무효 signature와 3초 이내 ephemeral response 검증
14. `#start-here` 역할 add·remove button과 정확한 role ID allowlist·ephemeral 결과 검증
15. Go/No-Go 통과 commit을 수정하지 않고 production environment에 배포하고 `Studio Bot` application endpoint를 연결

A 단계에서는 범용 관리자 UI와 공개 feed를 만들지 않는다. 실제 Discord payload·이미지 한도·permission을 통과한 최소 vertical slice만 남긴다.

### B — canonical publishing backend

1. 일곱 D1 table migration
2. draft·published pointer와 immutable published version
3. R2 staging·promote·orphan cleanup
4. delivery outbox·Queue·DLQ
5. Console 목록·editor·preview·상태·재시도
6. taxonomy add·rename·reorder·archive
7. publish·update·unpublish·private archive·permanent purge saga
8. pin·Hero 관리

### C — Portfolio projection

1. `#now` D1 feed
2. category·topic·sort·page URL state
3. pinned item과 Hero
4. SNS card·Show more
5. slider·crop grid·lightbox
6. `/updates/[slug]`와 OG metadata
7. `/community`와 Discord thread CTA
8. keyboard·touch·screen reader·reduced-motion 검증

### D — 복구·운영

1. 중요한 동작 직전 fresh check와 mapping된 `published` post의 daily Discord delivery reconciliation
2. dead-letter 복구
3. environment retention을 적용하는 scheduled candidate scan과 Queue 재검증
4. 양쪽 공개 표면 archive와 원본 permanent purge·tombstone 검증
5. JSON·asset manifest export
6. rollback과 retention runbook
7. privacy policy와 삭제 요청 경로
8. 마지막 성공 시각·실패율·처리 시간

### 미래 범위

- 독립 email opt-in
- 실제 유료 offering과 Patreon entitlement
- private member channel
- SFW teaser 잠금카드
- 예외적 장문 원본 adapter
- 협업 편집·예약 게시

실제 두 번째 사용처가 생기기 전에는 schema, table, channel과 UI를 만들지 않는다.

## 14. Go / No-Go

| 검사 | 완료 계약 | 실패 시 |
| --- | --- | --- |
| Access 보호 | 비인증 Console·write 요청 403 | 공개 경로 구현 중단 |
| test isolation | 비관리자 계정은 `BOT TEST`를 볼 수 없고 test Bot은 production channel을 보거나 production 알림 역할을 관리할 수 없음 | Discord spike 중단 |
| application isolation | test·production application이 서로 다른 endpoint·token·public key·target ID만 사용하고 잘못된 application signature를 거부 | production Bot 연결 금지 |
| promotion parity | D1에서 통과한 commit과 명령·handler를 수정하지 않고 production environment에 배포 | production 배포 중단 |
| resource isolation | staging에서 게시·삭제·복원·cleanup·Queue retry를 실행해도 production D1 row·R2 key·Queue depth가 변하지 않음 | production 승격 금지 |
| pipeline fail-closed | staging migration·deploy·smoke 중 하나라도 실패하면 production resource에는 어떤 명령도 실행되지 않음 | pipeline 중단 |
| approval binding | 승인 화면의 commit·migration·production target이 staging 검증 run과 정확히 같고 명시적 승인 전에는 production 명령이 없음 | production 승격 금지 |
| approval revocation visibility | 중단된 승인 run은 `approval_revoked`로 기록되고 다음 실행 전에 run·commit·사유와 재검증 필요가 명시됨 | 새 staging 시작 금지 |
| runner portability | local runner와 CI가 같은 Node CLI·manifest schema·exit code를 사용하고 runner 전용 API가 배포 core에 없음 | pipeline 공개 금지 |
| publish visibility gate | 새 candidate는 Discord delivery 검증 전 공개되지 않고 수정 실패·불명 중에는 기존 정상 Portfolio version이 유지됨 | publish/update 공개 금지 |
| unknown visibility hold | affected candidate가 current로 노출된 불명 상태에서는 remote 대조 전에 `withheld`·media 차단·cache purge가 완료되고 원본은 보존됨 | reconciliation 중단 |
| manual visibility resume | stale·불일치 비교에서는 재개가 거부되고, 직전 fresh remote 대조가 정확히 일치할 때만 같은 pointer·Discord mapping으로 `published`가 되며 pin·Hero가 복원되고 중복 Discord post·ping이 없음 | 공개 재개 중단 |
| mismatch resolution UX | 목록에는 `차이 검토` 하나만 보이고 dialog는 변경 section만 표시하며, 원본 재적용 뒤 fresh 일치 확인 전에는 `공개 재개`가 나오지 않고 archive는 보조 danger action으로 분리됨 | 불일치 복구 공개 금지 |
| drift check cadence | `차이 검토`·update·공개 재개 직전에는 fresh remote를 읽고, 목록은 remote 호출 없이 마지막 상태를 보이며 daily Queue가 mapping된 `published` post만 읽기 전용으로 점검함 | reconciliation 공개 금지 |
| projection fault isolation | 공개 post의 Discord drift는 delivery state만 `확인 필요`가 되고 Portfolio status·pointer·pin·Hero·cache·media는 그대로 유지됨 | drift 처리 공개 금지 |
| attention discoverability | `확인 필요` post가 전체 목록 상단과 전용 filter에서 제목·표면·원인·마지막 확인 시각으로 식별되고 색상에만 의존하지 않음 | Console 목록 공개 금지 |
| safe task switch | 이동 전에 최신 draft revision과 private upload 접수를 확인하고 실패 시 route를 유지하며, 재로그인·browser 재시작 뒤에도 `작업 중` 목록과 안정 URL에서 같은 초안을 복원함 | editor 공개 금지 |
| Discord detach | active mapping과 public CTA만 제거되고 remote thread·댓글·Portfolio 공개본·pin·Hero·media는 유지되며 daily 점검과 `확인 필요`에서 제외됨 | 연결 해제 공개 금지 |
| Discord reconnect | Bot 소유·Forum·권한·mapping을 fresh 검증한 기존 thread만 update·재사용하고, 검증 불명·실패에서는 detached를 유지하며 자동 새 post·알림이 없음 | 재연결 공개 금지 |
| Bot Forum create | 제목·본문·kind·topic·여러 이미지 순서 보존 | Discord delivery 방식 재검토 |
| Bot update | 본문·attachment·tag가 같은 thread에서 교체 | update 공개 금지 |
| Markdown parity | 허용 fixture가 두 표면에서 같은 구조로 보이고 mention ping이 없음 | formatter 범위 축소 |
| autosave | IME·undo·느린 응답·여러 tab에서도 최신 draft가 과거 값으로 덮이지 않음 | editor 공개 금지 |
| surface delete | Portfolio·public media 즉시 차단, thread 삭제와 재시도 404 성공 | 양쪽 삭제 공개 금지 |
| private source | 수정·surface delete 뒤 공개 route와 Discord에는 없고 Studio에서만 복구 가능 | archive 공개 금지 |
| archive restore | private source로 새 Forum thread를 만들고 같은 slug를 공개하며 실패·불명 결과에서는 Portfolio가 계속 숨겨짐 | 양쪽 복원 공개 금지 |
| restore notification | starter create payload와 응답에 `SUPPRESS_NOTIFICATIONS`가 있고 mention ping이 없음 | Discord 복원 공개 금지 |
| opt-in notification | 알림 역할 보유 계정만 최초 게시 ping을 받고 수정·재공개·복원에서는 다시 받지 않음 | 역할 알림 production 금지 |
| role self-service | 유효 button은 exact role만 add·remove하고 invalid signature·guild·message·custom ID는 거부하며 D1 회원 row를 만들지 않음 | 역할 button 공개 금지 |
| 이미지 | metadata release와 비율·alt 보존 | 원본 공개 금지, 변환 경로 재선정 |
| R2 관리 | 날짜·제목 prefix 검색, D1 exact-key 삭제, prefix empty와 public cache purge 검증 | asset 삭제 production 금지 |
| retention 변경 | 7/30에서 더 긴 기간으로 바꾸면 미삭제 후보가 연장되고 잘못된 값에서는 cleanup이 중단됨 | scheduled cleanup 공개 금지 |
| version swap | 실패 중 기존 정상 version 유지 | Portfolio publish 중단 |
| idempotency | 중복 click·Queue delivery에도 post/version 중복 없음 | production 금지 |
| taxonomy archive | Portfolio filter·card와 Discord 선택지에서 제거 | Console taxonomy 공개 금지 |
| drift | Discord missing 상태를 감지하고 canonical은 보존 | reconciliation 재설계 |

## 15. 저장소·배포 계약

현재는 계획 단계이며 Discord application, D1, R2, Queue, Studio Console과 공개 feed를 아직 구현하지 않았다.

- `app/page.tsx`는 조합 루트로 유지한다.
- Studio Console UI와 공개 feed를 별도 module·section으로 둔다.
- 기존 `worker/index.ts`의 Vinext `fetch`를 보존하는 얇은 Worker wrapper만 추가한다.
- 같은 Worker가 초기 `fetch / queue / scheduled` handler를 소유한다.
- 실제 배포 독립성 요구가 생기기 전에는 consumer microservice를 나누지 않는다.
- D1·R2·Queue binding을 추가할 때 `wrangler.jsonc`, `.openai/hosting.json`, generated types, migration과 `docs/technical-index.md`를 같은 변경에서 맞춘다.
- OpenAI Sites preview와 production Cloudflare binding을 동일하다고 가정하지 않고 각각 검증한다.
- 최종 공개 origin은 `https://about.bluehair.blue`다.

Bot runtime은 한 Worker codebase의 Cloudflare environment 두 개로 격리한다.

- production은 기존 top-level `about` Worker와 `about.bluehair.blue`를 유지한다.
- staging은 향후 `env.staging`으로 선언하는 별도 `about-staging` Worker와 그 배포가 반환한 `workers.dev` origin을 사용한다.
- Vite plugin build·deploy는 `CLOUDFLARE_ENV=staging`으로 staging config를 선택한다.
- named environment에서 상속되지 않는 `vars`·binding·secret은 각 environment에 명시한다. 같은 변수 이름을 쓰되 값은 섞지 않는다.
- test와 production을 고르는 runtime `MODE` switch나 두 환경의 channel ID를 한 Worker에 함께 넣는 방식은 사용하지 않는다.
- 승격 단위는 검증된 git commit과 동일 build pipeline이다. staging 검증 뒤 production용으로 코드를 다시 고치거나 명령을 복사하지 않는다.

D1·R2·Queue·DLQ도 environment마다 물리적으로 분리하되 code가 보는 논리 이름은 동일하게 유지한다.

| 논리 용도 | staging resource | production resource |
| --- | --- | --- |
| `STUDIO_DB` D1 | `about-studio-staging` | `about-studio-production` |
| `STUDIO_MEDIA` R2 | `about-studio-media-staging` | `about-studio-media-production` |
| `PUBLISH_QUEUE` | `about-studio-publish-staging` | `about-studio-publish-production` |
| publish DLQ | `about-studio-publish-dlq-staging` | `about-studio-publish-dlq-production` |

- 두 D1 database는 repository의 같은 `migrations/` SQL sequence를 각각 적용한다.
- R2 key 형식은 같지만 bucket이 다르므로 environment prefix나 runtime 분기가 필요 없다.
- Queue payload에는 environment나 임의 target ID를 넣지 않는다. 주입된 `PUBLISH_QUEUE`와 현재 Worker binding만 신뢰한다.
- scheduled cleanup과 reconciliation도 현재 environment binding만 사용하며 다른 environment resource credential을 갖지 않는다.
- 실제 resource ID와 이름은 `wrangler.jsonc`의 해당 environment에만 선언하고 application code·D1·Queue message에 저장하지 않는다.

일상 운영은 하나의 promotion pipeline이 모두 조정한다.

1. 한 번 `lint → test`를 통과하고 승격할 git commit을 고정한다.
2. pipeline이 staging의 정확한 D1 이름·R2 bucket·Queue·DLQ binding을 preflight한다.
3. 같은 migration sequence를 staging D1에 적용하고 `about-staging`을 배포한다.
4. test Bot으로 게시·수정·삭제·복원·role button·Queue retry smoke를 수행한다.
5. 모든 검사가 성공한 뒤 commit SHA·migration 목록·staging smoke·production resource 이름을 보여주고 production 승격 gate에서 멈춘다.
6. 승인되면 production D1에 같은 migration sequence를 적용하고 고정된 commit을 `about`에 배포한다.
7. production read-only smoke와 application·resource ID 대조 결과를 같은 run 기록에 남긴다.

이 pipeline은 여러 Cloudflare product를 하나의 원자적 transaction으로 묶지는 않는다. 대신 각 단계가 성공해야 다음 단계가 시작되고, staging 실패 시 production 명령 자체를 실행하지 않는다. production migration은 기존 Worker와 호환되는 additive change를 먼저 적용해 deploy 실패 시에도 현재 production을 깨뜨리지 않는다.

production gate는 staging 검증을 수행한 같은 pipeline run 안의 수동 승인 한 번으로 고정한다. 승인 action은 해당 run의 불변 commit과 target manifest에만 유효하다. 새 commit, resource 설정 변경이나 새 run이 생기면 이전 승인을 재사용하지 않는다. 승인 거부나 승인 대기 중 run 종료 시 staging은 그대로 남고 production에는 아무 작업도 하지 않는다. 동시에 둘 이상의 production 승격이 진행되지 않도록 pipeline concurrency를 하나로 제한한다.

초기 실행기는 local `npm run promote`로 고정한다. 단, npm script에 배포 절차를 직접 나열하지 않고 Node 표준 기능만 쓰는 `tooling/promote.mjs` 하나를 호출한다.

- 인자 없는 local 실행은 staging phase를 수행하고 결과를 보여준 뒤 terminal에서 production 승인을 받아 같은 process의 production phase를 이어간다.
- CLI 내부 phase는 `staging`과 `production` 두 개뿐이며 같은 함수와 validation을 재사용한다. test·production용 script 사본은 만들지 않는다.
- staging phase는 secret이 없는 `studio-promotion/v1` JSON manifest를 만든다. manifest에는 commit SHA, migration·lockfile·Wrangler config hash, environment별 resource 이름, staging deployment ID와 smoke 결과만 둔다.
- production phase는 manifest와 현재 commit·file hash·target을 다시 비교하고 하나라도 다르면 실행을 거부한다. token, Access JWT, Discord interaction token과 Cloudflare credential은 manifest에 넣지 않는다.
- local runtime state는 이미 Git에서 제외된 `.wrangler/promotions/` 아래에 둔다. manifest는 해당 process와 run에서만 production 승격에 사용할 수 있으며 Git에 추적하지 않는다.

### 승인 폐기 고지 계약

승인 대기 중 local process가 종료되면 이전 승인 context는 재사용하지 않고 `approval_revoked`로 폐기한다. 폐기 사실이 조용히 사라지지 않도록 다음 계약을 고정한다.

- 정상 거부, `Ctrl+C`와 종료 신호를 처리할 수 있을 때는 terminal에 즉시 폐기 메시지를 표시하고 `history.jsonl`에 event를 추가한다.
- 강제 종료·전원 중단처럼 당시 기록할 수 없으면 다음 `npm run promote`가 남은 `pending.json`을 발견한 뒤 어떤 migration·deploy·smoke보다 먼저 같은 폐기 event를 추가한다.
- event에는 `run_id`, commit SHA, `revoked_at`, `reason`, 마지막 완료 phase만 기록한다. secret, token, email, Discord user ID와 raw request는 기록하지 않는다.
- 폐기된 manifest는 production phase 입력으로 거부하며 새 run은 staging부터 다시 검증한다.
- local audit는 `.wrangler/promotions/history.jsonl`, 추후 CI에서는 같은 event schema의 job log·artifact를 사용한다. application DB와 별도 audit service는 만들지 않는다.

표시 문구는 다음처럼 고정한다.

~~~text
이전 production 승인은 폐기되었습니다.
run: {run_id}
commit: {commit_sha}
사유: {reason}
production으로 진행하려면 staging부터 다시 검증해야 합니다.
~~~

### 배포 실행기 마이그레이션 계약

여기서 “쉬운 마이그레이션”이 보장하는 범위는 **local runner에서 GitHub Actions나 다른 CI runner로의 이전**이다.

- CI로 옮길 때 새 workflow는 같은 `tooling/promote.mjs staging`을 실행해 manifest를 job artifact로 전달하고, native production approval 뒤 같은 `tooling/promote.mjs production`을 호출한다.
- application code, D1 migration, R2 key, Queue payload, `wrangler.jsonc` binding과 Discord Bot handler는 바꾸지 않는다.
- runner별 차이는 checkout·artifact 전달·승인 UI·credential 주입뿐이다. 이 차이를 application module이나 deployment core에 import하지 않는다.
- GitHub private repository에서 native required reviewer를 쓰려면 이를 지원하는 plan이 필요하다. 지원되지 않으면 현재 local gate를 유지하고 third-party approval action으로 우회하지 않는다.
- 공동 운영, 원격 승인이나 중앙 audit 이력이 실제로 필요해질 때 workflow 파일 하나를 추가하는 것이 migration trigger다.

OpenAI Sites 연결도 같은 논리 D1·R2 이름을 사용하되 `.openai/hosting.json`에는 project ID와 logical declaration만 두고 실제 resource ID·runtime secret을 넣지 않는다. 직접 Cloudflare staging·production resource는 `wrangler.jsonc`, Sites preview resource는 Sites가 각각 연결하며 둘이 같은 physical resource라고 가정하지 않는다. runner를 옮겨도 이 hosting 계약과 `dist/.openai/hosting.json` 산출물은 그대로 유지한다.

D1을 실제 도입할 때는 `db/schema.ts`를 schema source로 두고 검토한 생성 SQL을 같은 `migrations/` sequence로 추적한다. application query는 작은 D1 helper 뒤의 prepared statement와 필요한 `batch()`만 사용한다. searchable metadata와 workflow state는 D1, source·derivative bytes는 R2에 두며 browser storage를 기준 원본으로 쓰지 않는다. 실제 D1·R2가 생기기 전까지 현재 `.openai/hosting.json`의 `d1`·`r2`는 `null`로 유지한다.

이 계약은 **Cloudflare D1·R2 데이터를 다른 provider로 자동 이전한다는 뜻이 아니다.** provider migration은 D1 export, R2 object·metadata manifest, import 검증과 cutover가 필요한 별도 작업이다. D 단계의 JSON·asset manifest export는 그 작업을 가능하게 하지만 현재 범위에서 다른 storage adapter를 미리 만들지 않는다.

resource 생성은 최초 bootstrap stage에서 한 번만 수행하고 이후 routine deploy가 누락된 production resource를 자동 생성하지 않게 한다. 별도 IaC framework, custom deployment dashboard, third-party approval action과 test/production용 중복 script는 만들지 않는다.

초기 secret·environment 후보:

~~~text
Cloudflare secret · environment별 별도 등록
- DISCORD_BOT_TOKEN

environment value
- CF_ACCESS_TEAM_DOMAIN
- CF_ACCESS_AUD
- STUDIO_ADMIN_EMAIL
- DISCORD_APPLICATION_ID
- DISCORD_APPLICATION_PUBLIC_KEY
- DISCORD_GUILD_ID
- DISCORD_START_CHANNEL_ID
- DISCORD_ROLE_PANEL_MESSAGE_ID
- DISCORD_FORUM_CHANNEL_ID
- DISCORD_ANNOUNCEMENTS_CHANNEL_ID
- DISCORD_NOTIFY_ROLE_ID
- ASSET_ORPHAN_RETENTION_DAYS=7
- VERSION_ROLLBACK_RETENTION_DAYS=30

D1 taxonomy
- kind/topic stable key
- label/order/status
- discord_tag_id
~~~

위 Discord 변수 이름은 두 environment에서 동일하다. staging 값은 test application·`BOT TEST` channel·test message·test role만 가리키고 production 값은 `Studio Bot`과 공개 surface만 가리킨다. `DISCORD_TEST_*` 병렬 변수군은 만들지 않는다. D1·R2·Queue도 같은 논리 binding 이름과 서로 다른 physical resource를 사용한다.

기존 로컬 `.env`의 Patreon `CLIENT_SECRET`, creator access token과 refresh token은 새 CMS에서 읽지 않는다. 값을 문서·client·log로 옮기지 않는다. Patreon 페이지 링크처럼 공개해도 되는 값만 site content로 둔다.

## 16. 결정 로그

| 날짜 | ID | 결정 | 상태 |
| --- | --- | --- | --- |
| 2026-08-25 | R-001 | Patreon Post API를 콘텐츠·이미지의 기준 원본으로 사용하지 않는다. | 유지 |
| 2026-08-25 | R-002 | scraping·HTML parser·Discord CDN hotlink로 API 공백을 메우지 않는다. | 유지 |
| 2026-08-26 | R-003 | Patreon은 초기 보장 혜택 없는 순수 후원으로 사용한다. | 유지 |
| 2026-08-27 | R-004 | 후원 가격 의도는 월 5,000원 수준, CTA는 `제작자 더 일하게 만들기`다. | 유지 |
| 2026-08-27 | R-005 | 초기 post는 한국어·2,000자 이하·공개 SFW다. | 유지 |
| 2026-08-27 | R-006 | category는 `근황 / 작품 소식`, topic은 `캐릭터 / 세계관 / 일러스트 / 개발`이다. | 유지 |
| 2026-08-27 | R-007 | 최신순·오래된순·filter·번호 page·pin·Hero와 SNS 이미지 UX를 제공한다. | 유지 |
| 2026-08-27 | R-008 | Discord Forum을 editorial source로 사용하고 Message command로 승인한다. | 이번 안으로 대체 |
| 2026-08-27 | R-009 | Studio Console과 D1/R2를 editorial·published source로 통합한다. | 권장안 |
| 2026-08-27 | R-010 | Discord는 Bot이 자동 게시하는 community projection으로 사용한다. | 권장안 |
| 2026-08-27 | R-011 | 생성·수정·삭제는 Console의 단일 동작과 Queue fan-out으로 처리한다. | 권장안 |
| 2026-08-27 | R-012 | Discord native 변경은 canonical mutation이 아니라 drift로 다룬다. | 권장안 |
| 2026-08-27 | R-013 | taxonomy·pin·Hero를 Console에서 관리한다. | 권장안 |
| 2026-08-27 | R-014 | 상시 Gateway, 범용 CRM, 회원 DB와 외부 workflow SaaS를 만들지 않는다. | 권장안 |
| 2026-08-27 | R-015 | Studio Console은 `about.bluehair.blue/studio`에 두고 UI와 API를 `/studio*` Access policy로 함께 보호한다. | 확정 |
| 2026-08-27 | R-016 | Studio Console 로그인은 정확한 관리자 email 하나에 대한 Cloudflare One-time PIN을 사용한다. | 확정 |
| 2026-08-27 | R-017 | 본문은 Discord-compatible Markdown을 canonical source로 저장하고 Bot이 변환 없이 전송한다. | 확정 |
| 2026-08-27 | R-018 | canonical 본문에는 Discord mention token을 허용하지 않고 Forum·운영 메시지에 `allowed_mentions.parse = []`를 강제한다. | 확정 |
| 2026-08-27 | R-019 | 현재 mutable draft 하나를 1.5초 debounce로 자동 저장하고 `Ctrl/Cmd+S` 즉시 저장과 native undo/redo를 지원한다. | 확정 |
| 2026-08-27 | R-020 | draft revision 조건부 update로 느린 응답·여러 tab의 silent overwrite를 막고 publish shortcut은 두지 않는다. | 확정 |
| 2026-08-27 | R-021 | 이미지 선택 즉시 private R2 background upload를 시작하고 이미지별 진행·실패·재시도를 제공한다. | 확정 |
| 2026-08-27 | R-022 | R2 key는 날짜·최초 제목 snapshot과 불변 post·asset ID를 함께 쓰며 D1 exact-key manifest로 삭제한다. | 확정 |
| 2026-08-27 | R-023 | 미게시 orphan 7일·교체 version metadata와 derivative 30일을 기본 보존하며 두 기간은 검증된 server environment value로 늘릴 수 있다. | 확정 |
| 2026-08-27 | R-024 | 한 번이라도 게시된 private source는 자동 삭제하지 않고 수정·공개 삭제 뒤에도 Studio archive에 보존한다. | 확정 |
| 2026-08-27 | R-025 | 일반 삭제는 Portfolio와 Discord만 제거하는 private archive이며 원본 제거는 별도 permanent purge다. | 확정 |
| 2026-08-27 | R-026 | private archive 복원은 같은 Portfolio slug와 새 Discord Forum thread를 함께 복원하는 단일 작업으로 처리한다. | 확정 |
| 2026-08-27 | R-027 | Discord 복원이 실패하거나 결과가 불명확하면 Portfolio를 공개하지 않으며 불명 create는 자동 재전송하지 않는다. | 확정 |
| 2026-08-27 | R-028 | 복원으로 생성하는 Discord starter에는 `SUPPRESS_NOTIFICATIONS`를 고정 적용해 push·desktop 알림을 보내지 않는다. | 확정 |
| 2026-08-27 | R-029 | 최초 새 게시만 `#announcements`에서 정확한 알림 역할 하나를 mention하고 수정·재공개·복원은 알리지 않는다. | 확정 |
| 2026-08-27 | R-030 | `#start-here`의 명시적 add·remove button과 signature-verified HTTP interaction으로 알림 역할을 self-service 부여하며 회원 DB는 만들지 않는다. | 확정 |
| 2026-08-27 | R-031 | 초기 notification key는 `all` 하나로 두되 versioned button ID와 server allowlist를 확장 경계로 삼아 나중에 category role을 추가할 수 있게 한다. | 확정 |
| 2026-08-27 | R-032 | D1 Discord spike는 실제 server의 한파란·`Studio Bot Test` 전용 `BOT TEST` category에서 별도 test channel·role ID로 수행한다. | 확정 |
| 2026-08-27 | R-033 | Discord application·Bot은 test와 production 두 개로 격리하되 code·명령·handler는 하나만 유지하고, 검증된 commit을 수정 없이 production environment로 승격한다. | 확정 |
| 2026-08-27 | R-034 | staging과 production의 D1·R2·Queue·DLQ는 물리적으로 분리하고, 같은 binding·migration·code를 사용하는 단일 fail-closed promotion pipeline으로 함께 관리한다. | 확정 |
| 2026-08-27 | R-035 | production은 staging 검증이 끝난 같은 pipeline run에서 commit·migration·target을 확인한 뒤 수동 승인 한 번으로만 승격한다. | 확정 |
| 2026-08-27 | R-036 | 초기 promotion runner는 local `npm run promote`로 두고 Node 표준 기능의 단일 CLI가 staging·승인·production을 같은 process에서 수행한다. | 확정 |
| 2026-08-27 | R-037 | 배포 core와 secret 없는 versioned manifest를 runner-neutral 계약으로 유지해 추후 CI migration은 workflow·approval·credential wiring만 교체한다. | 확정 |
| 2026-08-27 | R-038 | 승인 대기 run이 종료되면 이전 승인을 폐기하고, 즉시 또는 다음 실행의 첫 단계에서 run·commit·사유·staging 재검증 필요를 명시하고 감사 event를 남긴다. | 확정 |
| 2026-08-27 | R-039 | production code promotion smoke는 실제 콘텐츠를 만들지 않으며 중단 시 특정 post 삭제 없이 deployment 원격 상태를 먼저 대조한다. | 확정 |
| 2026-08-27 | R-040 | 콘텐츠 candidate는 Discord delivery 검증 뒤에만 Portfolio에 공개하고, 불명 affected version이 노출되면 기존 lifecycle status로 즉시 공개 차단한 뒤 원격을 대조한다. | 확정 |
| 2026-08-27 | R-041 | `withheld` remote가 정확히 일치해도 자동 재공개하지 않고, 관리자가 fresh 대조 뒤 수동 재개한다. 같은 current pointer·Discord mapping·pin·Hero를 재사용하며 알림은 기존 dedupe 계약을 따른다. | 확정 |
| 2026-08-27 | R-042 | Discord가 승인본과 다르면 D1/R2를 원본으로 유지한다. 목록에는 `차이 검토` 하나만 두고, dialog에서 원본 재적용을 주 동작으로, 양쪽 archive를 숨겨진 danger 동작으로 제공한 뒤 fresh 일치 확인을 거쳐 수동 공개한다. | 확정 |
| 2026-08-27 | R-043 | Discord drift는 `차이 검토`·update·공개 재개 직전에 fresh check하고, 나머지는 mapping된 공개 post를 하루 한 번 Queue로 점검한다. Console 목록은 저장된 마지막 상태만 읽으며 초기에는 주기 설정 UI를 만들지 않는다. | 확정 |
| 2026-08-27 | R-044 | 공개 중인 post의 Discord drift는 관리 레이어의 delivery state만 `확인 필요`로 바꾸고 정상 Portfolio 공개본·pointer·pin·Hero·cache·media는 유지한다. `withheld`는 노출된 candidate 결과가 불명확한 경우에만 사용한다. | 확정 |
| 2026-08-27 | R-045 | `확인 필요`는 별도 알림함 없이 Console의 상단 count·filter와 목록 상단 row로 제공하고, 제목·영향 표면·구체적 원인·마지막 확인 시각을 text로 명확히 표시한다. | 확정 |
| 2026-08-27 | R-046 | 작업 이동 전 최신 D1 revision과 private upload 접수를 확인하고 실패 시 이동을 막는다. active draft는 자동 만료하지 않으며 안정 URL과 `작업 중` filter에서 언제든 재개한다. | 확정 |
| 2026-08-27 | R-047 | `Discord 연결 해제`는 active mapping과 Portfolio CTA만 제거하고 기존 thread·댓글과 Portfolio 공개본은 보존한다. remote 이력은 delivery job에 남기고 daily 점검에서는 제외한다. | 확정 |
| 2026-08-27 | R-048 | Discord 재연결은 과거 thread를 fresh 검증해 안전할 때 우선 재사용한다. 승인본 update·재검증 뒤에만 active mapping과 CTA를 복원하며 실패·불명 결과에서는 자동으로 새 post를 만들지 않는다. | 확정 |

## 17. 공식 검증 자료

### Discord

- [Channel Resource — Forum, thread, tag, create·modify·delete](https://docs.discord.com/developers/resources/channel)
- [Message Resource — attachment와 bot message edit](https://docs.discord.com/developers/resources/message)
- [Component Reference — button과 custom ID](https://docs.discord.com/developers/components/reference)
- [Interactions Overview — public endpoint와 Ed25519 signature](https://docs.discord.com/developers/interactions/overview)
- [Application Resource — application별 Interaction Endpoint URL](https://docs.discord.com/developers/resources/application)
- [Receiving and Responding — 3초 initial response](https://docs.discord.com/developers/interactions/receiving-and-responding)
- [Guild Resource — member role add·remove](https://docs.discord.com/developers/resources/guild)
- [Permissions — role mention과 channel override](https://docs.discord.com/developers/topics/permissions)
- [API Reference — Discord message formatting과 mention syntax](https://docs.discord.com/developers/reference)
- [Markdown Text 101](https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline)
- [Community Onboarding FAQ — native role 선택과 활성화 조건](https://support.discord.com/hc/en-us/articles/11074987197975-Community-Onboarding-FAQ)
- [Gateway Events](https://docs.discord.com/developers/events/gateway-events)
- [Webhook Events](https://docs.discord.com/developers/events/webhook-events)
- [Developer Terms](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service)

### Cloudflare

- [Access application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
- [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Access One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
- [Access common policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)
- [Queue retries and batching](https://developers.cloudflare.com/queues/configuration/batching-retries/)
- [Dead Letter Queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)
- [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [D1 migrations와 Wrangler command](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Images binding](https://developers.cloudflare.com/images/optimization/binding/)
- [R2 Objects — key와 prefix](https://developers.cloudflare.com/r2/objects/)
- [R2 Workers API — prefix list와 batch delete](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/)
- [Workers Web Crypto — Ed25519 verify](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Wrangler environments — environment별 Worker·binding·secret](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Queue configuration](https://developers.cloudflare.com/queues/configuration/configure-queues/)

### Patreon

- [Patreon API Reference](https://docs.patreon.com/)
- [Patreon 지원 통화](https://support.patreon.com/hc/en-us/articles/360039589091-Patreon-s-supported-currencies)

### 배포 실행기 후보

- [GitHub Actions — 수동 workflow 실행](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [GitHub Actions — environment 승인·concurrency와 private repository 제한](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [Cloudflare Workers CI/CD](https://developers.cloudflare.com/workers/ci-cd/)

## 18. 다음 인터뷰 질문

**Q43. 핵심 인터뷰를 여기서 닫고 A 단계의 test Bot vertical spike로 넘어갈까?**

- **A. 전환 — 권장:** 먼저 test application·관리자 전용 `BOT TEST` surface의 연결과 권한을 읽기 전용으로 확인하고, 이어서 그 surface에서만 fixture 한 건의 create·update·delete·복원을 검증한다. production Discord·D1·R2에는 쓰지 않는다.
- **B. 계획 인터뷰 계속:** 아직 빠진 운영 결정을 더 찾은 뒤 구현 경계를 연다.
- **C. spike 없이 바로 전체 구현:** 실제 Discord payload·attachment·permission이 확인되지 않은 상태에서 넓은 코드를 만들게 되어 권장하지 않는다.

현재 문서는 원본·이미지·분류·게시·복구·관리 UX·배포 경계까지 구현에 필요한 핵심 결정을 갖췄다. A로 넘어가도 이후 검증에서 발견된 제약은 이 문서의 validation-needed 항목으로 되돌려 반영한다.
