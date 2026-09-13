/**
 * Closed GAQL compilers for Wave 21 gads_search recipes.
 * Stamp hops recipe name + params only — the model never sends raw GAQL.
 * These strings are the stamp-parity contract (SELECT only; no mutate).
 */

import { ToolError } from "../errors.js";

export const WAVE21_GADS_RECIPES = ["click_view", "keyword_performance", "ad_performance"] as const;

export type Wave21GadsRecipe = (typeof WAVE21_GADS_RECIPES)[number];

export type CompiledGadsRecipe = {
  recipe: Wave21GadsRecipe;
  from: string;
  select: string[];
  gaql: string;
  date_range: "single_day" | "required";
  notes: string[];
};

const CLICK_VIEW_SELECT = [
  "click_view.gclid",
  "campaign.id",
  "campaign.name",
  "ad_group.id",
  "metrics.clicks",
  "segments.date",
] as const;

const KEYWORD_PERFORMANCE_SELECT = [
  "campaign.id",
  "campaign.name",
  "ad_group.id",
  "ad_group_criterion.criterion_id",
  "ad_group_criterion.keyword.text",
  "ad_group_criterion.keyword.match_type",
  "metrics.impressions",
  "metrics.clicks",
  "metrics.cost_micros",
  "metrics.conversions",
  "segments.date",
] as const;

const AD_PERFORMANCE_SELECT = [
  "campaign.id",
  "campaign.name",
  "ad_group.id",
  "ad_group_ad.ad.id",
  "ad_group_ad.ad.name",
  "ad_group_ad.status",
  "metrics.impressions",
  "metrics.clicks",
  "metrics.cost_micros",
  "metrics.conversions",
  "segments.date",
] as const;

function renderGaql(select: readonly string[], from: string): string {
  return `SELECT ${select.join(", ")} FROM ${from}`;
}

export function isWave21GadsRecipe(recipe: string): recipe is Wave21GadsRecipe {
  return (WAVE21_GADS_RECIPES as readonly string[]).includes(recipe);
}

/**
 * Compile a Wave 21 closed recipe to SELECT-only GAQL.
 * Unknown recipes throw — do not invent fields or accept raw GAQL.
 */
export function compileGadsRecipe(recipe: string): CompiledGadsRecipe {
  switch (recipe) {
    case "click_view":
      return {
        recipe,
        from: "click_view",
        select: [...CLICK_VIEW_SELECT],
        gaql: renderGaql(CLICK_VIEW_SELECT, "click_view"),
        date_range: "single_day",
        notes: [
          "Google ClickView requires a single-day segments.date.",
          "gclid is an Ads click_view field — not a GA4 dimension.",
          "Ads last-click / click rows are not sole truth vs GA4 DDA Ads-id recipes.",
        ],
      };
    case "keyword_performance":
      return {
        recipe,
        from: "keyword_view",
        select: [...KEYWORD_PERFORMANCE_SELECT],
        gaql: renderGaql(KEYWORD_PERFORMANCE_SELECT, "keyword_view"),
        date_range: "required",
        notes: [
          "Keyword ids live here (ad_group_criterion.criterion_id).",
          "GA4 has no keyword *id* dimension — ads_mta_keyword_ids refuses.",
          "metrics.conversions is Ads last-click (or Ads reporting), not GA4 DDA.",
        ],
      };
    case "ad_performance":
      return {
        recipe,
        from: "ad_group_ad",
        select: [...AD_PERFORMANCE_SELECT],
        gaql: renderGaql(AD_PERFORMANCE_SELECT, "ad_group_ad"),
        date_range: "required",
        notes: [
          "Ad-level last-click / Ads reporting metrics.",
          "Join to GA4 on googleAdsCreativeId / sessionGoogleAdsCreativeId — not gclid.",
        ],
      };
    default: {
      throw new ToolError(
        "INVALID_ARGUMENT",
        "Unknown Wave 21 recipe. Valid: click_view, keyword_performance, ad_performance.",
        {
          hint: "Call gads_describe_recipes. Do not send raw GAQL. Other recipes compile on stamp.",
        },
      );
    }
  }
}

/** Stamp / fixture guard: Wave 21 compilers are SELECT … FROM … only. */
export function assertSelectOnlyGaql(gaql: string): void {
  const normalized = gaql.replace(/\s+/g, " ").trim();
  if (!/^SELECT\s.+\sFROM\s[a-z_]+$/i.test(normalized)) {
    throw new ToolError("INVALID_ARGUMENT", "Closed recipes compile to SELECT … FROM … only.", {
      hint: "No raw GAQL, no mutate, no INSERT/UPDATE/DELETE.",
    });
  }
  if (/\b(INSERT|UPDATE|DELETE|MUTATE|REMOVE)\b/i.test(normalized)) {
    throw new ToolError("INVALID_ARGUMENT", "Closed recipes must not compile mutate GAQL.", {
      hint: "gads_search is read-only. Budget writes are named mutate tools.",
    });
  }
}
