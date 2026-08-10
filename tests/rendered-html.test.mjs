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
  assert.match(html, /\/works\/prime-city\.webp/);
  assert.match(html, /id="work"/);
  assert.match(html, /id="support"/);
  assert.match(html, /id="now"/);
  assert.match(html, /https:\/\/intro\.bluehair\.blue/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("includes culturally adapted Japanese and English copy", async () => {
  const content = await readFile(
    new URL("../app/content.ts", import.meta.url),
    "utf8",
  );
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(content, /世界を、/);
  assert.match(content, /その応援は、次のキャラクターと次の世界をつくる時間になります/);
  assert.match(content, /I design/);
  assert.match(content, /Your support becomes time to create the next character/);
  assert.match(page, /document\.documentElement\.lang = locale/);
  assert.match(page, /localStorage\.setItem\(LOCALE_KEY, nextLocale\)/);
});

test("keeps scroll motion progressive and optional", async () => {
  const entry = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const css = (
    await Promise.all(
      ["motion.css", "responsive.css"].map((file) =>
        readFile(new URL("../app/styles/" + file, import.meta.url), "utf8"),
      ),
    )
  ).join("\n");

  assert.match(entry, /styles\/foundation\.css/);
  assert.match(entry, /styles\/motion\.css/);
  assert.match(css, /@supports \(animation-timeline: view\(\)\)/);
  assert.match(css, /@keyframes hero-wipe/);
  assert.match(css, /\.hero-scene \{[\s\S]*height: 190svh/);
  assert.match(css, /\.featured-work \{[\s\S]*position: sticky/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/,
  );
});
