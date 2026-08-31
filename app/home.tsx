"use client";

import type { PublicProjection } from "../lib/public-projection";
import { HeroSection } from "./components/hero-section";
import { ProjectIndexSection } from "./components/project-index-section";
import { SiteFooter } from "./components/site-footer";
import { SiteHeader } from "./components/site-header";
import { SupportSection } from "./components/support-section";
import { UpdatesSection } from "./components/updates-section";
import { siteContent } from "./content";
import { usePortfolioLocale } from "./use-portfolio-locale";

export function Home({ projection }: { projection: PublicProjection }) {
  const { locale, changeLocale } = usePortfolioLocale();
  const copy = siteContent[locale];

  return (
    <>
      <a className="skip-link" href="#main">
        {copy.skipLink}
      </a>

      <div className="ambient-mist" aria-hidden="true" />

      <SiteHeader copy={copy} locale={locale} onLocaleChange={changeLocale} />

      <main id="main">
        <HeroSection
          copy={copy.hero}
          posts={projection.hero}
          showcase={copy.showcase}
          feed={copy.feed}
        />
        <ProjectIndexSection copy={copy.work} />
        <SupportSection copy={copy.support} />
        <UpdatesSection
          notes={copy.notes}
          labels={copy.feed}
          projection={projection}
        />
      </main>

      <SiteFooter copy={copy.footer} />
    </>
  );
}
