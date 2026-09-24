import type { ActiveGrant } from "./auth";
import { json } from "./http";
import { openRefreshToken } from "./seal";
import { GA4_READ_SCOPES, GSC_READ_SCOPES, GTM_READ_SCOPES, refusalForGoogleScopes } from "./scopes";
import { isRecord } from "./validate";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const ADMIN_ORIGIN = "https://analyticsadmin.googleapis.com";
export const DATA_ORIGIN = "https://analyticsdata.googleapis.com";
export const GSC_ORIGIN = "https://searchconsole.googleapis.com";
export const GTM_ORIGIN = "https://tagmanager.googleapis.com";

export type ReadFamily = "ga4" | "gsc" | "gtm";

type AccessToken =
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "forbidden" }
  | { readonly kind: "failed" };

export type Access =
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "response"; readonly response: Response };

type GoogleCall =
  | { readonly kind: "ok"; readonly body: unknown }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not_found" }
  | { readonly kind: "failed" };

export type GoogleObject =
  | { readonly kind: "record"; readonly record: Record<string, unknown> }
  | { readonly kind: "response"; readonly response: Response };

export async function refreshAccessToken(env: Env, refreshToken: string): Promise<AccessToken> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_WEB_CLIENT_ID,
        client_secret: env.GOOGLE_WEB_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
    });
  } catch {
    return { kind: "failed" };
  }
  if (response.status === 403) {
    return { kind: "forbidden" };
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
  const accessToken = payload["access_token"];
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return { kind: "failed" };
  }
  return { kind: "token", token: accessToken };
}

function scopesFor(family: ReadFamily): readonly string[] {
  switch (family) {
    case "ga4":
      return GA4_READ_SCOPES;
    case "gsc":
      return GSC_READ_SCOPES;
    case "gtm":
      return GTM_READ_SCOPES;
    default: {
      const unexpected: never = family;
      return unexpected;
    }
  }
}

export async function readAccess(
  grant: ActiveGrant,
  env: Env,
  family: ReadFamily,
): Promise<string | Response> {
  const access = await accessForRead(grant, env, scopesFor(family), family);
  switch (access.kind) {
    case "token":
      return access.token;
    case "response":
      return access.response;
    default: {
      const unexpected: never = access;
      return unexpected;
    }
  }
}

export async function accessForRead(
  grant: ActiveGrant,
  env: Env,
  required: readonly string[],
  family: ReadFamily,
): Promise<Access> {
  const refused = refusalForGoogleScopes(grant.google, required);
  if (refused !== null) {
    return { kind: "response", response: refused };
  }
  const link = grant.google;
  if (link === null) {
    return { kind: "response", response: json({ error: "google_not_linked" }, 403) };
  }
  const refreshToken = await openRefreshToken(link.refresh_token, env.MUSE_TOKEN_ENC_KEY);
  if (refreshToken === null) {
    return { kind: "response", response: json({ error: "grant_unreadable" }, 500) };
  }
  const access = await refreshAccessToken(env, refreshToken);
  switch (access.kind) {
    case "token":
      return access;
    case "forbidden":
      return { kind: "response", response: json({ error: `${family}_forbidden` }, 403) };
    case "failed":
      return { kind: "response", response: json({ error: "google_token_failed" }, 502) };
    default: {
      const unexpected: never = access;
      return unexpected;
    }
  }
}

export function withQuery(
  base: string,
  params: Record<string, string | number | undefined>,
): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function googleCall(
  accessToken: string,
  url: string,
  init: { readonly method: "GET" | "POST"; readonly body?: unknown },
): Promise<GoogleCall> {
  const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` };
  let body: string | undefined;
  if (init.method === "POST") {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body ?? {});
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers,
      body,
      cache: "no-store",
    });
  } catch {
    return { kind: "failed" };
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: "forbidden" };
  }
  if (response.status === 404) {
    return { kind: "not_found" };
  }
  if (!response.ok) {
    return { kind: "failed" };
  }
  try {
    return { kind: "ok", body: await response.json() };
  } catch {
    return { kind: "failed" };
  }
}

export async function googleObject(
  family: ReadFamily,
  accessToken: string,
  url: string,
  init: { readonly method: "GET" | "POST"; readonly body?: unknown },
): Promise<GoogleObject> {
  const result = await googleCall(accessToken, url, init);
  switch (result.kind) {
    case "ok":
      if (!isRecord(result.body)) {
        return { kind: "response", response: json({ error: `${family}_unavailable` }, 502) };
      }
      return { kind: "record", record: result.body };
    case "forbidden":
      return { kind: "response", response: json({ error: `${family}_forbidden` }, 403) };
    case "not_found":
      return { kind: "response", response: json({ error: "not_found" }, 404) };
    case "failed":
      return { kind: "response", response: json({ error: `${family}_unavailable` }, 502) };
    default: {
      const unexpected: never = result;
      return unexpected;
    }
  }
}
