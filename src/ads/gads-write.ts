/**
 * Google Ads mutate tools — Consent C + gateway only.
 * Flag DGTL_ADS_MUTATE_ENABLED defaults off (fail closed, zero mutate HTTP).
 * Tools: gads_set_campaign_status, gads_update_campaign_budget.
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
  "Set DGTL_ADS_MUTATE_ENABLED=true on the plugin and ADS_MUTATE_ENABLED=true on stamp only after Google Ads API mutate-capable access + compliance. Default stays off. Never add mutate to Consent A.";

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
