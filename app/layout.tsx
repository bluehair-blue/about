import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "bluhair.blue";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.includes("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: "한파란 — 서브컬쳐 AI 챗봇 기획자",
    description:
      "캐릭터의 말투부터 세계의 규칙까지 설계하는 서브컬쳐 AI 챗봇 기획자 한파란의 포트폴리오.",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "한파란 — 서브컬쳐 AI 챗봇 기획자",
      description: "대화로 세계의 결을 설계합니다.",
      type: "website",
      locale: "ko_KR",
      images: [
        {
          url: `${origin}/og.png`,
          width: 1731,
          height: 909,
          alt: "한파란 포트폴리오 — 대화로 세계의 결을 설계합니다.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "한파란 — 서브컬쳐 AI 챗봇 기획자",
      description: "대화로 세계의 결을 설계합니다.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
