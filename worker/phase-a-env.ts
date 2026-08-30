export interface StudioD1Result<T = Record<string, unknown>> {
  meta?: { changes?: number };
  results?: T[];
}

export interface StudioD1Statement {
  bind(...values: unknown[]): StudioD1Statement;
  run<T = Record<string, unknown>>(): Promise<StudioD1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<StudioD1Result<T>>;
}

export interface StudioD1 {
  prepare(query: string): StudioD1Statement;
  batch(statements: StudioD1Statement[]): Promise<StudioD1Result[]>;
}

export interface StudioR2Object {
  key: string;
  size: number;
}

export interface StudioR2ObjectBody extends StudioR2Object {
  body: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface StudioR2 {
  get(key: string): Promise<StudioR2ObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer | Blob | ReadableStream<Uint8Array>,
    options?: {
      onlyIf?: Headers;
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
      sha256?: ArrayBuffer | string;
    },
  ): Promise<StudioR2Object | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<unknown>;
}

export interface StudioImageInfo {
  format: string;
  fileSize?: number;
  width: number;
  height: number;
}

export interface StudioImages {
  info(stream: ReadableStream<Uint8Array>): Promise<StudioImageInfo>;
  input(stream: ReadableStream<Uint8Array>): {
    transform(options: {
      width: number;
      height: number;
      fit: "scale-down";
    }): {
      output(options: {
        format: "image/webp";
        quality: number;
      }): Promise<{ response(): Response }>;
    };
  };
}

export type StudioQueueBody =
  | { type: "asset_process"; jobId: string; assetId: string }
  | { type: "discord_delivery"; jobId: string }
  | { type: "taxonomy_sync"; jobId: string };

export interface StudioQueueProducer {
  send(
    body: StudioQueueBody,
    options?: { contentType?: "json"; delaySeconds?: number },
  ): Promise<void>;
}

export interface StudioQueueMessage {
  body: unknown;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface StudioQueueBatch {
  messages: StudioQueueMessage[];
}

export interface PhaseAEnv {
  ASSETS?: {
    fetch(request: Request): Promise<Response> | Response;
  };
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  STUDIO_ADMIN_EMAIL?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_APPLICATION_ID?: string;
  DISCORD_APPLICATION_PUBLIC_KEY?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_START_CHANNEL_ID?: string;
  DISCORD_ROLE_PANEL_MESSAGE_ID?: string;
  DISCORD_FORUM_CHANNEL_ID?: string;
  DISCORD_ANNOUNCEMENTS_CHANNEL_ID?: string;
  DISCORD_NOTIFY_ROLE_ID?: string;
  STUDIO_DB?: StudioD1;
  STUDIO_MEDIA?: StudioR2;
  IMAGES?: StudioImages;
  PUBLISH_QUEUE?: StudioQueueProducer;
}

const requiredText = [
  "CF_ACCESS_TEAM_DOMAIN",
  "CF_ACCESS_AUD",
  "STUDIO_ADMIN_EMAIL",
  "DISCORD_BOT_TOKEN",
  "DISCORD_APPLICATION_ID",
  "DISCORD_APPLICATION_PUBLIC_KEY",
  "DISCORD_GUILD_ID",
  "DISCORD_START_CHANNEL_ID",
  "DISCORD_ROLE_PANEL_MESSAGE_ID",
  "DISCORD_FORUM_CHANNEL_ID",
  "DISCORD_ANNOUNCEMENTS_CHANNEL_ID",
  "DISCORD_NOTIFY_ROLE_ID",
] as const;

const discordIds = [
  "DISCORD_APPLICATION_ID",
  "DISCORD_GUILD_ID",
  "DISCORD_START_CHANNEL_ID",
  "DISCORD_ROLE_PANEL_MESSAGE_ID",
  "DISCORD_FORUM_CHANNEL_ID",
  "DISCORD_ANNOUNCEMENTS_CHANNEL_ID",
  "DISCORD_NOTIFY_ROLE_ID",
] as const;

function hasMethods(value: unknown, methods: string[]) {
  if (typeof value !== "object" || value === null) return false;
  const binding = value as Record<string, unknown>;
  return methods.every((method) => typeof binding[method] === "function");
}

function isCloudflareTeamDomain(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(".cloudflareaccess.com") &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function phaseAEnvironmentErrors(env: PhaseAEnv) {
  const errors: string[] = [];

  for (const name of requiredText) {
    if (typeof env[name] !== "string" || env[name].trim() === "") {
      errors.push(`Missing ${name}`);
    }
  }

  for (const name of discordIds) {
    const value = env[name];
    if (typeof value === "string" && !/^\d{17,20}$/.test(value)) {
      errors.push(`Invalid ${name}`);
    }
  }

  if (
    typeof env.CF_ACCESS_TEAM_DOMAIN === "string" &&
    !isCloudflareTeamDomain(env.CF_ACCESS_TEAM_DOMAIN)
  ) {
    errors.push("Invalid CF_ACCESS_TEAM_DOMAIN");
  }

  if (
    typeof env.DISCORD_APPLICATION_PUBLIC_KEY === "string" &&
    !/^[0-9a-f]{64}$/i.test(env.DISCORD_APPLICATION_PUBLIC_KEY)
  ) {
    errors.push("Invalid DISCORD_APPLICATION_PUBLIC_KEY");
  }

  const targetIds = discordIds
    .map((name) => env[name])
    .filter((value): value is string => typeof value === "string");
  if (new Set(targetIds).size !== targetIds.length) {
    errors.push("Discord IDs must be unique");
  }

  if (!hasMethods(env.STUDIO_DB, ["prepare", "batch"])) {
    errors.push("Missing STUDIO_DB binding");
  }
  if (!hasMethods(env.STUDIO_MEDIA, ["get", "put", "delete", "list"])) {
    errors.push("Missing STUDIO_MEDIA binding");
  }
  if (!hasMethods(env.IMAGES, ["info", "input"])) {
    errors.push("Missing IMAGES binding");
  }
  if (!hasMethods(env.PUBLISH_QUEUE, ["send"])) {
    errors.push("Missing PUBLISH_QUEUE binding");
  }

  return errors;
}
