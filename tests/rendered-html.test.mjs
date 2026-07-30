import assert from "node:assert/strict";
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
  assert.match(html, /한파란 — 서브컬쳐 AI 챗봇 기획자/);
  assert.match(html, /대화로/);
  assert.match(html, /id="work"/);
  assert.match(html, /id="support"/);
  assert.match(html, /id="now"/);
  assert.match(html, /https:\/\/intro\.bluehair\.blue/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});
