"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { postStatuses, type PostStatus } from "../../db/schema";
import styles from "./studio.module.css";

export type DraftFilter = "all" | "working" | "attention";

type DraftListItem = {
  postId: string;
  title: string;
  postStatus: PostStatus;
  revision: number | null;
  savedAt: string;
  hasDraft: boolean;
  editable: boolean;
  working: boolean;
  needsAttention: boolean;
  attentionReason: string | null;
  attentionAt: string | null;
  assetCount: number;
  pendingAssetCount: number;
  failedAssetCount: number;
  kindLabel: string;
  topics: string[];
  hasCurrentVersion: boolean;
  hasDiscordThread: boolean;
  discordDeliveryState: string | null;
  discordCheckedAt: string | null;
  latestDelivery: null | {
    status: string;
    error: string | null;
    updatedAt: string | null;
  };
};

type DraftListResult = {
  filter: DraftFilter;
  counts: Record<DraftFilter, number>;
  items: DraftListItem[];
};

const filterLabels: Record<DraftFilter, string> = {
  all: "전체",
  working: "작업 중",
  attention: "확인 필요",
};

const statusLabels: Record<PostStatus, string> = {
  draft: "초안",
  publishing: "게시 중",
  published: "게시됨",
  withheld: "확인 필요",
  unpublished: "공개 중지",
  archiving: "보관 중",
  archived: "private archive",
  restoring: "복원 중",
  purging: "영구 삭제 중",
  purged: "영구 삭제됨",
};

function isCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isLatestDelivery(value: unknown): value is NonNullable<DraftListItem["latestDelivery"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const delivery = value as Record<string, unknown>;
  return (
    typeof delivery.status === "string" &&
    (delivery.error === null || typeof delivery.error === "string") &&
    (delivery.updatedAt === null || typeof delivery.updatedAt === "string")
  );
}

function isDraftListItem(value: unknown): value is DraftListItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.postId === "string" &&
    typeof item.title === "string" &&
    typeof item.postStatus === "string" &&
    postStatuses.includes(item.postStatus as PostStatus) &&
    (item.revision === null || isCount(item.revision)) &&
    typeof item.savedAt === "string" &&
    typeof item.hasDraft === "boolean" &&
    typeof item.editable === "boolean" &&
    typeof item.working === "boolean" &&
    typeof item.needsAttention === "boolean" &&
    (item.attentionReason === null || typeof item.attentionReason === "string") &&
    (item.attentionAt === null || typeof item.attentionAt === "string") &&
    isCount(item.assetCount) &&
    isCount(item.pendingAssetCount) &&
    isCount(item.failedAssetCount) &&
    typeof item.kindLabel === "string" &&
    Array.isArray(item.topics) &&
    item.topics.every((topic) => typeof topic === "string") &&
    typeof item.hasCurrentVersion === "boolean" &&
    typeof item.hasDiscordThread === "boolean" &&
    (item.discordDeliveryState === null || typeof item.discordDeliveryState === "string") &&
    (item.discordCheckedAt === null || typeof item.discordCheckedAt === "string") &&
    (item.latestDelivery === null || isLatestDelivery(item.latestDelivery))
  );
}

function isDraftListResult(value: unknown): value is DraftListResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  const counts = result.counts as Record<string, unknown> | undefined;
  return (
    (result.filter === "all" ||
      result.filter === "working" ||
      result.filter === "attention") &&
    typeof counts === "object" &&
    counts !== null &&
    isCount(counts.all) &&
    isCount(counts.working) &&
    isCount(counts.attention) &&
    Array.isArray(result.items) &&
    result.items.every(isDraftListItem)
  );
}

function timeLabel(value: string, suffix = "저장") {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? `${suffix} 시각 확인 불가`
    : `${date.toLocaleString("ko-KR")} ${suffix}`;
}

function attentionLabel(reason: string | null) {
  if (reason === "post_withheld") return "게시 결과를 확인해야 합니다.";
  if (reason === "delivery_outcome_unknown") {
    return "원격 delivery 결과가 불명확합니다.";
  }
  if (reason === "delivery_queue_failed") return "Queue 등록에 실패했습니다.";
  if (reason === "asset_failed") return "이미지 처리가 실패했습니다.";
  if (reason === "discord_drift") {
    return "Discord 내용이 승인 원본과 다릅니다.";
  }
  return reason ? `처리 실패 · ${reason}` : "";
}

function uploadLabel(item: DraftListItem) {
  if (item.failedAssetCount > 0) {
    return `이미지 ${item.failedAssetCount}장 확인 필요`;
  }
  if (item.pendingAssetCount > 0) {
    return `이미지 ${item.pendingAssetCount}장 처리 중`;
  }
  return item.assetCount > 0
    ? `이미지 ${item.assetCount}장 접수됨`
    : "이미지 없음";
}

function portfolioSurface(item: DraftListItem) {
  if (item.postStatus === "published" && item.hasCurrentVersion) {
    return { label: "Portfolio 공개됨", reason: "D1 승인 current 사용", checkedAt: item.savedAt };
  }
  if (item.postStatus === "withheld") {
    return { label: "Portfolio 공개 차단", reason: "원격 대조 필요", checkedAt: item.attentionAt ?? item.savedAt };
  }
  if (["publishing", "restoring"].includes(item.postStatus)) {
    return { label: "Portfolio 전환 중", reason: "승인 current 확정 대기", checkedAt: item.savedAt };
  }
  if (["archived", "archiving"].includes(item.postStatus)) {
    return { label: "Portfolio private archive", reason: "공개 참조 없음", checkedAt: item.savedAt };
  }
  return {
    label: item.hasCurrentVersion ? "Portfolio 공개 중지" : "Portfolio 공개 전",
    reason: item.hasCurrentVersion ? "current는 보존됨" : "승인 current 없음",
    checkedAt: item.savedAt,
  };
}

function discordSurface(item: DraftListItem) {
  const job = item.latestDelivery;
  if (job && ["queued", "processing", "retrying", "verifying", "finalizing"].includes(job.status)) {
    return {
      label: job.status === "finalizing" ? "Discord 확인 완료 · D1 반영 중" : "Discord 전달 중",
      reason: job.error ?? job.status,
      checkedAt: job.updatedAt ?? item.discordCheckedAt,
    };
  }
  if (job && ["queue_failed", "failed", "outcome_unknown"].includes(job.status)) {
    return {
      label: "Discord 확인 필요",
      reason: job.error ?? job.status,
      checkedAt: job.updatedAt ?? item.discordCheckedAt,
    };
  }
  if (item.discordDeliveryState === "drift") {
    return {
      label: "Discord 차이 있음",
      reason: "승인 원본과 원격 내용이 다름",
      checkedAt: item.discordCheckedAt,
    };
  }
  if (item.hasDiscordThread) {
    return {
      label: "Discord thread 연결됨",
      reason: item.discordDeliveryState ?? "fresh 확인 기록 사용",
      checkedAt: item.discordCheckedAt,
    };
  }
  return {
    label: "Discord 미게시",
    reason: item.discordDeliveryState ?? "thread mapping 없음",
    checkedAt: item.discordCheckedAt ?? item.savedAt,
  };
}

async function requestDraftList(filter: DraftFilter) {
  const response = await fetch(
    `/studio/api/drafts?filter=${encodeURIComponent(filter)}`,
    { headers: { accept: "application/json" }, cache: "no-store" },
  );
  if (response.status === 401 || response.status === 403) {
    throw new Error("studio_access_required");
  }
  const result: unknown = await response.json();
  if (!response.ok || !isDraftListResult(result) || result.filter !== filter) {
    throw new Error("draft_list_failed");
  }
  return result;
}

export function DraftList({ filter }: { filter: DraftFilter }) {
  const [result, setResult] = useState<DraftListResult | null>(null);
  const [status, setStatus] = useState("작업 목록 불러오는 중…");
  const [reloadId, setReloadId] = useState(0);

  useEffect(() => {
    let active = true;
    void requestDraftList(filter).then(
      (next) => {
        if (!active) return;
        setResult(next);
        setStatus(next.items.length > 0 ? "" : "표시할 작업이 없습니다.");
      },
      (error: unknown) => {
        if (!active) return;
        setResult(null);
        setStatus(
          error instanceof Error && error.message === "studio_access_required"
            ? "다시 로그인 필요 · 로그인 후 목록을 다시 불러와 주세요"
            : "작업 목록을 불러오지 못했습니다.",
        );
      },
    );
    return () => {
      active = false;
    };
  }, [filter, reloadId]);

  const counts = result?.counts ?? { all: 0, working: 0, attention: 0 };

  return (
    <section className={styles.card} aria-labelledby="draft-list-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.step}>00</p>
          <h2 id="draft-list-heading">작업 목록</h2>
        </div>
        <div className={styles.headingActions}>
          <Link href="/studio/media">Media</Link>
          <Link className={styles.primaryLink} href="/studio/posts/new">
            새 초안
          </Link>
        </div>
      </div>

      <nav className={styles.filters} aria-label="작업 목록 필터">
        {(Object.keys(filterLabels) as DraftFilter[]).map((value) => (
          <Link
            key={value}
            href={`/studio?filter=${value}`}
            aria-current={filter === value ? "page" : undefined}
          >
            {filterLabels[value]} {counts[value]}
          </Link>
        ))}
      </nav>

      {status ? (
        <p className={styles.listStatus} role="status" aria-live="polite">
          {status}
          {result === null && !status.includes("불러오는 중") ? (
            <button
              type="button"
              onClick={() => {
                setStatus("작업 목록 불러오는 중…");
                setReloadId((current) => current + 1);
              }}
            >
              다시 불러오기
            </button>
          ) : null}
        </p>
      ) : null}

      {result && result.items.length > 0 ? (
        <ul className={styles.postList}>
          {result.items.map((item) => (
            <li key={item.postId} className={styles.postItem}>
              <div className={styles.postBadges}>
                <span>{statusLabels[item.postStatus]}</span>
                {item.needsAttention ? <strong>확인 필요</strong> : null}
              </div>
              <div>
                <h3>{item.title}</h3>
                <p>
                  {item.kindLabel}
                  {item.topics.length > 0 ? ` · ${item.topics.join(" · ")}` : ""}
                </p>
                <p>
                  {timeLabel(item.savedAt)} · {uploadLabel(item)}
                  {item.revision === null ? "" : ` · revision ${item.revision}`}
                </p>
                {[portfolioSurface(item), discordSurface(item)].map((surface) => (
                  <p key={surface.label} className={styles.surfaceState}>
                    <strong>{surface.label}</strong> · {surface.reason} · {timeLabel(surface.checkedAt ?? item.savedAt, "확인")}
                  </p>
                ))}
                {item.needsAttention ? (
                  <p className={styles.attentionReason}>
                    {attentionLabel(item.attentionReason)}
                    {item.attentionAt ? ` · ${timeLabel(item.attentionAt, "확인")}` : ""}
                  </p>
                ) : null}
              </div>
              {item.hasDraft ? (
                <Link
                  href={`/studio/posts/${encodeURIComponent(item.postId)}${
                    item.attentionReason === "discord_drift" ? "#delivery-heading" : ""
                  }`}
                >
                  {item.attentionReason === "discord_drift"
                    ? "차이 검토"
                    : item.editable
                    ? "작업 재개"
                    : "초안 보기"}
                </Link>
              ) : (
                <span className={styles.unavailable}>저장된 초안 없음</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
