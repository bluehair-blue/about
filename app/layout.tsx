import type { Metadata } from "next";
import { siteContent } from "./content";
import "./globals.css";

const SITE_ORIGIN = "https://about.bluehair.blue";
const defaultMeta = siteContent.ko.meta;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: defaultMeta.title,
  description: defaultMeta.description,
  alternates: { canonical: SITE_ORIGIN },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: defaultMeta.title,
    description: "인물과 이야기, 그들이 살아갈 규칙까지 설계합니다.",
    url: SITE_ORIGIN,
    type: "website",
    locale: "ko_KR",
    images: [
      {
        url: `${SITE_ORIGIN}/og.png`,
        width: 1731,
        height: 909,
        alt: "한파란 포트폴리오 — 세계를 설계합니다.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: defaultMeta.title,
    description: "인물과 이야기, 그들이 살아갈 규칙까지 설계합니다.",
    images: [`${SITE_ORIGIN}/og.png`],
  },
};

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
