import type { ActiveGrant } from "./auth";
import { json } from "./http";
import { openRefreshToken } from "./seal";
import { invalidRequest, isRecord } from "./validate";

export const KLAVIYO_API_REVISION = "2026-07-15";
export const KLAVIYO_ORIGIN = "https://a.klaviyo.com";

const PROFILE_PAGE_DEFAULT = 20;
const PROFILE_PAGE_MAX = 100;

const ACCOUNT_FIELDS =
  "contact_information.organization_name,industry,timezone,preferred_currency,locale,test_account";
const PROFILE_FIELDS = "email,created,updated,external_id";

const PROFILE_STRIP = [
  "phone_number",
  "location",
  "properties",
  "image",
  "organization",
  "title",
  "subscriptions",
  "predictive_analytics",
  "locale",
] as const;

type ReadyLink = {
  readonly apiKey: string;
};

type KlaviyoResult =
  | { readonly kind: "ok"; readonly body: unknown }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "rate_limited" }
  | { readonly kind: "unavailable" };

type ProfilePage = {
  readonly pageSize: number;
  readonly pageToken: string | undefined;
};

function upstreamError(
  kind: "unauthorized" | "forbidden" | "rate_limited" | "unavailable",
): Response {
  switch (kind) {
    case "unauthorized":
      return json({ error: "klaviyo_unauthorized" }, 401);
    case "forbidden":
      return json({ error: "klaviyo_forbidden" }, 403);
    case "rate_limited":
      return json({ error: "klaviyo_rate_limited" }, 429);
    case "unavailable":
      return json({ error: "klaviyo_unavailable" }, 502);
    default: {
      const unexpected: never = kind;
      return unexpected;
    }
  }
}

async function readyLink(grant: ActiveGrant, env: Env): Promise<ReadyLink | Response> {
  if (grant.klaviyo === null) {
    return json({ error: "klaviyo_not_linked" }, 403);
  }
  const apiKey = await openRefreshToken(grant.klaviyo.api_key, env.MUSE_TOKEN_ENC_KEY);
  if (apiKey === null) {
    return json({ error: "grant_unreadable" }, 500);
  }
  return { apiKey };
}

function readProfilePage(url: URL): ProfilePage | Response {
  const rawSize = url.searchParams.get("page_size");
  let pageSize = PROFILE_PAGE_DEFAULT;
  if (rawSize !== null && rawSize.length > 0) {
    if (!/^[0-9]+$/.test(rawSize)) {
      return invalidRequest("page_size must be an integer from 1 to 100.");
    }
    pageSize = Number(rawSize);
    if (pageSize < 1 || pageSize > PROFILE_PAGE_MAX) {
      return invalidRequest("page_size must be an integer from 1 to 100.");
    }
  }
  const rawToken = url.searchParams.get("page_token");
  if (rawToken === null || rawToken.length === 0) {
    return { pageSize, pageToken: undefined };
  }
  if (rawToken.length > 2048 || /[\u0000-\u001F]/.test(rawToken)) {
    return invalidRequest("page_token is not valid.");
  }
  return { pageSize, pageToken: rawToken };
}

function klaviyoUrl(path: string, query: Readonly<Record<string, string>>): string {
  const url = new URL(path, KLAVIYO_ORIGIN);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function klaviyoGet(link: ReadyLink, url: string): Promise<KlaviyoResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/vnd.api+json",
        authorization: `Klaviyo-API-Key ${link.apiKey}`,
        revision: KLAVIYO_API_REVISION,
      },
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (response.status === 401) {
    return { kind: "unauthorized" };
  }
  if (response.status === 403) {
    return { kind: "forbidden" };
  }
  if (response.status === 429) {
    return { kind: "rate_limited" };
  }
  if (!response.ok) {
    return { kind: "unavailable" };
  }
  try {
    return { kind: "ok", body: await response.json() };
  } catch {
    return { kind: "unavailable" };
  }
}

function firstAccount(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body)) {
    return null;
  }
  const data = body["data"];
  const row = Array.isArray(data) ? data[0] : data;
  if (!isRecord(row)) {
    return null;
  }
  const id = row["id"];
  if (typeof id !== "string" || id.trim().length === 0) {
    return null;
  }
  return row;
}

function profileRows(body: unknown): unknown[] | null {
  if (!isRecord(body)) {
    return null;
  }
  const data = body["data"];
  if (Array.isArray(data)) {
    return data;
  }
  if (isRecord(data)) {
    return [data];
  }
  return [];
}

function sparsifyProfile(resource: unknown): Record<string, unknown> | null {
  if (!isRecord(resource)) {
    return null;
  }
  const raw = resource["attributes"];
  const attributes: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
  for (const key of PROFILE_STRIP) {
    delete attributes[key];
  }
  const id = resource["id"];
  const type = resource["type"];
  const profile: Record<string, unknown> = {
    type: typeof type === "string" ? type : "profile",
    attributes,
  };
  if (typeof id === "string") {
    profile["id"] = id;
  }
  return profile;
}

function nextPageToken(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  const links = body["links"];
  if (!isRecord(links) || typeof links["next"] !== "string" || links["next"].length === 0) {
    return undefined;
  }
  try {
    const cursor = new URL(links["next"]).searchParams.get("page[cursor]");
    if (cursor !== null && cursor.length > 0) {
      return cursor;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function readAccount(grant: ActiveGrant, env: Env): Promise<Response> {
  const link = await readyLink(grant, env);
  if (link instanceof Response) {
    return link;
  }
  const result = await klaviyoGet(
    link,
    klaviyoUrl("/api/accounts", { "fields[account]": ACCOUNT_FIELDS }),
  );
  switch (result.kind) {
    case "ok": {
      const account = firstAccount(result.body);
      if (account === null) {
        return upstreamError("unavailable");
      }
      return json({ account }, 200);
    }
    case "unauthorized":
    case "forbidden":
    case "rate_limited":
    case "unavailable":
      return upstreamError(result.kind);
    default: {
      const unexpected: never = result;
      return unexpected;
    }
  }
}

async function readProfiles(url: URL, grant: ActiveGrant, env: Env): Promise<Response> {
  const page = readProfilePage(url);
  if (page instanceof Response) {
    return page;
  }
  const link = await readyLink(grant, env);
  if (link instanceof Response) {
    return link;
  }
  const query: Record<string, string> = {
    "fields[profile]": PROFILE_FIELDS,
    "page[size]": String(page.pageSize),
  };
  if (page.pageToken !== undefined) {
    query["page[cursor]"] = page.pageToken;
  }
  const result = await klaviyoGet(link, klaviyoUrl("/api/profiles", query));
  switch (result.kind) {
    case "ok": {
      const rows = profileRows(result.body);
      if (rows === null) {
        return upstreamError("unavailable");
      }
      const profiles: Record<string, unknown>[] = [];
      for (const row of rows) {
        const profile = sparsifyProfile(row);
        if (profile !== null) {
          profiles.push(profile);
        }
      }
      const next = nextPageToken(result.body);
      const body: Record<string, unknown> = { profiles };
      if (next !== undefined) {
        body["next_page_token"] = next;
      }
      return json(body, 200);
    }
    case "unauthorized":
    case "forbidden":
    case "rate_limited":
    case "unavailable":
      return upstreamError(result.kind);
    default: {
      const unexpected: never = result;
      return unexpected;
    }
  }
}

export async function routeKlaviyoReads(
  request: Request,
  grant: ActiveGrant,
  env: Env,
): Promise<Response | null> {
  if (request.method !== "GET") {
    return null;
  }
  const url = new URL(request.url);
  if (url.pathname === "/v1/klaviyo/account") {
    return readAccount(grant, env);
  }
  if (url.pathname === "/v1/klaviyo/profiles") {
    return readProfiles(url, grant, env);
  }
  return null;
}
