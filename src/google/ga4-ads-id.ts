import { MSG, ToolError } from "../errors.js";

/**
 * Closed GA4 Data API Ads *id* dimensions for MTA recipes.
 * Keyword/query *text* dimensions are not on this list (search-adjacent).
 * Official apiNames: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
 */
export const GA4_ADS_ID_DIMENSIONS = [
  "sessionGoogleAdsCampaignId",
  "sessionGoogleAdsAdGroupId",
  "sessionGoogleAdsCreativeId",
  "sessionGoogleAdsCustomerId",
  "firstUserGoogleAdsCampaignId",
  "firstUserGoogleAdsAdGroupId",
  "firstUserGoogleAdsCreativeId",
  "firstUserGoogleAdsCustomerId",
  "googleAdsCampaignId",
  "googleAdsAdGroupId",
  "googleAdsCreativeId",
  "googleAdsCustomerId",
  "sessionCampaignId",
  "firstUserCampaignId",
] as const;

export type Ga4AdsIdDimension = (typeof GA4_ADS_ID_DIMENSIONS)[number];

const ADS_ID_SET = new Set<string>(GA4_ADS_ID_DIMENSIONS);

/** Ads keyword/query *text* — not IDs. Keep out of MTA id recipes. */
export const GA4_ADS_TEXT_DENY = new Set([
  "sessiongoogleadskeyword",
  "sessiongoogleadsquery",
  "googleadskeyword",
  "googleadsquery",
  "firstusergoogleadskeyword",
  "firstusergoogleadsquery",
]);

export const GA4_ADS_ID_RECIPES = [
  "ads_mta_campaign_ids",
  "ads_mta_adgroup_ids",
  "ads_mta_creative_ids",
  "ads_mta_customer_ids",
  "ads_mta_ids",
  "ads_mta_keyword_ids",
] as const;

export type Ga4AdsIdRecipe = (typeof GA4_ADS_ID_RECIPES)[number];

export const GA4_ADS_ID_RECIPE_METRICS = ["sessions", "keyEvents"] as const;

function adsLikeName(name: string): boolean {
  const k = name.trim().toLowerCase();
  return k.includes("googleads") || /ads(campaign|adgroup|creative|keyword|customer|query)/i.test(name);
}

export function denyGa4AdsTextDimensions(names: unknown): void {
  if (!names) return;
  const list = Array.isArray(names) ? names : [names];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const key = raw.trim().toLowerCase();
    if (GA4_ADS_TEXT_DENY.has(key)) {
      throw new ToolError("UNSUPPORTED_DIMENSION", MSG.UNSUPPORTED_DIMENSION, {
        hint: "GA4 Ads keyword/query dimensions are text, not ids. Use gads_search recipe=keywords for keyword ids, or an ads_mta_* id recipe.",
      });
    }
  }
}

/** When a name looks like a Google Ads dimension, it must be on the id allowlist. */
export function assertGa4AdsIdDimensionsAllowed(names: unknown): void {
  if (!names) return;
  const list = Array.isArray(names) ? names : [names];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (!adsLikeName(name)) continue;
    if (ADS_ID_SET.has(name)) continue;
    throw new ToolError(
      "UNSUPPORTED_DIMENSION",
      "That Google Ads dimension is not on the closed Ads-id allowlist.",
      {
        hint: `Allowed apiNames: ${GA4_ADS_ID_DIMENSIONS.join(", ")}. Cite ga4_get_metadata; do not invent Ads ids. Keyword text is not an id.`,
      },
    );
  }
}

export function dimensionsForAdsIdRecipe(recipe: Ga4AdsIdRecipe): string[] {
  switch (recipe) {
    case "ads_mta_campaign_ids":
      return ["sessionGoogleAdsCampaignId", "googleAdsCampaignId"];
    case "ads_mta_adgroup_ids":
      return ["sessionGoogleAdsAdGroupId", "googleAdsAdGroupId"];
    case "ads_mta_creative_ids":
      return ["sessionGoogleAdsCreativeId", "googleAdsCreativeId"];
    case "ads_mta_customer_ids":
      return ["sessionGoogleAdsCustomerId", "googleAdsCustomerId"];
    case "ads_mta_ids":
      return [
        "sessionGoogleAdsCampaignId",
        "sessionGoogleAdsAdGroupId",
        "sessionGoogleAdsCreativeId",
        "sessionGoogleAdsCustomerId",
        "googleAdsCampaignId",
        "googleAdsAdGroupId",
        "googleAdsCreativeId",
        "googleAdsCustomerId",
      ];
    case "ads_mta_keyword_ids":
      throw new ToolError(
        "UNSUPPORTED_DIMENSION",
        "GA4 Data API v1beta has no Google Ads keyword *id* dimension (only keyword text).",
        {
          hint: "Use gads_search recipe=keywords for keyword ids. Do not send sessionGoogleAdsKeyword / googleAdsKeyword (text) on ga4_run_report.",
        },
      );
    default: {
      const _never: never = recipe;
      throw new ToolError("INVALID_ARGUMENT", `Unknown Ads-id recipe ${String(_never)}`);
    }
  }
}
