/* eslint-disable @next/next/no-html-link-for-pages -- Native public navigation avoids a Vinext dev optimizer reload on first lazy-route entry. */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import {
  loadPublicPost,
  PUBLIC_SITE_ORIGIN,
  publicPostPath,
} from "../../../lib/public-projection";
import { getRuntimeEnv } from "../../../lib/runtime-env";
import { MarkdownBody } from "../../components/markdown-body";
import { StandalonePublicGallery } from "../../components/public-gallery";

export const dynamic = "force-dynamic";

const findPost = cache(async (slug: string) => {
  const env = await getRuntimeEnv();
  return loadPublicPost(env.STUDIO_DB, slug, env.DISCORD_GUILD_ID);
});

function canonicalUrl(slug: string) {
  return new URL(publicPostPath(slug), PUBLIC_SITE_ORIGIN).href;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await findPost(slug);
  if (!post) return {};
  const canonical = canonicalUrl(post.slug);
  const primary = post.images[0];
  const image = primary
    ? new URL(primary.src, PUBLIC_SITE_ORIGIN).href
    : null;
  return {
    title: `${post.title} — 한파란`,
    description: post.description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      url: canonical,
      title: post.title,
      description: post.description,
      locale: "ko_KR",
      publishedTime: post.publishedAt,
      images: image
        ? [{
            url: image,
            width: primary.width,
            height: primary.height,
            alt: primary.alt,
          }]
        : [],
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: post.title,
      description: post.description,
      images: image ? [image] : [],
    },
  };
}

export default async function PublicPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await findPost(slug);
  if (!post) notFound();
  const kindLabel = post.kind === "work" ? "작품 소식" : "근황";

  return (
    <>
      <a className="skip-link" href="#post-content">
        본문으로 건너뛰기
      </a>
      <header className="detail-site-header">
        <a href="/" aria-label="한파란 포트폴리오 홈">
          HANPARAN
        </a>
        <a href="/#now">제작 근황으로 돌아가기</a>
      </header>
      <main className="detail-page" id="post-content">
        <article className="detail-post">
          <header className="detail-post-header">
            <p>{kindLabel}</p>
            <h1 lang="ko">{post.title}</h1>
            <time dateTime={post.publishedAt}>
              {post.publishedAt.slice(0, 10).replaceAll("-", ".")}
            </time>
            {post.topics.length > 0 ? (
              <ul className="post-topic-list" aria-label="주제">
                {post.topics.map((topic) => (
                  <li key={topic.key}>{topic.label}</li>
                ))}
              </ul>
            ) : null}
          </header>
          <StandalonePublicGallery images={post.images} title={post.title} />
          <MarkdownBody
            body={post.bodyMarkdown}
            className="public-markdown detail-markdown"
            lang="ko"
          />
          <footer className="detail-post-actions">
            <a href="/#now">다른 제작 근황 보기</a>
            {post.discordUrl ? (
              <a
                href={post.discordUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Discord에서 댓글 보기
              </a>
            ) : null}
          </footer>
        </article>
      </main>
    </>
  );
}
