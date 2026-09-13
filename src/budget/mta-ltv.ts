/**
 * Wave 21 MTA / LTV → budget proposal.
 * Compares GA4 DDA (Ads-id dimensions) to Ads last-click recipes.
 * Proposes per-platform confirm-gated budget tools — never a mega allocate_budgets.
 */

import { MSG, ToolError } from "../errors.js";
import { requireId } from "../ids.js";

export const PLATFORM_BUDGET_TOOLS = {
  gads: "gads_update_campaign_budget",
  meta: "meta_update_adset",
  tiktok: "tiktok_update_campaign_budget",
} as const;

export type BudgetPlatform = keyof typeof PLATFORM_BUDGET_TOOLS;

export const PLATFORM_ORDER = ["gads", "meta", "tiktok"] as const;

export const MAX_DAILY_BUDGET_DOLLARS = 100_000;

/** LTV-ish apiNames — only use when ga4_get_metadata listed them. Never invent. */
export const LTV_API_NAMES = ["userLifetimeValue", "lifetimeValue", "userLtv"] as const;

export type Ga4MtaRow = {
  campaign_id: string;
  key_events?: number;
  sessions?: number;
  ltv?: number;
};

export type AdsLastClickRow = {
  campaign_id: string;
  conversions?: number;
  cost_micros?: number;
};

export type CurrentBudget = {
  platform: BudgetPlatform;
  campaign_id?: string;
  customer_id?: string;
  campaign_budget_id?: string;
  ad_account_id?: string;
  adset_id?: string;
  advertiser_id?: string;
  current_daily_budget_dollars: number;
};

export type ProposedBudgetCall = {
  platform: BudgetPlatform;
  tool: (typeof PLATFORM_BUDGET_TOOLS)[BudgetPlatform];
  dry_run: true;
  proposed_daily_budget_dollars: number;
  share: number;
  ga4_key_events: number;
  ads_last_click_conversions: number;
  args: Record<string, unknown>;
};

export type MtaLtvProposal = {
  property_id: string;
  ga4_attribution_model: string;
  ads_reporting_model: "last_click_or_ads_reporting";
  winner: null;
  note: string;
  used_ltv: boolean;
  proposals: ProposedBudgetCall[];
  sequence: BudgetPlatform[];
  next_platform: BudgetPlatform | null;
};

function isPlatform(raw: string): raw is BudgetPlatform {
  return raw === "gads" || raw === "meta" || raw === "tiktok";
}

function metadataSet(names: readonly string[]): Set<string> {
  return new Set(names.map((n) => n.trim()).filter(Boolean));
}

export function assertMetadataNames(requested: readonly string[], metadataNames: readonly string[]): void {
  const have = metadataSet(metadataNames);
  for (const raw of requested) {
    const name = raw.trim();
    if (!name) continue;
    if (!have.has(name)) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        `Metric or dimension ${name} is not in ga4_get_metadata for this property.`,
        {
          hint: "Cite apiName from ga4_get_metadata. Do not invent userLifetimeValue or Ads last-click as GA4 fields.",
        },
      );
    }
  }
}

export function assertLtvFromMetadata(requested: readonly string[], metadataNames: readonly string[]): void {
  const have = metadataSet(metadataNames);
  for (const raw of requested) {
    const name = raw.trim();
    if (!(LTV_API_NAMES as readonly string[]).includes(name)) continue;
    if (!have.has(name)) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        `${name} is not in this property's metadata — do not invent userLifetimeValue.`,
        {
          hint: "Call ga4_get_metadata. If LTV is absent, propose budgets from keyEvents / sessions + Ads-id dimensions only.",
        },
      );
    }
  }
}

export function assertNoGa4Gclid(names: unknown): void {
  if (!names) return;
  const list = Array.isArray(names) ? names : [names];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const key = raw.trim().toLowerCase();
    if (key === "gclid" || key.endsWith("gclid") || key.includes("gclid")) {
      throw new ToolError("UNSUPPORTED_DIMENSION", MSG.UNSUPPORTED_DIMENSION, {
        hint: "gclid is not a GA4 dimension. Use gads_search recipe=click_view (Consent C + Pro). Join on Ads-id dimensions (sessionGoogleAdsCampaignId), not gclid.",
      });
    }
  }
}

export function assertOnePlatformPerConfirm(platforms: readonly string[]): BudgetPlatform {
  if (platforms.length !== 1) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "Confirm exactly one platform per turn (gads, meta, or tiktok).",
      {
        hint: "Skill sequences gads_update_campaign_budget, then meta_update_adset, then tiktok_update_campaign_budget. There is no allocate_budgets tool.",
      },
    );
  }
  const raw = platforms[0]!;
  if (!isPlatform(raw)) {
    throw new ToolError("INVALID_ARGUMENT", "platform must be gads, meta, or tiktok", {
      hint: "One named budget tool per confirm.",
    });
  }
  return raw;
}

function platformTool(platform: BudgetPlatform): (typeof PLATFORM_BUDGET_TOOLS)[BudgetPlatform] {
  switch (platform) {
    case "gads":
      return PLATFORM_BUDGET_TOOLS.gads;
    case "meta":
      return PLATFORM_BUDGET_TOOLS.meta;
    case "tiktok":
      return PLATFORM_BUDGET_TOOLS.tiktok;
    default: {
      const _never: never = platform;
      throw new ToolError("INVALID_ARGUMENT", `Unknown platform ${String(_never)}`);
    }
  }
}

function dollarsOrFail(n: number, field: string): number {
  if (!Number.isFinite(n) || n < 0) {
    throw new ToolError("INVALID_ARGUMENT", `${field} must be a non-negative number`);
  }
  if (n > MAX_DAILY_BUDGET_DOLLARS) {
    throw new ToolError("SPEND_CAP_EXCEEDED", MSG.SPEND_CAP_EXCEEDED, {
      hint: `Max daily budget is $${MAX_DAILY_BUDGET_DOLLARS}.`,
    });
  }
  return Math.round(n * 100) / 100;
}

function weightForRow(
  row: Ga4MtaRow,
  useLtv: boolean,
): { weight: number; key_events: number; sessions: number; ltv: number } {
  const key_events = Number.isFinite(row.key_events) ? Math.max(0, Number(row.key_events)) : 0;
  const sessions = Number.isFinite(row.sessions) ? Math.max(0, Number(row.sessions)) : 0;
  const ltv = Number.isFinite(row.ltv) ? Math.max(0, Number(row.ltv)) : 0;
  const weight = useLtv && ltv > 0 ? ltv : key_events > 0 ? key_events : sessions;
  return { weight, key_events, sessions, ltv };
}

function adsConversions(rows: AdsLastClickRow[], campaignId: string): number {
  let n = 0;
  for (const row of rows) {
    if (row.campaign_id !== campaignId) continue;
    n += Number.isFinite(row.conversions) ? Math.max(0, Number(row.conversions)) : 0;
  }
  return n;
}

function buildArgs(row: CurrentBudget, dollars: number): Record<string, unknown> {
  switch (row.platform) {
    case "gads": {
      const customer_id = requireId(row.customer_id, "customer_id");
      const campaign_budget_id = requireId(row.campaign_budget_id, "campaign_budget_id");
      return {
        customer_id,
        campaign_budget_id,
        daily_budget_dollars: dollars,
        dry_run: true,
      };
    }
    case "meta": {
      const ad_account_id = requireId(row.ad_account_id, "ad_account_id");
      const adset_id = requireId(row.adset_id, "adset_id");
      return {
        ad_account_id,
        adset_id,
        daily_budget: Math.round(dollars * 100),
        dry_run: true,
      };
    }
    case "tiktok": {
      const advertiser_id = requireId(row.advertiser_id, "advertiser_id");
      const campaign_id = requireId(row.campaign_id, "campaign_id");
      return {
        advertiser_id,
        campaign_id,
        budget: dollars,
        budget_mode: "BUDGET_MODE_DAY",
        dry_run: true,
      };
    }
    default: {
      const _never: never = row.platform;
      throw new ToolError("INVALID_ARGUMENT", `Unknown platform ${String(_never)}`);
    }
  }
}

export function proposeMtaLtvBudgets(input: {
  property_id: string;
  metadata_metric_names: readonly string[];
  requested_metrics?: readonly string[];
  requested_dimensions?: readonly string[];
  ga4_attribution_model?: string;
  ga4_rows: Ga4MtaRow[];
  ads_last_click_rows?: AdsLastClickRow[];
  current_budgets: CurrentBudget[];
  pool_daily_budget_dollars: number;
}): MtaLtvProposal {
  const property_id = requireId(input.property_id, "property_id");
  assertNoGa4Gclid(input.requested_dimensions);
  assertNoGa4Gclid(input.requested_metrics);
  const requested = [...(input.requested_metrics ?? []), ...(input.requested_dimensions ?? [])];
  assertLtvFromMetadata(requested, input.metadata_metric_names);
  if (requested.length) assertMetadataNames(requested, input.metadata_metric_names);

  const have = metadataSet(input.metadata_metric_names);
  const askedLtv = requested.some((n) => (LTV_API_NAMES as readonly string[]).includes(n.trim()));
  const used_ltv = askedLtv && LTV_API_NAMES.some((n) => have.has(n));

  const pool = dollarsOrFail(input.pool_daily_budget_dollars, "pool_daily_budget_dollars");
  if (input.current_budgets.length < 1) {
    throw new ToolError("RESOURCE_REQUIRED", "Name at least one current budget (platform + ids).", {
      hint: "gads needs customer_id + campaign_budget_id; Meta needs ad_account_id + adset_id; TikTok needs advertiser_id + campaign_id.",
    });
  }

  const adsRows = input.ads_last_click_rows ?? [];
  const weights: number[] = [];
  const keyed: Array<{
    budget: CurrentBudget;
    key_events: number;
    ads_conversions: number;
    weight: number;
  }> = [];

  for (const budget of input.current_budgets) {
    if (!isPlatform(budget.platform)) {
      throw new ToolError("INVALID_ARGUMENT", "platform must be gads, meta, or tiktok");
    }
    dollarsOrFail(budget.current_daily_budget_dollars, "current_daily_budget_dollars");
    const campaign_id = typeof budget.campaign_id === "string" ? budget.campaign_id.trim() : "";
    const ga4 = input.ga4_rows.find((r) => r.campaign_id === campaign_id);
    const w = ga4
      ? weightForRow(ga4, used_ltv)
      : { weight: 0, key_events: 0, sessions: 0, ltv: 0 };
    keyed.push({
      budget,
      key_events: w.key_events,
      ads_conversions: campaign_id ? adsConversions(adsRows, campaign_id) : 0,
      weight: w.weight,
    });
    weights.push(w.weight);
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const proposals: ProposedBudgetCall[] = [];
  const seen = new Set<BudgetPlatform>();

  for (const row of keyed) {
    const share = totalWeight > 0 ? row.weight / totalWeight : 1 / keyed.length;
    const dollars = dollarsOrFail(pool * share, "proposed_daily_budget_dollars");
    const platform = row.budget.platform;
    seen.add(platform);
    proposals.push({
      platform,
      tool: platformTool(platform),
      dry_run: true,
      proposed_daily_budget_dollars: dollars,
      share: Math.round(share * 10000) / 10000,
      ga4_key_events: row.key_events,
      ads_last_click_conversions: row.ads_conversions,
      args: buildArgs(row.budget, dollars),
    });
  }

  const sequence = PLATFORM_ORDER.filter((p) => seen.has(p));
  const model = (input.ga4_attribution_model ?? "").trim() || "UNKNOWN";

  return {
    property_id,
    ga4_attribution_model: model,
    ads_reporting_model: "last_click_or_ads_reporting",
    winner: null,
    note: "GA4 DDA / Ads-id key events (and metadata LTV when present) weight the proposal. Ads last-click recipes are a second series — not sole truth. dry_run stays true. Confirm one platform at a time. No allocate_budgets tool.",
    used_ltv,
    proposals,
    sequence,
    next_platform: sequence[0] ?? null,
  };
}

export function nextPlatformAfterConfirm(
  proposal: MtaLtvProposal,
  confirmed: readonly string[],
): { done: true } | { platform: BudgetPlatform; tool: string } {
  const seen = new Set<BudgetPlatform>();
  for (const raw of confirmed) {
    if (!isPlatform(raw)) {
      throw new ToolError("INVALID_ARGUMENT", "platform must be gads, meta, or tiktok");
    }
    if (seen.has(raw)) {
      throw new ToolError("INVALID_ARGUMENT", "Confirm each platform once, in sequence.");
    }
    seen.add(raw);
  }
  for (let i = 0; i < confirmed.length; i += 1) {
    if (proposal.sequence[i] !== confirmed[i]) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        `Confirm ${proposal.sequence[i] ?? "the next sequenced platform"} before ${confirmed[i]}.`,
        { hint: "One platform per confirm, in gads → meta → tiktok order when those platforms were proposed." },
      );
    }
  }
  const next = proposal.sequence[confirmed.length];
  if (!next) return { done: true };
  return { platform: next, tool: platformTool(next) };
}
