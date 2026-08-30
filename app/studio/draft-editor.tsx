"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import {
  draftKinds,
  postStatuses,
  type DraftKind,
  type PostStatus,
} from "../../db/schema";
import { validateStudioMarkdown } from "../../lib/studio-markdown";
import { ImageUploader } from "./image-uploader";
import { DeliveryControls } from "./delivery-controls";
import { SurfacePreview } from "./surface-preview";
import { TaxonomyControls } from "./taxonomy-controls";
import styles from "./studio.module.css";

type Draft = {
  postId: string | null;
  revision: number;
  title: string;
  body: string;
  kind: DraftKind;
  topics: string[];
};

type SavedDraft = Draft & {
  savedAt: string;
  postStatus: PostStatus;
  editable: boolean;
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
    bodyLength <= 2_000 &&
    validateStudioMarkdown(draft.body) === null
  );
}

function saveErrorLabel(code: unknown) {
  if (typeof code !== "string") return "저장 실패 · 다시 시도해 주세요";
  const labels: Record<string, string> = {
    body_control_character: "저장 실패 · 본문의 제어 문자를 제거해 주세요",
    body_raw_html: "저장 실패 · HTML 태그는 사용할 수 없습니다",
    body_inline_image: "저장 실패 · 본문 이미지 문법 대신 이미지 영역을 사용해 주세요",
    body_discord_syntax: "저장 실패 · Discord mention·채널·emoji 문법을 제거해 주세요",
    body_unsupported_markdown: "저장 실패 · 지원하지 않는 Markdown 문법입니다",
    body_unsafe_link: "저장 실패 · 링크는 인증 정보 없는 https만 허용됩니다",
    body_invalid_link: "저장 실패 · Markdown 링크 주소를 확인해 주세요",
    invalid_topics: "저장 실패 · 보관되거나 바뀐 주제 선택을 확인해 주세요",
  };
  return labels[code] ?? `저장 실패 · ${code}`;
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
    draft.topics.length <= 4 &&
    draft.topics.every(
      (topic) =>
        typeof topic === "string" && /^[a-z][a-z0-9-]{0,31}$/u.test(topic),
    ) &&
    new Set(draft.topics).size === draft.topics.length &&
    typeof draft.savedAt === "string" &&
    typeof draft.postStatus === "string" &&
    postStatuses.includes(draft.postStatus as PostStatus) &&
    typeof draft.editable === "boolean"
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

function needsStudioLogin(status: number) {
  return status === 401 || status === 403;
}

function draftLoadFailure(error: unknown) {
  return error instanceof Error && error.message === "studio_access_required"
    ? "다시 로그인 필요 · 로그인 후 초안을 다시 불러와 주세요"
    : "초안을 불러오지 못했습니다 · 다시 시도해 주세요";
}

async function requestDraft(postId: string | null) {
  if (postId === null) return null;
  const response = await fetch(
    `/studio/api/drafts?postId=${encodeURIComponent(postId)}`,
    {
      headers: { accept: "application/json" },
      cache: "no-store",
    },
  );
  if (response.status === 204) return null;
  if (needsStudioLogin(response.status)) {
    throw new Error("studio_access_required");
  }

  const result: unknown = await response.json();
  if (!response.ok || !isSavedDraft(result)) {
    throw new Error("Draft load failed");
  }
  return result;
}

export function DraftEditor({ postId }: { postId: string | null }) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [ready, setReady] = useState(false);
  const [editable, setEditable] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [composing, setComposing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [moving, setMoving] = useState(false);
  const [navigationReason, setNavigationReason] = useState("");
  const [pendingUploadCount, setPendingUploadCount] = useState(0);
  const [assetManifestPending, setAssetManifestPending] = useState(false);
  const [status, setStatus] = useState("초안 불러오는 중…");
  const [taxonomyLabels, setTaxonomyLabels] = useState({
    kind: "업데이트",
    topics: [] as string[],
  });
  const draftRef = useRef(draft);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const dirtyRef = useRef(false);
  const composingRef = useRef(false);
  const savingRef = useRef(false);
  const queuedSaveRef = useRef(false);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const conflictRef = useRef(false);
  const changeIdRef = useRef(0);
  const movingRef = useRef(false);
  const pendingUploadCountRef = useRef(0);
  const assetManifestPendingRef = useRef(false);
  const assetManifestSavingRef = useRef(false);
  const assetManifestFlushRef = useRef<(() => Promise<boolean>) | null>(null);
  const uploadReceiptCheckedRef = useRef(postId === null);
  const navigationTargetRef = useRef("/studio?filter=working");
  const navigationDialogRef = useRef<HTMLDialogElement>(null);

  const updateTaxonomyLabels = useCallback(
    (labels: { kind: string; topics: string[] }) => {
      setTaxonomyLabels((current) =>
        current.kind === labels.kind &&
          current.topics.length === labels.topics.length &&
          current.topics.every((value, index) => value === labels.topics[index])
          ? current
          : labels
      );
    },
    [],
  );

  const getRevision = useCallback(() => draftRef.current.revision, []);

  const updateAssetRevision = useCallback((revision: number, savedAt: string) => {
    const current = draftRef.current;
    if (revision <= current.revision) return;
    const next = { ...current, revision };
    draftRef.current = next;
    setDraft(next);
    setStatus(savedTime(savedAt));
  }, []);

  const markAssetRevisionConflict = useCallback(() => {
    conflictRef.current = true;
    setConflict(true);
    setStatus("다른 창에서 이미지가 수정됨 · 현재 내용을 복사한 뒤 새로고침해 주세요");
  }, []);

  const updateAssetManifestPending = useCallback((value: boolean) => {
    assetManifestPendingRef.current = value;
    setAssetManifestPending(value);
  }, []);

  const registerAssetManifestFlush = useCallback(
    (flush: (() => Promise<boolean>) | null) => {
      assetManifestFlushRef.current = flush;
    },
    [],
  );

  const updateAssetManifestSaving = useCallback((value: boolean) => {
    assetManifestSavingRef.current = value;
  }, []);

  const restoreDraft = useCallback((result: SavedDraft | null) => {
    if (result === null) {
      draftRef.current = emptyDraft;
      dirtyRef.current = false;
      conflictRef.current = false;
      setDraft(emptyDraft);
      setDirty(false);
      setConflict(false);
      setEditable(true);
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
        topics: [...result.topics],
      };
      draftRef.current = restored;
      dirtyRef.current = false;
      conflictRef.current = false;
      setDraft(restored);
      setDirty(false);
      setConflict(false);
      setEditable(result.editable);
      setReady(true);
      setLoadFailed(false);
      setStatus(
        result.editable
          ? savedTime(result.savedAt)
          : `${savedTime(result.savedAt)} · ${result.postStatus} 상태에서는 읽기 전용`,
      );
    }
  }, []);

  const loadDraft = useCallback(async () => {
    try {
      restoreDraft(await requestDraft(postId));
    } catch (error) {
      setLoadFailed(true);
      setStatus(draftLoadFailure(error));
    }
  }, [postId, restoreDraft]);

  useEffect(() => {
    let active = true;
    void requestDraft(postId)
      .then((result) => {
        if (active) restoreDraft(result);
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadFailed(true);
          setStatus(draftLoadFailure(error));
        }
      });
    return () => {
      active = false;
    };
  }, [postId, restoreDraft]);

  function editDraft(change: (current: Draft) => Draft) {
    const next = change(draftRef.current);
    draftRef.current = next;
    dirtyRef.current = true;
    changeIdRef.current += 1;
    if (savingRef.current) queuedSaveRef.current = true;
    setDraft(next);
    setDirty(true);
    if (!conflictRef.current) {
      const markdownIssue = validateStudioMarkdown(next.body);
      setStatus(
        markdownIssue
          ? `${markdownIssue.message} · 아래 표시된 위치를 확인해 주세요`
          : isSaveable(next)
          ? "변경됨 · 1.5초 후 자동 저장"
          : "제목과 본문을 입력하면 저장됩니다",
      );
    }
  }

  const saveCurrent = useCallback(function saveCurrentDraft(): Promise<boolean> {
    if (savePromiseRef.current) {
      queuedSaveRef.current = true;
      return savePromiseRef.current;
    }
    if (!dirtyRef.current) return Promise.resolve(true);
    if (
      !ready ||
      !editable ||
      composingRef.current ||
      conflictRef.current ||
      assetManifestSavingRef.current ||
      !isSaveable(draftRef.current)
    ) {
      return Promise.resolve(false);
    }

    const cycle = (async () => {
      savingRef.current = true;
      setPending(true);

      try {
        do {
          if (
            composingRef.current ||
            conflictRef.current ||
            !isSaveable(draftRef.current)
          ) {
            return false;
          }
          queuedSaveRef.current = false;
          setStatus(movingRef.current ? "저장 후 이동 중…" : "저장 중…");
          const snapshot = draftRef.current;
          const savedChangeId = changeIdRef.current;
          const response = await fetch("/studio/api/drafts", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-studio-request": "1",
            },
            body: JSON.stringify(snapshot),
          });
          if (needsStudioLogin(response.status)) {
            setStatus("다시 로그인 필요 · 로그인 후 지금 저장을 눌러 주세요");
            return false;
          }
          const result: unknown = await response.json();

          if (
            response.status === 409 &&
            typeof result === "object" &&
            result !== null &&
            (result as { error?: unknown }).error === "revision_conflict"
          ) {
            conflictRef.current = true;
            setConflict(true);
            setStatus("다른 창에서 수정됨 · 로컬 내용을 복사한 뒤 새로고침해 주세요");
            return false;
          }
          if (!response.ok) {
            setStatus(
              saveErrorLabel(
                typeof result === "object" && result !== null
                  ? (result as { error?: unknown }).error
                  : null,
              ),
            );
            return false;
          }
          if (!isSaveResult(result)) {
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
          if (snapshot.postId === null) {
            uploadReceiptCheckedRef.current = false;
            window.history.replaceState(
              window.history.state,
              "",
              `/studio/posts/${encodeURIComponent(saved.postId)}`,
            );
          }

          if (changeIdRef.current === savedChangeId) {
            dirtyRef.current = false;
            setDirty(false);
            setStatus(savedTime(saved.savedAt));
          } else {
            queuedSaveRef.current = true;
            setStatus("변경됨 · 최신 내용을 이어서 저장합니다");
          }
        } while (queuedSaveRef.current && dirtyRef.current);
        return !dirtyRef.current;
      } catch {
        setStatus("저장 실패 · 다시 시도해 주세요");
        return false;
      } finally {
        savingRef.current = false;
        setPending(false);
      }
    })();
    savePromiseRef.current = cycle;
    void cycle.finally(() => {
      if (savePromiseRef.current === cycle) savePromiseRef.current = null;
    });
    return cycle;
  }, [editable, ready]);

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

  const updatePendingUploadCount = useCallback(
    (count: number, checked: boolean) => {
      pendingUploadCountRef.current = count;
      uploadReceiptCheckedRef.current = checked;
      setPendingUploadCount(count);
    },
    [],
  );

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (
        dirtyRef.current ||
        savingRef.current ||
        assetManifestPendingRef.current ||
        pendingUploadCountRef.current > 0
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, []);

  function showNavigationFailure(reason: string) {
    setNavigationReason(reason);
    const dialog = navigationDialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }

  async function requestNavigation(target: string) {
    if (movingRef.current) return;
    movingRef.current = true;
    setMoving(true);
    navigationTargetRef.current = target;

    const initialDraftSaved = await saveCurrent();
    const manifestSaved = initialDraftSaved && assetManifestFlushRef.current
      ? await assetManifestFlushRef.current()
      : initialDraftSaved;
    const saved = manifestSaved && await saveCurrent();
    const remainingUploads = pendingUploadCountRef.current;
    const receiptChecked = uploadReceiptCheckedRef.current;
    if (!saved || !receiptChecked || remainingUploads > 0) {
      showNavigationFailure(
        remainingUploads > 0
          ? `private 원본 접수가 끝나지 않은 이미지 ${remainingUploads}장이 남았습니다.`
          : !receiptChecked
          ? "private 원본 접수 상태를 아직 확인하지 못했습니다."
          : !manifestSaved
          ? "이미지 alt·순서를 저장하지 못했습니다."
          : "최신 초안 revision을 저장하지 못했습니다.",
      );
      movingRef.current = false;
      setMoving(false);
      return;
    }

    window.location.assign(target);
  }

  function handleNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    void requestNavigation(event.currentTarget.href);
  }

  async function copyCurrentChanges() {
    const current = draftRef.current;
    const copy = [
      `제목: ${current.title}`,
      `종류: ${current.kind}`,
      `주제: ${current.topics.join(", ")}`,
      "",
      current.body,
      pendingUploadCountRef.current > 0
        ? `\nprivate 접수 전 이미지: ${pendingUploadCountRef.current}장`
        : "",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(copy);
      setNavigationReason("변경 내용을 클립보드에 복사했습니다. 현재 화면은 유지됩니다.");
    } catch {
      setNavigationReason("변경 내용을 복사하지 못했습니다. 현재 화면의 입력은 유지됩니다.");
    }
  }

  function replaceBody(
    start: number,
    end: number,
    replacement: string,
    selectionStart: number,
    selectionEnd: number,
  ) {
    const textarea = bodyRef.current;
    if (!textarea || !ready || !editable) return;
    textarea.setRangeText(replacement, start, end, "end");
    editDraft((current) => ({ ...current, body: textarea.value }));
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  function formatInline(before: string, after: string, placeholder: string) {
    const textarea = bodyRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end) || placeholder;
    const replacement = `${before}${selected}${after}`;
    replaceBody(
      start,
      end,
      replacement,
      start + before.length,
      start + before.length + selected.length,
    );
  }

  function formatLink() {
    const textarea = bodyRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end) || "링크 텍스트";
    const replacement = `[${selected}](https://)`;
    const urlStart = start + selected.length + 3;
    replaceBody(start, end, replacement, urlStart, urlStart + 8);
  }

  function prefixLines(prefix: string) {
    const textarea = bodyRef.current;
    if (!textarea) return;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const start = textarea.value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const followingBreak = textarea.value.indexOf("\n", selectionEnd);
    const end = followingBreak < 0 ? textarea.value.length : followingBreak;
    const replacement = textarea.value
      .slice(start, end)
      .split("\n")
      .map((line) => `${prefix}${line}`)
      .join("\n");
    replaceBody(start, end, replacement, start, start + replacement.length);
  }

  const titleLength = characterCount(draft.title.trim());
  const bodyLength = characterCount(draft.body);
  const markdownIssue = validateStudioMarkdown(draft.body);
  const markdownIssuePosition = markdownIssue
    ? characterCount(draft.body.slice(0, markdownIssue.start)) + 1
    : null;
  const valid = isSaveable(draft);

  return (
    <>
      <nav className={styles.editorNavigation} aria-label="Studio 작업 이동">
        <div>
          <Link href="/studio?filter=working" onClick={handleNavigation}>
            작업 목록
          </Link>
          <Link href="/studio/media" onClick={handleNavigation}>
            Media
          </Link>
        </div>
        <span>{moving ? "저장 후 이동 중…" : "이동 전 최신 revision 확인"}</span>
      </nav>

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
              <h2 id="content-heading">게시글 편집기</h2>
            </div>
            <p>한국어 Markdown · 최대 2,000자</p>
          </div>

          {loadFailed ? (
            <button
              className={styles.retryButton}
              type="button"
              onClick={retryLoad}
            >
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
              disabled={!ready || !editable}
              aria-invalid={titleLength > 100}
              onChange={(event) =>
                editDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
            />
          </label>

          <div className={styles.field}>
            <label htmlFor="draft-body">
              본문 <small>{bodyLength}/2,000</small>
            </label>
            <div className={styles.markdownToolbar} role="toolbar" aria-label="Markdown 서식">
              <button type="button" disabled={!ready || !editable} onMouseDown={(event) => event.preventDefault()} onClick={() => formatInline("**", "**", "굵은 텍스트")}>굵게</button>
              <button type="button" disabled={!ready || !editable} onMouseDown={(event) => event.preventDefault()} onClick={() => formatInline("*", "*", "기울임 텍스트")}>기울임</button>
              <button type="button" disabled={!ready || !editable} onMouseDown={(event) => event.preventDefault()} onClick={() => formatInline("~~", "~~", "취소선 텍스트")}>취소선</button>
              <button type="button" disabled={!ready || !editable} onMouseDown={(event) => event.preventDefault()} onClick={() => formatInline("`", "`", "code")}>code</button>
              <button type="button" disabled={!ready || !editable} onMouseDown={(event) => event.preventDefault()} onClick={formatLink}>link</button>
              <button type="button" disabled={!ready || !editable} onMouseDown={(event) => event.preventDefault()} onClick={() => prefixLines("> ")}>인용</button>
              <button type="button" disabled={!ready || !editable} onMouseDown={(event) => event.preventDefault()} onClick={() => prefixLines("- ")}>목록</button>
            </div>
            <textarea
              ref={bodyRef}
              id="draft-body"
              key={ready ? "ready" : "loading"}
              name="body"
              defaultValue={draft.body}
              rows={12}
              required
              disabled={!ready || !editable}
              aria-invalid={bodyLength > 2_000 || Boolean(markdownIssue)}
              aria-describedby={markdownIssue ? "draft-body-markdown-error" : undefined}
              onChange={(event) =>
                editDraft((current) => ({
                  ...current,
                  body: event.target.value,
                }))
              }
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
            />
            {markdownIssue ? (
              <p id="draft-body-markdown-error" className={styles.markdownError} role="alert">
                {markdownIssuePosition}번째 글자 · {markdownIssue.message}
              </p>
            ) : null}
          </div>

          <TaxonomyControls
            kind={draft.kind}
            topics={draft.topics}
            disabled={!ready || !editable}
            onKindChange={(kind) =>
              editDraft((current) => ({ ...current, kind }))
            }
            onTopicsChange={(topics) =>
              editDraft((current) => ({ ...current, topics }))
            }
            onLabelsChange={updateTaxonomyLabels}
          />

          <div className={styles.saveBar}>
            <p
              className={conflict ? styles.conflictStatus : styles.saveStatus}
              role="status"
              aria-live="polite"
            >
              {status}
            </p>
            <button
              type="submit"
              disabled={
                !ready || !editable || !dirty || !valid || pending || conflict
              }
            >
              {pending ? "저장 중…" : "지금 저장"}
            </button>
          </div>
        </section>
        <SurfacePreview
          postId={draft.postId}
          title={draft.title}
          body={draft.body}
          kindLabel={taxonomyLabels.kind}
          topicLabels={taxonomyLabels.topics}
        />
        <ImageUploader
          key={draft.postId ?? "new"}
          postId={draft.postId}
          disabled={
            !ready || !editable || dirty || pending || composing || conflict
          }
          onPendingChange={updatePendingUploadCount}
          getRevision={getRevision}
          onRevisionChange={updateAssetRevision}
          onRevisionConflict={markAssetRevisionConflict}
          onManifestPendingChange={updateAssetManifestPending}
          onManifestSavingChange={updateAssetManifestSaving}
          onRegisterManifestFlush={registerAssetManifestFlush}
        />
        <DeliveryControls
          postId={draft.postId}
          disabled={
            !ready || !editable || dirty || pending || composing || conflict ||
            assetManifestPending
          }
        />
      </form>

      <dialog
        ref={navigationDialogRef}
        className={styles.navigationDialog}
        onCancel={() => setMoving(false)}
      >
        <h2>저장하지 못해 이동을 멈췄어요</h2>
        <p>{navigationReason}</p>
        {pendingUploadCount > 0 ? (
          <p>현재 화면에서 남은 원본을 접수한 뒤 다시 시도해 주세요.</p>
        ) : null}
        <div>
          <button
            type="button"
            onClick={() => {
              navigationDialogRef.current?.close();
              void requestNavigation(navigationTargetRef.current);
            }}
          >
            다시 저장
          </button>
          <button
            type="button"
            onClick={() => navigationDialogRef.current?.close()}
          >
            현재 화면 유지
          </button>
          <button type="button" onClick={() => void copyCurrentChanges()}>
            변경 내용 복사
          </button>
        </div>
      </dialog>
    </>
  );
}
