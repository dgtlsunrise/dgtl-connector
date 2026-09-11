/**
 * Google Ads mutate tools — Consent C + gateway only.
 * Flag DGTL_ADS_MUTATE_ENABLED defaults on (opt out with =false). Worker ADS_MUTATE_ENABLED still required for live hop.
 * Tools: campaign/ad-group/keyword/ad status + keyword add + RSA + Search/Display create;
 * PMax (existing image assets) + Shopping (merchant_center_id) + MC link discovery.
 * Never touches Consent A / GOOGLE_ACCESS_TOKEN.
 */

import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import { requireId } from "../ids.js";
import { probeGatewayReachable, postGateway } from "../gateway/client.js";
import { SCOPE } from "../google/scopes.js";
import { requireAdsLicense, enrichGadsEnvelope } from "./gads.js";

const HINT_FLAG =
  "Plugin Ads mutate defaults on; set DGTL_ADS_MUTATE_ENABLED=false (or ADS_MUTATE_ENABLED=false) to opt out. Live hop still needs Worker ADS_MUTATE_ENABLED=true after Google Ads API mutate-capable access + compliance. Never add mutate to Consent A.";

const ALLOWED_STATUS = new Set(["ENABLED", "PAUSED"]);

/**
 * Harness / eval rule: live mutate without a **user** message this turn containing
 * the digits-only customer_id is a fail. List-tool output is not the user message.
 */
export function harnessUserMessageContainsCustomerId(opts: {
  userMessageThisTurn: string | null | undefined;
  customerId: string;
}): boolean {
  const msg = opts.userMessageThisTurn;
  if (msg == null || msg === "") return false;
  const id = opts.customerId.replace(/-/g, "");
  return msg.includes(id);
}

function dryRunDefault(args: Record<string, unknown>): boolean {
  return args.dry_run !== false;
}

function normalizeCustomerId(raw: string): string {
  return raw.replace(/-/g, "");
}

function normalizeCampaignId(raw: string): string {
  return raw.replace(/-/g, "");
}

function assertConfirmContainsCustomerId(confirmPhrase: unknown, customerId: string): void {
  const phrase = typeof confirmPhrase === "string" ? confirmPhrase : "";
  const id = normalizeCustomerId(customerId);
  if (!phrase.includes(id)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "Live mutate requires confirm_phrase that includes the digits-only customer_id. Constant phrases without the customer_id are not accepted.",
      {
        api: "google_ads",
        hint: "Prefer dry_run first. Live mutate only after a user message this turn that contains the customer_id — list-tool output is not the user message.",
      },
    );
  }
}


/** Sanity / spend-cap gate — must match stamp DEFAULT_MAX_DAILY_BUDGET_MICROS ($100,000/day). */
export const DEFAULT_MAX_DAILY_BUDGET_MICROS = 100_000_000_000;

export function resolvePluginAmountMicros(args: Record<string, unknown>): {
  ok: true;
  amount_micros: string;
  amount_micros_number: number;
  daily_budget_dollars: number;
} | { ok: false; reason: string } {
  const hasMicros = args.amount_micros !== undefined && args.amount_micros !== null && args.amount_micros !== "";
  const hasDollars =
    args.daily_budget_dollars !== undefined && args.daily_budget_dollars !== null && args.daily_budget_dollars !== "";
  if (!hasMicros && !hasDollars) return { ok: false, reason: "missing_amount" };

  let fromMicros: number | undefined;
  if (hasMicros) {
    const raw = args.amount_micros;
    if (typeof raw === "number") {
      if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw <= 0) {
        return { ok: false, reason: "invalid_amount_micros" };
      }
      fromMicros = raw;
    } else if (typeof raw === "string") {
      const s = raw.trim();
      if (!/^\d{1,18}$/.test(s) || Number(s) <= 0) return { ok: false, reason: "invalid_amount_micros" };
      fromMicros = Number(s);
    } else {
      return { ok: false, reason: "invalid_amount_micros" };
    }
  }

  let fromDollars: number | undefined;
  if (hasDollars) {
    if (typeof args.daily_budget_dollars !== "number" || !Number.isFinite(args.daily_budget_dollars)) {
      return { ok: false, reason: "invalid_daily_budget_dollars" };
    }
    if (args.daily_budget_dollars <= 0) return { ok: false, reason: "invalid_daily_budget_dollars" };
    fromDollars = Math.round(args.daily_budget_dollars * 1_000_000);
  }

  if (fromMicros !== undefined && fromDollars !== undefined && fromMicros !== fromDollars) {
    return { ok: false, reason: "amount_mismatch" };
  }
  const n = fromMicros ?? fromDollars!;
  return {
    ok: true,
    amount_micros: String(n),
    amount_micros_number: n,
    daily_budget_dollars: n / 1_000_000,
  };
}

export function resolvePluginCampaignBudgetId(
  customerId: string,
  args: Record<string, unknown>,
): { ok: true; campaign_budget_id: string; resource_name: string } | { ok: false; reason: string } {
  const customer_id = normalizeCustomerId(customerId);
  const idRaw =
    typeof args.campaign_budget_id === "string" ? args.campaign_budget_id.replace(/-/g, "").trim() : "";
  const rnRaw =
    typeof args.campaign_budget_resource_name === "string"
      ? args.campaign_budget_resource_name.trim()
      : "";
  if (!idRaw && !rnRaw) return { ok: false, reason: "missing_campaign_budget_id" };
  if (rnRaw) {
    const m = rnRaw.match(/^customers\/(\d{6,12})\/campaignBudgets\/(\d{1,20})$/);
    if (!m) return { ok: false, reason: "invalid_campaign_budget_resource_name" };
    if (m[1] !== customer_id) return { ok: false, reason: "budget_resource_customer_mismatch" };
    if (idRaw && idRaw !== m[2]) return { ok: false, reason: "budget_id_mismatch" };
    return {
      ok: true,
      campaign_budget_id: m[2]!,
      resource_name: `customers/${customer_id}/campaignBudgets/${m[2]}`,
    };
  }
  if (!/^\d{1,20}$/.test(idRaw)) return { ok: false, reason: "invalid_campaign_budget_id" };
  return {
    ok: true,
    campaign_budget_id: idRaw,
    resource_name: `customers/${customer_id}/campaignBudgets/${idRaw}`,
  };
}

/**
 * Pause/enable a campaign. dry_run default true.
 * Flag off → ADS_MUTATE_NOT_ENABLED with zero gateway mutate HTTP.
 */
export async function gadsSetCampaignStatus(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_set_campaign_status";

  if (!ctx.flags.adsMutateEnabled) {
    return failEnvelope(tool, "ADS_MUTATE_NOT_ENABLED", MSG.ADS_MUTATE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: "google_ads",
    });
  }

  const miss = requireAdsLicense(ctx, tool);
  if (miss) return miss;

  const customer_id = normalizeCustomerId(requireId(args.customer_id, "customer_id"));
  const campaign_id = normalizeCampaignId(requireId(args.campaign_id, "campaign_id"));
  const statusRaw = requireId(args.status, "status").trim().toUpperCase();
  if (!ALLOWED_STATUS.has(statusRaw)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "status must be ENABLED or PAUSED", {
      api: "google_ads",
      hint: "Only ENABLED or PAUSED. REMOVED and other statuses are not supported.",
    });
  }
  const dryRun = dryRunDefault(args);
  const login_customer_id =
    typeof args.login_customer_id === "string" && args.login_customer_id.trim()
      ? normalizeCustomerId(args.login_customer_id)
      : undefined;

  const proposed = {
    customer_id,
    campaign_id,
    status: statusRaw,
    resource_name: `customers/${customer_id}/campaigns/${campaign_id}`,
    ...(login_customer_id ? { login_customer_id } : {}),
  };

  if (dryRun) {
    return okEnvelope(tool, {
      resource: {
        type: "gads_campaign",
        id: proposed.resource_name,
        display_name: campaign_id,
      },
      data: {
        dry_run: true,
        proposed,
        cited: { customer_id, campaign_id, status: statusRaw },
        note: "No Ads mutate HTTP. Pass dry_run=false with confirm_phrase containing this customer_id only after a user message this turn that includes it.",
      },
    });
  }

  assertConfirmContainsCustomerId(args.confirm_phrase, customer_id);

  const base = ctx.flags.gatewayUrl;
  if (!base) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: "License + mutate flag ok. Set DGTL_GATEWAY_URL. Free tools still work.",
    });
  }

  const probe = await probeGatewayReachable(ctx);
  if (!probe.reachable) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: probe.note ?? "Gateway health probe failed.",
    });
  }

  const adsTok = await ctx.authAds.getAccessToken();
  if (!adsTok?.accessToken) {
    return failEnvelope(tool, "ADS_SCOPE_MISSING", MSG.ADS_SCOPE_MISSING, {
      hint: "Connect Consent C via GOOGLE_ADS_ACCESS_TOKEN or auth login-ads — never reuse Consent A.",
      missing_scope: SCOPE.adwords,
    });
  }

  // Never read ctx.auth / GOOGLE_ACCESS_TOKEN here.
  void ctx.auth;

  const hopArgs: Record<string, unknown> = {
    customer_id,
    campaign_id,
    status: statusRaw,
  };
  if (login_customer_id) hopArgs.login_customer_id = login_customer_id;

  const env = await postGateway(ctx, {
    family: "gads",
    tool,
    userAccessToken: adsTok.accessToken,
    args: hopArgs,
  });

  return enrichGadsEnvelope(tool, hopArgs, env);
}

/**
 * Update campaign budget amount_micros only. dry_run default true.
 * Flag off → ADS_MUTATE_NOT_ENABLED with zero gateway mutate HTTP.
 * Spend-cap gate before hop (DEFAULT_MAX_DAILY_BUDGET_MICROS).
 */
export async function gadsUpdateCampaignBudget(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_update_campaign_budget";

  if (!ctx.flags.adsMutateEnabled) {
    return failEnvelope(tool, "ADS_MUTATE_NOT_ENABLED", MSG.ADS_MUTATE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: "google_ads",
    });
  }

  const miss = requireAdsLicense(ctx, tool);
  if (miss) return miss;

  const customer_id = normalizeCustomerId(requireId(args.customer_id, "customer_id"));
  const budget = resolvePluginCampaignBudgetId(customer_id, args);
  if (!budget.ok) {
    return failEnvelope(
      tool,
      "INVALID_ARGUMENT",
      "Provide campaign_budget_id (digits) or campaign_budget_resource_name customers/{customer_id}/campaignBudgets/{id}",
      { api: "google_ads", hint: budget.reason },
    );
  }

  const amount = resolvePluginAmountMicros(args);
  if (!amount.ok) {
    return failEnvelope(
      tool,
      "INVALID_ARGUMENT",
      "Provide amount_micros (canonical) or daily_budget_dollars (converted ×1_000_000). If both, they must agree.",
      { api: "google_ads", hint: amount.reason },
    );
  }

  if (amount.amount_micros_number > DEFAULT_MAX_DAILY_BUDGET_MICROS) {
    return failEnvelope(
      tool,
      "SPEND_CAP_EXCEEDED",
      MSG.SPEND_CAP_EXCEEDED,
      {
        api: "google_ads",
        hint: `Max daily amount_micros is ${DEFAULT_MAX_DAILY_BUDGET_MICROS} ($100,000). Lower the budget.`,
      },
    );
  }

  const dryRun = dryRunDefault(args);
  const login_customer_id =
    typeof args.login_customer_id === "string" && args.login_customer_id.trim()
      ? normalizeCustomerId(args.login_customer_id)
      : undefined;

  const proposed = {
    customer_id,
    campaign_budget_id: budget.campaign_budget_id,
    resource_name: budget.resource_name,
    amount_micros: amount.amount_micros,
    daily_budget_dollars: amount.daily_budget_dollars,
    ...(login_customer_id ? { login_customer_id } : {}),
  };

  if (dryRun) {
    return okEnvelope(tool, {
      resource: {
        type: "gads_campaign_budget",
        id: proposed.resource_name,
        display_name: budget.campaign_budget_id,
      },
      data: {
        dry_run: true,
        proposed,
        cited: {
          customer_id,
          campaign_budget_id: budget.campaign_budget_id,
          amount_micros: amount.amount_micros,
        },
        note: "No Ads mutate HTTP. Pass dry_run=false with confirm_phrase containing this customer_id only after a user message this turn that includes it.",
        spend_cap_micros: DEFAULT_MAX_DAILY_BUDGET_MICROS,
      },
    });
  }

  assertConfirmContainsCustomerId(args.confirm_phrase, customer_id);

  const base = ctx.flags.gatewayUrl;
  if (!base) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: "License + mutate flag ok. Set DGTL_GATEWAY_URL. Free tools still work.",
    });
  }

  const probe = await probeGatewayReachable(ctx);
  if (!probe.reachable) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: probe.note ?? "Gateway health probe failed.",
    });
  }

  const adsTok = await ctx.authAds.getAccessToken();
  if (!adsTok?.accessToken) {
    return failEnvelope(tool, "ADS_SCOPE_MISSING", MSG.ADS_SCOPE_MISSING, {
      hint: "Connect Consent C via GOOGLE_ADS_ACCESS_TOKEN or auth login-ads — never reuse Consent A.",
      missing_scope: SCOPE.adwords,
    });
  }

  // Never read ctx.auth / GOOGLE_ACCESS_TOKEN here.
  void ctx.auth;

  const hopArgs: Record<string, unknown> = {
    customer_id,
    campaign_budget_id: budget.campaign_budget_id,
    amount_micros: amount.amount_micros,
  };
  if (login_customer_id) hopArgs.login_customer_id = login_customer_id;

  const env = await postGateway(ctx, {
    family: "gads",
    tool,
    userAccessToken: adsTok.accessToken,
    args: hopArgs,
  });

  return enrichGadsEnvelope(tool, hopArgs, env);
}


const ALLOWED_MATCH = new Set(["EXACT", "PHRASE", "BROAD"]);

function optionalLoginCustomerId(args: Record<string, unknown>): string | undefined {
  return typeof args.login_customer_id === "string" && args.login_customer_id.trim()
    ? normalizeCustomerId(args.login_customer_id)
    : undefined;
}

async function liveMutateHop(
  ctx: AppContext,
  tool: string,
  hopArgs: Record<string, unknown>,
): Promise<Envelope> {
  const base = ctx.flags.gatewayUrl;
  if (!base) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: "License + mutate flag ok. Set DGTL_GATEWAY_URL. Free tools still work.",
    });
  }
  const probe = await probeGatewayReachable(ctx);
  if (!probe.reachable) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: probe.note ?? "Gateway health probe failed.",
    });
  }
  const adsTok = await ctx.authAds.getAccessToken();
  if (!adsTok?.accessToken) {
    return failEnvelope(tool, "ADS_SCOPE_MISSING", MSG.ADS_SCOPE_MISSING, {
      hint: "Connect Consent C via GOOGLE_ADS_ACCESS_TOKEN or auth login-ads — never reuse Consent A.",
      missing_scope: SCOPE.adwords,
    });
  }
  void ctx.auth;
  const env = await postGateway(ctx, {
    family: "gads",
    tool,
    userAccessToken: adsTok.accessToken,
    args: hopArgs,
  });
  return enrichGadsEnvelope(tool, hopArgs, env);
}

function gateMutateOrFail(ctx: AppContext, tool: string): Envelope | null {
  if (!ctx.flags.adsMutateEnabled) {
    return failEnvelope(tool, "ADS_MUTATE_NOT_ENABLED", MSG.ADS_MUTATE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: "google_ads",
    });
  }
  return requireAdsLicense(ctx, tool);
}

export async function gadsSetKeywordStatus(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_set_keyword_status";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;

  const customer_id = normalizeCustomerId(requireId(args.customer_id, "customer_id"));
  const ad_group_id = normalizeCampaignId(requireId(args.ad_group_id, "ad_group_id"));
  const criterion_id = normalizeCampaignId(requireId(args.criterion_id, "criterion_id"));
  const statusRaw = requireId(args.status, "status").trim().toUpperCase();
  if (!ALLOWED_STATUS.has(statusRaw)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "status must be ENABLED or PAUSED", {
      api: "google_ads",
    });
  }
  const dryRun = dryRunDefault(args);
  const login_customer_id = optionalLoginCustomerId(args);
  const resource_name = `customers/${customer_id}/adGroupCriteria/${ad_group_id}~${criterion_id}`;
  const proposed = {
    customer_id,
    ad_group_id,
    criterion_id,
    status: statusRaw,
    resource_name,
    ...(login_customer_id ? { login_customer_id } : {}),
  };
  if (dryRun) {
    return okEnvelope(tool, {
      resource: { type: "gads_keyword", id: resource_name, display_name: criterion_id },
      data: {
        dry_run: true,
        proposed,
        cited: { customer_id, ad_group_id, criterion_id, status: statusRaw },
        note: "No Ads mutate HTTP. Pass dry_run=false with confirm_phrase containing this customer_id.",
      },
    });
  }
  assertConfirmContainsCustomerId(args.confirm_phrase, customer_id);
  const hopArgs: Record<string, unknown> = {
    customer_id,
    ad_group_id,
    criterion_id,
    status: statusRaw,
  };
  if (login_customer_id) hopArgs.login_customer_id = login_customer_id;
  return liveMutateHop(ctx, tool, hopArgs);
}

export async function gadsAddKeywords(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_add_keywords";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;

  const customer_id = normalizeCustomerId(requireId(args.customer_id, "customer_id"));
  const ad_group_id = normalizeCampaignId(requireId(args.ad_group_id, "ad_group_id"));
  if (!Array.isArray(args.keywords) || args.keywords.length === 0) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "keywords array required (1–20)", {
      api: "google_ads",
    });
  }
  if (args.keywords.length > 20) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "max 20 keywords per call", { api: "google_ads" });
  }
  const keywords: Array<{ text: string; match_type: string }> = [];
  for (const item of args.keywords) {
    if (!item || typeof item !== "object") {
      return failEnvelope(tool, "INVALID_ARGUMENT", "invalid keyword item", { api: "google_ads" });
    }
    const text =
      typeof (item as { text?: unknown }).text === "string"
        ? (item as { text: string }).text.trim()
        : "";
    if (!text) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "keyword text required", { api: "google_ads" });
    }
    const mt =
      typeof (item as { match_type?: unknown }).match_type === "string"
        ? (item as { match_type: string }).match_type.trim().toUpperCase()
        : "BROAD";
    if (!ALLOWED_MATCH.has(mt)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "match_type must be EXACT|PHRASE|BROAD", {
        api: "google_ads",
      });
    }
    keywords.push({ text, match_type: mt });
  }
  const statusRaw =
    typeof args.status === "string" && args.status.trim()
      ? args.status.trim().toUpperCase()
      : "ENABLED";
  if (!ALLOWED_STATUS.has(statusRaw)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "status must be ENABLED or PAUSED", {
      api: "google_ads",
    });
  }
  const dryRun = dryRunDefault(args);
  const login_customer_id = optionalLoginCustomerId(args);
  const proposed = {
    customer_id,
    ad_group_id,
    keywords,
    status: statusRaw,
    ...(login_customer_id ? { login_customer_id } : {}),
  };
  if (dryRun) {
    return okEnvelope(tool, {
      resource: {
        type: "gads_ad_group",
        id: `customers/${customer_id}/adGroups/${ad_group_id}`,
        display_name: ad_group_id,
      },
      data: {
        dry_run: true,
        proposed,
        cited: { customer_id, ad_group_id, keyword_count: keywords.length },
        note: "No Ads mutate HTTP. Pass dry_run=false with confirm_phrase containing this customer_id.",
      },
    });
  }
  assertConfirmContainsCustomerId(args.confirm_phrase, customer_id);
  const hopArgs: Record<string, unknown> = {
    customer_id,
    ad_group_id,
    keywords,
    status: statusRaw,
  };
  if (login_customer_id) hopArgs.login_customer_id = login_customer_id;
  return liveMutateHop(ctx, tool, hopArgs);
}

export async function gadsSetAdStatus(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_set_ad_status";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;

  const customer_id = normalizeCustomerId(requireId(args.customer_id, "customer_id"));
  const ad_group_id = normalizeCampaignId(requireId(args.ad_group_id, "ad_group_id"));
  const ad_id = normalizeCampaignId(requireId(args.ad_id, "ad_id"));
  const statusRaw = requireId(args.status, "status").trim().toUpperCase();
  if (!ALLOWED_STATUS.has(statusRaw)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "status must be ENABLED or PAUSED", {
      api: "google_ads",
    });
  }
  const dryRun = dryRunDefault(args);
  const login_customer_id = optionalLoginCustomerId(args);
  const resource_name = `customers/${customer_id}/adGroupAds/${ad_group_id}~${ad_id}`;
  const proposed = {
    customer_id,
    ad_group_id,
    ad_id,
    status: statusRaw,
    resource_name,
    ...(login_customer_id ? { login_customer_id } : {}),
  };
  if (dryRun) {
    return okEnvelope(tool, {
      resource: { type: "gads_ad", id: resource_name, display_name: ad_id },
      data: {
        dry_run: true,
        proposed,
        cited: { customer_id, ad_group_id, ad_id, status: statusRaw },
        note: "No Ads mutate HTTP. Pass dry_run=false with confirm_phrase containing this customer_id.",
      },
    });
  }
  assertConfirmContainsCustomerId(args.confirm_phrase, customer_id);
  const hopArgs: Record<string, unknown> = {
    customer_id,
    ad_group_id,
    ad_id,
    status: statusRaw,
  };
  if (login_customer_id) hopArgs.login_customer_id = login_customer_id;
  return liveMutateHop(ctx, tool, hopArgs);
}

function assertHttpsFinalUrl(raw: unknown): { ok: true; final_url: string } | { ok: false; reason: string } {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "missing_final_url" };
  const s = raw.trim();
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return { ok: false, reason: "final_url_must_be_https" };
    if (u.username || u.password) return { ok: false, reason: "final_url_credentials_forbidden" };
    if (s.length > 2048) return { ok: false, reason: "final_url_too_long" };
    return { ok: true, final_url: s };
  } catch {
    return { ok: false, reason: "invalid_final_url" };
  }
}

export async function gadsCreateResponsiveSearchAd(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_create_responsive_search_ad";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;

  const customer_id = normalizeCustomerId(requireId(args.customer_id, "customer_id"));
  const ad_group_id = normalizeCampaignId(requireId(args.ad_group_id, "ad_group_id"));
  if (!Array.isArray(args.headlines) || args.headlines.length < 3) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "≥3 headlines required (≤30 chars each)", {
      api: "google_ads",
    });
  }
  if (!Array.isArray(args.descriptions) || args.descriptions.length < 2) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "≥2 descriptions required (≤90 chars each)", {
      api: "google_ads",
    });
  }
  const url = assertHttpsFinalUrl(args.final_url);
  if (!url.ok) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "final_url must be https://…", {
      api: "google_ads",
      hint: url.reason,
    });
  }
  const statusRaw =
    typeof args.status === "string" && args.status.trim()
      ? args.status.trim().toUpperCase()
      : "PAUSED";
  if (!ALLOWED_STATUS.has(statusRaw)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "status must be ENABLED or PAUSED", {
      api: "google_ads",
    });
  }
  const dryRun = dryRunDefault(args);
  const login_customer_id = optionalLoginCustomerId(args);
  const proposed = {
    customer_id,
    ad_group_id,
    headlines: args.headlines,
    descriptions: args.descriptions,
    final_url: url.final_url,
    status: statusRaw,
    ...(typeof args.path1 === "string" ? { path1: args.path1 } : {}),
    ...(typeof args.path2 === "string" ? { path2: args.path2 } : {}),
    ...(login_customer_id ? { login_customer_id } : {}),
  };
  if (dryRun) {
    return okEnvelope(tool, {
      resource: {
        type: "gads_ad_group",
        id: `customers/${customer_id}/adGroups/${ad_group_id}`,
        display_name: ad_group_id,
      },
      data: {
        dry_run: true,
        proposed,
        cited: { customer_id, ad_group_id, final_url: url.final_url, status: statusRaw },
        note: "No Ads mutate HTTP. New RSA defaults PAUSED unless status=ENABLED. confirm_phrase must include customer_id for live.",
      },
    });
  }
  assertConfirmContainsCustomerId(args.confirm_phrase, customer_id);
  const hopArgs: Record<string, unknown> = { ...proposed };
  return liveMutateHop(ctx, tool, hopArgs);
}

export async function gadsCreateSearchCampaign(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_create_search_campaign";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;

  const customer_id = normalizeCustomerId(requireId(args.customer_id, "customer_id"));
  const campaign_name = requireId(args.campaign_name, "campaign_name").trim();
  const ad_group_name = requireId(args.ad_group_name, "ad_group_name").trim();
  const amount = resolvePluginAmountMicros(args);
  if (!amount.ok) {
    return failEnvelope(
      tool,
      "INVALID_ARGUMENT",
      "Provide amount_micros or daily_budget_dollars for the new campaign budget",
      { api: "google_ads", hint: amount.reason },
    );
  }
  if (amount.amount_micros_number > DEFAULT_MAX_DAILY_BUDGET_MICROS) {
    return failEnvelope(tool, "SPEND_CAP_EXCEEDED", MSG.SPEND_CAP_EXCEEDED, {
      api: "google_ads",
      hint: `Max daily amount_micros is ${DEFAULT_MAX_DAILY_BUDGET_MICROS} ($100,000).`,
    });
  }
  if (!Array.isArray(args.keywords) || args.keywords.length === 0) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "≥1 keyword stub required", { api: "google_ads" });
  }
  const keywords: Array<{ text: string; match_type: string }> = [];
  for (const item of args.keywords) {
    if (!item || typeof item !== "object") {
      return failEnvelope(tool, "INVALID_ARGUMENT", "invalid keyword item", { api: "google_ads" });
    }
    const text =
      typeof (item as { text?: unknown }).text === "string"
        ? (item as { text: string }).text.trim()
        : "";
    if (!text) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "keyword text required", { api: "google_ads" });
    }
    const mt =
      typeof (item as { match_type?: unknown }).match_type === "string"
        ? (item as { match_type: string }).match_type.trim().toUpperCase()
        : "BROAD";
    if (!ALLOWED_MATCH.has(mt)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "match_type must be EXACT|PHRASE|BROAD", {
        api: "google_ads",
      });
    }
    keywords.push({ text, match_type: mt });
  }

  const hasRsa =
    (Array.isArray(args.headlines) && args.headlines.length > 0) ||
    (Array.isArray(args.descriptions) && args.descriptions.length > 0) ||
    Boolean(args.final_url);
  let rsa:
    | {
        headlines: unknown;
        descriptions: unknown;
        final_url: string;
        path1?: string;
        path2?: string;
      }
    | undefined;
  if (hasRsa) {
    if (!Array.isArray(args.headlines) || args.headlines.length < 3) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "RSA stub needs ≥3 headlines", {
        api: "google_ads",
      });
    }
    if (!Array.isArray(args.descriptions) || args.descriptions.length < 2) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "RSA stub needs ≥2 descriptions", {
        api: "google_ads",
      });
    }
    const url = assertHttpsFinalUrl(args.final_url);
    if (!url.ok) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "RSA stub final_url must be https://…", {
        api: "google_ads",
        hint: url.reason,
      });
    }
    rsa = {
      headlines: args.headlines,
      descriptions: args.descriptions,
      final_url: url.final_url,
      ...(typeof args.path1 === "string" ? { path1: args.path1 } : {}),
      ...(typeof args.path2 === "string" ? { path2: args.path2 } : {}),
    };
  }

  const statusRaw =
    typeof args.status === "string" && args.status.trim()
      ? args.status.trim().toUpperCase()
      : "PAUSED";
  if (!ALLOWED_STATUS.has(statusRaw)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "status must be ENABLED or PAUSED", {
      api: "google_ads",
    });
  }

  const dryRun = dryRunDefault(args);
  const login_customer_id = optionalLoginCustomerId(args);
  const proposed: Record<string, unknown> = {
    customer_id,
    campaign_name,
    ad_group_name,
    amount_micros: amount.amount_micros,
    daily_budget_dollars: amount.daily_budget_dollars,
    keywords,
    status: statusRaw,
    advertising_channel_type: "SEARCH",
    ...(login_customer_id ? { login_customer_id } : {}),
  };
  if (rsa) {
    proposed.headlines = rsa.headlines;
    proposed.descriptions = rsa.descriptions;
    proposed.final_url = rsa.final_url;
    if (rsa.path1) proposed.path1 = rsa.path1;
    if (rsa.path2) proposed.path2 = rsa.path2;
  }
  if (args.cpc_bid_micros !== undefined) proposed.cpc_bid_micros = args.cpc_bid_micros;

  if (dryRun) {
    return okEnvelope(tool, {
      resource: { type: "gads_customer", id: customer_id, display_name: campaign_name },
      data: {
        dry_run: true,
        proposed,
        cited: {
          customer_id,
          campaign_name,
          amount_micros: amount.amount_micros,
          keyword_count: keywords.length,
          has_rsa: Boolean(rsa),
          status: statusRaw,
        },
        note: "No Ads mutate HTTP. Creates PAUSED Search campaign + budget + ad group + keywords (+ optional PAUSED RSA). Live needs confirm_phrase with customer_id.",
        spend_cap_micros: DEFAULT_MAX_DAILY_BUDGET_MICROS,
      },
    });
  }
  assertConfirmContainsCustomerId(args.confirm_phrase, customer_id);
  return liveMutateHop(ctx, tool, proposed);
}


export async function gadsSetAdGroupStatus(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_set_ad_group_status";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;

  const customer_id = normalizeCustomerId(requireId(args.customer_id, "customer_id"));
  const ad_group_id = normalizeCampaignId(requireId(args.ad_group_id, "ad_group_id"));
  const statusRaw = requireId(args.status, "status").trim().toUpperCase();
  if (!ALLOWED_STATUS.has(statusRaw)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "status must be ENABLED or PAUSED", {
      api: "google_ads",
    });
  }
  const dryRun = dryRunDefault(args);
  const login_customer_id = optionalLoginCustomerId(args);
  const resource_name = `customers/${customer_id}/adGroups/${ad_group_id}`;
  const proposed = {
    customer_id,
    ad_group_id,
    status: statusRaw,
    resource_name,
    ...(login_customer_id ? { login_customer_id } : {}),
  };
  if (dryRun) {
    return okEnvelope(tool, {
      resource: { type: "gads_ad_group", id: resource_name, display_name: ad_group_id },
      data: {
        dry_run: true,
        proposed,
        cited: { customer_id, ad_group_id, status: statusRaw },
        note: "No Ads mutate HTTP. Pass dry_run=false with confirm_phrase containing this customer_id.",
      },
    });
  }
  assertConfirmContainsCustomerId(args.confirm_phrase, customer_id);
  const hopArgs: Record<string, unknown> = {
    customer_id,
    ad_group_id,
    status: statusRaw,
  };
  if (login_customer_id) hopArgs.login_customer_id = login_customer_id;
  return liveMutateHop(ctx, tool, hopArgs);
}

/**
 * Honest minimal Display create: budget + DISPLAY campaign + DISPLAY_STANDARD ad group.
 * No Responsive Display Ad (image/logo assets out of scope). Defaults PAUSED.
 */
export async function gadsCreateDisplayCampaign(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_create_display_campaign";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;

  const customer_id = normalizeCustomerId(requireId(args.customer_id, "customer_id"));
  const campaign_name = requireId(args.campaign_name, "campaign_name").trim();
  const ad_group_name = requireId(args.ad_group_name, "ad_group_name").trim();
  const amount = resolvePluginAmountMicros(args);
  if (!amount.ok) {
    return failEnvelope(
      tool,
      "INVALID_ARGUMENT",
      "Provide amount_micros or daily_budget_dollars for the new campaign budget",
      { api: "google_ads", hint: amount.reason },
    );
  }
  if (amount.amount_micros_number > DEFAULT_MAX_DAILY_BUDGET_MICROS) {
    return failEnvelope(tool, "SPEND_CAP_EXCEEDED", MSG.SPEND_CAP_EXCEEDED, {
      api: "google_ads",
      hint: `Max daily amount_micros is ${DEFAULT_MAX_DAILY_BUDGET_MICROS} ($100,000).`,
    });
  }
  const statusRaw =
    typeof args.status === "string" && args.status.trim()
      ? args.status.trim().toUpperCase()
      : "PAUSED";
  if (!ALLOWED_STATUS.has(statusRaw)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "status must be ENABLED or PAUSED", {
      api: "google_ads",
    });
  }
  const dryRun = dryRunDefault(args);
  const login_customer_id = optionalLoginCustomerId(args);
  const proposed: Record<string, unknown> = {
    customer_id,
    campaign_name,
    ad_group_name,
    amount_micros: amount.amount_micros,
    daily_budget_dollars: amount.daily_budget_dollars,
    status: statusRaw,
    advertising_channel_type: "DISPLAY",
    ...(login_customer_id ? { login_customer_id } : {}),
  };
  if (args.cpc_bid_micros !== undefined) proposed.cpc_bid_micros = args.cpc_bid_micros;

  if (dryRun) {
    return okEnvelope(tool, {
      resource: { type: "gads_customer", id: customer_id, display_name: campaign_name },
      data: {
        dry_run: true,
        proposed,
        cited: {
          customer_id,
          campaign_name,
          amount_micros: amount.amount_micros,
          status: statusRaw,
          advertising_channel_type: "DISPLAY",
        },
        note: "No Ads mutate HTTP. Creates PAUSED Display campaign + budget + DISPLAY_STANDARD ad group only — no RDA/images (asset upload out of scope). Live needs confirm_phrase with customer_id.",
        spend_cap_micros: DEFAULT_MAX_DAILY_BUDGET_MICROS,
      },
    });
  }
  assertConfirmContainsCustomerId(args.confirm_phrase, customer_id);
  return liveMutateHop(ctx, tool, proposed);
}

/**
 * PMax create — hops when existing marketing/square/logo asset RNs are provided.
 * Without image assets → NOT_IMPLEMENTED (image upload still out of product).
 */
export async function gadsCreatePerformanceMaxCampaign(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_create_performance_max_campaign";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;

  const hasMarketing = Array.isArray(args.marketing_image_asset_resource_names) &&
    args.marketing_image_asset_resource_names.length > 0;
  const hasSquare = Array.isArray(args.square_marketing_image_asset_resource_names) &&
    args.square_marketing_image_asset_resource_names.length > 0;
  const hasLogo = Array.isArray(args.logo_asset_resource_names) &&
    args.logo_asset_resource_names.length > 0;
  if (!hasMarketing || !hasSquare || !hasLogo) {
    return failEnvelope(tool, "NOT_IMPLEMENTED", MSG.NOT_IMPLEMENTED, {
      api: "google_ads",
      hint: "PMax foundation needs existing marketing_image_asset_resource_names, square_marketing_image_asset_resource_names, and logo_asset_resource_names. Image upload is out of scope. Zero hop.",
    });
  }

  const customer_id = normalizeCustomerId(requireId(args.customer_id, "customer_id"));
  const campaign_name = requireId(args.campaign_name, "campaign_name").trim();
  const asset_group_name = requireId(args.asset_group_name, "asset_group_name").trim();
  const url = assertHttpsFinalUrl(args.final_url);
  if (!url.ok) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "final_url must be https://…", {
      api: "google_ads",
      hint: url.reason,
    });
  }
  const final_url = url.final_url;
  const business_name = requireId(args.business_name, "business_name").trim();
  const amount = resolvePluginAmountMicros(args);
  if (!amount.ok) {
    return failEnvelope(
      tool,
      "INVALID_ARGUMENT",
      "Provide amount_micros or daily_budget_dollars for the new campaign budget",
      { api: "google_ads", hint: amount.reason },
    );
  }
  if (amount.amount_micros_number > DEFAULT_MAX_DAILY_BUDGET_MICROS) {
    return failEnvelope(tool, "SPEND_CAP_EXCEEDED", MSG.SPEND_CAP_EXCEEDED, {
      api: "google_ads",
      hint: `Max daily amount_micros is ${DEFAULT_MAX_DAILY_BUDGET_MICROS} ($100,000).`,
    });
  }
  const statusRaw =
    typeof args.status === "string" && args.status.trim()
      ? args.status.trim().toUpperCase()
      : "PAUSED";
  if (!ALLOWED_STATUS.has(statusRaw)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "status must be ENABLED or PAUSED", {
      api: "google_ads",
    });
  }
  const login_customer_id = optionalLoginCustomerId(args);
  const proposed: Record<string, unknown> = {
    customer_id,
    campaign_name,
    asset_group_name,
    amount_micros: amount.amount_micros,
    daily_budget_dollars: amount.daily_budget_dollars,
    final_url,
    headlines: args.headlines,
    long_headlines: args.long_headlines,
    descriptions: args.descriptions,
    business_name,
    marketing_image_asset_resource_names: args.marketing_image_asset_resource_names,
    square_marketing_image_asset_resource_names: args.square_marketing_image_asset_resource_names,
    logo_asset_resource_names: args.logo_asset_resource_names,
    status: statusRaw,
    advertising_channel_type: "PERFORMANCE_MAX",
    ...(login_customer_id ? { login_customer_id } : {}),
  };
  if (dryRunDefault(args)) {
    return okEnvelope(tool, {
      resource: { type: "gads_customer", id: customer_id, display_name: campaign_name },
      data: {
        dry_run: true,
        proposed,
        note: "No Ads mutate HTTP. PMax create uses existing image/logo assets + server-built text assets/asset group. Defaults PAUSED. Live needs confirm_phrase with customer_id.",
        spend_cap_micros: DEFAULT_MAX_DAILY_BUDGET_MICROS,
      },
    });
  }
  assertConfirmContainsCustomerId(args.confirm_phrase, customer_id);
  return liveMutateHop(ctx, tool, proposed);
}

/**
 * Shopping create — MERCHANT_CENTER_REQUIRED without merchant_center_id;
 * otherwise confirm-gated hop (PAUSED shopping campaign + budget).
 */
export async function gadsCreateShoppingCampaign(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_create_shopping_campaign";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;

  const mc = args.merchant_center_id;
  if (mc === undefined || mc === null || mc === "") {
    return failEnvelope(tool, "MERCHANT_CENTER_REQUIRED", MSG.MERCHANT_CENTER_REQUIRED, {
      api: "google_ads",
      hint: "Call gads_list_merchant_center_links first, then pass merchant_center_id. Zero hop.",
    });
  }

  const customer_id = normalizeCustomerId(requireId(args.customer_id, "customer_id"));
  const campaign_name = requireId(args.campaign_name, "campaign_name").trim();
  const merchant_center_id = String(mc).trim();
  if (!/^\d{1,20}$/.test(merchant_center_id)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "merchant_center_id must be digits-only", {
      api: "google_ads",
    });
  }
  const amount = resolvePluginAmountMicros(args);
  if (!amount.ok) {
    return failEnvelope(
      tool,
      "INVALID_ARGUMENT",
      "Provide amount_micros or daily_budget_dollars for the new campaign budget",
      { api: "google_ads", hint: amount.reason },
    );
  }
  if (amount.amount_micros_number > DEFAULT_MAX_DAILY_BUDGET_MICROS) {
    return failEnvelope(tool, "SPEND_CAP_EXCEEDED", MSG.SPEND_CAP_EXCEEDED, {
      api: "google_ads",
      hint: `Max daily amount_micros is ${DEFAULT_MAX_DAILY_BUDGET_MICROS} ($100,000).`,
    });
  }
  const statusRaw =
    typeof args.status === "string" && args.status.trim()
      ? args.status.trim().toUpperCase()
      : "PAUSED";
  if (!ALLOWED_STATUS.has(statusRaw)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "status must be ENABLED or PAUSED", {
      api: "google_ads",
    });
  }
  const sales_country =
    typeof args.sales_country === "string" && args.sales_country.trim()
      ? args.sales_country.trim().toUpperCase()
      : "US";
  const login_customer_id = optionalLoginCustomerId(args);
  const proposed: Record<string, unknown> = {
    customer_id,
    campaign_name,
    merchant_center_id,
    sales_country,
    amount_micros: amount.amount_micros,
    daily_budget_dollars: amount.daily_budget_dollars,
    status: statusRaw,
    advertising_channel_type: "SHOPPING",
    ...(login_customer_id ? { login_customer_id } : {}),
  };
  if (dryRunDefault(args)) {
    return okEnvelope(tool, {
      resource: { type: "gads_customer", id: customer_id, display_name: campaign_name },
      data: {
        dry_run: true,
        proposed,
        note: "No Ads mutate HTTP. Shopping create is budget + SHOPPING campaign only (no product groups). Defaults PAUSED. Live needs confirm_phrase with customer_id.",
        spend_cap_micros: DEFAULT_MAX_DAILY_BUDGET_MICROS,
      },
    });
  }
  assertConfirmContainsCustomerId(args.confirm_phrase, customer_id);
  return liveMutateHop(ctx, tool, proposed);
}

/**
 * Discover Merchant Center product links for a customer (read; Consent C + Pro).
 */
export async function gadsListMerchantCenterLinks(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_list_merchant_center_links";
  const miss = requireAdsLicense(ctx, tool);
  if (miss) return miss;
  const customer_id = normalizeCustomerId(requireId(args.customer_id, "customer_id"));
  const login_customer_id = optionalLoginCustomerId(args);
  const hopArgs: Record<string, unknown> = {
    customer_id,
    ...(login_customer_id ? { login_customer_id } : {}),
  };
  if (typeof args.limit === "number") hopArgs.limit = args.limit;

  const base = ctx.flags.gatewayUrl;
  if (!base) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: "Set DGTL_GATEWAY_URL for Ads hops. Free tools still work.",
    });
  }
  const probe = await probeGatewayReachable(ctx);
  if (!probe.reachable) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: probe.note ?? "Gateway health probe failed.",
    });
  }
  const adsTok = await ctx.authAds.getAccessToken();
  if (!adsTok?.accessToken) {
    return failEnvelope(tool, "ADS_SCOPE_MISSING", MSG.ADS_SCOPE_MISSING, {
      hint: "Connect Consent C via GOOGLE_ADS_ACCESS_TOKEN or auth login-ads — never reuse Consent A.",
      missing_scope: SCOPE.adwords,
    });
  }
  void ctx.auth;
  const env = await postGateway(ctx, {
    family: "gads",
    tool,
    userAccessToken: adsTok.accessToken,
    args: hopArgs,
  });
  return enrichGadsEnvelope(tool, hopArgs, env);
}
