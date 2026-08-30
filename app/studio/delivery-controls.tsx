"use client";

import { useCallback, useEffect, useState } from "react";

import styles from "./studio.module.css";

type DeliveryStatus = {
  postId: string;
  postStatus: string;
  mode: "create" | "update";
  threadId: string | null;
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
    action: "create" | "update" | "delete";
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
    typeof assets === "object" && assets !== null &&
    typeof (assets as Record<string, unknown>).count === "number" &&
    typeof (assets as Record<string, unknown>).notReadyCount === "number" &&
    typeof (assets as Record<string, unknown>).discordBytes === "number" &&
    typeof status.budgetBytes === "number" &&
    typeof status.canPublish === "boolean" &&
    typeof status.canDelete === "boolean";
}

function active(status: DeliveryStatus | null) {
  return status?.latestJob &&
    ["queued", "processing", "retrying", "verifying", "finalizing"].includes(
      status.latestJob.status,
    );
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
  const currentDelivery = delivery?.postId === postId ? delivery : null;

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
        if (!stopped && (active(next) || next.assets.notReadyCount > 0)) {
          timer = window.setTimeout(refresh, 2_000);
        }
      } catch {
        if (!stopped) setMessage("전달 상태를 불러오지 못했습니다.");
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

  async function submit(action: "publish" | "delete" | "retry") {
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
          ...(action === "retry" && currentDelivery?.latestJob
            ? { jobId: currentDelivery.latestJob.jobId }
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
      if (active(next)) window.dispatchEvent(new Event("studio-state-changed"));
    } catch {
      setMessage("전달 요청 상태를 확인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const retryable = currentDelivery?.latestJob &&
    ["queue_failed", "retrying", "failed"].includes(currentDelivery.latestJob.status);
  const outcomeUnknown = currentDelivery?.latestJob?.status === "outcome_unknown";

  return (
    <section className={styles.card} aria-labelledby="delivery-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.step}>03</p>
          <h2 id="delivery-heading">Discord Forum 전달</h2>
        </div>
        <p>Queue · exact mapping · read-after-write</p>
      </div>

      <dl className={styles.deliveryFacts}>
        <div>
          <dt>상태</dt>
          <dd>{currentDelivery?.postStatus ?? "초안 저장 대기"}</dd>
        </div>
        <div>
          <dt>작업</dt>
          <dd>{currentDelivery?.mode === "update" ? "같은 thread 수정" : "새 thread 생성"}</dd>
        </div>
        <div>
          <dt>Discord 파생본</dt>
          <dd>
            {currentDelivery
              ? `${currentDelivery.assets.count}장 · ${byteLabel(currentDelivery.assets.discordBytes)} / ${byteLabel(currentDelivery.budgetBytes)}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>최근 job</dt>
          <dd>
            {currentDelivery?.latestJob
              ? `${currentDelivery.latestJob.action} · ${currentDelivery.latestJob.status} · ${currentDelivery.latestJob.attempts}회`
              : "없음"}
          </dd>
        </div>
      </dl>

      {outcomeUnknown ? (
        <p className={styles.deliveryWarning} role="alert">
          Discord 결과가 불명확해 자동 재전송을 멈췄습니다. remote mapping을 먼저 대조해야 합니다.
        </p>
      ) : null}
      {message ? <p className={styles.assetMessage} role="status">{message}</p> : null}

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
        {retryable ? (
          <button type="button" disabled={busy} onClick={() => void submit("retry")}>
            같은 job 재시도
          </button>
        ) : null}
        <button
          type="button"
          className={styles.dangerButton}
          disabled={disabled || busy || !currentDelivery?.canDelete || Boolean(active(currentDelivery))}
          onClick={() => void submit("delete")}
        >
          Forum thread 삭제
        </button>
      </div>
    </section>
  );
}
