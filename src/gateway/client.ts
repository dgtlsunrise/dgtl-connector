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
  ad_account_id?: string;
  object_id?: string;
  level?: "account" | "campaign" | "adset" | "ad";
  date_start?: string;
  date_stop?: string;
  creative_id?: string;
};

export type GatewayRequest = {
  tool: string;
  recipe: GatewayRecipe;
  params: GatewayParams;
};

export type GatewayReachable = {
  reachable: boolean;
  note?: string;
};

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
    let body: { ok?: boolean } = {};
    try {
      body = (await res.json()) as { ok?: boolean };
    } catch {
      return { reachable: false, note: "Gateway health returned non-JSON." };
    }
    if (body.ok !== true) {
      return { reachable: false, note: "Gateway health ok≠true." };
    }
    return { reachable: true };
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

function stripUrlishParams(params: Record<string, unknown>): GatewayParams {
  const out: GatewayParams = {};
  const allow = new Set([
    "customer_id",
    "login_customer_id",
    "date_range",
    "where",
    "limit",
    "ad_account_id",
    "object_id",
    "level",
    "date_start",
    "date_stop",
    "creative_id",
  ]);
  for (const [k, v] of Object.entries(params)) {
    if (!allow.has(k)) continue;
    if (typeof v === "string" && /^https?:\/\//i.test(v)) continue;
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
 * Never attaches developer-token. Never sends a URL field.
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

  // Refuse accidental URL keys on the wire (contract: never send a URL).
  const raw = JSON.stringify(body);
  if (/https?:\/\//i.test(raw)) {
    return failEnvelope(opts.tool, "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
      hint: "Gateway request must not contain URLs. Send recipe + params only.",
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
