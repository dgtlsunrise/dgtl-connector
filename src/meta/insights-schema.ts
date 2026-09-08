/**
 * Local Meta Marketing API insights catalog (steal UX from Meta hosted Ads MCP docs).
 * No Graph / gateway call — agents must use these names; do not invent fields.
 * Writes / catalogs / audiences / lift stay out of v1 (ads_read only).
 */

export type MetaField = {
  api_name: string;
  description: string;
};

export const META_INSIGHT_LEVELS: MetaField[] = [
  { api_name: "account", description: "Aggregate at ad account level." },
  { api_name: "campaign", description: "One row per campaign (or filter with object_id)." },
  { api_name: "adset", description: "One row per ad set." },
  { api_name: "ad", description: "One row per ad." },
];

/** Common Marketing API date_preset values (insights edge). Prefer over inventing ranges. */
export const META_DATE_PRESETS: MetaField[] = [
  { api_name: "today", description: "Calendar today in the ad account timezone." },
  { api_name: "yesterday", description: "Previous calendar day." },
  { api_name: "last_7d", description: "Last 7 complete days (excludes today)." },
  { api_name: "last_14d", description: "Last 14 complete days." },
  { api_name: "last_28d", description: "Last 28 complete days." },
  { api_name: "last_30d", description: "Last 30 complete days." },
  { api_name: "last_90d", description: "Last 90 complete days." },
  { api_name: "this_month", description: "From the 1st of this month through today." },
  { api_name: "last_month", description: "Previous calendar month." },
  { api_name: "lifetime", description: "Since object creation (can be large)." },
  { api_name: "maximum", description: "API maximum available window for the object." },
];

/** Breakdowns Meta Ads MCP docs highlight (age/gender/platform) plus common safe ones. */
export const META_BREAKDOWNS: MetaField[] = [
  { api_name: "age", description: "Age buckets (e.g. 18-24)." },
  { api_name: "gender", description: "male / female / unknown." },
  { api_name: "country", description: "Country code." },
  { api_name: "region", description: "Region within country." },
  { api_name: "dma", description: "Designated Market Area (US)." },
  { api_name: "impression_device", description: "Device that saw the impression." },
  { api_name: "publisher_platform", description: "facebook / instagram / audience_network / messenger / …" },
  { api_name: "platform_position", description: "Feed, Stories, Reels, etc." },
  { api_name: "device_platform", description: "mobile_app / desktop / mobile_web / …" },
  { api_name: "hourly_stats_aggregated_by_advertiser_time_zone", description: "Hour buckets in advertiser TZ." },
];

/** Closed default metric set — agents should not invent Graph field names. */
export const META_INSIGHT_FIELDS: MetaField[] = [
  { api_name: "impressions", description: "Times ads were on screen." },
  { api_name: "reach", description: "Unique users who saw ads." },
  { api_name: "frequency", description: "Average impressions per reached user." },
  { api_name: "clicks", description: "All clicks (link + other)." },
  { api_name: "unique_clicks", description: "Unique users who clicked." },
  { api_name: "ctr", description: "Click-through rate." },
  { api_name: "cpc", description: "Cost per click." },
  { api_name: "cpm", description: "Cost per 1,000 impressions." },
  { api_name: "spend", description: "Amount spent." },
  { api_name: "actions", description: "Conversion action breakdowns (array)." },
  { api_name: "action_values", description: "Value of conversions (array)." },
  { api_name: "cost_per_action_type", description: "CPA by action type (array)." },
  { api_name: "purchase_roas", description: "Purchase return on ad spend (when available)." },
  { api_name: "website_purchase_roas", description: "Website purchase ROAS (when available)." },
  { api_name: "inline_link_clicks", description: "Clicks to destinations." },
  { api_name: "inline_link_click_ctr", description: "CTR for inline link clicks." },
  { api_name: "video_p25_watched_actions", description: "Video 25% watched (when video ads)." },
  { api_name: "video_p100_watched_actions", description: "Video completes (when video ads)." },
];

export const META_LEVEL_NAMES = new Set(META_INSIGHT_LEVELS.map((x) => x.api_name));
export const META_DATE_PRESET_NAMES = new Set(META_DATE_PRESETS.map((x) => x.api_name));
export const META_BREAKDOWN_NAMES = new Set(META_BREAKDOWNS.map((x) => x.api_name));
export const META_FIELD_NAMES = new Set(META_INSIGHT_FIELDS.map((x) => x.api_name));

export function describeMetaInsightsSchema(): {
  levels: MetaField[];
  date_presets: MetaField[];
  breakdowns: MetaField[];
  fields: MetaField[];
  notes: string[];
  deferred: string[];
} {
  return {
    levels: META_INSIGHT_LEVELS,
    date_presets: META_DATE_PRESETS,
    breakdowns: META_BREAKDOWNS,
    fields: META_INSIGHT_FIELDS,
    notes: [
      "Call meta_describe_insights_schema before inventing breakdowns, date_preset, or field names.",
      "ad_account_id may be act_123 or 123 — do not invent account ids; use meta_list_ad_accounts.",
      "Pass date_preset OR date_start+date_stop — not conflicting invented ranges.",
      "Empty insights with ok:true is not auth failure — widen dates, drop breakdowns, or check object_id.",
      "NOT_FOUND usually means wrong ad_account_id / object_id — re-list; retrying the same id will not help.",
      "Cite ad_account_id, level, dates/preset, and breakdowns from data.cited in answers.",
      "v1 is ads_read only — no create/edit campaign, catalog, audience, or lift mutate tools.",
    ],
    deferred: [
      "Meta hosted Ads MCP categories left for backlog: ad create/edit, catalogs, signals/datasets, help-center search, A/B tests & lift, activity logs.",
      "ads_mcp_management Advanced Access + Meta's hosted mcp.facebook.com/ads remain a future product decision (Polar+stamp stays our Meta path for now).",
    ],
  };
}
