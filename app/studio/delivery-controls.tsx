"use client";

import { useCallback, useEffect, useState } from "react";

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
  assets: {
    count: number;
    notReadyCount: number;
    discordBytes: number;
  };
  budgetBytes: number;
  canPublish: boolean;
  canDelete: boolean;
  latestJob: null | {
    jobId: string;
    target: "discord";
    action: "create" | "update" | "delete";
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
    typeof assets === "object" && assets !== null &&
    typeof (assets as Record<string, unknown>).count === "number" &&
    typeof (assets as Record<string, unknown>).notReadyCount === "number" &&
    typeof (assets as Record<string, unknown>).discordBytes === "number" &&
    typeof status.budgetBytes === "number" &&
    typeof status.canPublish === "boolean" &&
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

  async function submit(
    action: "publish" | "delete" | "retry",
    retryJobId?: string,
  ) {
    if (!postId || busy) return;
    if (
      action === "delete" &&
      !window.confirm("BOT TEST Forum thread를 삭제합니다. 계속할까요?")
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
          ...(action === "retry" && retryJobId
            ? { jobId: retryJobId }
            : {}),
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
            className={styles.dangerButton}
            disabled={disabled || busy || !currentDelivery?.canDelete || Boolean(active(currentDelivery))}
            onClick={() => void submit("delete")}
          >
            Forum thread 삭제
          </button>
        </div>
      </details>
    </section>
  );
}
