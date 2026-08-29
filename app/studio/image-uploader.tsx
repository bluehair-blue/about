"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";

import { assetStatuses, type AssetStatus } from "../../db/schema";
import styles from "./studio.module.css";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

type Asset = {
  assetId: string;
  status: AssetStatus;
  width: number;
  height: number;
  sourceMime: "image/jpeg" | "image/png" | "image/webp";
  sourceBytes: number;
  ordinal: number;
  alt: string;
  createdAt: string;
};

type PendingFile = {
  id: string;
  file: File;
  alt: string;
  error: string;
};

function isAsset(value: unknown): value is Asset {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const asset = value as Record<string, unknown>;
  return (
    typeof asset.assetId === "string" &&
    typeof asset.status === "string" &&
    assetStatuses.includes(asset.status as AssetStatus) &&
    typeof asset.width === "number" &&
    typeof asset.height === "number" &&
    (asset.sourceMime === "image/jpeg" ||
      asset.sourceMime === "image/png" ||
      asset.sourceMime === "image/webp") &&
    typeof asset.sourceBytes === "number" &&
    typeof asset.ordinal === "number" &&
    typeof asset.alt === "string" &&
    typeof asset.createdAt === "string"
  );
}

async function requestAssets(postId: string) {
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
    !(result as { assets: unknown[] }).assets.every(isAsset)
  ) {
    throw new Error("Asset load failed");
  }
  return (result as { assets: Asset[] }).assets;
}

function altIsValid(value: string) {
  const alt = value.trim();
  return (
    alt.replace(/\s/gu, "") !== "" &&
    Array.from(alt).length <= 1_000
  );
}

function byteLabel(value: number) {
  return value < 1024 * 1024
    ? `${Math.ceil(value / 1024)} KB`
    : `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function statusLabel(status: AssetStatus) {
  switch (status) {
    case "uploading":
      return "업로드 접수됨";
    case "processing":
      return "원본 저장됨 · 파생본 대기";
    case "ready":
      return "준비 완료";
    case "failed":
      return "처리 실패";
    case "deleting":
      return "삭제 중";
    case "orphan":
      return "연결 끊김";
  }
}

export function ImageUploader({
  postId,
  disabled,
}: {
  postId: string | null;
  disabled: boolean;
}) {
  const [loaded, setLoaded] = useState<{ postId: string; assets: Asset[] } | null>(
    null,
  );
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [busyId, setBusyId] = useState("");
  const [status, setStatus] = useState("");
  const assets = loaded?.postId === postId ? loaded.assets : [];

  const loadAssets = useCallback(async (targetPostId: string) => {
    const next = await requestAssets(targetPostId);
    setLoaded({ postId: targetPostId, assets: next });
    return next;
  }, []);

  useEffect(() => {
    if (!postId) return;
    let active = true;
    void requestAssets(postId)
      .then((next) => {
        if (active) setLoaded({ postId, assets: next });
      })
      .catch(() => {
        if (active) setStatus("이미지 목록을 불러오지 못했습니다.");
      });
    return () => {
      active = false;
    };
  }, [postId]);

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = [...(event.target.files ?? [])];
    event.target.value = "";
    const capacity = Math.max(0, 10 - assets.length - pendingFiles.length);
    const accepted = selected.slice(0, capacity).map((file) => ({
      id: crypto.randomUUID(),
      file,
      alt: "",
      error: file.size > MAX_SOURCE_BYTES ? "20MB 이하 파일만 가능합니다." : "",
    }));
    setPendingFiles((current) => [...current, ...accepted]);
    if (selected.length > capacity) {
      setStatus("이미지는 draft당 최대 10장입니다.");
    }
  }

  function updatePending(id: string, change: Partial<PendingFile>) {
    setPendingFiles((current) =>
      current.map((item) => item.id === id ? { ...item, ...change } : item),
    );
  }

  async function upload(item: PendingFile) {
    if (!postId || disabled || busyId) return;
    if (item.file.size < 1 || item.file.size > MAX_SOURCE_BYTES) {
      updatePending(item.id, { error: "1 byte 이상 20MB 이하 파일만 가능합니다." });
      return;
    }
    if (!altIsValid(item.alt)) {
      updatePending(item.id, { error: "공백이 아닌 alt를 1–1,000자로 입력해 주세요." });
      return;
    }

    setBusyId(item.id);
    updatePending(item.id, { error: "" });
    const form = new FormData();
    form.set("postId", postId);
    form.set("ordinal", String(assets.length));
    form.set("alt", item.alt);
    form.set("file", item.file);

    try {
      const response = await fetch("/studio/api/assets", {
        method: "POST",
        headers: { "x-studio-request": "1" },
        body: form,
      });
      const result = (await response.json()) as {
        assetId?: unknown;
        error?: unknown;
      };
      if (!response.ok) {
        if (typeof result.assetId === "string") {
          setPendingFiles((current) =>
            current.filter((candidate) => candidate.id !== item.id),
          );
          setStatus("원본 저장 실패 상태를 D1 manifest에 보존했습니다.");
          try {
            await loadAssets(postId);
          } catch {
            setStatus("실패 manifest를 보존했습니다 · 페이지를 새로고침해 주세요.");
          }
        } else {
          updatePending(item.id, { error: "원본 업로드에 실패했습니다." });
        }
        return;
      }

      setPendingFiles((current) =>
        current.filter((candidate) => candidate.id !== item.id),
      );
      setStatus("private R2 원본과 D1 manifest를 저장했습니다.");
      try {
        await loadAssets(postId);
      } catch {
        setStatus("원본은 저장됐습니다 · 목록은 페이지를 새로고침해 주세요.");
      }
    } catch {
      updatePending(item.id, { error: "원본 업로드에 실패했습니다." });
    } finally {
      setBusyId("");
    }
  }

  async function remove(asset: Asset) {
    if (!postId || disabled || busyId) return;
    setBusyId(asset.assetId);
    try {
      const response = await fetch(
        `/studio/api/assets/${encodeURIComponent(asset.assetId)}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            "x-studio-request": "1",
          },
          body: "{}",
        },
      );
      if (!response.ok) throw new Error("Asset delete failed");
      setStatus("D1 exact key로 private 원본을 삭제했습니다.");
      try {
        await loadAssets(postId);
      } catch {
        setStatus("원본은 삭제됐습니다 · 목록은 페이지를 새로고침해 주세요.");
      }
    } catch {
      setStatus("이미지를 삭제하지 못했습니다.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className={styles.card} aria-labelledby="media-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.step}>02</p>
          <h2 id="media-heading">이미지 원본</h2>
        </div>
        <p>JPEG · PNG · static WebP · 최대 10장</p>
      </div>

      <label className={styles.upload}>
        <span>fixture 이미지 선택</span>
        <input
          type="file"
          name="images"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={!postId || disabled || assets.length + pendingFiles.length >= 10}
          onChange={selectFiles}
        />
      </label>
      <p className={styles.note}>
        {!postId
          ? "제목과 본문을 먼저 저장하면 이미지 업로드가 활성화됩니다."
          : disabled
          ? "현재 draft 저장이 끝나면 이미지를 추가할 수 있습니다."
          : "파일당 20MB 이하 · 원본은 private R2에만 저장됩니다."}
      </p>

      {pendingFiles.length > 0 ? (
        <ul className={styles.assetList} aria-label="업로드 대기 이미지">
          {pendingFiles.map((item) => (
            <li key={item.id} className={styles.assetItem}>
              <div>
                <strong>{item.file.name}</strong>
                <small>{byteLabel(item.file.size)}</small>
              </div>
              <label className={styles.assetAlt}>
                <span>alt</span>
                <input
                  value={item.alt}
                  maxLength={1_000}
                  disabled={busyId === item.id}
                  aria-invalid={item.error !== ""}
                  onChange={(event) =>
                    updatePending(item.id, { alt: event.target.value, error: "" })
                  }
                />
              </label>
              <div className={styles.assetButtons}>
                <button
                  type="button"
                  disabled={disabled || busyId !== ""}
                  onClick={() => void upload(item)}
                >
                  {busyId === item.id ? "업로드 중…" : "원본 업로드"}
                </button>
                <button
                  type="button"
                  disabled={busyId !== ""}
                  onClick={() =>
                    setPendingFiles((current) =>
                      current.filter((candidate) => candidate.id !== item.id),
                    )
                  }
                >
                  취소
                </button>
              </div>
              {item.error ? <p role="alert">{item.error}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {assets.length > 0 ? (
        <ol className={styles.assetList} aria-label="저장된 이미지">
          {assets.map((asset) => (
            <li key={asset.assetId} className={styles.assetItem}>
              <div>
                <strong>{asset.ordinal + 1}. {asset.alt}</strong>
                <small>
                  {asset.width}×{asset.height} · {byteLabel(asset.sourceBytes)}
                </small>
              </div>
              <p className={styles.assetState}>{statusLabel(asset.status)}</p>
              <button
                type="button"
                disabled={disabled || busyId !== ""}
                onClick={() => void remove(asset)}
              >
                {busyId === asset.assetId ? "삭제 중…" : "원본 삭제"}
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      {status ? <p className={styles.assetMessage} role="status">{status}</p> : null}
    </section>
  );
}
