# Repository agent contract

작업 전에 `docs/architecture.md`에서 배정된 파트의 컨텍스트 패킷과 DOM 계약만 확인한다.
dependency·빌드·배포 작업은 `docs/technical-index.md`의 버전 묶음과 완료 계약도 확인한다.

- 한 작업은 한 섹션 또는 한 런타임 계약을 소유한다. 배정되지 않은 파일은 수정하지 않는다.
- `app/page.tsx`는 조합 루트다. 섹션 구현을 다시 이 파일에 넣지 않는다.
- 섹션 props는 `SiteCopy`의 필요한 조각만 받는다. 전역 Context나 새 상태 라이브러리를 추가하지 않는다.
- DOM wrapper, 태그 순서, class, `data-*` 변경 전에는 해당 CSS 선택자와 테스트를 함께 확인한다.
- `app/globals.css` import 순서와 `52rem` motion/responsive 경계를 유지한다.
- `.openai/hosting.json`, `vite.config.ts`, `worker/`, `tooling/`, `wrangler.jsonc`는 배포 파트가 아니면 건드리지 않는다.
- 최종 공개 origin은 `https://about.bluehair.blue`다.
- 실패한 우회 코드를 쌓지 말고 공통 호출 지점의 원인을 고친다.
- 의존성, 범용 primitive, factory, Context는 두 번째 실제 사용처가 없으면 만들지 않는다.
- 최소 검증은 배정 패킷의 검사이며, 통합 전에는 `npm run lint && npm test`를 통과시킨다.

사이트 checkout 수정과 배포는 주 에이전트만 수행한다. 조사 에이전트는 읽기 전용 결과만 반환한다.
