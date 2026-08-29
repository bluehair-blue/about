import {
  draftKinds,
  draftSchemaVersion,
  draftTopics,
  type DraftKind,
  type DraftTopic,
} from "../db/schema";
import type { PhaseAEnv, StudioD1 } from "./phase-a-env";

const MAX_REQUEST_BYTES = 16_384;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Draft = {
  postId: string | null;
  revision: number;
  title: string;
  body: string;
  kind: DraftKind;
  topics: DraftTopic[];
};

type DraftRow = {
  post_id: string;
  version_id: string;
  revision: number;
  title: string;
  body_markdown: string;
  kind: DraftKind;
  updated_at: string;
};

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function methodNotAllowed() {
  return new Response("Method not allowed", {
    status: 405,
    headers: { allow: "GET, POST" },
  });
}

function codePointLength(value: string) {
  return Array.from(value).length;
}

function markdownError(body: string) {
  if (/\u0000|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body)) {
    return "body_control_character";
  }
  if (/<\/?[A-Za-z][^>]*>/u.test(body)) return "body_raw_html";
  if (/!\[[^\]\n]*\]\([^\n)]*\)/u.test(body)) return "body_inline_image";
  if (/<(?:@!?|@&|#|t:|a?:)[^>\n]+>|@(everyone|here)\b/iu.test(body)) {
    return "body_discord_syntax";
  }
  if (/^#{1,6}\s/mu.test(body) || /\|\|/u.test(body)) {
    return "body_unsupported_markdown";
  }

  for (const match of body.matchAll(/\[[^\]\n]+\]\(([^)\s]+)(?:\s+"[^"\n]*")?\)/gu)) {
    try {
      const url = new URL(match[1]);
      if (url.protocol !== "https:" || url.username || url.password) {
        return "body_unsafe_link";
      }
    } catch {
      return "body_invalid_link";
    }
  }

  for (const match of body.matchAll(/\b([A-Za-z][A-Za-z0-9+.-]*):\/\//gu)) {
    if (match[1].toLowerCase() !== "https") return "body_unsafe_link";
  }

  return null;
}

function parseDraft(value: unknown): Draft | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "invalid_json_object";
  }

  const input = value as Record<string, unknown>;
  const postId = input.postId === null || input.postId === undefined
    ? null
    : input.postId;
  if (postId !== null && (typeof postId !== "string" || !uuidPattern.test(postId))) {
    return "invalid_post_id";
  }
  if (
    typeof input.revision !== "number" ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0
  ) {
    return "invalid_revision";
  }
  if ((postId === null && input.revision !== 0) || (postId !== null && input.revision < 1)) {
    return "invalid_revision";
  }
  if (typeof input.title !== "string") return "invalid_title";
  const title = input.title.normalize("NFC").trim();
  if (codePointLength(title) < 1 || codePointLength(title) > 100) {
    return "invalid_title";
  }
  if (typeof input.body !== "string") return "invalid_body";
  const body = input.body.normalize("NFC").replace(/\r\n?/gu, "\n");
  if (body.trim() === "" || codePointLength(body) > 2_000) {
    return "invalid_body";
  }
  const invalidMarkdown = markdownError(body);
  if (invalidMarkdown) return invalidMarkdown;
  if (typeof input.kind !== "string" || !draftKinds.includes(input.kind as DraftKind)) {
    return "invalid_kind";
  }
  if (!Array.isArray(input.topics) || input.topics.length > 4) {
    return "invalid_topics";
  }
  const suppliedTopics = input.topics;
  if (
    suppliedTopics.some(
      (topic) => typeof topic !== "string" || !draftTopics.includes(topic as DraftTopic),
    ) ||
    new Set(suppliedTopics).size !== suppliedTopics.length
  ) {
    return "invalid_topics";
  }

  return {
    postId,
    revision: input.revision,
    title,
    body,
    kind: input.kind as DraftKind,
    topics: draftTopics.filter((topic) => suppliedTopics.includes(topic)),
  };
}

async function hashDraft(draft: Draft) {
  const source = JSON.stringify({
    title: draft.title,
    body: draft.body,
    kind: draft.kind,
    topics: draft.topics,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function topicInsert(
  database: StudioD1,
  versionId: string,
  topic: DraftTopic,
  condition?: { postId: string; revision: number },
) {
  if (!condition) {
    return database.prepare(`
      INSERT INTO studio_post_version_topics (version_id, taxonomy_id)
      SELECT ?, id
      FROM studio_taxonomy
      WHERE dimension = 'topic' AND stable_key = ? AND status = 'active'
    `).bind(versionId, topic);
  }

  return database.prepare(`
    INSERT INTO studio_post_version_topics (version_id, taxonomy_id)
    SELECT ?, taxonomy.id
    FROM studio_taxonomy AS taxonomy
    WHERE taxonomy.dimension = 'topic'
      AND taxonomy.stable_key = ?
      AND taxonomy.status = 'active'
      AND EXISTS (
        SELECT 1
        FROM studio_post_versions AS version
        WHERE version.id = ?
          AND version.post_id = ?
          AND version.state = 'draft'
          AND version.revision = ?
      )
  `).bind(
    versionId,
    topic,
    versionId,
    condition.postId,
    condition.revision,
  );
}

async function createDraft(database: StudioD1, draft: Draft) {
  const postId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const savedAt = new Date().toISOString();
  const sourceHash = await hashDraft(draft);

  await database.batch([
    database.prepare(`
      INSERT INTO studio_posts (id, status, created_at, updated_at)
      VALUES (?, 'draft', ?, ?)
    `).bind(postId, savedAt, savedAt),
    database.prepare(`
      INSERT INTO studio_post_versions (
        id, post_id, state, revision, source_hash, title, body_markdown,
        kind, locale, created_at, updated_at, schema_version
      ) VALUES (?, ?, 'draft', 1, ?, ?, ?, ?, 'ko', ?, ?, ?)
    `).bind(
      versionId,
      postId,
      sourceHash,
      draft.title,
      draft.body,
      draft.kind,
      savedAt,
      savedAt,
      draftSchemaVersion,
    ),
    ...draft.topics.map((topic) => topicInsert(database, versionId, topic)),
    database.prepare(`
      UPDATE studio_posts
      SET draft_version_id = ?
      WHERE id = ? AND draft_version_id IS NULL
    `).bind(versionId, postId),
  ]);

  return json({ postId, versionId, revision: 1, savedAt }, 201);
}

async function updateDraft(database: StudioD1, draft: Draft) {
  const pointer = await database.prepare(`
    SELECT draft_version_id
    FROM studio_posts
    WHERE id = ? AND status = 'draft'
  `).bind(draft.postId).first<{ draft_version_id: string }>();
  if (!pointer) return json({ error: "draft_not_found" }, 404);

  const versionId = pointer.draft_version_id;
  const savedAt = new Date().toISOString();
  const sourceHash = await hashDraft(draft);
  const statements = [
    database.prepare(`
      DELETE FROM studio_post_version_topics
      WHERE version_id = ?
        AND EXISTS (
          SELECT 1
          FROM studio_post_versions
          WHERE id = ? AND post_id = ? AND state = 'draft' AND revision = ?
        )
    `).bind(versionId, versionId, draft.postId, draft.revision),
    ...draft.topics.map((topic) =>
      topicInsert(database, versionId, topic, {
        postId: draft.postId as string,
        revision: draft.revision,
      })
    ),
    database.prepare(`
      UPDATE studio_posts
      SET updated_at = ?
      WHERE id = ?
        AND draft_version_id = ?
        AND EXISTS (
          SELECT 1
          FROM studio_post_versions
          WHERE id = ? AND post_id = ? AND state = 'draft' AND revision = ?
        )
    `).bind(
      savedAt,
      draft.postId,
      versionId,
      versionId,
      draft.postId,
      draft.revision,
    ),
  ];
  const updateIndex = statements.length;
  statements.push(
    database.prepare(`
      UPDATE studio_post_versions
      SET revision = revision + 1,
        source_hash = ?,
        title = ?,
        body_markdown = ?,
        kind = ?,
        updated_at = ?,
        schema_version = ?
      WHERE id = ? AND post_id = ? AND state = 'draft' AND revision = ?
    `).bind(
      sourceHash,
      draft.title,
      draft.body,
      draft.kind,
      savedAt,
      draftSchemaVersion,
      versionId,
      draft.postId,
      draft.revision,
    ),
  );

  const results = await database.batch(statements);
  if (results[updateIndex]?.meta?.changes !== 1) {
    const current = await database.prepare(`
      SELECT revision
      FROM studio_post_versions
      WHERE id = ? AND post_id = ? AND state = 'draft'
    `).bind(versionId, draft.postId).first<{ revision: number }>();
    return json(
      { error: "revision_conflict", currentRevision: current?.revision ?? null },
      409,
    );
  }

  return json({
    postId: draft.postId,
    versionId,
    revision: draft.revision + 1,
    savedAt,
  });
}

async function readDraft(request: Request, database: StudioD1) {
  const requestedPostId = new URL(request.url).searchParams.get("postId");
  if (requestedPostId !== null && !uuidPattern.test(requestedPostId)) {
    return json({ error: "invalid_post_id" }, 400);
  }

  const row = requestedPostId
    ? await database.prepare(`
        SELECT post.id AS post_id, version.id AS version_id, version.revision,
          version.title, version.body_markdown, version.kind, version.updated_at
        FROM studio_posts AS post
        JOIN studio_post_versions AS version ON version.id = post.draft_version_id
        WHERE post.id = ? AND post.status = 'draft' AND version.state = 'draft'
      `).bind(requestedPostId).first<DraftRow>()
    : await database.prepare(`
        SELECT post.id AS post_id, version.id AS version_id, version.revision,
          version.title, version.body_markdown, version.kind, version.updated_at
        FROM studio_posts AS post
        JOIN studio_post_versions AS version ON version.id = post.draft_version_id
        WHERE post.status = 'draft' AND version.state = 'draft'
        ORDER BY post.updated_at DESC, post.id ASC
        LIMIT 1
      `).first<DraftRow>();
  if (!row) return new Response(null, { status: 204 });

  const topicRows = await database.prepare(`
    SELECT taxonomy.stable_key
    FROM studio_post_version_topics AS selected
    JOIN studio_taxonomy AS taxonomy ON taxonomy.id = selected.taxonomy_id
    WHERE selected.version_id = ? AND taxonomy.dimension = 'topic'
    ORDER BY taxonomy.ordinal ASC
  `).bind(row.version_id).all<{ stable_key: DraftTopic }>();

  return json({
    postId: row.post_id,
    versionId: row.version_id,
    revision: row.revision,
    title: row.title,
    body: row.body_markdown,
    kind: row.kind,
    topics: (topicRows.results ?? []).map(({ stable_key }) => stable_key),
    savedAt: row.updated_at,
  });
}

async function saveDraft(request: Request, database: StudioD1) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return json({ error: "request_too_large" }, 413);
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
    return json({ error: "request_too_large" }, 413);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const draft = parseDraft(decoded);
  if (typeof draft === "string") return json({ error: draft }, 400);

  return draft.postId
    ? updateDraft(database, draft)
    : createDraft(database, draft);
}

export async function handleStudioDraftRequest(
  request: Request,
  env: PhaseAEnv,
) {
  const database = env.STUDIO_DB;
  if (!database) return json({ error: "draft_storage_unavailable" }, 503);

  try {
    if (request.method === "GET") return readDraft(request, database);
    if (request.method === "POST") return saveDraft(request, database);
    return methodNotAllowed();
  } catch {
    return json({ error: "draft_storage_unavailable" }, 503);
  }
}
