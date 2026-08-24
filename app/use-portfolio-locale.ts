"use client";

import { useEffect, useState } from "react";
import { siteContent, type Locale } from "./content";

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

export function usePortfolioLocale() {
  const [locale, setLocale] = useState<Locale>("ko");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const initialLocale = detectLocale();
      setLocale(initialLocale);
      syncDocument(initialLocale);
    });

    return () => window.cancelAnimationFrame(frame);
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

  return { locale, changeLocale };
}
