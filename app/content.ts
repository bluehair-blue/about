export const featuredWork = {
  title: "프라임시티",
  englishTitle: "PRIME CITY",
  description:
    "20인의 캐릭터와 도시 세계관을 하나의 대화형 엔터테인먼트로 설계한 장기 프로젝트.",
  image: "/works/prime-city.webp",
  url: "https://intro.bluehair.blue",
  details: ["WORLD BUILDING", "20 PERSONAS", "INTERACTIVE FICTION"],
};

export type UpdateItem = {
  date: string;
  state: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
};

export const updates: UpdateItem[] = [
  {
    date: "2026.07.30",
    state: "진행 중",
    title: "포트폴리오의 첫 기준을 세우는 중",
    description:
      "작품, 후원, 제작 노트를 한 흐름으로 잇는 레퍼런스 페이지를 정리하고 있습니다.",
    image: "/smoke-ribbon.png",
    imageAlt: "옅은 배경 위를 흐르는 파란 연무",
  },
  {
    date: "2026.04.23",
    state: "완료",
    title: "프라임시티의 인물과 장면 확장",
    description:
      "신규 캐릭터와 시네마틱 인트로, 이미지 제작 파이프라인을 확장했습니다.",
    image: "/works/prime-city.webp",
    imageAlt: "프라임시티 캐릭터 장그루",
  },
];
