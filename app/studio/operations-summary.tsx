"use client";

import { useEffect, useState } from "react";

import styles from "./studio.module.css";

type OperationsStatus = {
  schema: "studio-operations/v1";
  windowHours: 24;
  checkedAt: string;
  lastSucceededAt: string | null;
  total: number;
  failures: number;
  failureRate: number;
  averageProcessingMs: number | null;
  pending: number;
};

function isOperationsStatus(value: unknown): value is OperationsStatus {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.schema === "studio-operations/v1" && item.windowHours === 24 &&
    typeof item.checkedAt === "string" &&
    (item.lastSucceededAt === null || typeof item.lastSucceededAt === "string") &&
    ["total", "failures", "failureRate", "pending"].every(
      (key) => typeof item[key] === "number" && Number.isFinite(item[key]),
    ) &&
    (item.averageProcessingMs === null ||
      (typeof item.averageProcessingMs === "number" &&
        Number.isFinite(item.averageProcessingMs)));
}

function timeLabel(value: string | null) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "시각 확인 불가" : date.toLocaleString("ko-KR");
}

function durationLabel(value: number | null) {
  if (value === null) return "기록 없음";
  return value < 1_000 ? `${value}ms` : `${(value / 1_000).toFixed(1)}초`;
}

export function OperationsSummary() {
  const [status, setStatus] = useState<OperationsStatus | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/studio/api/operations", {
      headers: { accept: "application/json" },
      cache: "no-store",
    }).then(async (response) => {
      const result: unknown = await response.json();
      if (!response.ok || !isOperationsStatus(result)) throw new Error("operations_failed");
      if (active) setStatus(result);
    }).catch(() => {
      if (active) setError(true);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className={styles.card} aria-labelledby="operations-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.step}>OPS</p>
          <h2 id="operations-heading">최근 24시간 운영 상태</h2>
        </div>
        <p>{status ? timeLabel(status.checkedAt) : "확인 중…"}</p>
      </div>
      {error ? (
        <p className={styles.listStatus} role="status">
          운영 상태를 불러오지 못했습니다. 게시 데이터는 변경하지 않았습니다.
        </p>
      ) : (
        <dl className={styles.operationsFacts} aria-busy={!status}>
          <div>
            <dt>마지막 성공</dt>
            <dd>{timeLabel(status?.lastSucceededAt ?? null)}</dd>
          </div>
          <div>
            <dt>실패율</dt>
            <dd>{status ? `${(status.failureRate * 100).toFixed(1)}% (${status.failures}/${status.total})` : "—"}</dd>
          </div>
          <div>
            <dt>평균 처리 시간</dt>
            <dd>{durationLabel(status?.averageProcessingMs ?? null)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
