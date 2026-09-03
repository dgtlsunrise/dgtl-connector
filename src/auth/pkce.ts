import { createHash, randomBytes } from "node:crypto";
import { CONSENT_A } from "../google/scopes.js";

export type PkceChallenge = {
  verifier: string;
  challenge: string;
  state: string;
};

export function generatePkce(): PkceChallenge {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  return { verifier, challenge, state };
}

export function buildGoogleAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", (opts.scopes ?? CONSENT_A).join(" "));
  u.searchParams.set("code_challenge", opts.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", opts.state);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  return u.toString();
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
};

function form(body: Record<string, string>): string {
  return new URLSearchParams(body).toString();
}

/** Optional confidential-client secret. Never required; never logged. */
function resolveClientSecret(explicit?: string): string | undefined {
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  const fromEnv = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  return undefined;
}

function withOptionalSecret(body: Record<string, string>, secret: string | undefined): Record<string, string> {
  if (secret) body.client_secret = secret;
  return body;
}

/** Public client by default; client_secret is included only when provided. */
export async function exchangeAuthorizationCode(
  opts: {
    clientId: string;
    code: string;
    verifier: string;
    redirectUri: string;
    clientSecret?: string;
  },
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form(
      withOptionalSecret(
        {
          client_id: opts.clientId,
          code: opts.code,
          code_verifier: opts.verifier,
          grant_type: "authorization_code",
          redirect_uri: opts.redirectUri,
        },
        resolveClientSecret(opts.clientSecret),
      ),
    ),
  });
  const json = (await res.json()) as TokenResponse & { error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`token exchange failed: ${json.error ?? res.status}`);
  }
  return json;
}

export async function refreshAccessToken(
  opts: { clientId: string; refreshToken: string; clientSecret?: string },
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form(
      withOptionalSecret(
        {
          client_id: opts.clientId,
          refresh_token: opts.refreshToken,
          grant_type: "refresh_token",
        },
        resolveClientSecret(opts.clientSecret),
      ),
    ),
  });
  const json = (await res.json()) as TokenResponse & { error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`refresh failed: ${json.error ?? res.status}`);
  }
  return json;
}
