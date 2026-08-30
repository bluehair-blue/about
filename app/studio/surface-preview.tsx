"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { assetStatuses, type AssetStatus } from "../../db/schema";
import styles from "./studio.module.css";

type PreviewAsset = {
  assetId: string;
  status: AssetStatus;
  ordinal: number;
  alt: string;
};

function isPreviewAsset(value: unknown): value is PreviewAsset {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const asset = value as Record<string, unknown>;
  return (
    typeof asset.assetId === "string" &&
    typeof asset.status === "string" &&
    assetStatuses.includes(asset.status as AssetStatus) &&
    typeof asset.ordinal === "number" &&
    typeof asset.alt === "string"
  );
}

function inlineNodes(value: string, keyPrefix: string, depth = 0): ReactNode[] {
  if (depth > 4 || value === "") return [value];
  const token = /(\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|`([^`\n]+)`|\[([^\]\n]+)\]\((https:\/\/[^)\s]+)(?:\s+"[^"\n]*")?\)|\*([^*\n]+)\*|_([^_\n]+)_)/u;
  const match = token.exec(value);
  if (!match) return [value];

  const before = value.slice(0, match.index);
  const after = value.slice(match.index + match[0].length);
  let formatted: ReactNode;
  if (match[2] || match[3]) {
    formatted = <strong>{inlineNodes(match[2] ?? match[3], `${keyPrefix}-strong`, depth + 1)}</strong>;
  } else if (match[4]) {
    formatted = <del>{inlineNodes(match[4], `${keyPrefix}-del`, depth + 1)}</del>;
  } else if (match[5]) {
    formatted = <code>{match[5]}</code>;
  } else if (match[6] && match[7]) {
    formatted = <a href={match[7]} target="_blank" rel="noreferrer">{match[6]}</a>;
  } else {
    formatted = <em>{inlineNodes(match[8] ?? match[9], `${keyPrefix}-em`, depth + 1)}</em>;
  }

  return [
    before,
    <Fragment key={`${keyPrefix}-${match.index}`}>{formatted}</Fragment>,
    ...inlineNodes(after, `${keyPrefix}-after-${match.index}`, depth),
  ];
}

function MarkdownPreview({ body }: { body: string }) {
  const lines = body.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: ReactNode[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<pre key={`code-${index}`}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    if (/^>\s?/u.test(line)) {
      const quoted: string[] = [];
      const start = index;
      while (index < lines.length && /^>\s?/u.test(lines[index])) {
        quoted.push(lines[index].replace(/^>\s?/u, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${start}`}>
          {quoted.map((item, itemIndex) => (
            <Fragment key={`${start}-${itemIndex}`}>
              {itemIndex > 0 ? <br /> : null}
              {inlineNodes(item, `quote-${start}-${itemIndex}`)}
            </Fragment>
          ))}
        </blockquote>,
      );
      continue;
    }
    if (/^(?:[-+*]|\d+\.)\s+/u.test(line)) {
      const ordered = /^\d+\.\s+/u.test(line);
      const items: string[] = [];
      const start = index;
      const pattern = ordered ? /^\d+\.\s+/u : /^[-+*]\s+/u;
      while (index < lines.length && pattern.test(lines[index])) {
        items.push(lines[index].replace(pattern, ""));
        index += 1;
      }
      const children = items.map((item, itemIndex) => (
        <li key={`${start}-${itemIndex}`}>
          {inlineNodes(item, `list-${start}-${itemIndex}`)}
        </li>
      ));
      blocks.push(
        ordered
          ? <ol key={`list-${start}`}>{children}</ol>
          : <ul key={`list-${start}`}>{children}</ul>,
      );
      continue;
    }

    const paragraph: string[] = [];
    const start = index;
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !lines[index].startsWith("```") &&
      !/^>\s?/u.test(lines[index]) &&
      !/^(?:[-+*]|\d+\.)\s+/u.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${start}`}>
        {paragraph.map((item, itemIndex) => (
          <Fragment key={`${start}-${itemIndex}`}>
            {itemIndex > 0 ? <br /> : null}
            {inlineNodes(item, `paragraph-${start}-${itemIndex}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className={styles.markdownPreview}>{blocks}</div>;
}

async function requestPreviewAssets(postId: string) {
  const response = await fetch(
    `/studio/api/assets?postId=${encodeURIComponent(postId)}`,
    { headers: { accept: "application/json" }, cache: "no-store" },
  );
  const result: unknown = await response.json();
  if (
    !response.ok ||
    typeof result !== "object" ||
    result === null ||
    !Array.isArray((result as { assets?: unknown }).assets) ||
    !(result as { assets: unknown[] }).assets.every(isPreviewAsset)
  ) {
    throw new Error("preview_assets_failed");
  }
  return (result as { assets: PreviewAsset[] }).assets;
}

export function SurfacePreview({
  postId,
  title,
  body,
  kindLabel,
  topicLabels,
}: {
  postId: string | null;
  title: string;
  body: string;
  kindLabel: string;
  topicLabels: string[];
}) {
  const [portfolioMode, setPortfolioMode] = useState<"card" | "detail">("card");
  const [loaded, setLoaded] = useState<{ postId: string; assets: PreviewAsset[] } | null>(null);
  const assets = postId && loaded?.postId === postId ? loaded.assets : [];

  const refresh = useCallback(async () => {
    if (!postId) return;
    try {
      setLoaded({ postId, assets: await requestPreviewAssets(postId) });
    } catch {
      setLoaded({ postId, assets: [] });
    }
  }, [postId]);

  useEffect(() => {
    if (!postId) return;
    let active = true;
    const handleChange = () => void refresh();
    window.addEventListener("studio-state-changed", handleChange);
    void requestPreviewAssets(postId).then(
      (assets) => {
        if (active) setLoaded({ postId, assets });
      },
      () => {
        if (active) setLoaded({ postId, assets: [] });
      },
    );
    return () => {
      active = false;
      window.removeEventListener("studio-state-changed", handleChange);
    };
  }, [postId, refresh]);

  const visibleBody = body.trim() || "본문을 입력하면 여기에 표시됩니다.";
  const visibleTitle = title.trim() || "제목 미리보기";

  return (
    <section className={styles.card} aria-labelledby="preview-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.step}>02</p>
          <h2 id="preview-heading">두 surface 미리보기</h2>
        </div>
        <p>canonical Markdown · 실제 공개 전 fresh 검증 필요</p>
      </div>

      <div className={styles.previewGrid}>
        <article className={styles.portfolioPreview}>
          <header>
            <strong>Portfolio</strong>
            <div className={styles.previewSwitch} aria-label="Portfolio 미리보기 종류">
              <button
                type="button"
                aria-pressed={portfolioMode === "card"}
                onClick={() => setPortfolioMode("card")}
              >
                카드
              </button>
              <button
                type="button"
                aria-pressed={portfolioMode === "detail"}
                onClick={() => setPortfolioMode("detail")}
              >
                상세
              </button>
            </div>
          </header>
          <div className={portfolioMode === "card" ? styles.previewCardBody : undefined}>
            <p className={styles.previewMeta}>
              {kindLabel}{topicLabels.length > 0 ? ` · ${topicLabels.join(" · ")}` : ""}
            </p>
            <h3>{visibleTitle}</h3>
            {assets.length > 0 ? (
              <div className={styles.previewMedia}>
                {assets.slice(0, portfolioMode === "card" ? 4 : 10).map((asset) => (
                  <img
                    key={asset.assetId}
                    src={`/studio/api/assets/${encodeURIComponent(asset.assetId)}/preview?surface=portfolio`}
                    alt={asset.alt}
                  />
                ))}
              </div>
            ) : null}
            <MarkdownPreview body={visibleBody} />
          </div>
        </article>

        <article className={styles.discordPreview}>
          <header>
            <strong>Discord Forum starter</strong>
            <span>mention 차단 · 근사 표시</span>
          </header>
          <h3>{visibleTitle}</h3>
          <MarkdownPreview body={visibleBody} />
          {assets.length > 0 ? (
            <div className={styles.previewMedia}>
              {assets.map((asset) => (
                <img
                  key={asset.assetId}
                  src={`/studio/api/assets/${encodeURIComponent(asset.assetId)}/preview?surface=discord`}
                  alt={asset.alt}
                />
              ))}
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}
