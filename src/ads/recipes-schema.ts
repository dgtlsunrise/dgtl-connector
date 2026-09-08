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
