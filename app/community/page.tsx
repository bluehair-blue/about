/* eslint-disable @next/next/no-html-link-for-pages -- Native public navigation avoids a Vinext dev optimizer reload on first lazy-route entry. */
import type { Metadata } from "next";

import {
  loadPublicCommunityThreads,
  PUBLIC_SITE_ORIGIN,
  publicPostPath,
} from "../../lib/public-projection";
import { getRuntimeEnv } from "../../lib/runtime-env";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "커뮤니티 — 한파란",
  description: "한파란의 공개 제작 글과 연결된 Discord 댓글 참여 안내.",
  alternates: { canonical: `${PUBLIC_SITE_ORIGIN}/community` },
  openGraph: {
    title: "커뮤니티 — 한파란",
    description: "공개 제작 글과 연결된 Discord 댓글 참여 안내.",
    url: `${PUBLIC_SITE_ORIGIN}/community`,
    images: [],
  },
  twitter: {
    card: "summary",
    title: "커뮤니티 — 한파란",
    description: "공개 제작 글과 연결된 Discord 댓글 참여 안내.",
    images: [],
  },
};

export default async function CommunityPage() {
  const env = await getRuntimeEnv();
  const threads = await loadPublicCommunityThreads(
    env.STUDIO_DB,
    env.DISCORD_GUILD_ID,
  );
  return (
    <>
      <a className="skip-link" href="#community-content">
        본문으로 건너뛰기
      </a>
      <header className="detail-site-header">
        <a href="/" aria-label="한파란 포트폴리오 홈">
          HANPARAN
        </a>
        <a href="/#now">제작 근황으로 돌아가기</a>
      </header>
      <main className="community-page" id="community-content">
        <header>
          <p>COMMUNITY · DISCORD</p>
          <h1>공개 글에서 이어지는 대화</h1>
          <p>
            댓글은 공개 글과 연결된 Discord Forum thread에서 확인하고 참여할 수
            있습니다. Discord 계정과 서버 접근 권한은 Discord 화면에서 안내됩니다.
          </p>
        </header>
        <section aria-labelledby="community-threads">
          <h2 id="community-threads">참여 가능한 공개 글</h2>
          {threads.length > 0 ? (
            <ul className="community-thread-list">
              {threads.map((thread) => (
                <li key={thread.postId}>
                  <div>
                    <a href={publicPostPath(thread.slug)}>{thread.title}</a>
                    <span lang="ko">공개 승인본</span>
                  </div>
                  <a
                    href={thread.discordUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Discord에서 댓글 보기 ↗
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="community-empty">
              현재 확인된 Discord 댓글 경로가 없습니다.
            </p>
          )}
        </section>
      </main>
    </>
  );
}
