"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import styles from "./studio.module.css";

type DeliveryStatus = {
  postId: string;
  postStatus: string;
  mode: "create" | "update";
  threadId: string | null;
  hasCurrentVersion: boolean;
  discordDeliveryState: string | null;
  discordCheckedAt: string | null;
  remoteHash: string | null;
  pinnedAt: string | null;
  heroRank: number | null;
  curationRevision: number;
  updatedAt: string;
  assets: {
    count: number;
    notReadyCount: number;
    discordBytes: number;
  };
  budgetBytes: number;
  canPublish: boolean;
  canUnpublish: boolean;
  canRepublish: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canPurge: boolean;
  canCurate: boolean;
  canDelete: boolean;
  latestJob: null | {
    jobId: string;
    target: "discord";
    action: "create" | "update" | "delete" | "check";
    status: string;
    attempts: number;
    error: string | null;
    updatedAt: string;
  };
  notificationJob: null | {
    jobId: string;
    target: "notification";
    action: "send";
    status: string;
    attempts: number;
    error: string | null;
    updatedAt: string;
  };
};

type FreshCheckAttachment = {
  filename: string;
  size: number;
  description: string | null;
};

type FreshCheckResult = {
  postId: string;
  action: "fresh_check";
  outcome: "matched" | "drift";
  checkedAt: string;
  changed: Array<"body" | "images" | "classification">;
  expected: {
    title: string;
    body: string;
    tagIds: string[];
    attachments: FreshCheckAttachment[];
  };
  remote: {
    threadFound: boolean;
    starterFound: boolean;
    title: string | null;
    body: string | null;
    tagIds: string[];
    attachments: FreshCheckAttachment[];
  };
  technical: {
    threadId: string;
    starterMessageId: string;
    expectedHash: string;
    remoteHash: string;
  };
};

function byteLabel(value: number) {
  return value < 1024 * 1024
    ? `${Math.ceil(value / 1024)} KB`
    : `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  const assets = status.assets;
  return typeof status.postId === "string" &&
    typeof status.postStatus === "string" &&
    (status.mode === "create" || status.mode === "update") &&
    (status.threadId === null || typeof status.threadId === "string") &&
    typeof status.hasCurrentVersion === "boolean" &&
    (status.discordDeliveryState === null || typeof status.discordDeliveryState === "string") &&
    (status.discordCheckedAt === null || typeof status.discordCheckedAt === "string") &&
    (status.pinnedAt === null || typeof status.pinnedAt === "string") &&
    (status.heroRank === null || typeof status.heroRank === "number") &&
    typeof status.curationRevision === "number" &&
    Number.isSafeInteger(status.curationRevision) &&
    status.curationRevision >= 0 &&
    typeof status.updatedAt === "string" &&
    typeof assets === "object" && assets !== null &&
    typeof (assets as Record<string, unknown>).count === "number" &&
    typeof (assets as Record<string, unknown>).notReadyCount === "number" &&
    typeof (assets as Record<string, unknown>).discordBytes === "number" &&
    typeof status.budgetBytes === "number" &&
    typeof status.canPublish === "boolean" &&
    typeof status.canUnpublish === "boolean" &&
    typeof status.canRepublish === "boolean" &&
    typeof status.canArchive === "boolean" &&
    typeof status.canRestore === "boolean" &&
    typeof status.canPurge === "boolean" &&
    typeof status.canCurate === "boolean" &&
    typeof status.canDelete === "boolean" &&
    (status.latestJob === null || (
      typeof status.latestJob === "object" &&
      status.latestJob !== null &&
      typeof (status.latestJob as Record<string, unknown>).jobId === "string" &&
      typeof (status.latestJob as Record<string, unknown>).action === "string" &&
      typeof (status.latestJob as Record<string, unknown>).status === "string" &&
      typeof (status.latestJob as Record<string, unknown>).attempts === "number" &&
      ((status.latestJob as Record<string, unknown>).error === null ||
        typeof (status.latestJob as Record<string, unknown>).error === "string") &&
      typeof (status.latestJob as Record<string, unknown>).updatedAt === "string"
    )) &&
    (status.notificationJob === null || (
      typeof status.notificationJob === "object" &&
      status.notificationJob !== null &&
      typeof (status.notificationJob as Record<string, unknown>).jobId === "string" &&
      (status.notificationJob as Record<string, unknown>).target === "notification" &&
      (status.notificationJob as Record<string, unknown>).action === "send" &&
      typeof (status.notificationJob as Record<string, unknown>).status === "string" &&
      typeof (status.notificationJob as Record<string, unknown>).attempts === "number" &&
      ((status.notificationJob as Record<string, unknown>).error === null ||
        typeof (status.notificationJob as Record<string, unknown>).error === "string") &&
      typeof (status.notificationJob as Record<string, unknown>).updatedAt === "string"
    ));
}

function isFreshCheckAttachment(value: unknown): value is FreshCheckAttachment {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const attachment = value as Record<string, unknown>;
  return typeof attachment.filename === "string" &&
    typeof attachment.size === "number" &&
    Number.isSafeInteger(attachment.size) &&
    attachment.size >= 0 &&
    (attachment.description === null || typeof attachment.description === "string");
}

function isFreshCheckResult(value: unknown): value is FreshCheckResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  const expected = result.expected as Record<string, unknown> | undefined;
  const remote = result.remote as Record<string, unknown> | undefined;
  const technical = result.technical as Record<string, unknown> | undefined;
  const validSections = ["body", "images", "classification"];
  return typeof result.postId === "string" &&
    result.action === "fresh_check" &&
    (result.outcome === "matched" || result.outcome === "drift") &&
    typeof result.checkedAt === "string" &&
    Array.isArray(result.changed) &&
    result.changed.every((section) => validSections.includes(String(section))) &&
    typeof expected === "object" && expected !== null &&
    typeof expected.title === "string" &&
    typeof expected.body === "string" &&
    Array.isArray(expected.tagIds) &&
    expected.tagIds.every((tagId) => typeof tagId === "string") &&
    Array.isArray(expected.attachments) &&
    expected.attachments.every(isFreshCheckAttachment) &&
    typeof remote === "object" && remote !== null &&
    typeof remote.threadFound === "boolean" &&
    typeof remote.starterFound === "boolean" &&
    (remote.title === null || typeof remote.title === "string") &&
    (remote.body === null || typeof remote.body === "string") &&
    Array.isArray(remote.tagIds) &&
    remote.tagIds.every((tagId) => typeof tagId === "string") &&
    Array.isArray(remote.attachments) &&
    remote.attachments.every(isFreshCheckAttachment) &&
    typeof technical === "object" && technical !== null &&
    typeof technical.threadId === "string" &&
    typeof technical.starterMessageId === "string" &&
    typeof technical.expectedHash === "string" &&
    typeof technical.remoteHash === "string";
}

function active(status: DeliveryStatus | null) {
  return status?.latestJob &&
    ["queued", "processing", "retrying", "verifying", "finalizing"].includes(
      status.latestJob.status,
    );
}

function pollingActive(status: DeliveryStatus | null) {
  return Boolean(active(status)) || Boolean(
    status?.notificationJob &&
      ["queued", "processing", "retrying"].includes(status.notificationJob.status),
  );
}

function timeLabel(value: string | null | undefined) {
  if (!value) return "확인 시각 없음";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "확인 시각 없음"
    : `${date.toLocaleString("ko-KR")} 확인`;
}

function errorLabel(value: string | null | undefined) {
  if (!value) return "원인 없음";
  const labels: Record<string, string> = {
    queue_send_failed: "Queue 등록 실패",
    discord_rate_limited: "Discord 요청 제한",
    discord_create_failed: "Discord 생성 실패",
    discord_update_failed: "Discord 수정 실패",
    discord_delete_failed: "Discord 삭제 실패",
    discord_check_unavailable: "Discord 확인 실패",
    discord_check_rate_limited: "Discord 확인 요청 제한",
    discord_check_invalid_response: "Discord 확인 응답 오류",
    discord_tags_missing: "Discord 분류 연결 누락",
    published_snapshot_invalid: "승인 원본 확인 실패",
    published_mapping_not_found: "공개 mapping 없음",
    fresh_check_conflict: "확인 중 상태 변경",
    discord_check_interrupted: "Discord 확인 중단",
    delivery_retry_exhausted: "자동 재시도 소진",
    notification_network_unknown: "알림 전송 결과 불명",
    notification_server_unknown: "알림 서버 결과 불명",
    notification_rate_limited: "알림 요청 제한",
    notification_outcome_unknown: "알림 처리 결과 불명",
    remote_verification_failed: "fresh remote 재확인 실패",
    finalization_failed: "D1 finalization 실패",
  };
  return labels[value] ?? value;
}

export function DeliveryControls({
  postId,
  disabled,
}: {
  postId: string | null;
  disabled: boolean;
}) {
  const [delivery, setDelivery] = useState<DeliveryStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [freshPostId, setFreshPostId] = useState("");
  const [purgeTitle, setPurgeTitle] = useState("");
  const [heroRankInput, setHeroRankInput] = useState("");
  const [review, setReview] = useState<FreshCheckResult | null>(null);
  const reviewDialogRef = useRef<HTMLDialogElement>(null);
  const shownDelivery = delivery?.postId === postId ? delivery : null;
  const currentDelivery = freshPostId === postId ? shownDelivery : null;

  const load = useCallback(async (targetPostId: string) => {
    const response = await fetch(
      `/studio/api/publish?postId=${encodeURIComponent(targetPostId)}`,
      { headers: { accept: "application/json" }, cache: "no-store" },
    );
    const result: unknown = await response.json();
    if (!response.ok || !isDeliveryStatus(result)) {
      throw new Error("Delivery status load failed");
    }
    setDelivery(result);
    setFreshPostId(targetPostId);
    return result;
  }, []);

  useEffect(() => {
    if (!postId) {
      return;
    }
    let stopped = false;
    let timer = 0;
    const refresh = async () => {
      try {
        const next = await load(postId);
        setMessage((current) =>
          current === "전달 상태를 불러오지 못했습니다." ? "" : current
        );
        if (!stopped && (pollingActive(next) || next.assets.notReadyCount > 0)) {
          timer = window.setTimeout(refresh, 2_000);
        }
      } catch {
        if (!stopped) {
          setFreshPostId("");
          setMessage("전달 상태를 불러오지 못했습니다 · 이전 표시는 오래된 상태이며 action을 막았습니다.");
        }
      }
    };
    const handleStateChanged = () => {
      window.clearTimeout(timer);
      void refresh();
    };
    window.addEventListener("studio-state-changed", handleStateChanged);
    void refresh();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("studio-state-changed", handleStateChanged);
    };
  }, [load, postId]);

  useEffect(() => {
    const dialog = reviewDialogRef.current;
    if (review && dialog && !dialog.open) dialog.showModal();
  }, [review]);

  async function reviewDiscord() {
    if (!postId || busy || !currentDelivery) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/studio/api/publish", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-studio-request": "1",
        },
        body: JSON.stringify({ action: "fresh_check", postId }),
      });
      const result: unknown = await response.json();
      if (!response.ok || !isFreshCheckResult(result) || result.postId !== postId) {
        const error = typeof result === "object" && result !== null &&
            typeof (result as Record<string, unknown>).error === "string"
          ? (result as Record<string, string>).error
          : null;
        setMessage(
          `Discord 확인을 마치지 못했습니다. Portfolio 공개본과 기존 연결은 그대로 유지했습니다. 잠시 뒤 다시 확인해 주세요. · ${errorLabel(error)}`,
        );
        return;
      }
      setReview(result);
      setMessage(
        result.outcome === "matched"
          ? "Discord와 승인 원본이 일치합니다. Portfolio 공개본과 연결은 그대로 유지했습니다."
          : "Discord에서 차이를 확인했습니다. Portfolio 공개본과 연결은 그대로 유지했습니다. 검토 창에서 달라진 부분을 확인해 주세요.",
      );
      await load(postId);
      window.dispatchEvent(new Event("studio-state-changed"));
    } catch {
      setMessage(
        "Discord 확인 응답을 받지 못했습니다. Portfolio 공개본과 기존 연결은 그대로 유지했습니다. 잠시 뒤 다시 확인해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(
    action:
      | "publish"
      | "unpublish"
      | "republish"
      | "archive"
      | "restore"
      | "purge"
      | "pin"
      | "unpin"
      | "hero"
      | "retry"
      | "reconcile",
    retryJobId?: string,
    heroRank?: number | null,
  ) {
    if (!postId || busy) return;
    if (
      action === "archive" &&
      !window.confirm("Portfolio를 숨기고 BOT TEST Forum thread를 삭제해 보관합니다. 계속할까요?")
    ) return;
    if (
      action === "purge" &&
      !window.confirm("private source와 모든 파생본을 영구 삭제하고 tombstone만 남깁니다. 되돌릴 수 없습니다.")
    ) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/studio/api/publish", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-studio-request": "1",
        },
        body: JSON.stringify({
          action,
          postId,
          ...((action === "retry" || action === "reconcile") && retryJobId
            ? { jobId: retryJobId }
            : {}),
          ...(action === "purge" ? { title: purgeTitle } : {}),
          ...(["pin", "unpin", "hero"].includes(action)
            ? { curationRevision: currentDelivery?.curationRevision }
            : {}),
          ...(action === "hero" ? { heroRank: heroRank ?? null } : {}),
        }),
      });
      const result = await response.json() as {
        error?: unknown;
        missing?: unknown;
        noChange?: unknown;
      };
      if (!response.ok) {
        const missing = Array.isArray(result.missing)
          ? `: ${result.missing.join(", ")}`
          : "";
        setMessage(
          typeof result.error === "string"
            ? `${result.error}${missing}`
            : "전달 요청에 실패했습니다.",
        );
      } else {
        setMessage(
          result.noChange
            ? "Discord와 같은 hash라 새 작업을 만들지 않았습니다."
            : "Queue에 전달 작업을 등록했습니다.",
        );
      }
      const next = await load(postId);
      if (pollingActive(next)) window.dispatchEvent(new Event("studio-state-changed"));
    } catch {
      setMessage("전달 요청 상태를 확인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const retryable = currentDelivery?.latestJob &&
    ["queue_failed", "retrying", "failed", "finalizing"].includes(currentDelivery.latestJob.status);
  const notificationRetryable = currentDelivery?.notificationJob &&
    ["queue_failed", "retrying", "failed"].includes(
      currentDelivery.notificationJob.status,
    );
  const outcomeUnknown = shownDelivery?.latestJob?.status === "outcome_unknown";
  const canReconcile = currentDelivery?.latestJob?.status === "outcome_unknown" &&
    currentDelivery.latestJob.action === "update";
  const notificationUnknown = shownDelivery?.notificationJob?.status === "outcome_unknown";

  return (
    <section className={styles.card} aria-labelledby="delivery-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.step}>04</p>
          <h2 id="delivery-heading">Discord Forum 전달</h2>
        </div>
        <p>Queue · exact mapping · read-after-write</p>
      </div>

      <dl className={styles.deliveryFacts}>
        <div>
          <dt>상태</dt>
          <dd>{shownDelivery?.postStatus ?? "초안 저장 대기"}</dd>
        </div>
        <div>
          <dt>작업</dt>
          <dd>{shownDelivery?.mode === "update" ? "같은 thread 수정" : "새 thread 생성"}</dd>
        </div>
        <div>
          <dt>Discord 파생본</dt>
          <dd>
            {shownDelivery
              ? `${shownDelivery.assets.count}장 · ${byteLabel(shownDelivery.assets.discordBytes)} / ${byteLabel(shownDelivery.budgetBytes)}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>최근 job</dt>
          <dd>
            {shownDelivery?.latestJob
              ? `${shownDelivery.latestJob.action} · ${shownDelivery.latestJob.status} · ${shownDelivery.latestJob.attempts}회`
              : "없음"}
          </dd>
        </div>
        <div>
          <dt>최초 게시 알림</dt>
          <dd>
            {shownDelivery?.notificationJob
              ? `${shownDelivery.notificationJob.status} · ${shownDelivery.notificationJob.attempts}회 · ${timeLabel(shownDelivery.notificationJob.updatedAt)}`
              : "대상 아님"}
          </dd>
        </div>
        <div>
          <dt>pin · Hero</dt>
          <dd>
            {shownDelivery?.pinnedAt ? "pin 지정" : "pin 없음"}
            {shownDelivery?.heroRank === null || shownDelivery?.heroRank === undefined
              ? " · Hero 없음"
              : ` · Hero ${shownDelivery.heroRank}`}
          </dd>
        </div>
        <div>
          <dt>Portfolio</dt>
          <dd>
            {shownDelivery?.postStatus === "published" && shownDelivery.hasCurrentVersion
              ? "승인 current 공개됨"
              : shownDelivery?.postStatus === "withheld"
              ? "공개 차단 · 원격 대조 필요"
              : shownDelivery?.hasCurrentVersion
              ? "current 보존 · 현재 비공개"
              : "공개 전"}
          </dd>
        </div>
        <div>
          <dt>Discord</dt>
          <dd>
            {shownDelivery?.threadId ? "thread 연결됨" : "thread mapping 없음"}
            {shownDelivery?.discordDeliveryState ? ` · ${shownDelivery.discordDeliveryState}` : ""}
          </dd>
        </div>
        <div>
          <dt>원인</dt>
          <dd>{errorLabel(shownDelivery?.latestJob?.error)}</dd>
        </div>
        <div>
          <dt>마지막 확인</dt>
          <dd>{timeLabel(shownDelivery?.discordCheckedAt ?? shownDelivery?.latestJob?.updatedAt)}</dd>
        </div>
      </dl>

      {outcomeUnknown ? (
        <p className={styles.deliveryWarning} role="alert">
          Discord 결과가 불명확해 자동 재전송을 멈췄습니다. remote mapping을 먼저 대조해야 합니다.
        </p>
      ) : null}
      {notificationUnknown ? (
        <p className={styles.deliveryWarning} role="alert">
          알림 전송 결과가 불명확해 자동 재전송을 멈췄습니다. announcements channel을 먼저 대조해야 합니다.
        </p>
      ) : null}
      {message ? <p className={styles.assetMessage} role="status">{message}</p> : null}

      <div className={styles.deliveryButtons}>
        {currentDelivery?.postStatus === "published" && currentDelivery.threadId ? (
          <button type="button" disabled={busy} onClick={() => void reviewDiscord()}>
            {busy ? "확인 중…" : "차이 검토"}
          </button>
        ) : null}
        {canReconcile ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit("reconcile", currentDelivery.latestJob?.jobId)}
          >
            Discord mutation 없이 원격 대조
          </button>
        ) : null}
        {retryable ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit("retry", currentDelivery.latestJob?.jobId)}
          >
            {currentDelivery.latestJob?.status === "finalizing"
              ? "Discord 재전송 없이 D1 반영 재시도"
              : "같은 job 재시도"}
          </button>
        ) : null}
        {notificationRetryable ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit("retry", currentDelivery.notificationJob?.jobId)}
          >
            최초 게시 알림 재시도
          </button>
        ) : null}
      </div>
      <details className={styles.deliveryActions}>
        <summary>게시·Forum 작업</summary>
        <div className={styles.deliveryButtons}>
          <button
            type="button"
            disabled={!postId || disabled || busy || !currentDelivery?.canPublish || Boolean(active(currentDelivery))}
            onClick={() => void submit("publish")}
          >
            {busy
              ? "요청 중…"
              : currentDelivery?.mode === "update"
              ? "같은 thread 수정"
              : "BOT TEST에 게시"}
          </button>
          <button
            type="button"
            disabled={disabled || busy || !currentDelivery?.canUnpublish || Boolean(active(currentDelivery))}
            onClick={() => void submit("unpublish")}
          >
            Portfolio 공개 중지
          </button>
          <button
            type="button"
            disabled={disabled || busy || !currentDelivery?.canRepublish || Boolean(active(currentDelivery))}
            onClick={() => void submit("republish")}
          >
            같은 mapping으로 재공개
          </button>
          <button
            type="button"
            disabled={disabled || busy || !currentDelivery?.canRestore || Boolean(active(currentDelivery))}
            onClick={() => void submit("restore")}
          >
            새 Forum thread로 복원
          </button>
          <button
            type="button"
            className={styles.dangerButton}
            disabled={disabled || busy || !currentDelivery?.canArchive || Boolean(active(currentDelivery))}
            onClick={() => void submit("archive")}
          >
            양쪽 공개 보관
          </button>
        </div>
        <div className={styles.heroControls}>
          <button
            type="button"
            disabled={disabled || busy || !currentDelivery?.canCurate || Boolean(active(currentDelivery))}
            onClick={() => void submit(currentDelivery?.pinnedAt ? "unpin" : "pin")}
          >
            {currentDelivery?.pinnedAt ? "pin 해제" : "이 post를 pin"}
          </button>
          <label>
            Hero rank
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={heroRankInput}
              placeholder={currentDelivery?.heroRank?.toString() ?? "없음"}
              onChange={(event) => setHeroRankInput(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={
              disabled ||
              busy ||
              !currentDelivery?.canCurate ||
              !/^\d+$/u.test(heroRankInput) ||
              !Number.isSafeInteger(Number(heroRankInput)) ||
              Boolean(active(currentDelivery))
            }
            onClick={() => void submit("hero", undefined, Number(heroRankInput))}
          >
            Hero 적용
          </button>
          <button
            type="button"
            disabled={
              disabled ||
              busy ||
              !currentDelivery?.canCurate ||
              currentDelivery.heroRank === null ||
              Boolean(active(currentDelivery))
            }
            onClick={() => void submit("hero", undefined, null)}
          >
            Hero 해제
          </button>
        </div>
        <div className={styles.purgeConfirmation}>
          <label>
            permanent purge 제목 재입력
            <input
              value={purgeTitle}
              maxLength={100}
              autoComplete="off"
              onChange={(event) => setPurgeTitle(event.target.value.normalize("NFC"))}
            />
          </label>
          <button
            type="button"
            className={styles.dangerButton}
            disabled={
              disabled ||
              busy ||
              !currentDelivery?.canPurge ||
              purgeTitle.length === 0 ||
              Boolean(active(currentDelivery))
            }
            onClick={() => void submit("purge")}
          >
            원본까지 영구 삭제
          </button>
        </div>
      </details>
      <dialog
        ref={reviewDialogRef}
        className={styles.navigationDialog}
        onClose={() => setReview(null)}
      >
        {review ? (
          <>
            <h2>
              {review.outcome === "matched"
                ? "Discord와 승인 원본이 일치합니다"
                : "Discord에서 차이를 확인했습니다"}
            </h2>
            <p>
              {review.outcome === "matched"
                ? "확인 시각만 갱신했습니다. Portfolio 공개본과 Discord 연결은 그대로입니다."
                : "자동으로 수정하지 않았습니다. Portfolio 공개본과 Discord 연결은 그대로입니다. 달라진 부분만 아래에 표시합니다."}
            </p>
            {review.changed.includes("body") ? (
              <section>
                <h3>본문</h3>
                <p><strong>승인 원본 제목</strong> · {review.expected.title}</p>
                <p><strong>Discord 제목</strong> · {review.remote.title ?? "thread 없음"}</p>
                <p className={styles.differenceText}>
                  <strong>승인 원본 본문</strong><br />{review.expected.body}
                </p>
                <p className={styles.differenceText}>
                  <strong>Discord 본문</strong><br />{review.remote.body ?? "starter message 없음"}
                </p>
              </section>
            ) : null}
            {review.changed.includes("images") ? (
              <section>
                <h3>이미지</h3>
                <p>
                  승인 원본 {review.expected.attachments.length}장 · Discord {review.remote.attachments.length}장
                </p>
                <p>
                  승인 원본: {review.expected.attachments.map(({ filename }) => filename).join(", ") || "없음"}
                </p>
                <p>
                  Discord: {review.remote.attachments.map(({ filename }) => filename).join(", ") || "없음"}
                </p>
              </section>
            ) : null}
            {review.changed.includes("classification") ? (
              <section>
                <h3>분류</h3>
                <p>
                  Forum 위치나 적용 tag가 승인 원본과 다릅니다. 기술 정보에서 ID를 확인하세요.
                </p>
              </section>
            ) : null}
            {!review.remote.threadFound ? (
              <p role="alert">
                연결된 Discord thread를 찾지 못했습니다. 자동으로 새 글을 만들지 않았습니다.
              </p>
            ) : !review.remote.starterFound ? (
              <p role="alert">
                연결된 starter message를 찾지 못했습니다. 자동으로 새 글을 만들지 않았습니다.
              </p>
            ) : null}
            <details>
              <summary>기술 정보</summary>
              <p>확인 시각 · {timeLabel(review.checkedAt)}</p>
              <p>thread ID · {review.technical.threadId}</p>
              <p>starter ID · {review.technical.starterMessageId}</p>
              <p className={styles.differenceText}>expected hash · {review.technical.expectedHash}</p>
              <p className={styles.differenceText}>remote hash · {review.technical.remoteHash}</p>
              <p>expected tag IDs · {review.expected.tagIds.join(", ") || "없음"}</p>
              <p>remote tag IDs · {review.remote.tagIds.join(", ") || "없음"}</p>
            </details>
            <div>
              <button type="button" onClick={() => reviewDialogRef.current?.close()}>
                현재 상태 유지
              </button>
            </div>
          </>
        ) : null}
      </dialog>
    </section>
  );
}
