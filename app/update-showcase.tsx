"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { UpdateItem } from "./content";

const SLIDE_INTERVAL_MS = 2600;

type ShowcaseLabels = {
  label: string;
  latest: string;
  selectionLabel: string;
  itemLabel: string;
  allUpdates: string;
};

export function UpdateShowcase({
  items,
  labels,
}: {
  items: UpdateItem[];
  labels: ShowcaseLabels;
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

  if (itemCount === 0) return null;

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

          return (
            <article
              className="update-slide"
              data-active={active}
              aria-hidden={!active}
              key={item.date}
            >
              <img
                className="update-slide-image"
                src={item.image}
                alt={item.imageAlt}
                width="900"
                height="1200"
              />
              <div className="update-slide-copy">
                <p className="update-slide-meta">
                  <span>{item.state}</span>
                  <time dateTime={item.date.replaceAll(".", "-")}>{item.date}</time>
                </p>
                <h2>{item.title}</h2>
                <p>{item.description}</p>
              </div>
            </article>
          );
        })}
      </div>

      <div className="update-stage-bottom">
        <div className="update-stage-pagination" aria-label={labels.selectionLabel}>
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
                key={item.date}
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
