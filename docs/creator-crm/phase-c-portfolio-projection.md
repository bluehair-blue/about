# Phase C — Portfolio projection

> 상태: Phase B 완료 대기
>
> 목적: D1/R2 승인본을 `about.bluehair.blue`의 SNS형 공개 feed·Hero·상세 페이지로 안전하게 투영한다.
>
> 선행 문서: [`phase-b-canonical-backend.md`](./phase-b-canonical-backend.md)

## 1. 완료 결과

방문자는 `#now`에서 공개 글을 분류·정렬·페이지 이동하고, 이미지 gallery와 전체 글을 본 뒤 Discord 댓글 또는 Patreon 후원 경로로 이동할 수 있다. 공개 UI는 `published` current version과 허용된 Portfolio derivative만 읽는다.

Phase C는 공개 projection만 소유한다. 콘텐츠 수정·복구 판단은 Studio Console로 되돌린다.

## 2. 시작 조건

- Phase B의 current pointer·status·public media guard가 검증되었다.
- staging에 이미지 0장, 1장, 동일 비율 여러 장, 혼합 비율 여러 장 fixture가 있다.
- pin 하나와 여러 `hero_rank`, active/archived taxonomy, active/detached Discord mapping fixture가 있다.
- `/updates/[slug]`가 사용할 stable slug와 승인본 metadata가 준비되어 있다.

## 3. 읽을 파일과 소유 범위

먼저 읽을 파일:

- 이 문서와 Phase B 완료 기록
- [`AGENTS.md`](../../AGENTS.md)
- [`architecture.md`](../architecture.md)의 DOM·스타일 계약
- [`technical-index.md`](../technical-index.md)의 app·metadata·테스트 계약
- [`app/page.tsx`](../../app/page.tsx), [`app/content.ts`](../../app/content.ts)
- [`app/components/updates-section.tsx`](../../app/components/updates-section.tsx), [`app/components/hero-section.tsx`](../../app/components/hero-section.tsx)
- [`app/globals.css`](../../app/globals.css), `app/styles/sections.css`, `motion.css`, `responsive.css`
- [`tests/rendered-html.test.mjs`](../../tests/rendered-html.test.mjs)
- Phase B의 public post query와 media route

이 Phase가 소유하는 범위:

- root initial feed loader와 `#now` SNS feed module
- filter·sort·pagination URL normalization
- pin·Hero projection
- post card·gallery·lightbox
- `/updates/[slug]`와 item-specific metadata
- `/community`와 active Discord CTA
- 공개 UI의 responsive·keyboard·touch·screen-reader·reduced-motion 검증

Studio route·write API·D1 lifecycle·Queue consumer와 Discord mutation은 수정하지 않는다.

## 4. root 데이터 경계

현재 `app/page.tsx`에 D1 query나 section 구현을 직접 넣지 않는다.

권장 구조:

1. `app/page.tsx`는 server에서 URL query를 allowlist로 정규화하고 initial public projection을 읽는다.
2. 현재 locale hook과 섹션 조합은 좁은 client Home module로 이동한다.
3. server가 직렬화 가능한 `PublicPostSummary`를 Home에 전달한다.
4. feed와 Hero는 같은 summary 계약을 사용하되 각 section이 필요한 필드만 props로 받는다.

이 변경에서 `architecture.md`와 조합 회귀 테스트를 함께 갱신한다. 전역 Context, client-side 기준 원본, 범용 data layer와 중복 fetch cache를 만들지 않는다.

모든 public query는 다음을 강제한다.

- `studio_posts.status = published`
- `current_version_id`의 승인본만 join
- current version이 참조한 public derivative만 반환
- private R2 key·Discord derivative·Discord CDN URL 제외
- raw query를 SQL identifier나 `ORDER BY`에 보간하지 않고 allowlist branch 사용

## 5. feed 계약

- anchor: `#now`
- layout: 단일 열 SNS feed
- category: `전체 / 근황 / 작품 소식`
- topic: active topic 하나
- sort: `최신순 / 오래된순`
- category와 topic 조합 허용
- pagination: 일반 post 10개, 번호형 page
- pin: page 1에서 filter와 맞을 때만 일반 10개·page count 밖에 한 건 표시
- Hero: pin과 독립, nullable `hero_rank` 오름차순

URL 예시:

```text
?kind=work&tag=character&sort=oldest&page=2#now
```

- 알 수 없는 kind·tag·sort·page는 제거하거나 기본값으로 정규화한다.
- archived tag는 tag 없는 기본 feed로 정규화한다.
- filter·sort·page link는 새로고침·공유·browser Back에서 같은 결과를 복원한다.

게시물 원문은 초기에는 한국어뿐이다. 번역을 만들지 않고 card·detail 본문에 `lang="ko"`를 적용한다. site chrome의 기존 ko/ja/en locale 계약은 유지한다.

## 6. 카드·이미지 계약

| 이미지 | 표시 |
| --- | --- |
| 0장 | media 영역 없는 text card |
| 1장 | 큰 thumbnail |
| 동일 비율 2–10장 | crop 없는 horizontal slider |
| 혼합 비율 2–4장 | 일정 frame의 crop grid |
| 혼합 비율 5–10장 | 앞 4장과 `+N` overlay |

동일 비율 판정:

```text
max(ratio) / min(ratio) <= 1.01
```

- ratio는 EXIF orientation 적용 뒤 dimension을 사용한다.
- slider는 이전·다음 button, swipe와 keyboard를 지원한다.
- crop grid thumbnail을 눌러도 원본 source가 아니라 Portfolio derivative lightbox를 연다.
- lightbox는 feed 위 공용 native `<dialog>` 하나를 사용하고 contain·순번·이전/다음·Escape·swipe·focus 복귀·reduced motion을 지원한다.
- 본문은 4줄 preview와 `더 보기 / 접기`를 제공한다.
- `사이트에서 전체 보기`는 detail route로 이동한다.
- active Discord mapping이 있을 때만 `Discord에서 댓글 보기`를 표시한다.

새 carousel·dialog dependency, image hotlink와 model-authored SVG를 추가하지 않는다.

## 7. 상세 route와 metadata

route: `/updates/[slug]`

- current 승인본 전체 Markdown과 0–10장 gallery
- allowlist Markdown renderer와 안전한 URL scheme
- stable canonical: `https://about.bluehair.blue/updates/{slug}`
- record별 title·description, Open Graph와 X metadata
- primary Portfolio derivative가 있으면 trusted origin의 absolute URL로 OG/X image 사용
- 이미지가 없으면 상속된 generic item image를 사용하지 않고 item OG/X image를 비움
- private source·Discord CDN URL을 HTML·RSC payload·client bundle에 보내지 않음
- unpublished·withheld·archived·purged slug는 lifecycle 계약에 맞는 404/410

root와 detail metadata 변경은 `app/layout.tsx`, public origin과 렌더 테스트의 기존 계약을 함께 확인한다.

## 8. Hero·Community·Patreon

Hero:

- `hero_rank`가 있는 `published` post만 사용
- 순서는 rank로만 결정하고 reaction·댓글 수로 자동 승격하지 않음
- 기존 `.hero` direct-child와 `52rem / 52.001rem` responsive 경계를 보존

Community:

- `/community`는 Discord 참여 안내와 active thread 경로만 제공
- detached·missing·unverified mapping의 CTA는 표시하지 않음
- Discord 댓글·reaction·profile을 D1로 복제하지 않음

Patreon:

- title: `작업실 연료 보급`
- CTA: `제작자 더 일하게 만들기 ↗`
- 월 5,000원 수준의 순수 후원 설명
- 혜택·일정·Discord role·독점 콘텐츠를 약속하지 않음
- 결제액·통화는 Patreon checkout에서 확인
- 초기에는 membership blur·lock card 없음

## 9. 구현 순서

1. public query·URL normalization과 query test
2. root server loader와 thin client Home 조합으로 이동
3. `#now` feed·filter·sort·pagination
4. pin과 Hero projection
5. card text·Discord/detail CTA
6. 이미지 0/1/multi layout과 slider
7. 공용 lightbox와 keyboard·touch behavior
8. `/updates/[slug]` render와 record metadata
9. `/community`와 Patreon CTA 확인
10. responsive·reduced-motion·accessibility·cache invalidation 회귀

DOM wrapper, tag order, class와 `data-*`를 바꿔야 하면 해당 CSS selector와 렌더 테스트를 같은 변경에서 갱신한다. `app/globals.css` import 순서는 유지한다.

## 10. 완료 증거

- [ ] unknown·archived query가 canonical URL state로 정규화됨
- [ ] 최신순·오래된순·kind·topic·pagination 결과가 D1 fixture와 일치
- [ ] pin이 filter와 page count 계약을 지키고 Hero와 독립적임
- [ ] 0/1/동일 비율/혼합 비율 이미지 fixture가 지정 layout으로 표시됨
- [ ] slider·lightbox keyboard, swipe, Escape, focus 복귀와 reduced motion 확인
- [ ] long body의 `더 보기 / 접기`와 detail 이동 확인
- [ ] active mapping에만 Discord CTA가 있고 detach 뒤 cache purge로 사라짐
- [ ] detail canonical·title·description·OG/X가 record와 일치
- [ ] private source·Discord CDN URL이 public output에 없음
- [ ] mobile `52rem` 경계와 기존 DOM·CSS 회귀 통과
- [ ] `npm run lint`와 `npm test` 통과
- [ ] build output 세 항목 존재

## 11. 완료 기록

- commit: 미기록
- root feed fixture: 미기록
- detail/metadata fixture: 미기록
- keyboard/mobile evidence: 미기록
- Go/No-Go: 미통과

## 다음 Phase

공개 projection과 접근성 검증이 통과한 뒤 [Phase D — recovery and operations](./phase-d-recovery-operations.md)로 이동한다. UI에서 발견한 lifecycle 오류는 Phase C에서 우회하지 말고 Phase B invariant로 되돌려 고친다.
