import type { ActiveGrant } from "./auth";
import { json } from "./http";
import { openRefreshToken } from "./seal";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REPORT_PREFIX = "https://analyticsdata.googleapis.com/v1beta/properties/";
const DEFAULT_START = "28daysAgo";
const DEFAULT_END = "yesterday";

type AccessToken =
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "forbidden" }
  | { readonly kind: "failed" };

type Report =
  | { readonly kind: "ok"; readonly sessions: number }
  | { readonly kind: "forbidden" }
  | { readonly kind: "failed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function dateParam(url: URL, name: string, fallback: string): string {
  const value = url.searchParams.get(name);
  if (value === null || value.length === 0) {
    return fallback;
  }
  return value;
}

function sessionCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return Number(value);
  }
  return null;
}

function sessionsFromReport(payload: unknown): number | null {
  if (!isRecord(payload)) {
    return null;
  }
  const rows = payload["rows"];
  if (rows === undefined) {
    return 0;
  }
  if (!Array.isArray(rows)) {
    return null;
  }
  if (rows.length === 0) {
    return 0;
  }
  const first = rows[0];
  if (!isRecord(first)) {
    return null;
  }
  const metricValues = first["metricValues"];
  if (!Array.isArray(metricValues) || metricValues.length === 0) {
    return null;
  }
  const metric = metricValues[0];
  if (!isRecord(metric)) {
    return null;
  }
  return sessionCount(metric["value"]);
}

async function refreshAccessToken(env: Env, refreshToken: string): Promise<AccessToken> {
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

async function runReport(
  propertyId: string,
  startDate: string,
  endDate: string,
  accessToken: string,
): Promise<Report> {
  let response: Response;
  try {
    response = await fetch(`${REPORT_PREFIX}${propertyId}:runReport`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        metrics: [{ name: "sessions" }],
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
  const sessions = sessionsFromReport(payload);
  if (sessions === null) {
    return { kind: "failed" };
  }
  return { kind: "ok", sessions };
}

export async function readSessions(
  request: Request,
  grant: ActiveGrant,
  env: Env,
  propertyId: string,
): Promise<Response> {
  if (!/^[0-9]+$/.test(propertyId)) {
    return json({ error: "invalid_property_id" }, 400);
  }
  if (grant.google === null) {
    return json({ error: "google_not_linked" }, 403);
  }

  const refreshToken = await openRefreshToken(grant.google.refresh_token, env.MUSE_TOKEN_ENC_KEY);
  if (refreshToken === null) {
    return json({ error: "grant_unreadable" }, 500);
  }

  const url = new URL(request.url);
  const startDate = dateParam(url, "start_date", DEFAULT_START);
  const endDate = dateParam(url, "end_date", DEFAULT_END);
  const access = await refreshAccessToken(env, refreshToken);
  switch (access.kind) {
    case "forbidden":
      return json({ error: "ga4_forbidden" }, 403);
    case "failed":
      return json({ error: "google_token_failed" }, 502);
    case "token":
      break;
    default: {
      const unexpected: never = access;
      return unexpected;
    }
  }

  const report = await runReport(propertyId, startDate, endDate, access.token);
  switch (report.kind) {
    case "ok":
      return json(
        {
          property_id: propertyId,
          start_date: startDate,
          end_date: endDate,
          sessions: report.sessions,
        },
        200,
      );
    case "forbidden":
      return json({ error: "ga4_forbidden" }, 403);
    case "failed":
      return json({ error: "ga4_unavailable" }, 502);
    default: {
      const unexpected: never = report;
      return unexpected;
    }
  }
}
