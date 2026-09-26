import { mintBearerToken, type ActiveGrant, type GoogleLink } from "./auth";
import { base64UrlToBytes, bytesToBase64Url } from "./bytes";
import { html } from "./http";
import { CONNECT_REQUIRED_SCOPES, CONSENT_A } from "./scopes";
import { sealRefreshToken } from "./seal";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const STATE_TTL_SECONDS = 600;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
// Pinned so the incoming Host cannot choose a different Google redirect URI.
const REDIRECT_URI = "https://muse-api.dgtlsunrise.com/oauth/google/callback";

type Identity = {
  readonly sub: string;
  readonly email: string;
};

type TokenResponse = {
  readonly refreshToken: string | null;
  readonly accessToken: string | null;
  readonly idToken: string | null;
  readonly scopes: readonly string[];
};

type CodeExchange =
  | { readonly kind: "token"; readonly token: TokenResponse }
  | { readonly kind: "missing_scopes" }
  | { readonly kind: "failed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; font-size: 1rem; line-height: 1.5; margin: 0; background: #f6f5f2; color: #14221c; }
  main { max-width: 36rem; margin: 4rem auto; padding: 2rem; background: #fff; border: 1px solid #d5d1c8; }
  h1 { font-size: 1.5rem; line-height: 1.3; margin: 0 0 1rem; }
  p { margin: 0 0 1rem; }
  button { font: inherit; min-height: 48px; padding: 0.75rem 1.1rem; background: #1f4d3a; color: #fff; border: 0; cursor: pointer; }
  button:focus-visible, a:focus-visible { outline: 3px solid #0b57d0; outline-offset: 2px; }
  code { font-family: ui-monospace, monospace; font-size: 0.95rem; word-break: break-all; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

function errorPage(status: number, message: string): Response {
  return html(
    page(
      "Connect Google to Muse",
      `<h1>Connect Google to Muse</h1>
<p>${escapeHtml(message)}</p>
<p><a href="/connect">Return to Connect</a></p>`,
    ),
    status,
  );
}

export function connectPage(): Response {
  return html(
    page(
      "Connect Google to Muse",
      `<h1>Connect Google to Muse</h1>
<p>Sign in with Google so Muse can read and manage Google Analytics, Search Console, and Tag Manager on accounts you can access.</p>
<p>Muse does not ask for Google Ads, Merchant Center, or Business Profile. An older read-only connection cannot manage until you connect again.</p>
<form action="/oauth/google/start" method="get">
<button type="submit">Connect Google</button>
</form>`,
    ),
    200,
  );
}

function stateKey(state: string): string {
  return `state:${state}`;
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function startGoogleOAuth(env: Env): Promise<Response> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = bytesToBase64Url(verifierBytes);
  const stateBytes = new Uint8Array(32);
  crypto.getRandomValues(stateBytes);
  const state = bytesToBase64Url(stateBytes);
  const challenge = await codeChallenge(verifier);
  await env.MUSE_TOKENS.put(
    stateKey(state),
    JSON.stringify({ code_verifier: verifier, created_at: new Date().toISOString() }),
    { expirationTtl: STATE_TTL_SECONDS },
  );

  const authorize = new URL(GOOGLE_AUTH_URL);
  authorize.searchParams.set("client_id", env.GOOGLE_WEB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", REDIRECT_URI);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", CONSENT_A.join(" "));
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("access_type", "offline");
  authorize.searchParams.set("prompt", "consent");

  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.href,
      "cache-control": "no-store",
    },
  });
}

function parsePending(raw: string | null): { code_verifier: string } | null {
  if (raw === null) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  const verifier = value["code_verifier"];
  const createdAt = value["created_at"];
  if (typeof verifier !== "string" || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) {
    return null;
  }
  if (typeof createdAt !== "string" || createdAt.length === 0) {
    return null;
  }
  return { code_verifier: verifier };
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

function scopesFromToken(value: unknown): readonly string[] | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const scopes = value.split(/\s+/).filter((scope) => scope.length > 0);
  for (const required of CONNECT_REQUIRED_SCOPES) {
    if (!scopes.includes(required)) {
      return null;
    }
  }
  return scopes;
}

async function exchangeCode(env: Env, code: string, verifier: string): Promise<CodeExchange> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_WEB_CLIENT_ID,
        client_secret: env.GOOGLE_WEB_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      cache: "no-store",
    });
  } catch {
    return { kind: "failed" };
  }
  if (!response.ok) {
    return { kind: "failed" };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { kind: "failed" };
  }
  if (!isRecord(payload)) {
    return { kind: "failed" };
  }
  const scopes = scopesFromToken(payload["scope"]);
  if (scopes === null) {
    return { kind: "missing_scopes" };
  }
  return {
    kind: "token",
    token: {
      refreshToken: optionalString(payload["refresh_token"]),
      accessToken: optionalString(payload["access_token"]),
      idToken: optionalString(payload["id_token"]),
      scopes,
    },
  };
}

function claimsIdentity(claims: Record<string, unknown>): Identity | null {
  const sub = claims["sub"];
  const email = claims["email"];
  if (typeof sub !== "string" || sub.length === 0) {
    return null;
  }
  if (typeof email !== "string" || email.length === 0) {
    return null;
  }
  return { sub, email };
}

function identityFromIdToken(idToken: string): Identity | null {
  const parts = idToken.split(".");
  const payload = parts[1];
  if (parts.length !== 3 || payload === undefined || payload.length === 0) {
    return null;
  }
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(payload));
    const claims: unknown = JSON.parse(json);
    if (!isRecord(claims)) {
      return null;
    }
    return claimsIdentity(claims);
  } catch {
    return null;
  }
}

async function identityFromUserinfo(accessToken: string): Promise<Identity | null> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_USERINFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  if (!isRecord(payload)) {
    return null;
  }
  return claimsIdentity(payload);
}

// The id_token is taken from Google's token response on this connection, not from the browser.
async function readIdentity(token: TokenResponse): Promise<Identity | null> {
  if (token.idToken !== null) {
    const fromId = identityFromIdToken(token.idToken);
    if (fromId !== null) {
      return fromId;
    }
  }
  if (token.accessToken === null) {
    return null;
  }
  return identityFromUserinfo(token.accessToken);
}

function tokenPage(token: string): Response {
  return html(
    page(
      "Muse bearer token",
      `<h1>Muse bearer token</h1>
<p>Paste this into Muse as the Bearer token. It is shown only this once.</p>
<p><code>${escapeHtml(token)}</code></p>`,
    ),
    200,
  );
}

export async function finishGoogleOAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const stateOk = state !== null && STATE_PATTERN.test(state);

  if (url.searchParams.get("error") !== null) {
    if (stateOk && state !== null) {
      await env.MUSE_TOKENS.delete(stateKey(state));
    }
    return errorPage(400, "Google did not complete sign-in.");
  }

  if (!stateOk || state === null) {
    return errorPage(400, "This sign-in link is invalid or has expired.");
  }

  const pending = parsePending(await env.MUSE_TOKENS.get(stateKey(state), "text"));
  await env.MUSE_TOKENS.delete(stateKey(state));
  if (pending === null) {
    return errorPage(400, "This sign-in link is invalid or has expired.");
  }
  if (code === null || code.length === 0 || code.length > 2048) {
    return errorPage(400, "Google did not complete sign-in.");
  }

  const exchanged = await exchangeCode(env, code, pending.code_verifier);
  switch (exchanged.kind) {
    case "failed":
      return errorPage(502, "Google did not complete sign-in.");
    case "missing_scopes":
      return errorPage(
        400,
        "Google did not share your Google account ID and email, which Muse needs to connect. Reopen /connect and reconnect Google.",
      );
    case "token":
      break;
    default: {
      const unexpected: never = exchanged;
      return unexpected;
    }
  }
  if (exchanged.token.refreshToken === null) {
    return errorPage(502, "Google did not return a refresh token.");
  }

  const identity = await readIdentity(exchanged.token);
  if (identity === null) {
    return errorPage(502, "Google did not share the account.");
  }

  const sealed = await sealRefreshToken(exchanged.token.refreshToken, env.MUSE_TOKEN_ENC_KEY);
  if (sealed === null) {
    return errorPage(500, "Sign-in could not be saved.");
  }

  const minted = await mintBearerToken();
  const now = new Date().toISOString();
  const google: GoogleLink = {
    sub: identity.sub,
    email: identity.email,
    scopes: exchanged.token.scopes,
    refresh_token: sealed,
    linked_at: now,
  };
  const grant: ActiveGrant = {
    v: 1,
    grant_id: crypto.randomUUID(),
    created_at: now,
    status: "active",
    google,
    shopify: null,
    klaviyo: null,
  };
  await env.MUSE_TOKENS.put(minted.key, JSON.stringify(grant));
  return tokenPage(minted.token);
}
