import handler from "vinext/server/app-router-entry";

import { verifyAccessRequest } from "./access";
import {
  handleDiscordInteraction,
  upsertDiscordRolePanel,
} from "./discord-interactions";
import { phaseAEnvironmentErrors, type PhaseAEnv } from "./phase-a-env";
import { handleStudioAssetRequest } from "./studio-assets";
import { handleStudioDraftRequest } from "./studio-drafts";
import { handleStudioPublishRequest } from "./studio-publishing";
import { handleStudioQueue } from "./studio-queue";

const INTERACTIONS_PATH = "/api/discord/interactions";
const DRAFTS_PATH = "/studio/api/drafts";
const ASSETS_PATH = "/studio/api/assets";
const PUBLISH_PATH = "/studio/api/publish";
const STUDIO_WRITE_HEADER = "x-studio-request";
type VinextContext = Parameters<typeof handler.fetch>[2];

function isStudioPath(pathname: string) {
  return pathname === "/studio" || pathname.startsWith("/studio/");
}

function unavailable() {
  return new Response("Studio is not configured", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function forbidden() {
  return new Response("Forbidden", {
    status: 403,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function isValidStudioWrite(request: Request, pathname: string) {
  const contentType = request.headers.get("content-type") ?? "";
  const validSourceUpload =
    pathname === ASSETS_PATH &&
    request.method === "POST" &&
    /^multipart\/form-data\s*;\s*boundary=/iu.test(contentType);
  return (
    request.headers.get("origin") === new URL(request.url).origin &&
    request.headers.get(STUDIO_WRITE_HEADER) === "1" &&
    (validSourceUpload ||
      contentType.split(";", 1)[0].toLowerCase() === "application/json")
  );
}

function privateResponse(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(
    request: Request,
    env: PhaseAEnv = {},
    context?: VinextContext,
  ) {
    const url = new URL(request.url);

    if (url.pathname === INTERACTIONS_PATH) {
      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { allow: "POST" },
        });
      }
      if (phaseAEnvironmentErrors(env).length > 0) return unavailable();
      return handleDiscordInteraction(request, env);
    }

    if (isStudioPath(url.pathname)) {
      if (phaseAEnvironmentErrors(env).length > 0) return unavailable();
      if (!(await verifyAccessRequest(request, env))) return forbidden();

      if (
        url.pathname.startsWith("/studio/api/") &&
        request.method !== "GET" &&
        request.method !== "HEAD" &&
        !isValidStudioWrite(request, url.pathname)
      ) {
        return forbidden();
      }

      if (url.pathname === "/studio/api/discord/role-panel") {
        if (request.method !== "POST") {
          return new Response("Method not allowed", {
            status: 405,
            headers: { allow: "POST" },
          });
        }
        return privateResponse(await upsertDiscordRolePanel(env));
      }

      if (url.pathname === DRAFTS_PATH) {
        return privateResponse(await handleStudioDraftRequest(request, env));
      }

      if (
        url.pathname === ASSETS_PATH ||
        url.pathname.startsWith(`${ASSETS_PATH}/`)
      ) {
        return privateResponse(await handleStudioAssetRequest(request, env));
      }

      if (url.pathname === PUBLISH_PATH) {
        return privateResponse(await handleStudioPublishRequest(request, env));
      }

      return privateResponse(
        await handler.fetch(request, env, context),
      );
    }

    return handler.fetch(request, env, context);
  },
  async queue(batch: Parameters<typeof handleStudioQueue>[0], env: PhaseAEnv = {}) {
    await handleStudioQueue(batch, env);
  },
};

export default worker;
