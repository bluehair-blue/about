export type Locale = "ko" | "ja" | "en";

export type UpdateItem = {
  id: string;
  date: string;
  dateTime: string;
  state: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
};

export type SiteCopy = {
  meta: { title: string; description: string };
  skipLink: string;
  homeLabel: string;
  navLabel: string;
  languageLabel: string;
  nav: { work: string; support: string; now: string };
  hero: {
    title: [string, string];
    intro: string;
    workLink: string;
  };
  work: {
    sectionTitle: string;
    sectionSubtitle: string;
    title: string;
    subtitle: string;
    description: string;
    image: string;
    imageAlt: string;
    url: string;
    openLabel: string;
    visualCta: string;
    label: string;
    detailsLabel: string;
    details: string[];
    projectLink: string;
  };
  support: {
    title: [string, string];
    description: string;
    panelLabel: string;
    options: {
      title: string;
      status: string;
      href?: string;
      openLabel?: string;
    }[];
    note: string;
  };
  notes: {
    sectionTitle: string;
    sectionSubtitle: string;
    footnote: string;
  };
  updates: UpdateItem[];
  showcase: {
    label: string;
    latest: string;
    selectionLabel: string;
    itemLabel: string;
    allUpdates: string;
  };
  footer: { name: string; top: string };
};

const project = {
  image: "/works/prime-city.webp",
  url: "https://intro.bluehair.blue",
  details: ["WORLD BUILDING", "20 PERSONAS", "INTERACTIVE FICTION"],
};

const patreonUrl = "https://www.patreon.com/bluehairblue";

export const localeOptions: { value: Locale; label: string }[] = [
  { value: "ko", label: "한국어" },
  { value: "ja", label: "日本語" },
  { value: "en", label: "English" },
];

export const siteContent = {
  ko: {
    meta: {
      title: "한파란 — 세계를 설계합니다.",
      description:
        "인물과 이야기, 그들이 살아갈 규칙까지 설계하는 한파란의 포트폴리오.",
    },
    skipLink: "본문으로 건너뛰기",
    homeLabel: "한파란 포트폴리오 홈",
    navLabel: "주요 메뉴",
    languageLabel: "사이트 언어",
    nav: { work: "작품", support: "후원", now: "근황" },
    hero: {
      title: ["세계를", "설계합니다."],
      intro: "인물과 이야기, 그들이 살아갈 규칙까지.",
      workLink: "첫 작품 보기",
    },
    work: {
      ...project,
      sectionTitle: "Selected work",
      sectionSubtitle: "선별 작품",
      title: "프라임시티",
      subtitle: "PRIME CITY",
      description:
        "20인의 캐릭터와 도시 세계관을 하나의 대화형 엔터테인먼트로 설계한 장기 프로젝트.",
      imageAlt: "프라임시티 캐릭터 장그루",
      openLabel: "프라임시티 소개 사이트 열기",
      visualCta: "프로젝트 방문 ↗",
      label: "FEATURED · 2026",
      detailsLabel: "프로젝트 주요 정보",
      projectLink: "프로젝트 소개 보기",
    },
    support: {
      title: ["좋아한 장면이", "오래 남았다면."],
      description:
        "후원은 다음 캐릭터와 다음 세계를 만드는 시간으로 돌아옵니다.",
      panelLabel: "후원 방법",
      options: [
        { title: "공개 제작로그", status: "누구나 읽을 수 있습니다" },
        {
          title: "Patreon 멤버십",
          status: "제작실 응원하기 ↗",
          href: patreonUrl,
          openLabel: "Patreon 제작실 페이지를 새 탭에서 열기",
        },
      ],
      note: "작품과 공개 제작로그는 계속 누구나 볼 수 있습니다. 멤버십에는 별도의 AI 채팅 이용권이 포함되지 않습니다.",
    },
    notes: {
      sectionTitle: "Making notes",
      sectionSubtitle: "제작 근황",
      footnote:
        "세부 제작 로그와 아카이브는 콘텐츠 구조가 확정된 뒤 순차적으로 공개합니다.",
    },
    updates: [
      {
        id: "portfolio-foundation",
        date: "2026.07.30",
        dateTime: "2026-07-30",
        state: "진행 중",
        title: "포트폴리오의 첫 기준을 세우는 중",
        description:
          "작품, 후원, 제작 노트를 한 흐름으로 잇는 레퍼런스 페이지를 정리하고 있습니다.",
        image: "/smoke-ribbon.png",
        imageAlt: "옅은 배경 위를 흐르는 파란 연무",
      },
      {
        id: "prime-city-expansion",
        date: "2026.04.23",
        dateTime: "2026-04-23",
        state: "완료",
        title: "프라임시티의 인물과 장면 확장",
        description:
          "신규 캐릭터와 시네마틱 인트로, 이미지 제작 파이프라인을 확장했습니다.",
        image: "/works/prime-city.webp",
        imageAlt: "프라임시티 캐릭터 장그루",
      },
    ],
    showcase: {
      label: "최근 업데이트 슬라이드",
      latest: "최근 업데이트",
      selectionLabel: "업데이트 선택",
      itemLabel: "{index}번째 업데이트: {title}",
      allUpdates: "전체 업데이트 보기",
    },
    footer: { name: "한파란", top: "맨 위로" },
  },
  ja: {
    meta: {
      title: "ハンパラン — 世界を、設計する。",
      description:
        "人物と物語、そして彼らが生きるためのルールまで設計する、ハンパランのポートフォリオ。",
    },
    skipLink: "本文へ移動",
    homeLabel: "ハンパランのポートフォリオ ホーム",
    navLabel: "メインメニュー",
    languageLabel: "サイトの言語",
    nav: { work: "作品", support: "応援", now: "近況" },
    hero: {
      title: ["世界を、", "設計する。"],
      intro: "人物と物語、そして彼らが生きるためのルールまで。",
      workLink: "代表作を見る",
    },
    work: {
      ...project,
      sectionTitle: "Selected work",
      sectionSubtitle: "代表作",
      title: "プライムシティ",
      subtitle: "PRIME CITY",
      description:
        "20人のキャラクターと都市の世界観を、ひとつのインタラクティブ・エンターテインメントとして設計した長期プロジェクト。",
      imageAlt: "プライムシティのキャラクター、ジャングル",
      openLabel: "プライムシティの紹介サイトを開く",
      visualCta: "プロジェクトへ ↗",
      label: "FEATURED · 2026",
      detailsLabel: "プロジェクト概要",
      projectLink: "プロジェクトを見る",
    },
    support: {
      title: ["心に残る場面が", "あったなら。"],
      description:
        "その応援は、次のキャラクターと次の世界をつくる時間になります。",
      panelLabel: "応援方法",
      options: [
        { title: "公開制作ノート", status: "どなたでも読めます" },
        {
          title: "Patreon メンバーシップ",
          status: "制作室を応援する ↗",
          href: patreonUrl,
          openLabel: "Patreonの制作室ページを新しいタブで開く",
        },
      ],
      note: "作品と公開制作ノートは、これからも誰でも見られる形で続けます。メンバーシップに限定AIチャットへのアクセス権は含まれません。",
    },
    notes: {
      sectionTitle: "Making notes",
      sectionSubtitle: "制作ノート",
      footnote:
        "詳しい制作ログとアーカイブは、コンテンツ構成が固まり次第、順次公開します。",
    },
    updates: [
      {
        id: "portfolio-foundation",
        date: "2026.07.30",
        dateTime: "2026-07-30",
        state: "制作中",
        title: "ポートフォリオの基準を整えています",
        description:
          "作品、応援方法、制作ノートをひとつの流れでたどれるリファレンスページを整えています。",
        image: "/smoke-ribbon.png",
        imageAlt: "淡い背景にたなびく青い煙",
      },
      {
        id: "prime-city-expansion",
        date: "2026.04.23",
        dateTime: "2026-04-23",
        state: "完了",
        title: "プライムシティの人物とシーンを拡張",
        description:
          "新キャラクター、シネマティックなイントロ、画像制作パイプラインを拡張しました。",
        image: "/works/prime-city.webp",
        imageAlt: "プライムシティのキャラクター、ジャングル",
      },
    ],
    showcase: {
      label: "最新情報のスライド",
      latest: "最新情報",
      selectionLabel: "更新を選択",
      itemLabel: "{index}件目の更新：{title}",
      allUpdates: "すべての更新を見る",
    },
    footer: { name: "ハンパラン", top: "ページ上部へ" },
  },
  en: {
    meta: {
      title: "Hanparan — I design worlds.",
      description:
        "Hanparan’s portfolio of characters, stories, and the systems that bring their worlds to life.",
    },
    skipLink: "Skip to main content",
    homeLabel: "Hanparan portfolio home",
    navLabel: "Main navigation",
    languageLabel: "Site language",
    nav: { work: "Work", support: "Support", now: "Now" },
    hero: {
      title: ["I design", "worlds."],
      intro: "Characters, stories, and the rules that bring their worlds to life.",
      workLink: "View featured work",
    },
    work: {
      ...project,
      sectionTitle: "Selected work",
      sectionSubtitle: "Featured project",
      title: "Prime City",
      subtitle: "AN INTERACTIVE WORLD",
      description:
        "A long-term project bringing 20 characters and an urban universe together as one interactive entertainment experience.",
      imageAlt: "Jang Gru, a character from Prime City",
      openLabel: "Open the Prime City introduction site",
      visualCta: "VISIT PROJECT ↗",
      label: "FEATURED · 2026",
      detailsLabel: "Project highlights",
      projectLink: "Explore the project",
    },
    support: {
      title: ["If a scene", "stayed with you."],
      description:
        "Your support becomes time to create the next character—and the next world.",
      panelLabel: "Ways to support",
      options: [
        { title: "Public studio notes", status: "Open to everyone" },
        {
          title: "Patreon membership",
          status: "Support the studio ↗",
          href: patreonUrl,
          openLabel: "Open the studio Patreon page in a new tab",
        },
      ],
      note: "Artwork and public studio notes will remain open to everyone. Membership does not include access to gated AI chat experiences.",
    },
    notes: {
      sectionTitle: "Making notes",
      sectionSubtitle: "Studio updates",
      footnote:
        "Detailed production logs and archives will be released as the content structure settles.",
    },
    updates: [
      {
        id: "portfolio-foundation",
        date: "2026.07.30",
        dateTime: "2026-07-30",
        state: "In progress",
        title: "Setting the foundation for this portfolio",
        description:
          "I’m shaping a reference page that connects the work, ways to support it, and production notes in one clear flow.",
        image: "/smoke-ribbon.png",
        imageAlt: "Blue mist drifting across a pale background",
      },
      {
        id: "prime-city-expansion",
        date: "2026.04.23",
        dateTime: "2026-04-23",
        state: "Complete",
        title: "Expanding Prime City’s cast and scenes",
        description:
          "Added new characters, a cinematic intro, and a broader image-production pipeline.",
        image: "/works/prime-city.webp",
        imageAlt: "Jang Gru, a character from Prime City",
      },
    ],
    showcase: {
      label: "Latest updates carousel",
      latest: "Latest update",
      selectionLabel: "Choose an update",
      itemLabel: "Update {index}: {title}",
      allUpdates: "View all updates",
    },
    footer: { name: "Hanparan", top: "Back to top" },
  },
} satisfies Record<Locale, SiteCopy>;
