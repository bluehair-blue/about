# 한파란 포트폴리오

서브컬쳐 AI 챗봇 기획자 한파란의 포트폴리오 레퍼런스 사이트입니다.

- `#work`: 작품 목록
- `#support`: 후원 안내
- `#now`: 제작 근황

## 구조

- `app/content.ts`: 작품과 제작 근황 데이터
- `app/page.tsx`: 페이지의 시맨틱 마크업
- `app/globals.css`: 스타일 모듈 진입점
- `app/styles/`: 기반·히어로·섹션·모션·반응형 스타일
- `worker/`: Cloudflare Worker 진입점
- `tooling/`: 빌드 시 필요한 Sites 메타데이터 처리
- `tests/`: 렌더링과 스크롤 모션 회귀 테스트

콘텐츠는 `app/content.ts`, 화면 구조는 `app/page.tsx`에서 수정합니다. 모든 작성 색상은 OKLCH를 사용합니다.

```bash
npm run dev
npm run build
npm test
npm run deploy
```

배포 주소는 `https://about.bluehair.blue`이며, Worker 미리보기는 `https://about.odeye3217.workers.dev`에서 확인할 수 있습니다.
