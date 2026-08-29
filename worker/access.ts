import type { PhaseAEnv } from "./phase-a-env";

type AccessEnv = Pick<
  PhaseAEnv,
  "CF_ACCESS_TEAM_DOMAIN" | "CF_ACCESS_AUD" | "STUDIO_ADMIN_EMAIL"
>;

type JwtHeader = {
  alg?: unknown;
  kid?: unknown;
};

type JwtPayload = {
  aud?: unknown;
  email?: unknown;
  exp?: unknown;
  iss?: unknown;
  nbf?: unknown;
};

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function decodeJson<T>(value: string) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    decodeBase64Url(value),
  );
  return JSON.parse(text) as T;
}

function normalizeTeamDomain(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".cloudflareaccess.com") ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function hasAudience(claim: unknown, expected: string) {
  return claim === expected ||
    (Array.isArray(claim) && claim.some((value) => value === expected));
}

export async function verifyAccessRequest(request: Request, env: AccessEnv) {
  const token = request.headers.get("cf-access-jwt-assertion");
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN
    ? normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN)
    : null;

  if (
    !token ||
    token.length > 16_384 ||
    !teamDomain ||
    !env.CF_ACCESS_AUD ||
    !env.STUDIO_ADMIN_EMAIL
  ) {
    return false;
  }

  try {
    const [encodedHeader, encodedPayload, encodedSignature, extra] =
      token.split(".");
    if (!encodedHeader || !encodedPayload || !encodedSignature || extra) {
      return false;
    }

    const header = decodeJson<JwtHeader>(encodedHeader);
    const payload = decodeJson<JwtPayload>(encodedPayload);
    if (header.alg !== "RS256" || typeof header.kid !== "string") return false;

    const now = Math.floor(Date.now() / 1000);
    if (
      payload.iss !== teamDomain ||
      !hasAudience(payload.aud, env.CF_ACCESS_AUD) ||
      typeof payload.email !== "string" ||
      payload.email.toLowerCase() !== env.STUDIO_ADMIN_EMAIL.toLowerCase() ||
      typeof payload.exp !== "number" ||
      payload.exp <= now ||
      (payload.nbf !== undefined &&
        (typeof payload.nbf !== "number" || payload.nbf > now))
    ) {
      return false;
    }

    const certs = await fetch(`${teamDomain}/cdn-cgi/access/certs`, {
      headers: { accept: "application/json" },
      redirect: "manual",
    });
    if (!certs.ok) return false;

    const jwks = (await certs.json()) as { keys?: unknown };
    if (!Array.isArray(jwks.keys)) return false;
    const jwk = jwks.keys.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as Record<string, unknown>).kid === header.kid &&
        (candidate as Record<string, unknown>).kty === "RSA" &&
        (candidate as Record<string, unknown>).alg === "RS256" &&
        (candidate as Record<string, unknown>).use === "sig",
    );
    if (!jwk) return false;

    const key = await crypto.subtle.importKey(
      "jwk",
      jwk as JsonWebKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64Url(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
  } catch {
    return false;
  }
}
