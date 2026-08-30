"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

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
  publicBytes: number | null;
  discordBytes: number | null;
  ordinal: number;
  alt: string;
  processingError: string | null;
  createdAt: string;
  updatedAt: string;
};

type AssetListResult = {
  assets: Asset[];
  revision: number;
};

type PendingFile = {
  id: string;
  file: File;
  alt: string;
  error: string;
  failedAssetId?: string;
  receiptUnknown?: boolean;
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
    (asset.publicBytes === null || typeof asset.publicBytes === "number") &&
    (asset.discordBytes === null || typeof asset.discordBytes === "number") &&
    typeof asset.ordinal === "number" &&
    typeof asset.alt === "string" &&
    (asset.processingError === null || typeof asset.processingError === "string") &&
    typeof asset.createdAt === "string" &&
    typeof asset.updatedAt === "string"
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
    !(result as { assets: unknown[] }).assets.every(isAsset) ||
    typeof (result as { revision?: unknown }).revision !== "number" ||
    !Number.isSafeInteger((result as { revision: number }).revision) ||
    (result as { revision: number }).revision < 1
  ) {
    throw new Error("Asset load failed");
  }
  return result as AssetListResult;
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

function statusLabel(asset: Asset) {
  if (asset.processingError === "asset_storage_failed") {
    return "private 원본 저장 실패";
  }
  switch (asset.status) {
    case "uploading":
      return "private 원본 확인 중";
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

function checkedTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "확인 시각 없음"
    : `${date.toLocaleString("ko-KR")} 확인`;
}

function isRevisionResult(value: unknown): value is { revision: number; savedAt: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    typeof result.revision === "number" &&
    Number.isSafeInteger(result.revision) &&
    result.revision >= 1 &&
    typeof result.savedAt === "string"
  );
}

export function ImageUploader({
  postId,
  disabled,
  onPendingChange,
  getRevision,
  onRevisionChange,
  onRevisionConflict,
  onManifestPendingChange,
  onManifestSavingChange,
  onRegisterManifestFlush,
}: {
  postId: string | null;
  disabled: boolean;
  onPendingChange: (count: number, checked: boolean) => void;
  getRevision: () => number;
  onRevisionChange: (revision: number, savedAt: string) => void;
  onRevisionConflict: () => void;
  onManifestPendingChange: (pending: boolean) => void;
  onManifestSavingChange: (saving: boolean) => void;
  onRegisterManifestFlush: (flush: (() => Promise<boolean>) | null) => void;
}) {
  const [loaded, setLoaded] = useState<{ postId: string; assets: Asset[] } | null>(
    null,
  );
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [busyId, setBusyId] = useState("");
  const [status, setStatus] = useState("");
  const [manifestDirty, setManifestDirty] = useState(false);
  const [manifestPending, setManifestPending] = useState(false);
  const [draggingId, setDraggingId] = useState("");
  const manifestDirtyRef = useRef(false);
  const manifestChangeIdRef = useRef(0);
  const manifestSavePromiseRef = useRef<Promise<boolean> | null>(null);
  const loadedRef = useRef(loaded);
  const assets = loaded?.postId === postId ? loaded.assets : [];
  const unacceptedCount = pendingFiles.length + assets.filter((asset) =>
    asset.status === "uploading" ||
    asset.processingError === "asset_storage_failed"
  ).length;
  const receiptChecked = postId === null || loaded?.postId === postId;

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useEffect(() => {
    onPendingChange(unacceptedCount, receiptChecked);
  }, [onPendingChange, receiptChecked, unacceptedCount]);

  const loadAssets = useCallback(async (targetPostId: string) => {
    const next = await requestAssets(targetPostId);
    setLoaded({ postId: targetPostId, assets: next.assets });
    return next;
  }, []);

  useEffect(() => {
    if (!postId) return;
    let active = true;
    let timer = 0;
    const refresh = async () => {
      try {
        const next = await requestAssets(postId);
        if (!active) return;
        if (!manifestDirtyRef.current && !manifestSavePromiseRef.current) {
          setLoaded({ postId, assets: next.assets });
        }
        setStatus((current) =>
          current === "이미지 목록을 불러오지 못했습니다." ? "" : current
        );
        if (next.assets.some((asset) => asset.status === "processing" || asset.status === "uploading")) {
          timer = window.setTimeout(refresh, 2_000);
        }
      } catch {
        if (active) setStatus("이미지 목록을 불러오지 못했습니다.");
      }
    };
    const handleStateChanged = () => {
      window.clearTimeout(timer);
      void refresh();
    };
    window.addEventListener("studio-state-changed", handleStateChanged);
    void refresh();
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("studio-state-changed", handleStateChanged);
    };
  }, [postId]);

  function editManifest(change: (current: Asset[]) => Asset[]) {
    if (!postId || disabled || manifestPending || busyId) return;
    const current = loadedRef.current?.postId === postId
      ? loadedRef.current.assets
      : [];
    const next = change(current).map((asset, ordinal) => ({ ...asset, ordinal }));
    const nextLoaded = { postId, assets: next };
    loadedRef.current = nextLoaded;
    setLoaded(nextLoaded);
    manifestDirtyRef.current = true;
    manifestChangeIdRef.current += 1;
    setManifestDirty(true);
    onManifestPendingChange(true);
    setStatus("alt·순서 변경됨 · 1.5초 후 자동 저장");
  }

  const saveManifest = useCallback(function saveAssetManifest(): Promise<boolean> {
    if (manifestSavePromiseRef.current) return manifestSavePromiseRef.current;
    if (!manifestDirtyRef.current) return Promise.resolve(true);
    if (!postId) return Promise.resolve(false);

    const cycle = (async () => {
      setManifestPending(true);
      onManifestSavingChange(true);
      try {
        do {
          const current = loadedRef.current;
          if (!current || current.postId !== postId) return false;
          const savedChangeId = manifestChangeIdRef.current;
          setStatus("alt·순서 저장 중…");
          const response = await fetch("/studio/api/assets", {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              "x-studio-request": "1",
            },
            body: JSON.stringify({
              postId,
              revision: getRevision(),
              assets: current.assets.map(({ assetId, ordinal, alt }) => ({
                assetId,
                ordinal,
                alt,
              })),
            }),
          });
          const result: unknown = await response.json();
          if (response.status === 409) {
            setStatus("다른 창에서 이미지 순서나 alt가 수정됨 · 현재 화면을 유지합니다.");
            onRevisionConflict();
            return false;
          }
          if (!response.ok || !isRevisionResult(result)) {
            setStatus("alt·순서를 저장하지 못했습니다 · 다시 시도해 주세요");
            return false;
          }
          onRevisionChange(result.revision, result.savedAt);
          if (manifestChangeIdRef.current === savedChangeId) {
            manifestDirtyRef.current = false;
            setManifestDirty(false);
            setStatus(`${checkedTime(result.savedAt)} · alt·순서 저장됨`);
          }
        } while (manifestDirtyRef.current);
        return true;
      } catch {
        setStatus("alt·순서 저장 결과를 확인하지 못했습니다 · 자동 재시도하지 않습니다");
        return false;
      } finally {
        setManifestPending(false);
        onManifestSavingChange(false);
        if (!manifestDirtyRef.current) onManifestPendingChange(false);
      }
    })();
    manifestSavePromiseRef.current = cycle;
    void cycle.finally(() => {
      if (manifestSavePromiseRef.current === cycle) {
        manifestSavePromiseRef.current = null;
      }
    });
    return cycle;
  }, [getRevision, onManifestPendingChange, onManifestSavingChange, onRevisionChange, onRevisionConflict, postId]);

  useEffect(() => {
    onRegisterManifestFlush(saveManifest);
    return () => onRegisterManifestFlush(null);
  }, [onRegisterManifestFlush, saveManifest]);

  useEffect(() => {
    if (!manifestDirty || manifestPending || disabled) return;
    const timer = window.setTimeout(() => void saveManifest(), 1_500);
    return () => window.clearTimeout(timer);
  }, [disabled, manifestDirty, manifestPending, saveManifest]);

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
    if (!postId || disabled || busyId || manifestDirty || manifestPending) return;
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
    let submitted = false;
    let expectedRevision = getRevision();

    try {
      if (item.failedAssetId) {
        const removed = await fetch(
          `/studio/api/assets/${encodeURIComponent(item.failedAssetId)}`,
          {
            method: "DELETE",
            headers: {
              "content-type": "application/json",
              "x-studio-request": "1",
            },
            body: JSON.stringify({ expectedRevision }),
          },
        );
        const removedResult: unknown = await removed.json();
        if (removed.status === 409) {
          onRevisionConflict();
          throw new Error("revision_conflict");
        }
        if (!removed.ok || !isRevisionResult(removedResult)) {
          throw new Error("Failed receipt cleanup failed");
        }
        expectedRevision = removedResult.revision;
        onRevisionChange(removedResult.revision, removedResult.savedAt);
        updatePending(item.id, { failedAssetId: undefined });
      }
      const currentAssets = await loadAssets(postId);
      if (currentAssets.revision !== expectedRevision) {
        onRevisionConflict();
        throw new Error("revision_conflict");
      }
      const form = new FormData();
      form.set("postId", postId);
      form.set("revision", String(expectedRevision));
      form.set("ordinal", String(currentAssets.assets.length));
      form.set("alt", item.alt);
      form.set("file", item.file);
      submitted = true;
      const response = await fetch("/studio/api/assets", {
        method: "POST",
        headers: { "x-studio-request": "1" },
        body: form,
      });
      const result = (await response.json()) as {
        assetId?: unknown;
        error?: unknown;
        revision?: unknown;
        savedAt?: unknown;
      };
      const responseError = result.error;
      const responseAssetId = result.assetId;
      if (isRevisionResult(result)) {
        onRevisionChange(result.revision, result.savedAt);
      }
      if (!response.ok) {
        if (response.status === 409 && responseError === "revision_conflict") {
          onRevisionConflict();
          updatePending(item.id, { error: "다른 창에서 이미지 목록이 수정되었습니다." });
          return;
        }
        if (
          responseError === "asset_storage_failed" &&
          typeof responseAssetId === "string"
        ) {
          updatePending(item.id, {
            error: "private 원본 저장에 실패했습니다. 파일을 유지했으니 다시 시도해 주세요.",
            failedAssetId: responseAssetId,
          });
          setStatus("private upload 접수가 끝나지 않아 작업 이동을 막습니다.");
        } else if (typeof responseAssetId === "string") {
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
      setStatus("원본을 저장하고 파생본 작업을 Queue에 등록했습니다.");
      window.dispatchEvent(new Event("studio-state-changed"));
    } catch {
      updatePending(item.id, {
        error: submitted
          ? "원본 접수 결과가 불명확합니다. 자동 재시도하지 않고 파일을 유지합니다."
          : "원본 업로드를 시작하지 못했습니다.",
        receiptUnknown: submitted || undefined,
      });
    } finally {
      setBusyId("");
    }
  }

  async function cancelPending(item: PendingFile) {
    if (!item.failedAssetId || !postId) {
      setPendingFiles((current) =>
        current.filter((candidate) => candidate.id !== item.id),
      );
      return;
    }
    if (busyId || manifestDirty || manifestPending) return;
    setBusyId(item.id);
    try {
      const response = await fetch(
        `/studio/api/assets/${encodeURIComponent(item.failedAssetId)}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            "x-studio-request": "1",
          },
          body: JSON.stringify({ expectedRevision: getRevision() }),
        },
      );
      const result: unknown = await response.json();
      if (response.status === 409) {
        onRevisionConflict();
        throw new Error("revision_conflict");
      }
      if (!response.ok || !isRevisionResult(result)) {
        throw new Error("Failed receipt cleanup failed");
      }
      onRevisionChange(result.revision, result.savedAt);
      setPendingFiles((current) =>
        current.filter((candidate) => candidate.id !== item.id),
      );
      await loadAssets(postId);
    } catch {
      updatePending(item.id, {
        error: "실패 manifest를 정리하지 못해 파일 선택을 유지합니다.",
      });
    } finally {
      setBusyId("");
    }
  }

  async function retry(asset: Asset) {
    if (!postId || disabled || busyId || manifestDirty || manifestPending) return;
    setBusyId(asset.assetId);
    try {
      const response = await fetch(
        `/studio/api/assets/${encodeURIComponent(asset.assetId)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-studio-request": "1",
          },
          body: "{}",
        },
      );
      if (!response.ok) throw new Error("Asset retry failed");
      setStatus("같은 asset job을 Queue에 다시 등록했습니다.");
      window.dispatchEvent(new Event("studio-state-changed"));
    } catch {
      setStatus("파생본 처리를 다시 등록하지 못했습니다.");
    } finally {
      setBusyId("");
    }
  }

  async function remove(asset: Asset) {
    if (!postId || disabled || busyId || manifestDirty || manifestPending) return;
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
          body: JSON.stringify({ expectedRevision: getRevision() }),
        },
      );
      const result: unknown = await response.json();
      if (response.status === 409) {
        onRevisionConflict();
        throw new Error("revision_conflict");
      }
      if (!response.ok || !isRevisionResult(result)) {
        throw new Error("Asset delete failed");
      }
      onRevisionChange(result.revision, result.savedAt);
      setStatus("초안에서 이미지를 제거했습니다. 원본은 retention 계약에 따라 안전하게 보존됩니다.");
      window.dispatchEvent(new Event("studio-state-changed"));
    } catch {
      setStatus("이미지를 삭제하지 못했습니다.");
    } finally {
      setBusyId("");
    }
  }

  function moveAsset(index: number, offset: -1 | 1) {
    editManifest((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function dropAsset(event: DragEvent<HTMLLIElement>, targetId: string) {
    event.preventDefault();
    const sourceId = draggingId || event.dataTransfer.getData("text/plain");
    setDraggingId("");
    if (!sourceId || sourceId === targetId) return;
    editManifest((current) => {
      const sourceIndex = current.findIndex(({ assetId }) => assetId === sourceId);
      const targetIndex = current.findIndex(({ assetId }) => assetId === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  return (
    <section className={styles.card} aria-labelledby="media-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.step}>03</p>
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
          disabled={!postId || disabled || manifestDirty || manifestPending || assets.length + pendingFiles.length >= 10}
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
                  disabled={disabled || busyId !== "" || item.receiptUnknown}
                  onClick={() => void upload(item)}
                >
                  {busyId === item.id
                    ? "업로드 중…"
                    : item.receiptUnknown
                    ? "접수 확인 필요"
                    : "원본 업로드"}
                </button>
                <button
                  type="button"
                  disabled={busyId !== ""}
                  onClick={() => void cancelPending(item)}
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
            <li
              key={asset.assetId}
              className={styles.assetItem}
              draggable={!disabled && !manifestPending && busyId === ""}
              onDragStart={(event) => {
                setDraggingId(asset.assetId);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", asset.assetId);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropAsset(event, asset.assetId)}
              onDragEnd={() => setDraggingId("")}
            >
              <img
                className={styles.assetThumb}
                src={`/studio/api/assets/${encodeURIComponent(asset.assetId)}/preview?surface=portfolio`}
                alt=""
              />
              <div>
                <strong>{asset.ordinal + 1}. 이미지</strong>
                <small>
                  {asset.width}×{asset.height} · {byteLabel(asset.sourceBytes)}
                </small>
              </div>
              <label className={styles.assetAlt}>
                <span>alt</span>
                <input
                  value={asset.alt}
                  maxLength={1_000}
                  disabled={disabled || manifestPending || busyId !== ""}
                  aria-invalid={!altIsValid(asset.alt)}
                  onChange={(event) =>
                    editManifest((current) =>
                      current.map((candidate) =>
                        candidate.assetId === asset.assetId
                          ? { ...candidate, alt: event.target.value }
                          : candidate
                      )
                    )
                  }
                />
              </label>
              <div className={styles.assetState}>
                <strong>{statusLabel(asset)}</strong>
                <small>{checkedTime(asset.updatedAt)}</small>
                {asset.processingError ? <small>원인 · {asset.processingError}</small> : null}
                {asset.status === "ready" && asset.discordBytes && asset.publicBytes ? (
                  <small>
                    Portfolio {byteLabel(asset.publicBytes)} · Discord {byteLabel(asset.discordBytes)}
                  </small>
                ) : null}
              </div>
              <div className={styles.assetButtons}>
                <button
                  type="button"
                  disabled={disabled || manifestPending || busyId !== "" || asset.ordinal === 0}
                  onClick={() => moveAsset(asset.ordinal, -1)}
                >
                  위
                </button>
                <button
                  type="button"
                  disabled={disabled || manifestPending || busyId !== "" || asset.ordinal === assets.length - 1}
                  onClick={() => moveAsset(asset.ordinal, 1)}
                >
                  아래
                </button>
                {asset.status === "failed" &&
                asset.processingError !== "asset_storage_failed" &&
                asset.processingError !== "asset_manifest_unavailable" ? (
                  <button
                    type="button"
                    disabled={disabled || manifestDirty || manifestPending || busyId !== ""}
                    onClick={() => void retry(asset)}
                  >
                    처리 재시도
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={disabled || manifestDirty || manifestPending || busyId !== ""}
                  onClick={() => void remove(asset)}
                >
                  {busyId === asset.assetId ? "처리 중…" : "초안에서 제거"}
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {status ? <p className={styles.assetMessage} role="status" aria-live="polite">{status}</p> : null}
      {manifestDirty ? (
        <button
          className={styles.retryButton}
          type="button"
          disabled={manifestPending || assets.some((asset) => !altIsValid(asset.alt))}
          onClick={() => void saveManifest()}
        >
          alt·순서 다시 저장
        </button>
      ) : null}
    </section>
  );
}
