import type { DraftKind } from "../db/schema";
import type { StudioD1 } from "../worker/phase-a-env";

export const PUBLIC_FEED_PAGE_SIZE = 10;
export const PUBLIC_SITE_ORIGIN = "https://about.bluehair.blue";

const publicKinds = ["update", "work"] as const;
const publicSorts = ["newest", "oldest"] as const;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const snowflakePattern = /^\d{17,20}$/u;
const hashPattern = /^[0-9a-f]{64}$/u;

export type PublicSort = (typeof publicSorts)[number];

export type PublicFeedQuery = {
  kind: "all" | DraftKind;
  tag: string | null;
  sort: PublicSort;
  page: number;
};

export type PublicTopic = {
  key: string;
  label: string;
  active: boolean;
};

export type PublicAsset = {
  assetId: string;
  src: string;
  width: number;
  height: number;
  alt: string;
};

export type PublicPostSummary = {
  postId: string;
  slug: string;
  title: string;
  bodyMarkdown: string;
  description: string;
  kind: DraftKind;
  publishedAt: string;
  pinned: boolean;
  heroRank: number | null;
  topics: PublicTopic[];
  images: PublicAsset[];
  discordUrl: string | null;
};

export type PublicProjection = {
  query: PublicFeedQuery;
  topics: Array<{ key: string; label: string }>;
  posts: PublicPostSummary[];
  pinned: PublicPostSummary | null;
  hero: PublicPostSummary[];
  totalCount: number;
  pageCount: number;
  canonicalHref: string | null;
};

export type PublicCommunityThread = {
  postId: string;
  slug: string;
  title: string;
  discordUrl: string;
};

type SearchParams = Record<string, string | string[] | undefined>;

type TopicRow = {
  stable_key: string;
  label: string;
  status: "active" | "archived";
};

type AssetRow = {
  version_id: string;
  asset_id: string;
  ordinal: number;
  alt: string;
  public_width: number;
  public_height: number;
};

type PostRow = {
  post_id: string;
  version_id: string;
  slug: string;
  title: string;
  body_markdown: string;
  kind: DraftKind;
  published_at: string;
  pinned_at: string | null;
  hero_rank: number | null;
  discord_thread_id: string | null;
  discord_starter_message_id: string | null;
  discord_delivery_state: string | null;
  discord_remote_hash: string | null;
  discord_checked_at: string | null;
};

type DiscordMappingRow = Pick<
  PostRow,
  | "discord_thread_id"
  | "discord_starter_message_id"
  | "discord_delivery_state"
  | "discord_remote_hash"
  | "discord_checked_at"
>;

const publicPostSelect = `
  SELECT post.id AS post_id, version.id AS version_id, post.slug,
    version.title, version.body_markdown, version.kind,
    version.updated_at AS published_at, post.pinned_at, post.hero_rank,
    post.discord_thread_id, post.discord_starter_message_id,
    post.discord_delivery_state, post.discord_remote_hash,
    post.discord_checked_at
  FROM studio_posts AS post
  JOIN studio_post_versions AS version
    ON version.id = post.current_version_id AND version.post_id = post.id
`;

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}

function positivePage(value: string | null) {
  if (value === null || !/^[1-9]\d{0,8}$/u.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : 1;
}

function canonicalParams(query: PublicFeedQuery) {
  const params = new URLSearchParams();
  if (query.kind !== "all") params.set("kind", query.kind);
  if (query.tag !== null) params.set("tag", query.tag);
  if (query.sort !== "newest") params.set("sort", query.sort);
  if (query.page !== 1) params.set("page", String(query.page));
  return params;
}

function isCanonicalSearch(raw: SearchParams, params: URLSearchParams) {
  const keys = Object.keys(raw);
  const expected = Array.from(params.keys());
  return (
    keys.length === expected.length &&
    expected.every((key) => one(raw[key]) === params.get(key))
  );
}

function canonicalHref(query: PublicFeedQuery) {
  const search = canonicalParams(query).toString();
  return `/${search === "" ? "" : `?${search}`}#now`;
}

function normalizeQuery(
  raw: SearchParams,
  activeTopics: Set<string>,
): PublicFeedQuery {
  const kindValue = one(raw.kind);
  const tagValue = one(raw.tag);
  const sortValue = one(raw.sort);
  return {
    kind: publicKinds.includes(kindValue as DraftKind)
      ? (kindValue as DraftKind)
      : "all",
    tag: tagValue !== null && activeTopics.has(tagValue) ? tagValue : null,
    sort: publicSorts.includes(sortValue as PublicSort)
      ? (sortValue as PublicSort)
      : "newest",
    page: positivePage(one(raw.page)),
  };
}

function feedFilter(query: PublicFeedQuery) {
  const clauses = [
    "post.status = 'published'",
    "post.current_version_id = version.id",
    "version.state = 'published'",
  ];
  const values: unknown[] = [];
  if (query.kind !== "all") {
    clauses.push("version.kind = ?");
    values.push(query.kind);
  }
  if (query.tag !== null) {
    clauses.push(`EXISTS (
      SELECT 1
      FROM studio_post_version_topics AS selected_topic
      JOIN studio_taxonomy AS selected_taxonomy
        ON selected_taxonomy.id = selected_topic.taxonomy_id
      WHERE selected_topic.version_id = version.id
        AND selected_taxonomy.dimension = 'topic'
        AND selected_taxonomy.status = 'active'
        AND selected_taxonomy.stable_key = ?
    )`);
    values.push(query.tag);
  }
  return { sql: clauses.join(" AND "), values };
}

function results<T>(value: { results?: T[] }) {
  return value.results ?? [];
}

function publicAssetPath(assetId: string) {
  return `/media/${assetId}/portfolio-v1.webp`;
}

function activeDiscordUrl(
  mapping: DiscordMappingRow,
  discordGuildId?: string,
) {
  if (
    typeof discordGuildId !== "string" ||
    !snowflakePattern.test(discordGuildId) ||
    mapping.discord_delivery_state !== "delivered" ||
    mapping.discord_thread_id === null ||
    !snowflakePattern.test(mapping.discord_thread_id) ||
    mapping.discord_starter_message_id === null ||
    !snowflakePattern.test(mapping.discord_starter_message_id) ||
    mapping.discord_remote_hash === null ||
    !hashPattern.test(mapping.discord_remote_hash) ||
    mapping.discord_checked_at === null ||
    !Number.isFinite(Date.parse(mapping.discord_checked_at))
  ) return null;
  return `https://discord.com/channels/${discordGuildId}/${mapping.discord_thread_id}`;
}

export function publicPostPath(slug: string) {
  return `/updates/${encodeURIComponent(slug)}`;
}

export function markdownDescription(markdown: string, maximum = 160) {
  const plain = markdown
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/\[([^\]\n]+)\]\(https:\/\/[^)\s]+(?:\s+"[^"\n]*")?\)/gu, "$1")
    .replace(/(?:\*\*|__|~~|`|\*|_)/gu, "")
    .replace(/^(?:>|[-+*]|\d+\.)\s*/gmu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const characters = Array.from(plain);
  return characters.length <= maximum
    ? plain
    : `${characters.slice(0, maximum - 1).join("")}…`;
}

function validPublicSlug(slug: string) {
  const characters = Array.from(slug);
  return (
    characters.length >= 11 &&
    characters.length <= 120 &&
    slug === slug.normalize("NFC") &&
    !/[\u0000-\u001f\u007f/\\]/u.test(slug) &&
    /--[0-9a-f]{8}$/u.test(slug)
  );
}

async function hydratePosts(
  database: StudioD1,
  rows: PostRow[],
  discordGuildId?: string,
) {
  const versionIds = Array.from(new Set(rows.map(({ version_id }) => version_id)));
  const topicMap = new Map<string, PublicTopic[]>();
  const assetMap = new Map<string, PublicAsset[]>();

  if (versionIds.length > 0) {
    const placeholders = versionIds.map(() => "?").join(", ");
    const [topicResult, assetResult] = await Promise.all([
      database.prepare(`
        SELECT selected.version_id, taxonomy.stable_key, taxonomy.label,
          taxonomy.status
        FROM studio_post_version_topics AS selected
        JOIN studio_taxonomy AS taxonomy ON taxonomy.id = selected.taxonomy_id
        WHERE selected.version_id IN (${placeholders})
          AND taxonomy.dimension = 'topic'
        ORDER BY selected.version_id, taxonomy.ordinal, taxonomy.id
      `).bind(...versionIds).all<TopicRow & { version_id: string }>(),
      database.prepare(`
        SELECT selected.version_id, asset.id AS asset_id, selected.ordinal,
          selected.alt, asset.public_width, asset.public_height
        FROM studio_post_version_assets AS selected
        JOIN studio_assets AS asset ON asset.id = selected.asset_id
        WHERE selected.version_id IN (${placeholders})
          AND asset.status = 'ready'
          AND asset.public_bytes IS NOT NULL
          AND asset.public_sha256 IS NOT NULL
          AND asset.public_width IS NOT NULL
          AND asset.public_height IS NOT NULL
          AND asset.first_published_at IS NOT NULL
        ORDER BY selected.version_id, selected.ordinal, asset.id
      `).bind(...versionIds).all<AssetRow>(),
    ]);

    for (const row of results(topicResult)) {
      const topics = topicMap.get(row.version_id) ?? [];
      topics.push({
        key: row.stable_key,
        label: row.label,
        active: row.status === "active",
      });
      topicMap.set(row.version_id, topics);
    }
    for (const row of results(assetResult)) {
      const images = assetMap.get(row.version_id) ?? [];
      images.push({
        assetId: row.asset_id,
        src: publicAssetPath(row.asset_id),
        width: Number(row.public_width),
        height: Number(row.public_height),
        alt: row.alt,
      });
      assetMap.set(row.version_id, images);
    }
  }

  return rows.map<PublicPostSummary>((row) => {
    return {
      postId: row.post_id,
      slug: row.slug,
      title: row.title,
      bodyMarkdown: row.body_markdown,
      description: markdownDescription(row.body_markdown),
      kind: row.kind,
      publishedAt: row.published_at,
      pinned: row.pinned_at !== null,
      heroRank: row.hero_rank === null ? null : Number(row.hero_rank),
      topics: topicMap.get(row.version_id) ?? [],
      images: assetMap.get(row.version_id) ?? [],
      discordUrl: activeDiscordUrl(row, discordGuildId),
    };
  });
}

export async function loadPublicProjection(
  database: StudioD1 | undefined,
  raw: SearchParams,
  discordGuildId?: string,
): Promise<PublicProjection> {
  const topicRows = database
    ? results(await database.prepare(`
        SELECT stable_key, label, status
        FROM studio_taxonomy
        WHERE dimension = 'topic' AND status = 'active'
        ORDER BY ordinal, id
      `).all<TopicRow>())
    : [];
  const topics = topicRows.map(({ stable_key, label }) => ({
    key: stable_key,
    label,
  }));
  const activeTopics = new Set(topics.map(({ key }) => key));
  let query = normalizeQuery(raw, activeTopics);

  if (!database) {
    const params = canonicalParams(query);
    return {
      query,
      topics,
      posts: [],
      pinned: null,
      hero: [],
      totalCount: 0,
      pageCount: 1,
      canonicalHref: isCanonicalSearch(raw, params) ? null : canonicalHref(query),
    };
  }

  const filter = feedFilter(query);
  const countRow = await database.prepare(`
    SELECT count(*) AS count
    FROM studio_posts AS post
    JOIN studio_post_versions AS version
      ON version.id = post.current_version_id AND version.post_id = post.id
    WHERE ${filter.sql} AND post.pinned_at IS NULL
  `).bind(...filter.values).first<{ count: number }>();
  const totalCount = Number(countRow?.count ?? 0);
  const pageCount = Math.max(1, Math.ceil(totalCount / PUBLIC_FEED_PAGE_SIZE));
  if (query.page > pageCount) query = { ...query, page: pageCount };

  const order = query.sort === "oldest"
    ? "version.updated_at ASC, post.id ASC"
    : "version.updated_at DESC, post.id DESC";
  const offset = (query.page - 1) * PUBLIC_FEED_PAGE_SIZE;
  const [postResult, pinResult, heroResult] = await Promise.all([
    database.prepare(`${publicPostSelect}
      WHERE ${filter.sql} AND post.pinned_at IS NULL
      ORDER BY ${order}
      LIMIT ? OFFSET ?
    `).bind(...filter.values, PUBLIC_FEED_PAGE_SIZE, offset).all<PostRow>(),
    query.page === 1
      ? database.prepare(`${publicPostSelect}
          WHERE ${filter.sql} AND post.pinned_at IS NOT NULL
          ORDER BY post.pinned_at DESC, post.id
          LIMIT 1
        `).bind(...filter.values).all<PostRow>()
      : Promise.resolve({ results: [] as PostRow[] }),
    database.prepare(`${publicPostSelect}
      WHERE post.status = 'published'
        AND post.current_version_id = version.id
        AND version.state = 'published'
        AND post.hero_rank IS NOT NULL
      ORDER BY post.hero_rank ASC, post.id ASC
    `).all<PostRow>(),
  ]);
  const postRows = results(postResult);
  const pinRows = results(pinResult);
  const heroRows = results(heroResult);
  const hydrated = await hydratePosts(
    database,
    Array.from(
      new Map(
        [...postRows, ...pinRows, ...heroRows].map((row) => [row.post_id, row]),
      ).values(),
    ),
    discordGuildId,
  );
  const byId = new Map(hydrated.map((post) => [post.postId, post]));
  const params = canonicalParams(query);
  return {
    query,
    topics,
    posts: postRows.map(({ post_id }) => byId.get(post_id)!),
    pinned: pinRows.length === 0 ? null : byId.get(pinRows[0].post_id) ?? null,
    hero: heroRows.map(({ post_id }) => byId.get(post_id)!),
    totalCount,
    pageCount,
    canonicalHref: isCanonicalSearch(raw, params) ? null : canonicalHref(query),
  };
}

export async function loadPublicPost(
  database: StudioD1 | undefined,
  slug: string,
  discordGuildId?: string,
) {
  if (!database || !validPublicSlug(slug)) return null;
  const row = await database.prepare(`${publicPostSelect}
    WHERE post.slug = ?
      AND post.status = 'published'
      AND post.current_version_id = version.id
      AND version.state = 'published'
    LIMIT 1
  `).bind(slug).first<PostRow>();
  if (!row) return null;
  return (await hydratePosts(database, [row], discordGuildId))[0] ?? null;
}

export async function publicPostRouteState(
  database: StudioD1 | undefined,
  slug: string,
): Promise<"published" | "hidden" | "gone"> {
  if (!database || !validPublicSlug(slug)) return "hidden";
  const row = await database.prepare(`
    SELECT post.status,
      CASE WHEN version.id IS NOT NULL AND version.state = 'published'
        THEN 1 ELSE 0 END AS valid_current
    FROM studio_posts AS post
    LEFT JOIN studio_post_versions AS version
      ON version.id = post.current_version_id AND version.post_id = post.id
    WHERE post.slug = ?
    LIMIT 1
  `).bind(slug).first<{ status: string; valid_current: number }>();
  if (row?.status === "purged") return "gone";
  return row?.status === "published" && Number(row.valid_current) === 1
    ? "published"
    : "hidden";
}

export async function loadPublicCommunityThreads(
  database: StudioD1 | undefined,
  discordGuildId?: string,
): Promise<PublicCommunityThread[]> {
  if (
    !database ||
    typeof discordGuildId !== "string" ||
    !snowflakePattern.test(discordGuildId)
  ) return [];
  const rows = results(await database.prepare(`
    SELECT post.id AS post_id, post.slug, version.title,
      post.discord_thread_id, post.discord_starter_message_id,
      post.discord_delivery_state, post.discord_remote_hash,
      post.discord_checked_at
    FROM studio_posts AS post
    JOIN studio_post_versions AS version
      ON version.id = post.current_version_id AND version.post_id = post.id
    WHERE post.status = 'published'
      AND version.state = 'published'
      AND post.discord_delivery_state = 'delivered'
      AND post.discord_thread_id IS NOT NULL
      AND post.discord_starter_message_id IS NOT NULL
      AND post.discord_remote_hash IS NOT NULL
      AND post.discord_checked_at IS NOT NULL
    ORDER BY version.updated_at DESC, post.id DESC
  `).all<{
    post_id: string;
    slug: string;
    title: string;
  } & DiscordMappingRow>());
  return rows
    .map((row) => ({ row, discordUrl: activeDiscordUrl(row, discordGuildId) }))
    .filter(
      (entry): entry is typeof entry & { discordUrl: string } =>
        entry.discordUrl !== null,
    )
    .map(({ row, discordUrl }) => ({
      postId: row.post_id,
      slug: row.slug,
      title: row.title,
      discordUrl,
    }));
}

export async function findPublicAsset(
  database: StudioD1 | undefined,
  assetId: string,
) {
  if (!database || !uuidPattern.test(assetId)) return null;
  return database.prepare(`
    SELECT asset.public_r2_key, asset.public_bytes, asset.public_sha256
    FROM studio_assets AS asset
    JOIN studio_post_version_assets AS selected ON selected.asset_id = asset.id
    JOIN studio_post_versions AS version ON version.id = selected.version_id
    JOIN studio_posts AS post
      ON post.current_version_id = version.id AND post.id = version.post_id
    WHERE asset.id = ?
      AND asset.status = 'ready'
      AND asset.public_r2_key IS NOT NULL
      AND asset.public_bytes IS NOT NULL
      AND asset.public_sha256 IS NOT NULL
      AND asset.first_published_at IS NOT NULL
      AND post.status = 'published'
      AND version.state = 'published'
    LIMIT 1
  `).bind(assetId).first<{
    public_r2_key: string;
    public_bytes: number;
    public_sha256: string;
  }>();
}
