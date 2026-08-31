"use client";

import { useState, type ReactNode } from "react";

import type {
  PublicFeedQuery,
  PublicPostSummary,
  PublicProjection,
} from "../../lib/public-projection";
import { PUBLIC_FEED_PAGE_SIZE } from "../../lib/public-projection";
import type { SiteCopy } from "../content";
import { MarkdownBody } from "./markdown-body";
import {
  PublicGallery,
  PublicLightbox,
  type LightboxSelection,
} from "./public-gallery";

function feedHref(
  current: PublicFeedQuery,
  changes: Partial<PublicFeedQuery>,
) {
  const query = { ...current, ...changes };
  const params = new URLSearchParams();
  if (query.kind !== "all") params.set("kind", query.kind);
  if (query.tag !== null) params.set("tag", query.tag);
  if (query.sort !== "newest") params.set("sort", query.sort);
  if (query.page !== 1) params.set("page", String(query.page));
  const search = params.toString();
  return `/${search === "" ? "" : `?${search}`}#now`;
}

function dateLabel(value: string) {
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/u.test(day) ? day.replaceAll("-", ".") : value;
}

function FilterLink({
  active,
  href,
  children,
}: {
  active: boolean;
  href: string;
  children: ReactNode;
}) {
  return (
    <a href={href} aria-current={active ? "page" : undefined}>
      {children}
    </a>
  );
}

function PublicPostCard({
  post,
  number,
  labels,
  expanded,
  onToggle,
  onOpen,
}: {
  post: PublicPostSummary;
  number: string;
  labels: SiteCopy["feed"];
  expanded: boolean;
  onToggle: () => void;
  onOpen: (selection: LightboxSelection) => void;
}) {
  const bodyId = `post-body-${post.postId}`;
  const kindLabel = post.kind === "work" ? labels.work : labels.update;
  return (
    <article
      className={`update public-post-card${post.pinned ? " public-post-card-pinned" : ""}`}
      data-post-kind={post.kind}
    >
      <div className="update-meta">
        <time dateTime={post.publishedAt}>{dateLabel(post.publishedAt)}</time>
        <span>{kindLabel}</span>
        {post.topics.length > 0 ? (
          <ul className="post-topic-list" aria-label={labels.topic}>
            {post.topics.map((topic) => (
              <li key={topic.key}>{topic.label}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="update-copy">
        <p aria-hidden="true">{number}</p>
        <h3 lang="ko">
          <a href={`/updates/${encodeURIComponent(post.slug)}`}>{post.title}</a>
        </h3>
        <div
          className="public-post-body"
          id={bodyId}
          data-expanded={expanded}
          lang="ko"
        >
          <MarkdownBody body={post.bodyMarkdown} className="public-markdown" />
        </div>
        <button
          className="post-expand"
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          {expanded ? labels.collapse : labels.expand}
        </button>
        <PublicGallery images={post.images} title={post.title} onOpen={onOpen} />
        <div className="post-actions">
          <a href={`/updates/${encodeURIComponent(post.slug)}`}>{labels.detail}</a>
          {post.discordUrl ? (
            <a
              href={post.discordUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {labels.discord}
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function UpdatesSection({
  notes,
  labels,
  projection,
}: {
  notes: SiteCopy["notes"];
  labels: SiteCopy["feed"];
  projection: PublicProjection;
}) {
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<LightboxSelection | null>(null);
  const { query } = projection;
  const categories = [
    { value: "all" as const, label: labels.all },
    { value: "update" as const, label: labels.update },
    { value: "work" as const, label: labels.work },
  ];

  return (
    <section className="section updates-section" id="now" aria-labelledby="now-title">
      <div className="section-heading">
        <p>03</p>
        <h2 id="now-title">{notes.sectionTitle}</h2>
        <span>{notes.sectionSubtitle}</span>
      </div>

      <div className="feed-controls" aria-label={labels.controls}>
        <div className="feed-filter-group">
          <p>{labels.category}</p>
          <div>
            {categories.map(({ value, label }) => (
              <FilterLink
                active={query.kind === value}
                href={feedHref(query, { kind: value, page: 1 })}
                key={value}
              >
                {label}
              </FilterLink>
            ))}
          </div>
        </div>
        <div className="feed-filter-group">
          <p>{labels.topic}</p>
          <div>
            <FilterLink
              active={query.tag === null}
              href={feedHref(query, { tag: null, page: 1 })}
            >
              {labels.all}
            </FilterLink>
            {projection.topics.map((topic) => (
              <FilterLink
                active={query.tag === topic.key}
                href={feedHref(query, { tag: topic.key, page: 1 })}
                key={topic.key}
              >
                {topic.label}
              </FilterLink>
            ))}
          </div>
        </div>
        <div className="feed-filter-group feed-sort-group">
          <p>{labels.sort}</p>
          <div>
            <FilterLink
              active={query.sort === "newest"}
              href={feedHref(query, { sort: "newest", page: 1 })}
            >
              {labels.newest}
            </FilterLink>
            <FilterLink
              active={query.sort === "oldest"}
              href={feedHref(query, { sort: "oldest", page: 1 })}
            >
              {labels.oldest}
            </FilterLink>
          </div>
        </div>
        <a className="community-link" href="/community">
          {labels.community}
        </a>
      </div>

      <div className="updates-list" aria-live="polite">
        {projection.pinned ? (
          <PublicPostCard
            post={projection.pinned}
            number={labels.pinned}
            labels={labels}
            expanded={expandedPostId === projection.pinned.postId}
            onToggle={() =>
              setExpandedPostId((current) =>
                current === projection.pinned?.postId
                  ? null
                  : projection.pinned?.postId ?? null,
              )
            }
            onOpen={setLightbox}
          />
        ) : null}
        {projection.posts.map((post, index) => (
          <PublicPostCard
            post={post}
            number={String(
              (query.page - 1) * PUBLIC_FEED_PAGE_SIZE + index + 1,
            ).padStart(2, "0")}
            labels={labels}
            expanded={expandedPostId === post.postId}
            onToggle={() =>
              setExpandedPostId((current) =>
                current === post.postId ? null : post.postId,
              )
            }
            onOpen={setLightbox}
            key={post.postId}
          />
        ))}
        {!projection.pinned && projection.posts.length === 0 ? (
          <p className="feed-empty">{labels.empty}</p>
        ) : null}
      </div>

      {projection.pageCount > 1 ? (
        <nav className="feed-pagination" aria-label={labels.pagination}>
          {Array.from({ length: projection.pageCount }, (_, index) => index + 1).map(
            (page) => (
              <FilterLink
                active={page === query.page}
                href={feedHref(query, { page })}
                key={page}
              >
                <span className="visually-hidden">{labels.page} </span>
                {page}
              </FilterLink>
            ),
          )}
        </nav>
      ) : null}

      <p className="updates-footnote">{notes.footnote}</p>
      <PublicLightbox selection={lightbox} onClose={() => setLightbox(null)} />
    </section>
  );
}
