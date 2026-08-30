"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  draftKinds,
  draftTopics,
  type DraftKind,
  type DraftTopic,
} from "../../db/schema";
import { ImageUploader } from "./image-uploader";
import { DeliveryControls } from "./delivery-controls";
import styles from "./studio.module.css";

const topicLabels: Record<DraftTopic, string> = {
  character: "캐릭터",
  world: "세계관",
  illustration: "일러스트",
  development: "개발",
};

type Draft = {
  postId: string | null;
  revision: number;
  title: string;
  body: string;
  kind: DraftKind;
  topics: DraftTopic[];
};

type SavedDraft = Draft & {
  savedAt: string;
};

type SaveResult = {
  postId: string;
  versionId: string;
  revision: number;
  savedAt: string;
};

const emptyDraft: Draft = {
  postId: null,
  revision: 0,
  title: "",
  body: "",
  kind: "update",
  topics: [],
};

function characterCount(value: string) {
  return Array.from(value).length;
}

function isSaveable(draft: Draft) {
  const titleLength = characterCount(draft.title.trim());
  const bodyLength = characterCount(draft.body);
  return (
    titleLength >= 1 &&
    titleLength <= 100 &&
    draft.body.trim() !== "" &&
    bodyLength <= 2_000
  );
}

function isSavedDraft(value: unknown): value is SavedDraft {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.postId === "string" &&
    typeof draft.revision === "number" &&
    Number.isSafeInteger(draft.revision) &&
    draft.revision >= 1 &&
    typeof draft.title === "string" &&
    typeof draft.body === "string" &&
    typeof draft.kind === "string" &&
    draftKinds.includes(draft.kind as DraftKind) &&
    Array.isArray(draft.topics) &&
    draft.topics.every(
      (topic) =>
        typeof topic === "string" && draftTopics.includes(topic as DraftTopic),
    ) &&
    typeof draft.savedAt === "string"
  );
}

function isSaveResult(value: unknown): value is SaveResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    typeof result.postId === "string" &&
    typeof result.versionId === "string" &&
    typeof result.revision === "number" &&
    Number.isSafeInteger(result.revision) &&
    result.revision >= 1 &&
    typeof result.savedAt === "string"
  );
}

function savedTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "저장됨"
    : `${date.toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })} 저장됨`;
}

async function requestDraft() {
  const response = await fetch("/studio/api/drafts", {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (response.status === 204) return null;

  const result: unknown = await response.json();
  if (!response.ok || !isSavedDraft(result)) {
    throw new Error("Draft load failed");
  }
  return result;
}

export function DraftEditor() {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [composing, setComposing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [status, setStatus] = useState("초안 불러오는 중…");
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  const composingRef = useRef(false);
  const savingRef = useRef(false);
  const queuedSaveRef = useRef(false);
  const conflictRef = useRef(false);
  const changeIdRef = useRef(0);

  const restoreDraft = useCallback((result: SavedDraft | null) => {
    if (result === null) {
      draftRef.current = emptyDraft;
      dirtyRef.current = false;
      conflictRef.current = false;
      setDraft(emptyDraft);
      setDirty(false);
      setConflict(false);
      setReady(true);
      setLoadFailed(false);
      setStatus("새 초안 · 저장 전");
    } else {
      const restored: Draft = {
        postId: result.postId,
        revision: result.revision,
        title: result.title,
        body: result.body,
        kind: result.kind,
        topics: draftTopics.filter((topic) => result.topics.includes(topic)),
      };
      draftRef.current = restored;
      dirtyRef.current = false;
      conflictRef.current = false;
      setDraft(restored);
      setDirty(false);
      setConflict(false);
      setReady(true);
      setLoadFailed(false);
      setStatus(savedTime(result.savedAt));
    }
  }, []);

  const loadDraft = useCallback(async () => {
    try {
      restoreDraft(await requestDraft());
    } catch {
      setLoadFailed(true);
      setStatus("초안을 불러오지 못했습니다 · 다시 시도해 주세요");
    }
  }, [restoreDraft]);

  useEffect(() => {
    let active = true;
    void requestDraft()
      .then((result) => {
        if (active) restoreDraft(result);
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
          setStatus("초안을 불러오지 못했습니다 · 다시 시도해 주세요");
        }
      });
    return () => {
      active = false;
    };
  }, [restoreDraft]);

  function editDraft(change: (current: Draft) => Draft) {
    const next = change(draftRef.current);
    draftRef.current = next;
    dirtyRef.current = true;
    changeIdRef.current += 1;
    setDraft(next);
    setDirty(true);
    if (!conflictRef.current) {
      setStatus(
        isSaveable(next)
          ? "변경됨 · 1.5초 후 자동 저장"
          : "제목과 본문을 입력하면 저장됩니다",
      );
    }
  }

  const saveCurrent = useCallback(async function saveCurrentDraft() {
    if (
      !ready ||
      !dirtyRef.current ||
      composingRef.current ||
      conflictRef.current ||
      !isSaveable(draftRef.current)
    ) {
      return;
    }
    if (savingRef.current) {
      queuedSaveRef.current = true;
      return;
    }

    savingRef.current = true;
    setPending(true);
    setStatus("저장 중…");
    const snapshot = draftRef.current;
    const savedChangeId = changeIdRef.current;

    try {
      const response = await fetch("/studio/api/drafts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-studio-request": "1",
        },
        body: JSON.stringify(snapshot),
      });
      const result: unknown = await response.json();

      if (
        response.status === 409 &&
        typeof result === "object" &&
        result !== null &&
        (result as { error?: unknown }).error === "revision_conflict"
      ) {
        conflictRef.current = true;
        setConflict(true);
        setStatus("저장 충돌 · 로컬 내용을 복사한 뒤 새로고침해 주세요");
        return;
      }
      if (!response.ok || !isSaveResult(result)) {
        throw new Error("Draft save failed");
      }

      const saved = result;
      const current = draftRef.current;
      const withServerVersion = {
        ...current,
        postId: saved.postId,
        revision: saved.revision,
      };
      draftRef.current = withServerVersion;
      setDraft(withServerVersion);

      if (changeIdRef.current === savedChangeId) {
        dirtyRef.current = false;
        setDirty(false);
        setStatus(savedTime(saved.savedAt));
      } else {
        setStatus("변경됨 · 1.5초 후 자동 저장");
      }
    } catch {
      setStatus("저장 실패 · 다시 시도해 주세요");
    } finally {
      savingRef.current = false;
      setPending(false);
      if (queuedSaveRef.current && !conflictRef.current) {
        queuedSaveRef.current = false;
        void saveCurrentDraft();
      }
    }
  }, [ready]);

  useEffect(() => {
    if (!dirty || composing || conflict || !isSaveable(draft)) return;
    const timer = window.setTimeout(() => {
      void saveCurrent();
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [composing, conflict, dirty, draft, saveCurrent]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveCurrent();
  }

  function handleShortcut(event: KeyboardEvent<HTMLFormElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveCurrent();
    }
  }

  function handleCompositionStart() {
    composingRef.current = true;
    setComposing(true);
  }

  function handleCompositionEnd() {
    composingRef.current = false;
    setComposing(false);
    if (dirtyRef.current && isSaveable(draftRef.current)) {
      setStatus("변경됨 · 1.5초 후 자동 저장");
    }
  }

  function retryLoad() {
    setReady(false);
    setLoadFailed(false);
    setStatus("초안 불러오는 중…");
    void loadDraft();
  }

  const titleLength = characterCount(draft.title.trim());
  const bodyLength = characterCount(draft.body);
  const valid = isSaveable(draft);

  return (
    <form
      className={styles.draftForm}
      onKeyDown={handleShortcut}
      onSubmit={handleSubmit}
      aria-busy={pending}
    >
      <section className={styles.card} aria-labelledby="content-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>01</p>
            <h2 id="content-heading">Discord test fixture</h2>
          </div>
          <p>한국어 Markdown · 최대 2,000자</p>
        </div>

        {loadFailed ? (
          <button className={styles.retryButton} type="button" onClick={retryLoad}>
            초안 다시 불러오기
          </button>
        ) : null}

        <label className={styles.field}>
          <span>
            제목 <small>{titleLength}/100</small>
          </span>
          <input
            key={ready ? "ready" : "loading"}
            name="title"
            defaultValue={draft.title}
            required
            disabled={!ready}
            aria-invalid={titleLength > 100}
            onChange={(event) =>
              editDraft((current) => ({ ...current, title: event.target.value }))
            }
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label className={styles.field}>
          <span>
            본문 <small>{bodyLength}/2,000</small>
          </span>
          <textarea
            key={ready ? "ready" : "loading"}
            name="body"
            defaultValue={draft.body}
            rows={12}
            required
            disabled={!ready}
            aria-invalid={bodyLength > 2_000}
            onChange={(event) =>
              editDraft((current) => ({ ...current, body: event.target.value }))
            }
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <div className={styles.split}>
          <fieldset disabled={!ready}>
            <legend>종류</legend>
            <label>
              <input
                type="radio"
                name="kind"
                value="update"
                checked={draft.kind === "update"}
                onChange={() =>
                  editDraft((current) => ({ ...current, kind: "update" }))
                }
              />
              업데이트
            </label>
            <label>
              <input
                type="radio"
                name="kind"
                value="work"
                checked={draft.kind === "work"}
                onChange={() =>
                  editDraft((current) => ({ ...current, kind: "work" }))
                }
              />
              작업
            </label>
          </fieldset>

          <fieldset disabled={!ready}>
            <legend>주제 · 최대 4개</legend>
            {draftTopics.map((topic) => (
              <label key={topic}>
                <input
                  type="checkbox"
                  name="topic"
                  value={topic}
                  checked={draft.topics.includes(topic)}
                  onChange={(event) =>
                    editDraft((current) => ({
                      ...current,
                      topics: event.target.checked
                        ? [...current.topics, topic]
                        : current.topics.filter((value) => value !== topic),
                    }))
                  }
                />
                {topicLabels[topic]}
              </label>
            ))}
          </fieldset>
        </div>

        <div className={styles.saveBar}>
          <p
            className={conflict ? styles.conflictStatus : styles.saveStatus}
            role="status"
          >
            {status}
          </p>
          <button
            type="submit"
            disabled={!ready || !dirty || !valid || pending || conflict}
          >
            {pending ? "저장 중…" : "지금 저장"}
          </button>
        </div>
      </section>
      <ImageUploader
        postId={draft.postId}
        disabled={!ready || dirty || pending || composing || conflict}
      />
      <DeliveryControls
        postId={draft.postId}
        disabled={!ready || dirty || pending || composing || conflict}
      />
    </form>
  );
}
