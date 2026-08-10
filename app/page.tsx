"use client";

import { useEffect, useState } from "react";
import {
  localeOptions,
  siteContent,
  type Locale,
} from "./content";
import { UpdateShowcase } from "./update-showcase";

const LOCALE_KEY = "hanparan-locale";

function isLocale(value: string | null): value is Locale {
  return value === "ko" || value === "ja" || value === "en";
}

function detectLocale(): Locale {
  try {
    const savedLocale = window.localStorage.getItem(LOCALE_KEY);
    if (isLocale(savedLocale)) return savedLocale;
  } catch {
    // Storage can be unavailable in privacy-restricted browsers.
  }

  const browserLocale = window.navigator.language.toLowerCase();
  if (browserLocale.startsWith("ja")) return "ja";
  if (browserLocale.startsWith("en")) return "en";
  return "ko";
}

function syncDocument(locale: Locale) {
  const { meta } = siteContent[locale];
  document.documentElement.lang = locale;
  document.title = meta.title;
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", meta.description);
}

export default function Home() {
  const [locale, setLocale] = useState<Locale>("ko");
  const copy = siteContent[locale];

  useEffect(() => {
    const initialLocale = detectLocale();
    setLocale(initialLocale);
    syncDocument(initialLocale);
  }, []);

  const changeLocale = (nextLocale: Locale) => {
    setLocale(nextLocale);
    syncDocument(nextLocale);

    try {
      window.localStorage.setItem(LOCALE_KEY, nextLocale);
    } catch {
      // The language still changes for this visit when storage is unavailable.
    }
  };

  return (
    <>
      <a className="skip-link" href="#main">
        {copy.skipLink}
      </a>

      <div className="ambient-mist" aria-hidden="true" />

      <header className="site-header">
        <div className="header-inner">
          <a className="wordmark" href="#top" aria-label={copy.homeLabel}>
            HANPARAN<span aria-hidden="true">.</span>
          </a>

          <nav aria-label={copy.navLabel}>
            <a href="#work">{copy.nav.work}</a>
            <a href="#support">{copy.nav.support}</a>
            <a href="#now">{copy.nav.now}</a>
          </nav>

          <div className="header-actions">
            <p className="header-note">WORLD DESIGN · BLUE</p>
            <select
              className="language-select"
              aria-label={copy.languageLabel}
              value={locale}
              onChange={(event) => changeLocale(event.target.value as Locale)}
            >
              {localeOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="hero-scene" id="top" aria-labelledby="hero-title">
          <div className="hero">
            <div className="hero-copy">
              <p className="eyebrow">WORLD · NARRATIVE · SYSTEM</p>
              <h1 id="hero-title">
                {copy.hero.title.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </h1>
              <div className="hero-intro">
                <p>{copy.hero.intro}</p>
                <a className="text-link" href="#work">
                  {copy.hero.workLink} <span aria-hidden="true">↓</span>
                </a>
              </div>
            </div>

            <UpdateShowcase items={copy.updates} labels={copy.showcase} />
          </div>
        </section>

        <section className="section work-section" id="work" aria-labelledby="work-title">
          <div className="section-heading">
            <p>01</p>
            <h2 id="work-title">{copy.work.sectionTitle}</h2>
            <span>{copy.work.sectionSubtitle}</span>
          </div>

          <article className="featured-work">
            <a
              className="work-visual"
              href={copy.work.url}
              target="_blank"
              rel="noreferrer"
              aria-label={copy.work.openLabel}
            >
              <img
                src={copy.work.image}
                alt={copy.work.imageAlt}
                width="800"
                height="1200"
              />
              <span className="visual-index">001</span>
              <span className="visual-cta" aria-hidden="true">
                {copy.work.visualCta}
              </span>
            </a>

            <div className="work-copy">
              <p className="work-label">{copy.work.label}</p>
              <h3>
                {copy.work.title}
                <span>{copy.work.subtitle}</span>
              </h3>
              <p className="work-description">{copy.work.description}</p>
              <ul className="work-details" aria-label={copy.work.detailsLabel}>
                {copy.work.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
              <a
                className="project-link"
                href={copy.work.url}
                target="_blank"
                rel="noreferrer"
              >
                {copy.work.projectLink} <span aria-hidden="true">↗</span>
              </a>
            </div>
          </article>
        </section>

        <section className="support-section" id="support" aria-labelledby="support-title">
          <div className="support-inner">
            <div className="support-copy">
              <p className="section-number">02 / SUPPORT</p>
              <h2 id="support-title">
                {copy.support.title.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </h2>
              <p>{copy.support.description}</p>
            </div>

            <div className="support-panel" aria-label={copy.support.panelLabel}>
              {copy.support.options.map((option, index) => (
                <div className="support-row" key={option.title}>
                  <div>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <h3>{option.title}</h3>
                  </div>
                  <p>{option.status}</p>
                </div>
              ))}
              <p className="support-note">{copy.support.note}</p>
            </div>
          </div>
        </section>

        <section className="section updates-section" id="now" aria-labelledby="now-title">
          <div className="section-heading">
            <p>03</p>
            <h2 id="now-title">{copy.notes.sectionTitle}</h2>
            <span>{copy.notes.sectionSubtitle}</span>
          </div>

          <div className="updates-list">
            {copy.updates.map((update, index) => (
              <article className="update" key={update.date}>
                <div className="update-meta">
                  <time dateTime={update.date.replaceAll(".", "-")}>{update.date}</time>
                  <span>{update.state}</span>
                </div>
                <div className="update-copy">
                  <p aria-hidden="true">0{index + 1}</p>
                  <h3>{update.title}</h3>
                  <p>{update.description}</p>
                </div>
              </article>
            ))}
          </div>

          <p className="updates-footnote">{copy.notes.footnote}</p>
        </section>
      </main>

      <footer>
        <div className="footer-mark">
          <span>{copy.footer.name}</span>
          <span>HANPARAN</span>
        </div>
        <p>WORLD · NARRATIVE · SYSTEM</p>
        <a href="#top">{copy.footer.top} ↑</a>
      </footer>
    </>
  );
}
