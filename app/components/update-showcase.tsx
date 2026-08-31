"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { PublicPostSummary } from "../../lib/public-projection";
import type { SiteCopy } from "../content";

const SLIDE_INTERVAL_MS = 2600;

export function UpdateShowcase({
  items,
  labels,
  feed,
}: {
  items: PublicPostSummary[];
  labels: SiteCopy["showcase"];
  feed: SiteCopy["feed"];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const itemCount = items.length;
  const paused = hovered || focusWithin || reducedMotion;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReducedMotion(preference.matches);

    syncPreference();
    preference.addEventListener("change", syncPreference);
    return () => preference.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    if (paused || itemCount < 2) return;

    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % itemCount);
    }, SLIDE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [activeIndex, itemCount, paused]);

  if (itemCount === 0) {
    return (
      <aside className="hero-updates" aria-label={labels.label} data-empty="true">
        <div className="update-stage-top" aria-hidden="true">
          <span>{labels.latest}</span>
          <span>00 / 00</span>
        </div>
        <div className="update-slides">
          <p className="update-stage-empty">{labels.empty}</p>
        </div>
        <div className="update-stage-bottom">
          <div className="update-stage-pagination" />
          <a href="#now">
            {labels.allUpdates} <span aria-hidden="true">↓</span>
          </a>
        </div>
      </aside>
    );
  }

  const currentIndex = activeIndex % itemCount;
  const countLabel = String(itemCount).padStart(2, "0");
  const style = {
    "--slide-duration": `${SLIDE_INTERVAL_MS}ms`,
  } as CSSProperties;

  return (
    <aside
      className="hero-updates"
      aria-label={labels.label}
      data-paused={paused}
      style={style}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusWithin(false);
        }
      }}
    >
      <div className="update-stage-top" aria-hidden="true">
        <span>{labels.latest}</span>
        <span>
          {String(currentIndex + 1).padStart(2, "0")} / {countLabel}
        </span>
      </div>

      <div className="update-slides" aria-live="off">
        {items.map((item, index) => {
          const active = index === currentIndex;
          const image = item.images[0];

          return (
            <article
              className="update-slide"
              data-active={active}
              aria-hidden={!active}
              key={item.postId}
            >
              {image ? (
                <img
                  className="update-slide-image"
                  src={image.src}
                  alt={image.alt}
                  width={image.width}
                  height={image.height}
                />
              ) : (
                <div className="update-slide-image update-slide-image-empty" aria-hidden="true" />
              )}
              <div className="update-slide-copy">
                <p className="update-slide-meta">
                  <span>{item.kind === "work" ? feed.work : feed.update}</span>
                  <time dateTime={item.publishedAt}>
                    {item.publishedAt.slice(0, 10).replaceAll("-", ".")}
                  </time>
                </p>
                <h2 lang="ko">
                  <a
                    href={`/updates/${encodeURIComponent(item.slug)}`}
                    tabIndex={active ? 0 : -1}
                  >
                    {item.title}
                  </a>
                </h2>
                <p className="update-slide-description" lang="ko">
                  {item.description}
                </p>
                <a
                  className="update-slide-link"
                  href={`/updates/${encodeURIComponent(item.slug)}`}
                  tabIndex={active ? 0 : -1}
                >
                  {labels.openPost}
                </a>
              </div>
            </article>
          );
        })}
      </div>

      <div className="update-stage-bottom">
        <div
          className="update-stage-pagination"
          role="group"
          aria-label={labels.selectionLabel}
        >
          {items.map((item, index) => {
            const active = index === currentIndex;

            return (
              <button
                type="button"
                aria-label={labels.itemLabel
                  .replace("{index}", String(index + 1))
                  .replace("{title}", item.title)}
                aria-pressed={active}
                data-active={active}
                key={item.postId}
                onClick={() => setActiveIndex(index)}
              >
                {String(index + 1).padStart(2, "0")}
              </button>
            );
          })}
        </div>

        <a href="#now">
          {labels.allUpdates} <span aria-hidden="true">↓</span>
        </a>
      </div>
    </aside>
  );
}
