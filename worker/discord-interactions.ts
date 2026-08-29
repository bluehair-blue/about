import type { PhaseAEnv } from "./phase-a-env";

const MAX_BODY_BYTES = 1_048_576;
const MAX_TIMESTAMP_SKEW_SECONDS = 300;
const DISCORD_API = "https://discord.com/api/v10";

const roleActions = {
  "notify-role:all:add:v1": {
    method: "PUT",
    message: "알림을 켰어요.",
  },
  "notify-role:all:remove:v1": {
    method: "DELETE",
    message: "알림을 껐어요.",
  },
} as const;

type DiscordEnv = Pick<
  PhaseAEnv,
  | "DISCORD_APPLICATION_ID"
  | "DISCORD_APPLICATION_PUBLIC_KEY"
  | "DISCORD_BOT_TOKEN"
  | "DISCORD_GUILD_ID"
  | "DISCORD_START_CHANNEL_ID"
  | "DISCORD_ROLE_PANEL_MESSAGE_ID"
  | "DISCORD_NOTIFY_ROLE_ID"
>;

const rolePanel = {
  content: "Studio 새 글 알림을 받으려면 아래 버튼을 사용하세요.",
  components: [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: "알림 받기",
          custom_id: "notify-role:all:add:v1",
        },
        {
          type: 2,
          style: 2,
          label: "알림 끄기",
          custom_id: "notify-role:all:remove:v1",
        },
      ],
    },
  ],
  allowed_mentions: { parse: [] },
};

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function unauthorized() {
  return new Response("Invalid interaction", {
    status: 401,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function upsertDiscordRolePanel(env: DiscordEnv) {
  const headers = {
    authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    "content-type": "application/json",
  };
  const messageUrl = `${DISCORD_API}/channels/${env.DISCORD_START_CHANNEL_ID}/messages/${env.DISCORD_ROLE_PANEL_MESSAGE_ID}`;
  let created = false;

  try {
    let response = await fetch(messageUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify(rolePanel),
      signal: AbortSignal.timeout(5_000),
    });

    if (response.status === 404) {
      created = true;
      response = await fetch(
        `${DISCORD_API}/channels/${env.DISCORD_START_CHANNEL_ID}/messages`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(rolePanel),
          signal: AbortSignal.timeout(5_000),
        },
      );
    }

    if (!response.ok) throw new Error("Discord rejected the role panel");
    const message = (await response.json()) as unknown;
    if (
      !isRecord(message) ||
      typeof message.id !== "string" ||
      !/^\d{17,20}$/.test(message.id) ||
      message.channel_id !== env.DISCORD_START_CHANNEL_ID
    ) {
      throw new Error("Discord returned an invalid role panel");
    }

    return json(
      {
        messageId: message.id,
        channelId: message.channel_id,
        created,
      },
      created ? 201 : 200,
    );
  } catch {
    return json({ error: "Discord role panel write failed" }, 502);
  }
}

function fromHex(value: string) {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    throw new Error("Invalid hex");
  }
  return Uint8Array.from(
    value.match(/.{2}/g) ?? [],
    (byte) => Number.parseInt(byte, 16),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getRecord(value: unknown, key: string) {
  if (!isRecord(value)) return null;
  const child = value[key];
  return isRecord(child) ? child : null;
}

function ephemeral(content: string) {
  return json({
    type: 4,
    data: {
      content,
      flags: 64,
      allowed_mentions: { parse: [] },
    },
  });
}

async function verifyRequest(request: Request, publicKey: string) {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (
    !signature ||
    !timestamp ||
    contentType?.toLowerCase() !== "application/json" ||
    (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) ||
    !/^\d+$/.test(timestamp)
  ) {
    return null;
  }

  const timestampSeconds = Number(timestamp);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) >
      MAX_TIMESTAMP_SKEW_SECONDS
  ) {
    return null;
  }

  try {
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength > MAX_BODY_BYTES) return null;

    const timestampBytes = new TextEncoder().encode(timestamp);
    const signed = new Uint8Array(timestampBytes.length + body.length);
    signed.set(timestampBytes);
    signed.set(body, timestampBytes.length);

    const key = await crypto.subtle.importKey(
      "raw",
      fromHex(publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "Ed25519",
      key,
      fromHex(signature),
      signed,
    );
    if (!valid) return null;

    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    ) as unknown;
  } catch {
    return null;
  }
}

export async function handleDiscordInteraction(
  request: Request,
  env: DiscordEnv,
) {
  if (!env.DISCORD_APPLICATION_PUBLIC_KEY) return unauthorized();
  const payload = await verifyRequest(
    request,
    env.DISCORD_APPLICATION_PUBLIC_KEY,
  );
  if (
    !isRecord(payload) ||
    payload.application_id !== env.DISCORD_APPLICATION_ID
  ) {
    return unauthorized();
  }

  if (payload.type === 1) return json({ type: 1 });
  if (payload.type !== 3) return unauthorized();

  const data = getRecord(payload, "data");
  const message = getRecord(payload, "message");
  const member = getRecord(payload, "member");
  const user = getRecord(member, "user");
  const customId = data?.custom_id;
  const action =
    typeof customId === "string" && customId in roleActions
      ? roleActions[customId as keyof typeof roleActions]
      : null;
  const userId = user?.id;

  if (
    !action ||
    data?.component_type !== 2 ||
    payload.guild_id !== env.DISCORD_GUILD_ID ||
    payload.channel_id !== env.DISCORD_START_CHANNEL_ID ||
    message?.id !== env.DISCORD_ROLE_PANEL_MESSAGE_ID ||
    typeof userId !== "string" ||
    !/^\d{17,20}$/.test(userId) ||
    !env.DISCORD_BOT_TOKEN ||
    !env.DISCORD_NOTIFY_ROLE_ID
  ) {
    return unauthorized();
  }

  try {
    const response = await fetch(
      `${DISCORD_API}/guilds/${env.DISCORD_GUILD_ID}/members/${userId}/roles/${env.DISCORD_NOTIFY_ROLE_ID}`,
      {
        method: action.method,
        headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
        signal: AbortSignal.timeout(2_000),
      },
    );
    if (response.status === 204) return ephemeral(action.message);
  } catch {
    // Unknown role-write results are reported without guessing success.
  }

  return ephemeral(
    "처리 상태를 확인하지 못했어요. 같은 버튼을 다시 눌러주세요.",
  );
}
