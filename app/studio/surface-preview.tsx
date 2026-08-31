"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { assetStatuses, type AssetStatus } from "../../db/schema";
import { MarkdownBody } from "../components/markdown-body";
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
            <MarkdownBody body={visibleBody} className={styles.markdownPreview} />
          </div>
        </article>

        <article className={styles.discordPreview}>
          <header>
            <strong>Discord Forum starter</strong>
            <span>mention 차단 · 근사 표시</span>
          </header>
          <h3>{visibleTitle}</h3>
          <MarkdownBody body={visibleBody} className={styles.markdownPreview} />
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
