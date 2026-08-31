import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the portfolio reference page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko">/);
  assert.match(html, /한파란 — 세계를 설계합니다\./);
  assert.match(html, /WORLD DESIGN · BLUE/);
  assert.match(html, /class="language-select"/);
  assert.match(html, /<option value="ko"[^>]*>한국어<\/option>/);
  assert.match(html, /<option value="ja"[^>]*>日本語<\/option>/);
  assert.match(html, /<option value="en"[^>]*>English<\/option>/);
  assert.match(html, /class="hero-scene"/);
  assert.match(html, /class="hero-updates"/);
  assert.match(html, /최근 업데이트 슬라이드/);
  assert.match(html, /Hero에 공개된 글이 없습니다/);
  assert.match(html, /\/works\/prime-city\.webp/);
  assert.match(html, /id="work"/);
  assert.match(html, /id="support"/);
  assert.match(html, /id="now"/);
  assert.match(html, /https:\/\/intro\.bluehair\.blue/);
  assert.match(html, /href="https:\/\/www\.patreon\.com\/bluehairblue"/);
  assert.match(html, /작업실 연료 보급/);
  assert.match(html, /제작자 더 일하게 만들기/);
  assert.match(html, /aria-label="Patreon 후원 결제 페이지를 새 탭에서 열기"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /월 5,000원 수준의 순수 후원입니다/);
  assert.match(html, /혜택·일정·Discord 역할·독점 콘텐츠는 약속하지 않으며/);
  assert.doesNotMatch(html, /후원 링크 준비 중|멤버십 구성 중/);
  assert.match(html, /제작 근황 필터와 정렬/);
  assert.match(html, /커뮤니티 안내 보기/);
  assert.match(html, /조건에 맞는 공개 글이 없습니다/);
  assert.match(html, /class="site-footer"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/about\.bluehair\.blue"/);
  assert.match(html, /<meta property="og:image" content="https:\/\/about\.bluehair\.blue\/og\.png"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("includes culturally adapted Japanese and English copy", async () => {
  const content = await readFile(
    new URL("../app/content.ts", import.meta.url),
    "utf8",
  );
  const locale = await readFile(
    new URL("../app/use-portfolio-locale.ts", import.meta.url),
    "utf8",
  );

  assert.match(content, /世界を、/);
  assert.match(content, /その応援は、次のキャラクターと次の世界をつくる時間になります/);
  assert.match(content, /制作室への燃料補給/);
  assert.match(content, /Patreonの支援決済ページを新しいタブで開く/);
  assert.match(content, /I design/);
  assert.match(content, /Your support becomes time to create the next character/);
  assert.match(content, /Fuel the studio/);
  assert.match(content, /Open the Patreon support checkout in a new tab/);
  assert.match(locale, /document\.documentElement\.lang = locale/);
  assert.match(locale, /localStorage\.setItem\(LOCALE_KEY, nextLocale\)/);
});

test("keeps the route as a thin section composition", async () => {
  const [page, home] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/home.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /loadPublicProjection/);
  assert.match(page, /getRuntimeEnv/);
  assert.match(page, /redirect\(projection\.canonicalHref\)/);
  assert.match(page, /<Home projection=\{projection\}/);
  assert.doesNotMatch(page, /"use client"|usePortfolioLocale\(\)/);
  assert.doesNotMatch(page, /<header\b|<section\b|<footer\b/);

  for (const component of [
    "SiteHeader",
    "HeroSection",
    "ProjectIndexSection",
    "SupportSection",
    "UpdatesSection",
    "SiteFooter",
  ]) {
    assert.match(home, new RegExp(`<${component}\\b`));
  }

  assert.match(home, /usePortfolioLocale\(\)/);
  assert.doesNotMatch(home, /<header\b|<section\b|<footer\b/);
});

test("keeps Phase C galleries and lightbox on one native interaction contract", async () => {
  const [gallery, updates, community, publicPost, sections, responsive] = await Promise.all([
    readFile(
      new URL("../app/components/public-gallery.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/updates-section.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/community/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/updates/[slug]/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/styles/sections.css", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/responsive.css", import.meta.url), "utf8"),
  ]);

  assert.match(gallery, /hasUniformAspectRatio/);
  assert.match(gallery, /<= 1\.01/);
  assert.match(gallery, /<dialog/);
  assert.match(gallery, /\.showModal\(\)/);
  assert.match(gallery, /onCancel=/);
  assert.match(gallery, /ArrowLeft/);
  assert.match(gallery, /ArrowRight/);
  assert.match(gallery, /onTouchStart=/);
  assert.match(gallery, /onTouchEnd=/);
  assert.match(gallery, /requestAnimationFrame\(\(\) => opener\?\.focus\(\)\)/);
  assert.match(updates, /aria-expanded=\{expanded\}/);
  assert.equal((updates.match(/<PublicLightbox\b/g) ?? []).length, 1);
  assert.doesNotMatch(community, /next\/link/);
  assert.doesNotMatch(publicPost, /next\/link/);
  assert.match(community, /<a href=\{publicPostPath\(thread\.slug\)\}>/);
  assert.match(publicPost, /<a href="\/#now">다른 제작 근황 보기<\/a>/);
  assert.match(sections, /\.post-media-slider[\s\S]*object-fit: contain/);
  assert.match(sections, /\.post-media-grid[\s\S]*object-fit: cover/);
  assert.match(sections, /\.public-lightbox::backdrop/);
  assert.match(responsive, /@media \(max-width: 52rem\)/);
  assert.match(
    responsive,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/,
  );
});

test("keeps the Patreon CTA inside the support DOM contract", async () => {
  const [support, sections] = await Promise.all([
    readFile(
      new URL("../app/components/support-section.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/styles/sections.css", import.meta.url), "utf8"),
  ]);

  assert.match(
    support,
    /className="support-panel"[\s\S]*copy\.options\.map[\s\S]*<div className="support-row"/,
  );
  assert.match(
    support,
    /<div className="support-row"[\s\S]*?<div>[\s\S]*?<\/div>\s*<p>/,
  );
  assert.match(support, /target="_blank"/);
  assert.match(support, /rel="noopener noreferrer"/);
  assert.match(sections, /\.support-row a:focus-visible/);
  assert.match(sections, /text-decoration-line: underline/);
});

test("does not copy local secrets into deployable server output", async () => {
  const [viteConfig, gitignore] = await Promise.all([
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
  ]);

  await assert.rejects(
    readFile(new URL("../dist/server/.dev.vars", import.meta.url)),
    { code: "ENOENT" },
  );
  assert.match(viteConfig, /CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV/);
  assert.match(viteConfig, /name\.startsWith\("\.dev\.vars\."\)/);
  assert.match(gitignore, /^\.dev\.vars\*$/m);
});

test("keeps scroll motion progressive and optional", async () => {
  const entry = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const [foundation, sections, motion, responsive] = await Promise.all(
    ["foundation.css", "sections.css", "motion.css", "responsive.css"].map(
      (file) => readFile(new URL("../app/styles/" + file, import.meta.url), "utf8"),
    ),
  );
  const css = [motion, responsive].join("\n");

  assert.match(entry, /styles\/foundation\.css/);
  assert.match(entry, /styles\/motion\.css/);
  assert.match(css, /@supports \(animation-timeline: view\(\)\)/);
  assert.match(css, /@keyframes hero-wipe/);
  assert.match(css, /\.hero-scene \{[\s\S]*height: 190svh/);
  assert.match(css, /\.featured-work \{[\s\S]*position: sticky/);
  assert.match(foundation, /--header-height: 4\.5rem/);
  assert.match(foundation, /\.site-header nav/);
  assert.match(sections, /\.site-footer \{/);
  assert.doesNotMatch(foundation, /^nav\b/m);
  assert.doesNotMatch(sections, /^footer\b/m);
  assert.match(
    css,
    /@media \(max-width: 52rem\)[\s\S]*\.hero-updates::before \{[\s\S]*content: none[\s\S]*\.update-slide-image \{[\s\S]*mask-image: none/,
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/,
  );
});
