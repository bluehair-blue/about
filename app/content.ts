export type Locale = "ko" | "ja" | "en";

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
  feed: {
    controls: string;
    category: string;
    all: string;
    update: string;
    work: string;
    topic: string;
    sort: string;
    newest: string;
    oldest: string;
    pinned: string;
    expand: string;
    collapse: string;
    detail: string;
    discord: string;
    community: string;
    empty: string;
    pagination: string;
    page: string;
  };
  showcase: {
    label: string;
    latest: string;
    selectionLabel: string;
    itemLabel: string;
    allUpdates: string;
    empty: string;
    openPost: string;
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
          title: "작업실 연료 보급",
          status: "제작자 더 일하게 만들기 ↗",
          href: patreonUrl,
          openLabel: "Patreon 후원 결제 페이지를 새 탭에서 열기",
        },
      ],
      note: "월 5,000원 수준의 순수 후원입니다. 혜택·일정·Discord 역할·독점 콘텐츠는 약속하지 않으며, 결제액과 통화는 Patreon 결제 화면에서 확인해 주세요.",
    },
    notes: {
      sectionTitle: "Making notes",
      sectionSubtitle: "제작 근황",
      footnote:
        "공개 승인된 한국어 원문만 표시합니다. 글 수정과 복구는 Studio에서 관리합니다.",
    },
    feed: {
      controls: "제작 근황 필터와 정렬",
      category: "분류",
      all: "전체",
      update: "근황",
      work: "작품 소식",
      topic: "주제",
      sort: "정렬",
      newest: "최신순",
      oldest: "오래된순",
      pinned: "PIN",
      expand: "더 보기",
      collapse: "접기",
      detail: "사이트에서 전체 보기",
      discord: "Discord에서 댓글 보기",
      community: "커뮤니티 안내 보기 →",
      empty: "조건에 맞는 공개 글이 없습니다.",
      pagination: "제작 근황 페이지",
      page: "페이지",
    },
    showcase: {
      label: "최근 업데이트 슬라이드",
      latest: "최근 업데이트",
      selectionLabel: "업데이트 선택",
      itemLabel: "{index}번째 업데이트: {title}",
      allUpdates: "전체 업데이트 보기",
      empty: "Hero에 공개된 글이 없습니다.",
      openPost: "전체 글 보기 ↗",
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
          title: "制作室への燃料補給",
          status: "制作者をもっと働かせる ↗",
          href: patreonUrl,
          openLabel: "Patreonの支援決済ページを新しいタブで開く",
        },
      ],
      note: "月5,000ウォン程度の純粋な支援です。特典、日程、Discordロール、限定コンテンツは約束せず、金額と通貨はPatreonの決済画面でご確認ください。",
    },
    notes: {
      sectionTitle: "Making notes",
      sectionSubtitle: "制作ノート",
      footnote:
        "公開承認された韓国語の原文だけを表示します。編集と復旧はStudioで管理します。",
    },
    feed: {
      controls: "制作近況の絞り込みと並び順",
      category: "分類",
      all: "すべて",
      update: "近況",
      work: "作品のお知らせ",
      topic: "テーマ",
      sort: "並び順",
      newest: "新しい順",
      oldest: "古い順",
      pinned: "固定",
      expand: "もっと見る",
      collapse: "閉じる",
      detail: "サイトで全文を見る",
      discord: "Discordでコメントを見る",
      community: "コミュニティ案内を見る →",
      empty: "条件に合う公開記事はありません。",
      pagination: "制作近況のページ",
      page: "ページ",
    },
    showcase: {
      label: "最新情報のスライド",
      latest: "最新情報",
      selectionLabel: "更新を選択",
      itemLabel: "{index}件目の更新：{title}",
      allUpdates: "すべての更新を見る",
      empty: "Heroに公開中の記事はありません。",
      openPost: "全文を見る ↗",
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
          title: "Fuel the studio",
          status: "Make the creator work more ↗",
          href: patreonUrl,
          openLabel: "Open the Patreon support checkout in a new tab",
        },
      ],
      note: "This is simple support at roughly KRW 5,000 per month. It promises no benefits, schedule, Discord role, or exclusive content; confirm the amount and currency at Patreon checkout.",
    },
    notes: {
      sectionTitle: "Making notes",
      sectionSubtitle: "Studio updates",
      footnote:
        "Only approved Korean originals are shown. Editing and recovery stay in Studio.",
    },
    feed: {
      controls: "Filter and sort studio updates",
      category: "Category",
      all: "All",
      update: "Updates",
      work: "Work news",
      topic: "Topic",
      sort: "Sort",
      newest: "Newest",
      oldest: "Oldest",
      pinned: "PIN",
      expand: "Read more",
      collapse: "Collapse",
      detail: "Read the full post on this site",
      discord: "View comments on Discord",
      community: "Community guide →",
      empty: "No public posts match these filters.",
      pagination: "Studio update pages",
      page: "Page",
    },
    showcase: {
      label: "Latest updates carousel",
      latest: "Latest update",
      selectionLabel: "Choose an update",
      itemLabel: "Update {index}: {title}",
      allUpdates: "View all updates",
      empty: "No posts are currently featured in the Hero.",
      openPost: "Read full post ↗",
    },
    footer: { name: "Hanparan", top: "Back to top" },
  },
} satisfies Record<Locale, SiteCopy>;
