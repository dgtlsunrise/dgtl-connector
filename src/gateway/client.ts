/**
 * License-gated DGTL gateway client (PR-5).
 * POST recipe+params only — never a URL, never developer-token.
 * Consent C / Meta user tokens only — never ctx.auth / GOOGLE_ACCESS_TOKEN.
 */

import type { AppContext } from "../context.js";
import { failEnvelope, type Envelope } from "../envelope.js";
import { MSG, type ErrorCode } from "../errors.js";
import { loadLicenseToken } from "../license/verify.js";
import { newRequestId } from "../log.js";

const HEALTH_TIMEOUT_MS = 3_000;
const HOP_TIMEOUT_MS = 25_000;

export type GatewayRecipe =
  | "campaigns"
  | "ad_groups"
  | "keywords"
  | "search_terms"
  | "conversion_actions"
  | "change_status"
  | "policy_topics"
  | "performance"
  | null;

export type GatewayParams = {
  customer_id?: string;
  login_customer_id?: string;
  date_range?: { start_date: string; end_date: string };
  where?: { status?: string; campaign_id?: string };
  limit?: number;
  campaign_id?: string;
  status?: string;
  campaign_budget_id?: string;
  campaign_budget_resource_name?: string;
  amount_micros?: string | number;
  daily_budget_dollars?: number;
  ad_account_id?: string;
  object_id?: string;
  level?: "account" | "campaign" | "adset" | "ad";
  date_start?: string;
  date_stop?: string;
  date_preset?: string;
  breakdowns?: string[];
  fields?: string[];
  time_increment?: string | number;
  creative_id?: string;
  adset_id?: string;
  ad_id?: string;
  /** Optional Meta rename (Slice 5). */
  name?: string;
  /** Meta ad set budget in cents (not micros). */
  daily_budget?: string | number;
  lifetime_budget?: string | number;
  /** Google Ads create/keyword tools. */
  ad_group_id?: string;
  criterion_id?: string;
  keywords?: Array<{ text: string; match_type?: string }>;
  headlines?: string[];
  descriptions?: string[];
  /** Validated https landing URL for RSA finalUrls — not a hop URL. */
  final_url?: string;
  path1?: string;
  path2?: string;
  campaign_name?: string;
  ad_group_name?: string;
  cpc_bid_micros?: string | number;
  /** Meta create campaign objective (closed Outcome enum). */
  objective?: string;
  special_ad_categories?: string | string[];
  billing_event?: string;
  optimization_goal?: string;
  bid_strategy?: string;
  countries?: string | string[];
  end_time?: string;
  /** Meta image upload — base64 bytes (not a URL). */
  bytes?: string;
  /** Meta video upload — https file_url (media source, not hop). */
  file_url?: string;
  /** Meta AdCreative page id. */
  page_id?: string;
  /** Meta image hash from adimages upload. */
  image_hash?: string;
  /** Meta video id from advideos upload. */
  video_id?: string;
  /** Meta AdCreative landing link (https). */
  link?: string;
  message?: string;
  title?: string;
  description?: string;
  call_to_action_type?: string;
  /** PMax asset group name. */
  asset_group_name?: string;
  /** Existing Google Ads asset resource names for PMax images. */
  marketing_image_asset_resource_names?: string[];
  square_marketing_image_asset_resource_names?: string[];
  logo_asset_resource_names?: string[];
  long_headlines?: string[];
  business_name?: string;
  /** Shopping / MC linkage. */
  merchant_center_id?: string | number;
  sales_country?: string;
};

export type GatewayRequest = {
  tool: string;
  recipe: GatewayRecipe;
  params: GatewayParams;
};

export type GatewayReachable = {
  reachable: boolean;
  note?: string;
  /** Worker ADS_MUTATE_ENABLED — boolean from health, else null. Never the env string. */
  ads_mutate_enabled?: boolean | null;
  /** Worker META_MUTATE_ENABLED — boolean from health, else null. Never the env string. */
  meta_mutate_enabled?: boolean | null;
};

function healthBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Normalize DGTL_GATEWAY_URL (trim trailing slash). Empty → undefined. */
export function gatewayUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = (env.DGTL_GATEWAY_URL || "").trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, "");
}

/**
 * license_status / whoami probe.
 * URL unset → false (no throw). URL set → GET /v1/health, no user token.
 * Probe fail → false + hint, not throw. Never true from “URL configured” alone.
 */
export async function probeGatewayReachable(
  ctx: Pick<AppContext, "env" | "fetchImpl" | "flags">,
): Promise<GatewayReachable> {
  const base = ctx.flags.gatewayUrl ?? gatewayUrlFromEnv(ctx.env);
  if (!base) {
    return { reachable: false, note: "DGTL_GATEWAY_URL unset." };
  }

  const url = `${base}/v1/health`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await ctx.fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        // No Authorization / no user token on health probe.
      },
      signal: ac.signal,
    });
    if (!res.ok) {
      return {
        reachable: false,
        note: `Gateway health returned HTTP ${res.status}. Set a reachable DGTL_GATEWAY_URL.`,
      };
    }
    let body: {
      ok?: boolean;
      ads_mutate_enabled?: unknown;
      meta_mutate_enabled?: unknown;
    } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      return { reachable: false, note: "Gateway health returned non-JSON." };
    }
    if (body.ok !== true) {
      return { reachable: false, note: "Gateway health ok≠true." };
    }
    return {
      reachable: true,
      ads_mutate_enabled: healthBool(body.ads_mutate_enabled),
      meta_mutate_enabled: healthBool(body.meta_mutate_enabled),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      reachable: false,
      note: `Gateway health probe failed (${msg}). Check DGTL_GATEWAY_URL.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hop param keys the plugin may POST to stamp. Fifth handwritten map (W0.2);
 * keep in lockstep with `GatewayParams` and stamp builders.
 */
export const GATEWAY_PARAM_ALLOW = new Set([
  "customer_id",
  "login_customer_id",
  "date_range",
  "where",
  "limit",
  "campaign_id",
  "status",
  "campaign_budget_id",
  "campaign_budget_resource_name",
  "amount_micros",
  "daily_budget_dollars",
  "ad_account_id",
  "object_id",
  "level",
  "date_start",
  "date_stop",
  "date_preset",
  "breakdowns",
  "fields",
  "time_increment",
  "creative_id",
  "adset_id",
  "ad_id",
  "name",
  "daily_budget",
  "lifetime_budget",
  "ad_group_id",
  "criterion_id",
  "keywords",
  "headlines",
  "descriptions",
  "final_url",
  "path1",
  "path2",
  "campaign_name",
  "ad_group_name",
  "cpc_bid_micros",
  "objective",
  "special_ad_categories",
  "billing_event",
  "optimization_goal",
  "bid_strategy",
  "countries",
  "end_time",
  "bytes",
  "file_url",
  "page_id",
  "image_hash",
  "video_id",
  "link",
  "message",
  "title",
  "description",
  "call_to_action_type",
  "asset_group_name",
  "marketing_image_asset_resource_names",
  "square_marketing_image_asset_resource_names",
  "logo_asset_resource_names",
  "long_headlines",
  "business_name",
  "merchant_center_id",
  "sales_country",
]);

/**
 * Closed https fields that are landing/media values — never hop targets.
 *
 * Checklist when adding a new media/URL field (do not skip; `final_url` already
 * broke live RSA create when it was missing):
 * 1. Add the key here (`CLOSED_HTTPS_FIELDS`).
 * 2. Add it to `GATEWAY_PARAM_ALLOW` and stamp `LANDING_URL_PARAM_KEYS`.
 * 3. Stamp mutate builder must validate https-only (no credentials).
 * 4. Add a hop test that the field survives `stripUrlishParams`.
 * 5. Update `tests/fixtures/w0-2-mutate-parity.json` `closed_https_fields` in BOTH
 *    dgtl-connector and dgtl-stamp.
 *
 * `path1` / `path2` are path-only sitelink fields (not https) — keep them off this set.
 */
export const CLOSED_HTTPS_FIELDS = new Set(["final_url", "file_url", "link"]);

function stripUrlishParams(params: Record<string, unknown>): GatewayParams {
  const out: GatewayParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (!GATEWAY_PARAM_ALLOW.has(k)) continue;
    // Reject https in open string fields (would be a proxy hop). Closed URL fields pass.
    if (!CLOSED_HTTPS_FIELDS.has(k) && typeof v === "string" && /^https?:\/\//i.test(v)) continue;
    if (k === "date_range" && v && typeof v === "object" && !Array.isArray(v)) {
      const dr = v as Record<string, unknown>;
      if (typeof dr.start_date === "string" && typeof dr.end_date === "string") {
        out.date_range = { start_date: dr.start_date, end_date: dr.end_date };
      }
      continue;
    }
    if (k === "where" && v && typeof v === "object" && !Array.isArray(v)) {
      const w = v as Record<string, unknown>;
      const where: { status?: string; campaign_id?: string } = {};
      if (typeof w.status === "string") where.status = w.status;
      if (typeof w.campaign_id === "string") where.campaign_id = w.campaign_id;
      out.where = where;
      continue;
    }
    if (k === "limit" && typeof v === "number") {
      out.limit = v;
      continue;
    }
    if (k === "level" && (v === "account" || v === "campaign" || v === "adset" || v === "ad")) {
      out.level = v;
      continue;
    }
    if ((k === "breakdowns" || k === "fields") && Array.isArray(v)) {
      const arr = v.filter((x): x is string => typeof x === "string" && x.length > 0);
      if (arr.length) (out as Record<string, unknown>)[k] = arr;
      continue;
    }
    if (k === "time_increment" && (typeof v === "string" || typeof v === "number")) {
      out.time_increment = v;
      continue;
    }
    if (k === "amount_micros" && (typeof v === "string" || typeof v === "number")) {
      out.amount_micros = v;
      continue;
    }
    if (k === "daily_budget_dollars" && typeof v === "number") {
      out.daily_budget_dollars = v;
      continue;
    }
    if ((k === "daily_budget" || k === "lifetime_budget") && (typeof v === "string" || typeof v === "number")) {
      (out as Record<string, unknown>)[k] = v;
      continue;
    }
    if (k === "cpc_bid_micros" && (typeof v === "string" || typeof v === "number")) {
      out.cpc_bid_micros = v;
      continue;
    }
    if (k === "keywords" && Array.isArray(v)) {
      const kws: Array<{ text: string; match_type?: string }> = [];
      for (const item of v) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const text =
          typeof (item as { text?: unknown }).text === "string"
            ? (item as { text: string }).text.trim()
            : "";
        if (!text) continue;
        const mt =
          typeof (item as { match_type?: unknown }).match_type === "string"
            ? (item as { match_type: string }).match_type
            : undefined;
        kws.push(mt ? { text, match_type: mt } : { text });
      }
      if (kws.length) out.keywords = kws;
      continue;
    }
    if ((k === "headlines" || k === "descriptions") && Array.isArray(v)) {
      const arr = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
      if (arr.length) (out as Record<string, unknown>)[k] = arr;
      continue;
    }
    if (CLOSED_HTTPS_FIELDS.has(k) && typeof v === "string" && /^https:\/\//i.test(v.trim())) {
      (out as Record<string, unknown>)[k] = v.trim();
      continue;
    }
    if (
      (k === "headlines" ||
        k === "descriptions" ||
        k === "long_headlines" ||
        k === "marketing_image_asset_resource_names" ||
        k === "square_marketing_image_asset_resource_names" ||
        k === "logo_asset_resource_names" ||
        k === "countries" ||
        k === "special_ad_categories") &&
      Array.isArray(v)
    ) {
      const arr = v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim());
      if (arr.length) (out as Record<string, unknown>)[k] = arr;
      continue;
    }
    if (k === "merchant_center_id" && (typeof v === "string" || typeof v === "number")) {
      out.merchant_center_id = v;
      continue;
    }
    if (typeof v === "string") {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

function recipeFromArgs(tool: string, args: Record<string, unknown>): GatewayRecipe {
  if (tool === "gads_campaign_performance") return "performance";
  const r = args.recipe;
  if (
    r === "campaigns" ||
    r === "ad_groups" ||
    r === "keywords" ||
    r === "search_terms" ||
    r === "conversion_actions" ||
    r === "change_status" ||
    r === "policy_topics" ||
    r === "performance"
  ) {
    return r;
  }
  return null;
}

const KNOWN_ERROR_CODES = new Set<string>([
  "UNAUTHENTICATED",
  "REAUTH_REQUIRED",
  "CONSENT_MISSING",
  "ACCESS_NOT_CONFIGURED",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "RESOURCE_REQUIRED",
  "INVALID_ARGUMENT",
  "UNSUPPORTED_DIMENSION",
  "UNSUPPORTED_OPERATION",
  "QUOTA_EXCEEDED",
  "RATE_LIMITED",
  "GOOGLE_UNAVAILABLE",
  "LICENSE_REQUIRED",
  "GATEWAY_UNAVAILABLE",
  "ADS_SCOPE_MISSING",
  "META_NOT_CONNECTED",
  "GBP_NOT_ENABLED",
  "WRITE_NOT_ENABLED",
  "CONSENT_W_REQUIRED",
  "ADS_MUTATE_NOT_ENABLED",
  "META_MUTATE_NOT_ENABLED",
  "META_SCOPE_MISSING",
  "SPEND_CAP_EXCEEDED",
]);

function mapGatewayResponse(tool: string, body: Record<string, unknown>, httpStatus: number): Envelope {
  if (body.ok === true) {
    const env: Envelope = { ok: true, tool };
    if (body.resource && typeof body.resource === "object") {
      env.resource = body.resource as Envelope["resource"];
    }
    if (body.data !== undefined) env.data = body.data;
    if (body.page && typeof body.page === "object") env.page = body.page as Envelope["page"];
    if (body.quota !== undefined) env.quota = body.quota;
    if (typeof body.hint === "string" && body.hint.trim()) env.hint = body.hint;
    return env;
  }

  const rawCode = typeof body.error_code === "string" ? body.error_code : "GATEWAY_UNAVAILABLE";
  const code: ErrorCode = KNOWN_ERROR_CODES.has(rawCode)
    ? (rawCode as ErrorCode)
    : httpStatus >= 500 || httpStatus === 0
      ? "GATEWAY_UNAVAILABLE"
      : "GOOGLE_UNAVAILABLE";

  const message =
    typeof body.message === "string" && body.message.trim()
      ? body.message
      : MSG.GATEWAY_UNAVAILABLE;

  return failEnvelope(tool, code, message, {
    hint: typeof body.hint === "string" ? body.hint : undefined,
    google_status: typeof body.google_status === "number" ? body.google_status : undefined,
    google_reason: typeof body.google_reason === "string" ? body.google_reason : undefined,
    api: typeof body.api === "string" ? body.api : undefined,
  });
}

export type GatewayHopOpts = {
  family: "gads" | "meta";
  tool: string;
  /** User access token from Consent C or Meta store only. */
  userAccessToken: string;
  args?: Record<string, unknown>;
};

/**
 * POST GatewayRequest to /v1/gads/{tool} or /v1/meta/{tool}.
 * Never attaches developer-token. Never sends open proxy URL hops (closed final_url/file_url/link OK).
 * Does not read ctx.auth or GOOGLE_ACCESS_TOKEN.
 */
export async function postGateway(ctx: AppContext, opts: GatewayHopOpts): Promise<Envelope> {
  const base = ctx.flags.gatewayUrl ?? gatewayUrlFromEnv(ctx.env);
  if (!base) {
    return failEnvelope(opts.tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: "Set DGTL_GATEWAY_URL to the DGTL Worker base URL. Free GA4/GSC/GTM tools are unaffected.",
    });
  }

  // Power-user DGTL_ADS_DEVELOPER_TOKEN is unimplemented (OQ 12) — ignore if present.
  void ctx.env.DGTL_ADS_DEVELOPER_TOKEN;

  const licenseJwt = loadLicenseToken(ctx.env, ctx.pluginDataDir);
  if (!licenseJwt) {
    return failEnvelope(opts.tool, "LICENSE_REQUIRED", MSG.LICENSE_REQUIRED);
  }

  const args = opts.args ?? {};
  const body: GatewayRequest = {
    tool: opts.tool,
    recipe: recipeFromArgs(opts.tool, args),
    params: stripUrlishParams(args),
  };

  // Refuse open proxy / client hop URLs on the wire. Closed landing/media URL
  // fields (final_url, file_url, link) are allowlisted after stripUrlishParams.
  const scrubbedParams: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body.params as Record<string, unknown>)) {
    scrubbedParams[k] =
      CLOSED_HTTPS_FIELDS.has(k) && typeof v === "string" ? "<closed-https>" : v;
  }
  const scrubbed = JSON.stringify({ ...body, params: scrubbedParams });
  if (/https?:\/\//i.test(scrubbed)) {
    return failEnvelope(opts.tool, "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
      hint: "Gateway request must not contain open proxy URLs. Closed final_url/file_url/link only.",
    });
  }

  const path =
    opts.family === "gads" ? `${base}/v1/gads/${opts.tool}` : `${base}/v1/meta/${opts.tool}`;
  const requestId = newRequestId();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HOP_TIMEOUT_MS);

  try {
    const res = await ctx.fetchImpl(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${licenseJwt}`,
        "X-DGTL-User-Access-Token": opts.userAccessToken,
        "X-DGTL-Request-Id": requestId,
        "Content-Type": "application/json",
        Accept: "application/json",
        // Never developer-token on the client.
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });

    let parsed: Record<string, unknown> = {};
    try {
      parsed = (await res.json()) as Record<string, unknown>;
    } catch {
      return failEnvelope(opts.tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
        hint: `Gateway returned HTTP ${res.status} with non-JSON body.`,
      });
    }

    if (res.status >= 500 && (!parsed.error_code || parsed.error_code === "GATEWAY_UNAVAILABLE")) {
      return failEnvelope(
        opts.tool,
        "GATEWAY_UNAVAILABLE",
        typeof parsed.message === "string" ? parsed.message : MSG.GATEWAY_UNAVAILABLE,
        {
          hint:
            typeof parsed.hint === "string"
              ? parsed.hint
              : `Worker HTTP ${res.status}. Free GA4/GSC/GTM tools still work.`,
          api: typeof parsed.api === "string" ? parsed.api : undefined,
        },
      );
    }

    return mapGatewayResponse(opts.tool, parsed, res.status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failEnvelope(opts.tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: `Gateway hop failed (${msg}). Check DGTL_GATEWAY_URL. Free tools still work.`,
    });
  } finally {
    clearTimeout(timer);
  }
}
