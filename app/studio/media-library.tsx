"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { assetStatuses, type AssetStatus } from "../../db/schema";
import styles from "./studio.module.css";

export type MediaFilter = {
  q: string;
  status: "all" | AssetStatus | string;
  from: string;
  to: string;
};

type MediaItem = {
  assetId: string;
  postId: string;
  postStatus: string;
  titleSnapshot: string;
  currentPostTitle: string;
  status: AssetStatus;
  width: number;
  height: number;
  sourceMime: string;
  sourceBytes: number;
  publicBytes: number | null;
  discordBytes: number | null;
  processingError: string | null;
  createdAt: string;
  updatedAt: string;
  orphanedAt: string | null;
  publishedOnce: boolean;
  referenceCount: number;
  cleanupEligible: boolean;
  cleanupJob: null | {
    status: string;
    error: string | null;
    updatedAt: string | null;
  };
};

type MediaResult = {
  filter: MediaFilter;
  total: number;
  truncated: boolean;
  retention: {
    orphanDays: number | null;
    cleanupAvailable: boolean;
    eligibleOrphanCount: number;
    nextCleanupAt: string | null;
  };
  items: MediaItem[];
};

function isCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isMediaItem(value: unknown): value is MediaItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.assetId === "string" &&
    typeof item.postId === "string" &&
    typeof item.postStatus === "string" &&
    typeof item.titleSnapshot === "string" &&
    typeof item.currentPostTitle === "string" &&
    typeof item.status === "string" &&
    assetStatuses.includes(item.status as AssetStatus) &&
    typeof item.width === "number" &&
    typeof item.height === "number" &&
    typeof item.sourceMime === "string" &&
    isCount(item.sourceBytes) &&
    (item.publicBytes === null || isCount(item.publicBytes)) &&
    (item.discordBytes === null || isCount(item.discordBytes)) &&
    (item.processingError === null || typeof item.processingError === "string") &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    (item.orphanedAt === null || typeof item.orphanedAt === "string") &&
    typeof item.publishedOnce === "boolean" &&
    isCount(item.referenceCount) &&
    typeof item.cleanupEligible === "boolean"
  );
}

function isMediaResult(value: unknown): value is MediaResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  const retention = result.retention as Record<string, unknown> | undefined;
  return (
    isCount(result.total) &&
    typeof result.truncated === "boolean" &&
    typeof retention === "object" &&
    retention !== null &&
    (retention.orphanDays === null || isCount(retention.orphanDays)) &&
    typeof retention.cleanupAvailable === "boolean" &&
    isCount(retention.eligibleOrphanCount) &&
    (retention.nextCleanupAt === null || typeof retention.nextCleanupAt === "string") &&
    Array.isArray(result.items) &&
    result.items.every(isMediaItem)
  );
}

function byteLabel(value: number | null) {
  if (value === null) return "없음";
  return value < 1024 * 1024
    ? `${Math.ceil(value / 1024)} KB`
    : `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function timeLabel(value: string | null) {
  if (!value) return "확인 시각 없음";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "확인 시각 없음"
    : date.toLocaleString("ko-KR");
}

function sourceLabel(item: MediaItem) {
  if (item.processingError === "asset_storage_failed") return "private source 없음";
  if (item.status === "deleting") return "private source 삭제 확인 중";
  if (item.publishedOnce && item.status === "orphan") return "private source archive 보존";
  return "private source 저장됨";
}

function derivativeLabel(item: MediaItem, surface: "Portfolio" | "Discord") {
  const bytes = surface === "Portfolio" ? item.publicBytes : item.discordBytes;
  if (item.status === "ready") return `${surface} 준비됨 · ${byteLabel(bytes)}`;
  if (item.status === "processing" || item.status === "uploading") return `${surface} 처리 중`;
  if (item.status === "orphan" && item.publishedOnce) return `${surface} 공개 참조 해제`;
  if (item.status === "deleting") return `${surface} 삭제 확인 중`;
  return `${surface} 사용 불가`;
}

async function requestMedia(filter: MediaFilter) {
  const params = new URLSearchParams({ view: "media" });
  for (const [key, value] of Object.entries(filter)) {
    if (value) params.set(key, value);
  }
  const response = await fetch(`/studio/api/assets?${params}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const result: unknown = await response.json();
  if (!response.ok || !isMediaResult(result)) throw new Error("media_load_failed");
  return result;
}

export function MediaLibrary({ filter }: { filter: MediaFilter }) {
  const [result, setResult] = useState<MediaResult | null>(null);
  const [message, setMessage] = useState("Media 불러오는 중…");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    const next = await requestMedia(filter);
    setResult(next);
    setMessage(next.items.length > 0 ? "" : "조건에 맞는 Media가 없습니다.");
  }, [filter]);

  useEffect(() => {
    let active = true;
    void requestMedia(filter).then(
      (next) => {
        if (!active) return;
        setResult(next);
        setMessage(next.items.length > 0 ? "" : "조건에 맞는 Media가 없습니다.");
      },
      () => {
        if (!active) return;
        setResult(null);
        setMessage("Media를 불러오지 못했습니다 · 다시 시도해 주세요");
      },
    );
    return () => {
      active = false;
    };
  }, [filter]);

  async function retry(item: MediaItem) {
    if (busyId) return;
    setBusyId(item.assetId);
    try {
      const response = await fetch(
        `/studio/api/assets/${encodeURIComponent(item.assetId)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-studio-request": "1",
          },
          body: "{}",
        },
      );
      if (!response.ok) throw new Error("asset_retry_failed");
      setMessage("같은 asset 처리 job을 다시 등록했습니다.");
      await load();
    } catch {
      setMessage("asset 처리 재시도에 실패했습니다.");
    } finally {
      setBusyId("");
    }
  }

  async function cleanup(item: MediaItem) {
    if (busyId) return;
    setBusyId(item.assetId);
    try {
      const response = await fetch("/studio/api/assets/cleanup", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-studio-request": "1",
        },
        body: JSON.stringify({ assetId: item.assetId }),
      });
      const body = (await response.json()) as { queued?: unknown };
      if (!response.ok) throw new Error("asset_cleanup_failed");
      setMessage(
        body.queued === 1
          ? "retention·참조를 재확인하는 exact-key 삭제 job을 등록했습니다."
          : "서버 재확인 결과 아직 안전 삭제 조건을 충족하지 않았습니다.",
      );
      await load();
    } catch {
      setMessage("orphan 안전 삭제 job을 등록하지 못했습니다.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className={styles.card} aria-labelledby="media-library-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.step}>MEDIA</p>
          <h2 id="media-library-heading">Media 관리</h2>
        </div>
        <Link className={styles.primaryLink} href="/studio?filter=working">작업 목록</Link>
      </div>

      <form className={styles.mediaFilters} action="/studio/media" method="get">
        <label>
          post 제목
          <input name="q" defaultValue={filter.q} maxLength={100} />
        </label>
        <label>
          상태
          <select name="status" defaultValue={filter.status}>
            <option value="all">전체</option>
            {assetStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label>
          upload 시작일
          <input type="date" name="from" defaultValue={filter.from} />
        </label>
        <label>
          upload 종료일
          <input type="date" name="to" defaultValue={filter.to} />
        </label>
        <button type="submit">검색</button>
      </form>

      {result ? (
        <p className={styles.retentionSummary}>
          검색 {result.total}건{result.truncated ? " · 최근 100건 표시" : ""} · 미게시 orphan 보존 {result.retention.orphanDays ?? "설정 오류"}일 · 지금 정리 가능 {result.retention.eligibleOrphanCount}건
          {result.retention.nextCleanupAt ? ` · 다음 후보 ${timeLabel(result.retention.nextCleanupAt)}` : ""}
          {!result.retention.cleanupAvailable ? " · cleanup 설정 미완료로 삭제 중지" : ""}
        </p>
      ) : null}

      {message ? (
        <p className={styles.listStatus} role="status" aria-live="polite">
          {message}
          {!result ? <button type="button" onClick={() => void load()}>다시 불러오기</button> : null}
        </p>
      ) : null}

      {result && result.items.length > 0 ? (
        <ul className={styles.mediaList}>
          {result.items.map((item) => (
            <li key={item.assetId} className={styles.mediaItem}>
              <img
                src={`/studio/api/assets/${encodeURIComponent(item.assetId)}/preview?surface=portfolio`}
                alt=""
              />
              <div className={styles.mediaCopy}>
                <div className={styles.postBadges}>
                  <span>{item.status}</span>
                  {item.cleanupEligible ? <strong>안전 삭제 가능</strong> : null}
                </div>
                <h3>{item.currentPostTitle}</h3>
                <p>최초 제목 · {item.titleSnapshot}</p>
                <p>{item.width}×{item.height} · {item.sourceMime} · {byteLabel(item.sourceBytes)}</p>
                <dl className={styles.mediaStates}>
                  <div><dt>Source</dt><dd>{sourceLabel(item)}</dd></div>
                  <div><dt>Portfolio</dt><dd>{derivativeLabel(item, "Portfolio")}</dd></div>
                  <div><dt>Discord</dt><dd>{derivativeLabel(item, "Discord")}</dd></div>
                </dl>
                <p>
                  upload {timeLabel(item.createdAt)} · 마지막 확인 {timeLabel(item.updatedAt)}
                  {item.processingError ? ` · 원인 ${item.processingError}` : ""}
                </p>
                {item.cleanupJob ? (
                  <p>
                    cleanup {item.cleanupJob.status} · {timeLabel(item.cleanupJob.updatedAt)}
                    {item.cleanupJob.error ? ` · 원인 ${item.cleanupJob.error}` : ""}
                  </p>
                ) : null}
              </div>
              <div className={styles.mediaActions}>
                <Link href={`/studio/posts/${encodeURIComponent(item.postId)}`}>소유 post 편집기</Link>
                {item.status === "failed" &&
                item.processingError !== "asset_storage_failed" &&
                item.processingError !== "asset_manifest_unavailable" ? (
                  <button type="button" disabled={busyId !== ""} onClick={() => void retry(item)}>같은 처리 재시도</button>
                ) : null}
                {item.cleanupEligible ? (
                  <button
                    type="button"
                    className={styles.dangerButton}
                    disabled={busyId !== "" || !result.retention.cleanupAvailable}
                    onClick={() => void cleanup(item)}
                  >
                    retention 재확인 후 삭제
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
