/**
 * Google Business Profile — direct Google hop (Consent B).
 *
 * Wave 5: GET-only accounts / locations / performance / keywords.
 * Not stamp. Never ctx.auth / Consent A. Flag default off.
 * `business.manage` is write-capable; tools do not POST/PUT/PATCH/DELETE.
 */
import type { AppContext } from "../context.js";
import { failEnvelope, HINT_EMPTY_LIST, okEnvelope, pageFromList, type Envelope } from "../envelope.js";
import { MSG } from "../errors.js";
import { asInt, normalizeGbpAccount, normalizeGbpLocation, requireId } from "../ids.js";
import { APIS, SCOPE } from "./scopes.js";

const SCOPE_GBP = SCOPE.business;
const HOST_ACCOUNTS = APIS.gbpAccounts;
const HOST_LOCATIONS = APIS.gbpLocations;
const HOST_PERF = APIS.gbpPerformance;

const LOCATION_READ_MASK =
  "name,title,storeCode,websiteUri,labels,phoneNumbers,storefrontAddress,latlng,profile,openInfo,metadata";

const DEFAULT_DAILY_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
] as const;

const DAILY_METRICS = new Set<string>([
  ...DEFAULT_DAILY_METRICS,
  "BUSINESS_CONVERSATIONS",
  "BUSINESS_BOOKINGS",
  "BUSINESS_FOOD_ORDERS",
  "BUSINESS_FOOD_MENU_CLICKS",
]);

type Rec = Record<string, unknown>;

function meta(tool: string, api: string) {
  return { api, requiredScope: SCOPE_GBP, tool };
}

function pageArgs(args: Rec): { pageSize: number; pageToken: string | undefined } {
  return {
    pageSize: asInt(args.page_size, 25, 1, 200),
    pageToken: typeof args.page_token === "string" ? args.page_token : undefined,
  };
}

/**
 * GBP_NOT_ENABLED (flag off) → GBP_NOT_CONNECTED → GBP_SCOPE_MISSING.
 * Direct hop: never GATEWAY_UNAVAILABLE. Never ctx.auth.
 * Dead-branch "Phase 7 / HTTP not in this binary" is gone: flag on hops.
 */
export async function requireGbpHop(ctx: AppContext, tool: string): Promise<Envelope | null> {
  if (!ctx.flags.gbpEnabled) {
    return failEnvelope(tool, "GBP_NOT_ENABLED", MSG.GBP_NOT_ENABLED, {
      hint: "Set DGTL_GBP_ENABLED=true after GBP Basic API Access quota is non-zero. Consent B is a separate grant — never business.manage on Consent A.",
      api: HOST_PERF,
    });
  }
  const tok = await ctx.authGbp.getAccessToken();
  if (!tok?.accessToken) {
    return failEnvelope(tool, "GBP_NOT_CONNECTED", MSG.GBP_NOT_CONNECTED, {
      hint: "Flag is on. Connect Consent B via GOOGLE_GBP_ACCESS_TOKEN or `auth login-gbp` (PLUGIN_DATA/google-oauth-gbp.json). Never reuse GOOGLE_ACCESS_TOKEN / Consent A. No stamp hop.",
      missing_scope: SCOPE_GBP,
    });
  }
  if (tok.scopes && tok.scopes.length > 0 && !tok.scopes.includes(SCOPE_GBP)) {
    return failEnvelope(tool, "GBP_SCOPE_MISSING", MSG.GBP_SCOPE_MISSING, {
      missing_scope: SCOPE_GBP,
      hint: "Re-run `auth login-gbp` on the Consent B client. Do not add business.manage to the free Consent A Desktop client.",
    });
  }
  return null;
}

function accountResource(account: { id: string; name: string }, display?: string) {
  return { type: "gbp_account", id: account.id, display_name: display ?? account.name };
}

function locationResource(location: { id: string; name: string }, display?: string) {
  return { type: "gbp_location", id: location.id, display_name: display ?? location.name };
}

function parseYmd(raw: string, field: string): { year: number; month: number; day: number } {
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    throw Object.assign(new Error("INVALID_DATE"), { field, raw });
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw Object.assign(new Error("INVALID_DATE"), { field, raw });
  }
  return { year, month, day };
}

function parseYearMonth(raw: string, field: string): { year: number; month: number } {
  const m = raw.trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) {
    throw Object.assign(new Error("INVALID_MONTH"), { field, raw });
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) {
    throw Object.assign(new Error("INVALID_MONTH"), { field, raw });
  }
  return { year, month };
}

function dateFail(tool: string, field: string, raw: string, kind: "date" | "month"): Envelope {
  return failEnvelope(
    tool,
    "INVALID_ARGUMENT",
    kind === "month"
      ? `${field} must be YYYY-MM (e.g. 2026-08), got ${raw}`
      : `${field} must be YYYY-MM-DD, got ${raw}`,
    { resource_id: field },
  );
}

export async function gbpListAccounts(ctx: AppContext, args: Rec): Promise<Envelope> {
  const miss = await requireGbpHop(ctx, "gbp_list_accounts");
  if (miss) return miss;
  const { pageSize, pageToken } = pageArgs(args);
  const raw = (await ctx.httpGbp.get(
    HOST_ACCOUNTS,
    "/v1/accounts",
    { pageSize, pageToken },
    meta("gbp_list_accounts", "mybusinessaccountmanagement.googleapis.com/v1"),
  )) as Rec;
  const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  return okEnvelope("gbp_list_accounts", {
    data: { accounts },
    page: pageFromList(
      accounts,
      accounts.length,
      typeof raw.nextPageToken === "string" ? raw.nextPageToken : undefined,
    ),
    ...(accounts.length === 0
      ? { hint: `${HINT_EMPTY_LIST} Empty GBP accounts is not an auth failure.` }
      : {}),
  });
}

export async function gbpListLocations(ctx: AppContext, args: Rec): Promise<Envelope> {
  const miss = await requireGbpHop(ctx, "gbp_list_locations");
  if (miss) return miss;
  const account = normalizeGbpAccount(requireId(args.account_name, "account_name"));
  const { pageSize, pageToken } = pageArgs(args);
  const raw = (await ctx.httpGbp.get(
    HOST_LOCATIONS,
    `/v1/${account.name}/locations`,
    { pageSize, pageToken, readMask: LOCATION_READ_MASK },
    meta("gbp_list_locations", "mybusinessbusinessinformation.googleapis.com/v1"),
  )) as Rec;
  const locations = Array.isArray(raw.locations) ? raw.locations : [];
  return okEnvelope("gbp_list_locations", {
    resource: accountResource(account),
    data: { locations },
    page: pageFromList(
      locations,
      typeof raw.totalSize === "number" ? raw.totalSize : locations.length,
      typeof raw.nextPageToken === "string" ? raw.nextPageToken : undefined,
    ),
    ...(locations.length === 0
      ? { hint: `${HINT_EMPTY_LIST} Empty locations is not an auth failure — check account_name.` }
      : {}),
  });
}

export async function gbpGetLocation(ctx: AppContext, args: Rec): Promise<Envelope> {
  const miss = await requireGbpHop(ctx, "gbp_get_location");
  if (miss) return miss;
  const location = normalizeGbpLocation(requireId(args.location_name, "location_name"));
  const raw = (await ctx.httpGbp.get(
    HOST_LOCATIONS,
    `/v1/${location.name}`,
    { readMask: LOCATION_READ_MASK },
    meta("gbp_get_location", "mybusinessbusinessinformation.googleapis.com/v1"),
  )) as Rec;
  const title = typeof raw.title === "string" ? raw.title : location.name;
  return okEnvelope("gbp_get_location", {
    resource: locationResource(location, title),
    data: raw,
  });
}

export async function gbpPerformance(ctx: AppContext, args: Rec): Promise<Envelope> {
  const miss = await requireGbpHop(ctx, "gbp_performance");
  if (miss) return miss;
  const location = normalizeGbpLocation(requireId(args.location_name, "location_name"));
  const startRaw = requireId(args.start_date, "start_date");
  const endRaw = requireId(args.end_date, "end_date");
  let start: { year: number; month: number; day: number };
  let end: { year: number; month: number; day: number };
  try {
    start = parseYmd(startRaw, "start_date");
  } catch {
    return dateFail("gbp_performance", "start_date", startRaw, "date");
  }
  try {
    end = parseYmd(endRaw, "end_date");
  } catch {
    return dateFail("gbp_performance", "end_date", endRaw, "date");
  }

  const requested = typeof args.daily_metric === "string" ? args.daily_metric.trim() : "";
  if (requested && !DAILY_METRICS.has(requested)) {
    return failEnvelope(
      "gbp_performance",
      "INVALID_ARGUMENT",
      `daily_metric must be a Business Profile Performance DailyMetric enum (e.g. WEBSITE_CLICKS), got ${requested}`,
      { resource_id: "daily_metric" },
    );
  }
  const metrics = requested ? [requested] : [...DEFAULT_DAILY_METRICS];

  const raw = (await ctx.httpGbp.get(
    HOST_PERF,
    `/v1/${location.name}:fetchMultiDailyMetricsTimeSeries`,
    {
      dailyMetrics: metrics,
      "dailyRange.startDate.year": start.year,
      "dailyRange.startDate.month": start.month,
      "dailyRange.startDate.day": start.day,
      "dailyRange.endDate.year": end.year,
      "dailyRange.endDate.month": end.month,
      "dailyRange.endDate.day": end.day,
    },
    meta("gbp_performance", "businessprofileperformance.googleapis.com/v1"),
  )) as Rec;

  const series = Array.isArray(raw.multiDailyMetricTimeSeries) ? raw.multiDailyMetricTimeSeries : [];
  return okEnvelope("gbp_performance", {
    resource: locationResource(location),
    data: {
      location_name: location.name,
      start_date: startRaw,
      end_date: endRaw,
      daily_metrics: metrics,
      multiDailyMetricTimeSeries: series,
    },
    hint: "Performance API does not list locations. Use gbp_list_locations first. Posts/replies are out of v1 (UNSUPPORTED_OPERATION).",
  });
}

function defaultKeywordRange(now: Date): { start: { year: number; month: number }; end: { year: number; month: number } } {
  // Last three complete months ending last month (inclusive).
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 2, 1));
  return {
    start: { year: start.getUTCFullYear(), month: start.getUTCMonth() + 1 },
    end: { year: end.getUTCFullYear(), month: end.getUTCMonth() + 1 },
  };
}

export async function gbpSearchKeywords(ctx: AppContext, args: Rec): Promise<Envelope> {
  const miss = await requireGbpHop(ctx, "gbp_search_keywords");
  if (miss) return miss;
  const location = normalizeGbpLocation(requireId(args.location_name, "location_name"));
  let start: { year: number; month: number };
  let end: { year: number; month: number };
  const monthRaw = typeof args.month === "string" ? args.month.trim() : "";
  if (monthRaw) {
    try {
      const one = parseYearMonth(monthRaw, "month");
      start = one;
      end = one;
    } catch {
      return dateFail("gbp_search_keywords", "month", monthRaw, "month");
    }
  } else {
    const range = defaultKeywordRange(ctx.now());
    start = range.start;
    end = range.end;
  }

  const raw = (await ctx.httpGbp.get(
    HOST_PERF,
    `/v1/${location.name}/searchkeywords/impressions/monthly`,
    {
      "monthlyRange.startMonth.year": start.year,
      "monthlyRange.startMonth.month": start.month,
      "monthlyRange.endMonth.year": end.year,
      "monthlyRange.endMonth.month": end.month,
    },
    meta("gbp_search_keywords", "businessprofileperformance.googleapis.com/v1"),
  )) as Rec;
  const keywords = Array.isArray(raw.searchKeywordsCounts) ? raw.searchKeywordsCounts : [];
  return okEnvelope("gbp_search_keywords", {
    resource: locationResource(location),
    data: {
      location_name: location.name,
      start_month: `${start.year}-${String(start.month).padStart(2, "0")}`,
      end_month: `${end.year}-${String(end.month).padStart(2, "0")}`,
      searchKeywordsCounts: keywords,
    },
    page: pageFromList(
      keywords,
      keywords.length,
      typeof raw.nextPageToken === "string" ? raw.nextPageToken : undefined,
    ),
    ...(keywords.length === 0
      ? { hint: `${HINT_EMPTY_LIST} Empty search keywords is not an auth failure.` }
      : {}),
  });
}
