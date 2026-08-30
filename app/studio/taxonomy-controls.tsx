"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import type { DraftKind } from "../../db/schema";
import styles from "./studio.module.css";

type TaxonomyItem = {
  id: string;
  dimension: "kind" | "topic";
  stableKey: string;
  label: string;
  status: "active" | "archived";
  ordinal: number;
  discordTagId: string | null;
  updatedAt: string;
};

type TaxonomyJob = {
  id: string;
  status: string;
  attempts: number;
  errorCode: string | null;
  updatedAt: string;
};

type TaxonomyResult = {
  taxonomy: TaxonomyItem[];
  latestJob: TaxonomyJob | null;
};

const emptyTaxonomy: TaxonomyItem[] = [];

const fallbackKinds: Array<Pick<TaxonomyItem, "stableKey" | "label">> = [
  { stableKey: "update", label: "업데이트" },
  { stableKey: "work", label: "작업" },
];

const fallbackTopics: Array<Pick<TaxonomyItem, "stableKey" | "label">> = [
  { stableKey: "character", label: "캐릭터" },
  { stableKey: "world", label: "세계관" },
  { stableKey: "illustration", label: "일러스트" },
  { stableKey: "development", label: "개발" },
];

function isTaxonomyItem(value: unknown): value is TaxonomyItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    (item.dimension === "kind" || item.dimension === "topic") &&
    typeof item.stableKey === "string" &&
    typeof item.label === "string" &&
    (item.status === "active" || item.status === "archived") &&
    typeof item.ordinal === "number" &&
    (item.discordTagId === null || typeof item.discordTagId === "string") &&
    typeof item.updatedAt === "string"
  );
}

function isTaxonomyJob(value: unknown): value is TaxonomyJob {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const job = value as Record<string, unknown>;
  return (
    typeof job.id === "string" &&
    typeof job.status === "string" &&
    typeof job.attempts === "number" &&
    (job.errorCode === null || typeof job.errorCode === "string") &&
    typeof job.updatedAt === "string"
  );
}

function isTaxonomyResult(value: unknown): value is TaxonomyResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    Array.isArray(result.taxonomy) &&
    result.taxonomy.every(isTaxonomyItem) &&
    (result.latestJob === null || isTaxonomyJob(result.latestJob))
  );
}

function checkedTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "확인 시각 없음"
    : `${date.toLocaleString("ko-KR")} 확인`;
}

function jobLabel(job: TaxonomyJob | null) {
  if (!job) return "Discord 분류 동기화 기록 없음";
  if (job.status === "succeeded") return "Discord 분류와 일치";
  if (["queued", "processing", "retrying", "verifying", "finalizing"].includes(job.status)) {
    return "Discord 분류 동기화 중";
  }
  if (job.status === "outcome_unknown") return "Discord 분류 결과 확인 필요";
  return "Discord 분류 동기화 실패";
}

function errorLabel(value: string | null) {
  if (!value) return "";
  const labels: Record<string, string> = {
    queue_send_failed: "Queue 등록 실패",
    discord_rate_limited: "Discord 요청 제한",
    discord_forum_unavailable: "Discord Forum 연결 실패",
    discord_forum_mismatch: "Discord Forum identity 불일치",
    discord_taxonomy_verification_failed: "Discord 재확인 불일치",
    taxonomy_retry_exhausted: "동기화 재시도 소진",
  };
  return labels[value] ?? value;
}

export function TaxonomyControls({
  kind,
  topics,
  disabled,
  onKindChange,
  onTopicsChange,
  onLabelsChange,
}: {
  kind: DraftKind;
  topics: string[];
  disabled: boolean;
  onKindChange: (kind: DraftKind) => void;
  onTopicsChange: (topics: string[]) => void;
  onLabelsChange: (labels: { kind: string; topics: string[] }) => void;
}) {
  const [result, setResult] = useState<TaxonomyResult | null>(null);
  const [message, setMessage] = useState("분류 불러오는 중…");
  const [busy, setBusy] = useState(false);
  const [stableKey, setStableKey] = useState("");
  const [label, setLabel] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/studio/api/taxonomy", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const next: unknown = await response.json();
    if (!response.ok || !isTaxonomyResult(next)) {
      throw new Error("taxonomy_load_failed");
    }
    setResult(next);
    setMessage("");
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    let timer = 0;
    const refresh = async () => {
      try {
        const next = await load();
        if (!active) return;
        if (
          next.latestJob &&
          ["queued", "processing", "retrying", "verifying", "finalizing"].includes(
            next.latestJob.status,
          )
        ) {
          timer = window.setTimeout(refresh, 2_000);
        }
      } catch {
        if (active) setMessage("분류를 불러오지 못했습니다 · 다시 시도해 주세요");
      }
    };
    void refresh();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [load]);

  async function mutate(payload: Record<string, unknown>) {
    if (busy) return false;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/studio/api/taxonomy", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-studio-request": "1",
        },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { error?: unknown };
      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "taxonomy_write_failed");
      }
      await load();
      setMessage("분류를 저장하고 Discord 동기화를 등록했습니다.");
      window.dispatchEvent(new Event("studio-state-changed"));
      return true;
    } catch (error) {
      const code = error instanceof Error ? error.message : "taxonomy_write_failed";
      setMessage(`분류를 저장하지 못했습니다 · ${errorLabel(code) || code}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function move(item: TaxonomyItem, offset: -1 | 1) {
    const items = (result?.taxonomy ?? [])
      .filter(
        (candidate) =>
          candidate.dimension === item.dimension && candidate.status === "active",
      )
      .sort((left, right) => left.ordinal - right.ordinal);
    const index = items.findIndex(({ id }) => id === item.id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    void mutate({
      action: "reorder",
      dimension: item.dimension,
      taxonomyIds: items.map(({ id }) => id),
    });
  }

  function rename(item: TaxonomyItem) {
    const next = window.prompt("새 표시 이름", item.label)?.normalize("NFC").trim();
    if (!next || next === item.label) return;
    void mutate({ action: "rename", taxonomyId: item.id, label: next });
  }

  function archive(item: TaxonomyItem) {
    if (!window.confirm(`‘${item.label}’ topic을 보관할까요? 기존 초안의 선택은 보존됩니다.`)) {
      return;
    }
    void mutate({ action: "archive", taxonomyId: item.id });
  }

  async function addTopic() {
    const nextKey = stableKey.trim();
    const nextLabel = label.normalize("NFC").trim();
    if (!/^[a-z][a-z0-9-]{0,31}$/u.test(nextKey) || !nextLabel) {
      setMessage("stable key와 표시 이름을 확인해 주세요.");
      return;
    }
    const saved = await mutate({
      action: "add",
      dimension: "topic",
      stableKey: nextKey,
      label: nextLabel,
    });
    if (saved) {
      setStableKey("");
      setLabel("");
    }
  }

  const catalog = result?.taxonomy ?? emptyTaxonomy;
  const activeKinds = catalog.filter(
    (item) => item.dimension === "kind" && item.status === "active",
  );
  const activeTopics = catalog.filter(
    (item) => item.dimension === "topic" && item.status === "active",
  );
  const selectedArchived = catalog.filter(
    (item) =>
      item.dimension === "topic" &&
      item.status === "archived" &&
      topics.includes(item.stableKey),
  );
  const displayedKinds = result ? activeKinds : fallbackKinds;
  const displayedTopics = result ? activeTopics : fallbackTopics;
  const latestJob = result?.latestJob ?? null;
  const retryable = latestJob && ["queue_failed", "retrying", "failed"].includes(latestJob.status);

  useEffect(() => {
    const all = [...catalog, ...fallbackKinds, ...fallbackTopics];
    onLabelsChange({
      kind: all.find((item) => item.stableKey === kind)?.label ?? kind,
      topics: topics.map(
        (topic) => all.find((item) => item.stableKey === topic)?.label ?? topic,
      ),
    });
  }, [catalog, kind, onLabelsChange, topics]);

  return (
    <div className={styles.taxonomyBlock}>
      <div className={styles.split}>
        <fieldset disabled={disabled}>
          <legend>종류</legend>
          {displayedKinds.map((item) => (
            <label key={item.stableKey}>
              <input
                type="radio"
                name="kind"
                value={item.stableKey}
                checked={kind === item.stableKey}
                onChange={() => onKindChange(item.stableKey as DraftKind)}
              />
              {item.label}
            </label>
          ))}
        </fieldset>

        <fieldset disabled={disabled}>
          <legend>주제 · 최대 4개</legend>
          {[...displayedTopics, ...selectedArchived].map((item) => {
            const selected = topics.includes(item.stableKey);
            const archived = "status" in item && item.status === "archived";
            return (
              <label key={item.stableKey}>
                <input
                  type="checkbox"
                  name="topic"
                  value={item.stableKey}
                  checked={selected}
                  disabled={!selected && (archived || topics.length >= 4)}
                  onChange={(event) =>
                    onTopicsChange(
                      event.target.checked
                        ? [...topics, item.stableKey]
                        : topics.filter((value) => value !== item.stableKey),
                    )
                  }
                />
                {item.label}{archived ? " · 보관됨" : ""}
              </label>
            );
          })}
        </fieldset>
      </div>

      <div className={styles.taxonomyStatus} role="status" aria-live="polite">
        <p>
          {latestJob ? `${jobLabel(latestJob)} · ${checkedTime(latestJob.updatedAt)}` : message || "분류 선택 준비됨"}
          {latestJob?.errorCode ? ` · ${errorLabel(latestJob.errorCode)}` : ""}
        </p>
        {retryable ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void mutate({ action: "retry", jobId: latestJob.id })}
          >
            같은 동기화 다시 시도
          </button>
        ) : message && !busy ? (
          <button
            type="button"
            onClick={() => {
              setMessage("분류 불러오는 중…");
              void load().catch(() => {
                setMessage("분류를 불러오지 못했습니다 · 다시 시도해 주세요");
              });
            }}
          >
            분류 다시 불러오기
          </button>
        ) : null}
      </div>

      <details className={styles.taxonomyManager}>
        <summary>분류 관리</summary>
        <p>stable key는 바꾸지 않고 표시 이름·순서·topic 보관만 관리합니다.</p>
        <div className={styles.taxonomyAdd}>
          <label>
            stable key
            <input
              value={stableKey}
              pattern="[a-z][a-z0-9-]{0,31}"
              maxLength={32}
              disabled={busy}
              onChange={(event) => setStableKey(event.target.value)}
            />
          </label>
          <label>
            표시 이름
            <input
              value={label}
              maxLength={20}
              disabled={busy}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <button type="button" disabled={busy} onClick={addTopic}>topic 추가</button>
        </div>
        <ul className={styles.taxonomyList}>
          {catalog.filter(({ status }) => status === "active").map((item) => (
            <li key={item.id}>
              <span>{item.dimension === "kind" ? "종류" : "주제"} · {item.label}</span>
              <div>
                <button type="button" disabled={busy} onClick={() => move(item, -1)}>위</button>
                <button type="button" disabled={busy} onClick={() => move(item, 1)}>아래</button>
                <button type="button" disabled={busy} onClick={() => rename(item)}>이름 변경</button>
                {item.dimension === "topic" ? (
                  <button type="button" disabled={busy} onClick={() => archive(item)}>보관</button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {message ? <p className={styles.assetMessage}>{message}</p> : null}
      </details>
    </div>
  );
}
