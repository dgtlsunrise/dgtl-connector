/**
 * Local closed Google Ads recipe catalog.
 * Steals official googleads/google-ads-mcp get_resource_metadata / metrics / segments
 * anti-hallucination UX — WITHOUT exposing raw GAQL or FieldService to the agent.
 */

export type GadsRecipeField = {
  api_name: string;
  description: string;
};

export type GadsRecipe = {
  recipe: string;
  description: string;
  typical_resources: string[];
  notes: string[];
};

export const GADS_RECIPES: GadsRecipe[] = [
  {
    recipe: "campaigns",
    description: "Campaign id, name, status, channel, bidding basics.",
    typical_resources: ["campaign"],
    notes: ["Use before performance when you need structure, not metrics."],
  },
  {
    recipe: "ad_groups",
    description: "Ad groups under campaigns (id, name, status).",
    typical_resources: ["ad_group"],
    notes: ["Optional where.campaign_id to narrow."],
  },
  {
    recipe: "keywords",
    description: "Keyword criteria (text, match type, status).",
    typical_resources: ["ad_group_criterion"],
    notes: ["Search campaigns; not PMax asset groups."],
  },
  {
    recipe: "search_terms",
    description: "Search terms report (query text + metrics).",
    typical_resources: ["search_term_view"],
    notes: ["Requires date_range for metrics."],
  },
  {
    recipe: "conversion_actions",
    description: "Conversion actions configured on the account.",
    typical_resources: ["conversion_action"],
    notes: ["Account-level setup, not performance time series."],
  },
  {
    recipe: "change_status",
    description: "Recent change-status resources.",
    typical_resources: ["change_status"],
    notes: ["Audit trail shape — not spend."],
  },
  {
    recipe: "policy_topics",
    description: "Policy topic findings when available.",
    typical_resources: ["ad_group_ad", "policy"],
    notes: ["May be empty on clean accounts — empty ≠ auth failure."],
  },
  {
    recipe: "performance",
    description: "Campaign (or scoped) performance metrics for a date range.",
    typical_resources: ["campaign", "metrics", "segments"],
    notes: [
      "Prefer gads_campaign_performance for the same closed recipe.",
      "Do not invent metrics.* / segments.* — recipes only (no raw GAQL).",
    ],
  },
  {
    recipe: "assets",
    description: "Asset library (id, name, type, resource_name) including images.",
    typical_resources: ["asset"],
    notes: ["Use after gads_upload_asset; cite resource_name for PMax."],
  },
  {
    recipe: "asset_groups",
    description: "PMax asset groups (id, name, status) with parent campaign.",
    typical_resources: ["asset_group"],
    notes: ["PMax only; Search uses ad_groups."],
  },
  {
    recipe: "audiences",
    description: "Audience id, name, status.",
    typical_resources: ["audience"],
    notes: ["Read only in Wave 1; attach is a later named tool."],
  },
  {
    recipe: "shared_sets",
    description: "Shared sets (negative keyword lists, placements).",
    typical_resources: ["shared_set"],
    notes: ["Read only; membership mutate is later."],
  },
  {
    recipe: "bidding_strategies",
    description: "Portfolio bidding strategies (id, name, type, status).",
    typical_resources: ["bidding_strategy"],
    notes: ["Read only; apply/create is Wave 2."],
  },
  {
    recipe: "geo",
    description: "Campaign location criteria (geo target constants).",
    typical_resources: ["campaign_criterion"],
    notes: ["LOCATION type only. Empty ≠ auth failure."],
  },
  {
    recipe: "demographics",
    description: "Age, gender, parental-status, income-range campaign criteria.",
    typical_resources: ["campaign_criterion"],
    notes: ["Read only in Wave 1."],
  },
  {
    recipe: "shopping_performance",
    description: "Shopping performance view (impressions, clicks, cost).",
    typical_resources: ["shopping_performance_view"],
    notes: ["Needs a Shopping/PMax+feed account; empty ≠ auth failure."],
  },
  {
    recipe: "recommendations",
    description: "Google Ads recommendations (type + campaign).",
    typical_resources: ["recommendation"],
    notes: ["Read only. Apply is Wave 2 confirm-gated."],
  },
  {
    recipe: "change_event",
    description: "Detailed change_event rows (last 14 days).",
    typical_resources: ["change_event"],
    notes: ["Richer than change_status. Google limits lookback to ~30 days."],
  },
  {
    recipe: "account_budget",
    description: "Account-level budget / billing read (status + approved limit).",
    typical_resources: ["account_budget"],
    notes: ["Read only. No billing write in product."],
  },
  {
    recipe: "negatives",
    description: "Negative campaign criteria (keyword text + match type).",
    typical_resources: ["campaign_criterion"],
    notes: ["Read only. Add-negative is Wave 2."],
  },
  {
    recipe: "experiments",
    description: "Campaign experiments (id, name, status, type).",
    typical_resources: ["experiment"],
    notes: ["Read only. Create/apply is Wave 2."],
  },
];

export const GADS_RECIPE_NAMES = new Set(GADS_RECIPES.map((r) => r.recipe));

export function describeGadsRecipes(): {
  recipes: GadsRecipe[];
  customer_id_notes: string[];
  discovery_notes: string[];
  rejected_from_official: string[];
} {
  return {
    recipes: GADS_RECIPES,
    customer_id_notes: [
      "Call gads_list_accessible_customers first if the user has not given a customer_id.",
      "customer_id digits only — strip hyphens (123-456-7890 → 1234567890).",
      "MCC: pass login_customer_id for the manager; customer_id is the client.",
      "Cite customer_id from data.cited on reports — do not invent ids.",
    ],
    discovery_notes: [
      "Official Ads MCP exposes get_resource_metadata + open search(GAQL). We keep CLOSED recipes only.",
      "Do not guess GAQL fields. Use gads_describe_recipes then gads_search with recipe enum.",
      "Empty rows with ok:true is not an auth failure — check customer_id, date_range, and recipe.",
      "NOT_FOUND / permission errors: re-list customers; do not attach a developer-token on this client.",
    ],
    rejected_from_official: [
      "Raw GAQL search tool",
      "GoogleAdsFieldService / get_resource_metadata live dumps",
      "User-supplied GOOGLE_ADS_DEVELOPER_TOKEN / ADC / pipx install story",
      "MCP resources metrics/segments/discovery-document/release-notes as free agent surfaces",
    ],
  };
}
