import type { z } from "zod";
import type { AppContext } from "../context.js";
import type { Envelope } from "../envelope.js";
import { gbpNotEnabled } from "../google/gbp.js";
import * as ga4 from "../google/ga4.js";
import * as gsc from "../google/gsc.js";
import * as gtm from "../google/gtm.js";
import * as gtmWrite from "../google/gtm-write.js";
import { googleWhoami } from "../google/whoami.js";
import { gadsDisabled, gadsDescribeRecipes, licenseStatus } from "../ads/gads.js";
import {
  gadsAddKeywords,
  gadsCreateDisplayCampaign,
  gadsCreatePerformanceMaxCampaign,
  gadsCreateResponsiveSearchAd,
  gadsCreateSearchCampaign,
  gadsCreateShoppingCampaign,
  gadsListMerchantCenterLinks,
  gadsSetAdGroupStatus,
  gadsSetAdStatus,
  gadsSetCampaignStatus,
  gadsSetKeywordStatus,
  gadsUpdateCampaignBudget,
} from "../ads/gads-write.js";
import {
  metaUpdateCampaign,
  metaUpdateAdset,
  metaUpdateAd,
  metaCreateCampaign,
  metaCreateAdset,
  metaCreateAd,
  metaUploadAdImage,
  metaUploadAdVideo,
  metaCreateAdCreative,
} from "../meta/meta-write.js";
import { metaDisabled, metaDescribeInsightsSchema } from "../meta/meta.js";
import { supportPacket } from "../support/packet.js";
import { feedbackPrepare, feedbackSend } from "../support/feedback.js";
import * as S from "./schemas.js";

export type ToolFamily = "identity" | "ga4" | "gsc" | "gtm" | "gtm_write" | "gbp" | "gads" | "meta" | "license";

export type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type ToolSpec = {
  name: string;
  group: string;
  family: ToolFamily;
  title: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  annotations: ToolAnnotations;
  handler: (ctx: AppContext, args: Record<string, unknown>) => Promise<Envelope>;
};

const RO = "Read-only. Never picks a default resource.";

/** Default MCP annotations for Consent A / fail-closed readonly families. */
const ANN_RO: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** Workspace create/update — not readonly; additive until publish. */
const ANN_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

/** Publish — irreversible; hosts must not treat as readonly. */
const ANN_DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export const TOOLS: ToolSpec[] = [
  {
    name: "google_whoami",
    group: "identity",
    family: "identity",
    title: "Google whoami",
    description: `${RO} Returns the connected Google email, granted scopes, and license features. Never returns tokens.`,
    inputSchema: S.emptyInput,
    annotations: ANN_RO,
    handler: (ctx) => googleWhoami(ctx),
  },
  {
    name: "ga4_list_accounts",
    group: "ga4-admin",
    family: "ga4",
    title: "GA4 list accounts",
    description: `${RO} List GA4 Analytics accounts visible to this Google user.`,
    inputSchema: S.pageInput,
    annotations: ANN_RO,
    handler: (ctx, args) => ga4.ga4ListAccounts(ctx, args),
  },
  {
    name: "ga4_list_account_summaries",
    group: "ga4-admin",
    family: "ga4",
    title: "GA4 list account summaries",
    description: `${RO} One-call agency picker: accounts with nested propertySummaries. Does not select a property.`,
    inputSchema: S.pageInput,
    annotations: ANN_RO,
    handler: (ctx, args) => ga4.ga4ListAccountSummaries(ctx, args),
  },
  {
    name: "ga4_list_properties",
    group: "ga4-admin",
    family: "ga4",
    title: "GA4 list properties",
    description: `${RO} List GA4 properties for a required account_id (filter=parent:accounts/{id}).`,
    inputSchema: S.accountPage,
    annotations: ANN_RO,
    handler: (ctx, args) => ga4.ga4ListProperties(ctx, args),
  },
  {
    name: "ga4_get_property",
    group: "ga4-admin",
    family: "ga4",
    title: "GA4 get property",
    description: `${RO} Get one GA4 property (timezone, currency). property_id required.`,
    inputSchema: S.propertyId,
    annotations: ANN_RO,
    handler: (ctx, args) => ga4.ga4GetProperty(ctx, args),
  },
  {
    name: "ga4_list_data_streams",
    group: "ga4-admin",
    family: "ga4",
    title: "GA4 list data streams",
    description: `${RO} List data streams for a required property_id.`,
    inputSchema: S.propertyPage,
    annotations: ANN_RO,
    handler: (ctx, args) => ga4.ga4ListDataStreams(ctx, args),
  },
  {
    name: "ga4_list_key_events",
    group: "ga4-admin",
    family: "ga4",
    title: "GA4 list key events",
    description: `${RO} List key events / conversions for a required property_id.`,
    inputSchema: S.propertyPage,
    annotations: ANN_RO,
    handler: (ctx, args) => ga4.ga4ListKeyEvents(ctx, args),
  },
  {
    name: "ga4_get_metadata",
    group: "ga4-data",
    family: "ga4",
    title: "GA4 get metadata",
    description: `${RO} Dimensions and metrics (apiName) for this property. Optional query/kind/custom_only filters shrink the catalog — search before inventing names. Cite property_id from the response.`,
    inputSchema: S.ga4GetMetadata,
    annotations: ANN_RO,
    handler: (ctx, args) => ga4.ga4GetMetadata(ctx, args),
  },
  {
    name: "ga4_run_report",
    group: "ga4-data",
    family: "ga4",
    title: "GA4 run report",
    description: `${RO} The only GA4 report tool. Denylists searchQuery/query/searchTerm/keyword with no Google call. property_id, date_ranges, metrics required. Cap 1000 rows. Echoes propertyQuota. Response data.cited repeats property_id + dates — cite them; do not invent apiNames (use ga4_get_metadata).`,
    inputSchema: S.ga4RunReport,
    annotations: ANN_RO,
    handler: (ctx, args) => ga4.ga4RunReport(ctx, args),
  },
  {
    name: "gsc_list_sites",
    group: "gsc",
    family: "gsc",
    title: "GSC list sites",
    description: `${RO} List Search Console sites. Exact siteUrl; do not coerce sc-domain vs URL-prefix.`,
    inputSchema: S.pageInput,
    annotations: ANN_RO,
    handler: (ctx, args) => gsc.gscListSites(ctx, args),
  },
  {
    name: "gsc_describe_schema",
    group: "gsc",
    family: "gsc",
    title: "GSC describe schema",
    description: `${RO} Local dimension/metric catalog + site_url / data_state notes. No Google call. Call before gsc_query_search_analytics; never invent dimension names.`,
    inputSchema: S.gscDescribeSchema,
    annotations: ANN_RO,
    handler: (ctx, args) => gsc.gscDescribeSchema(ctx, args),
  },
  {
    name: "gsc_get_site",
    group: "gsc",
    family: "gsc",
    title: "GSC get site",
    description: `${RO} Get one Search Console site by exact site_url.`,
    inputSchema: S.siteUrl,
    annotations: ANN_RO,
    handler: (ctx, args) => gsc.gscGetSite(ctx, args),
  },
  {
    name: "gsc_query_search_analytics",
    group: "gsc",
    family: "gsc",
    title: "GSC search analytics",
    description: `${RO} Search queries, pages, countries, devices. This is the tool for search queries — not ga4_run_report. Call gsc_describe_schema first. Cite site_url + dates from data.cited. Default data_state=final (laggy); use all for fresh days.`,
    inputSchema: S.gscQuery,
    annotations: ANN_RO,
    handler: (ctx, args) => gsc.gscQuerySearchAnalytics(ctx, args),
  },
  {
    name: "gsc_inspect_url",
    group: "gsc",
    family: "gsc",
    title: "GSC inspect URL",
    description: `${RO} URL Inspection. No request-indexing tool exists.`,
    inputSchema: S.gscInspect,
    annotations: ANN_RO,
    handler: (ctx, args) => gsc.gscInspectUrl(ctx, args),
  },
  {
    name: "gsc_list_sitemaps",
    group: "gsc",
    family: "gsc",
    title: "GSC list sitemaps",
    description: `${RO} List sitemaps for an exact site_url.`,
    inputSchema: S.gscSitemaps,
    annotations: ANN_RO,
    handler: (ctx, args) => gsc.gscListSitemaps(ctx, args),
  },
  {
    name: "gsc_get_sitemap",
    group: "gsc",
    family: "gsc",
    title: "GSC get sitemap",
    description: `${RO} Get one sitemap by site_url + feedpath from the list tool.`,
    inputSchema: S.gscSitemap,
    annotations: ANN_RO,
    handler: (ctx, args) => gsc.gscGetSitemap(ctx, args),
  },
  {
    name: "gtm_list_accounts",
    group: "gtm",
    family: "gtm",
    title: "GTM list accounts",
    description: `${RO} List Tag Manager accounts (hierarchy root). Next: gtm_list_containers → workspaces → draft tags OR live version. Classic 403 accessNotConfigured if Tag Manager API is not Enabled.`,
    inputSchema: S.pageInput,
    annotations: ANN_RO,
    handler: (ctx, args) => gtm.gtmListAccounts(ctx, args),
  },
  {
    name: "gtm_list_containers",
    group: "gtm",
    family: "gtm",
    title: "GTM list containers",
    description: `${RO} List containers for a required account_id (includes publicId GTM-XXXX).`,
    inputSchema: S.accountPage,
    annotations: ANN_RO,
    handler: (ctx, args) => gtm.gtmListContainers(ctx, args),
  },
  {
    name: "gtm_get_container",
    group: "gtm",
    family: "gtm",
    title: "GTM get container",
    description: `${RO} Get one container. account_id and container_id required.`,
    inputSchema: S.gtmContainer,
    annotations: ANN_RO,
    handler: (ctx, args) => gtm.gtmGetContainer(ctx, args),
  },
  {
    name: "gtm_list_workspaces",
    group: "gtm",
    family: "gtm",
    title: "GTM list workspaces",
    description: `${RO} List workspaces for account_id + container_id. If more than one, do not default to Default Workspace. Drafts ≠ live.`,
    inputSchema: S.gtmContainer,
    annotations: ANN_RO,
    handler: (ctx, args) => gtm.gtmListWorkspaces(ctx, args),
  },
  {
    name: "gtm_list_tags",
    group: "gtm",
    family: "gtm",
    title: "GTM list tags",
    description: `${RO} Workspace draft tags (source=workspace). Not live on the site — use gtm_get_live_container_version for published. Paginated; truncated when oversize.`,
    inputSchema: S.gtmWorkspaceList,
    annotations: ANN_RO,
    handler: (ctx, args) => gtm.gtmListTags(ctx, args),
  },
  {
    name: "gtm_list_triggers",
    group: "gtm",
    family: "gtm",
    title: "GTM list triggers",
    description: `${RO} Workspace draft triggers (source=workspace).`,
    inputSchema: S.gtmWorkspaceList,
    annotations: ANN_RO,
    handler: (ctx, args) => gtm.gtmListTriggers(ctx, args),
  },
  {
    name: "gtm_list_variables",
    group: "gtm",
    family: "gtm",
    title: "GTM list variables",
    description: `${RO} Workspace draft variables (source=workspace).`,
    inputSchema: S.gtmWorkspaceList,
    annotations: ANN_RO,
    handler: (ctx, args) => gtm.gtmListVariables(ctx, args),
  },
  {
    name: "gtm_get_live_container_version",
    group: "gtm",
    family: "gtm",
    title: "GTM live container version",
    description: `${RO} Published container (source=live). This is what is on the site; workspace drafts may differ. Never publishes.`,
    inputSchema: S.gtmContainer,
    annotations: ANN_RO,
    handler: (ctx, args) => gtm.gtmGetLiveContainerVersion(ctx, args),
  },

  // Consent W — GTM write/publish via GoogleWriteHttp (flagged off by default; never on Consent A)
  {
    name: "gtm_create_tag",
    group: "gtm-write",
    family: "gtm_write",
    title: "GTM create tag (Consent W)",
    description:
      "Create a workspace tag. Requires Consent W (tagmanager.edit.containers), not free Consent A. Returns WRITE_NOT_ENABLED when DGTL_WRITES_ENABLED is false. Prefer dry_run; live mutate needs an explicit user confirm that includes the container publicId.",
    inputSchema: S.gtmCreateTag,
    annotations: ANN_WRITE,
    handler: (ctx, args) => gtmWrite.gtmCreateTag(ctx, args),
  },
  {
    name: "gtm_update_tag",
    group: "gtm-write",
    family: "gtm_write",
    title: "GTM update tag (Consent W)",
    description:
      "Update a workspace tag. Consent W only. Returns WRITE_NOT_ENABLED / CONSENT_W_REQUIRED when gated off. Prefer dry_run; live mutate needs an explicit user confirm that includes the container publicId.",
    inputSchema: S.gtmUpdateTag,
    annotations: ANN_WRITE,
    handler: (ctx, args) => gtmWrite.gtmUpdateTag(ctx, args),
  },
  {
    name: "gtm_publish_container",
    group: "gtm-write",
    family: "gtm_write",
    title: "GTM publish container (Consent W)",
    description:
      "Publish a GTM container version. Highest-risk write. Requires Consent W (tagmanager.publish). Prefer dry_run first; live publish requires an explicit confirm that includes the container publicId from the user this turn. Flagged off by default (WRITE_NOT_ENABLED).",
    inputSchema: S.gtmPublishContainer,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gtmWrite.gtmPublishContainer(ctx, args),
  },
  // GBP — schemas + flag only
  {
    name: "gbp_list_accounts",
    group: "gbp",
    family: "gbp",
    title: "GBP list accounts",
    description: "Google Business Profile accounts. Flagged off until GBP quota is non-zero. Returns GBP_NOT_ENABLED.",
    inputSchema: S.gbpAccounts,
    annotations: ANN_RO,
    handler: async (ctx) => gbpNotEnabled("gbp_list_accounts", ctx),
  },
  {
    name: "gbp_list_locations",
    group: "gbp",
    family: "gbp",
    title: "GBP list locations",
    description: "GBP locations for an account. Flagged off (GBP_NOT_ENABLED). Consent B is business.manage, not Consent A.",
    inputSchema: S.gbpLocations,
    annotations: ANN_RO,
    handler: async (ctx) => gbpNotEnabled("gbp_list_locations", ctx),
  },
  {
    name: "gbp_get_location",
    group: "gbp",
    family: "gbp",
    title: "GBP get location",
    description: "GBP location (name, place_id, website, labels). Flagged off.",
    inputSchema: S.gbpGetLocation,
    annotations: ANN_RO,
    handler: async (ctx) => gbpNotEnabled("gbp_get_location", ctx),
  },
  {
    name: "gbp_performance",
    group: "gbp",
    family: "gbp",
    title: "GBP performance",
    description: "GBP Performance time series. Flagged off. Performance API does not list locations.",
    inputSchema: S.gbpPerformance,
    annotations: ANN_RO,
    handler: async (ctx) => gbpNotEnabled("gbp_performance", ctx),
  },
  {
    name: "gbp_search_keywords",
    group: "gbp",
    family: "gbp",
    title: "GBP search keywords",
    description: "Monthly search-keyword impressions. Flagged off.",
    inputSchema: S.gbpKeywords,
    annotations: ANN_RO,
    handler: async (ctx) => gbpNotEnabled("gbp_search_keywords", ctx),
  },
  // Paid Ads — LICENSE_REQUIRED
  {
    name: "gads_list_accessible_customers",
    group: "gads",
    family: "gads",
    title: "Google Ads list accessible customers",
    description:
      "Paid. Pro $19/mo. Use FIRST to discover customer IDs when the user has not given one — most Ads tools need a valid customer_id. Digits only (no hyphens). Cite returned ids; do not invent. No mutate. LICENSE_REQUIRED without a license. No developer-token on this client.",
    inputSchema: S.emptyInput,
    annotations: ANN_RO,
    handler: async (ctx, args) => gadsDisabled(ctx, "gads_list_accessible_customers", args),
  },
  {
    name: "gads_describe_recipes",
    group: "gads",
    family: "gads",
    title: "Google Ads describe closed recipes",
    description:
      "Paid. Pro $19/mo. Local closed-recipe catalog (anti-hallucination). Call before gads_search — do not invent GAQL or metrics.*/segments.* fields. Mirrors official get_resource_metadata UX without FieldService dumps. Zero Ads HTTP. LICENSE_REQUIRED without a license.",
    inputSchema: S.gadsDescribeRecipes,
    annotations: ANN_RO,
    handler: async (ctx) => gadsDescribeRecipes(ctx),
  },
  {
    name: "gads_get_customer",
    group: "gads",
    family: "gads",
    title: "Google Ads get customer",
    description:
      "Paid. Pro $19/mo. Descriptive name, currency, time zone for a customer_id from gads_list_accessible_customers. LICENSE_REQUIRED without a DGTL license.",
    inputSchema: S.gadsCustomer,
    annotations: ANN_RO,
    handler: async (ctx, args) => gadsDisabled(ctx, "gads_get_customer", args),
  },
  {
    name: "gads_search",
    group: "gads",
    family: "gads",
    title: "Google Ads search (recipes)",
    description:
      "Paid. Pro $19/mo. Closed recipe enum only (campaigns, ad_groups, keywords, search_terms, conversion_actions, change_status, policy_topics, performance). Call gads_describe_recipes first — do not invent GAQL. customer_id digits without hyphens; cite data.cited. LICENSE_REQUIRED without a license. No developer-token on this client.",
    inputSchema: S.gadsSearch,
    annotations: ANN_RO,
    handler: async (ctx, args) => gadsDisabled(ctx, "gads_search", args),
  },
  {
    name: "gads_campaign_performance",
    group: "gads",
    family: "gads",
    title: "Google Ads campaign performance",
    description:
      "Paid. Pro $19/mo. Closed performance recipe (same family as gads_search recipe=performance). Cite customer_id + date_range from data.cited. LICENSE_REQUIRED without a DGTL license.",
    inputSchema: S.gadsSearch,
    annotations: ANN_RO,
    handler: async (ctx, args) => gadsDisabled(ctx, "gads_campaign_performance", args),
  },
  {
    name: "gads_set_campaign_status",
    group: "gads-write",
    family: "gads",
    title: "Google Ads set campaign status (Consent C)",
    description:
      "Paid mutate. Pause or enable a campaign (ENABLED/PAUSED only). Prefer dry_run; live needs confirm_phrase with digits-only customer_id. Consent C + Pro + gateway — never Consent A.",
    inputSchema: S.gadsSetCampaignStatus,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsSetCampaignStatus(ctx, args),
  },
  {
    name: "gads_update_campaign_budget",
    group: "gads-write",
    family: "gads",
    title: "Google Ads update campaign budget (Consent C)",
    description:
      "Paid mutate. Update campaign budget amount_micros only (optional daily_budget_dollars). Prefer dry_run; confirm_phrase with customer_id; spend-cap $100k/day. Consent C + Pro + gateway — never Consent A.",
    inputSchema: S.gadsUpdateCampaignBudget,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsUpdateCampaignBudget(ctx, args),
  },
  {
    name: "gads_set_keyword_status",
    group: "gads-write",
    family: "gads",
    title: "Google Ads set keyword status (Consent C)",
    description:
      "Paid mutate. Pause or enable a Search keyword (ad group criterion). Prefer dry_run; live confirm_phrase must include digits-only customer_id. Consent C + Pro + gateway.",
    inputSchema: S.gadsSetKeywordStatus,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsSetKeywordStatus(ctx, args),
  },
  {
    name: "gads_add_keywords",
    group: "gads-write",
    family: "gads",
    title: "Google Ads add keywords (Consent C)",
    description:
      "Paid mutate. Add up to 20 Search keywords to an ad group (EXACT/PHRASE/BROAD). Prefer dry_run; live confirm_phrase with customer_id. Consent C + Pro + gateway.",
    inputSchema: S.gadsAddKeywords,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsAddKeywords(ctx, args),
  },
  {
    name: "gads_set_ad_status",
    group: "gads-write",
    family: "gads",
    title: "Google Ads set ad status (Consent C)",
    description:
      "Paid mutate. Pause or enable an ad (AdGroupAd). Prefer dry_run; live confirm_phrase with customer_id. Consent C + Pro + gateway.",
    inputSchema: S.gadsSetAdStatus,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsSetAdStatus(ctx, args),
  },
  {
    name: "gads_create_responsive_search_ad",
    group: "gads-write",
    family: "gads",
    title: "Google Ads create RSA (Consent C)",
    description:
      "Paid mutate. Create a Responsive Search Ad on an existing ad group (≥3 headlines, ≥2 descriptions, https final_url). Defaults PAUSED. Prefer dry_run; live confirm_phrase with customer_id. Consent C + Pro + gateway.",
    inputSchema: S.gadsCreateResponsiveSearchAd,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsCreateResponsiveSearchAd(ctx, args),
  },
  {
    name: "gads_create_search_campaign",
    group: "gads-write",
    family: "gads",
    title: "Google Ads create Search campaign (Consent C)",
    description:
      "Paid mutate. Closed Search create: budget + campaign + ad group + ≥1 keyword stub; optional RSA. Defaults PAUSED. Spend-cap on daily budget. Prefer dry_run; live confirm_phrase with customer_id. Consent C + Pro + gateway — never Consent A.",
    inputSchema: S.gadsCreateSearchCampaign,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsCreateSearchCampaign(ctx, args),
  },
  {
    name: "gads_set_ad_group_status",
    group: "gads-write",
    family: "gads",
    title: "Google Ads set ad group status (Consent C)",
    description:
      "Paid mutate. Pause or enable an ad group. Prefer dry_run; live confirm_phrase with customer_id. Consent C + Pro + gateway.",
    inputSchema: S.gadsSetAdGroupStatus,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsSetAdGroupStatus(ctx, args),
  },
  {
    name: "gads_create_display_campaign",
    group: "gads-write",
    family: "gads",
    title: "Google Ads create Display campaign (Consent C)",
    description:
      "Paid mutate. Honest minimal Display create: budget + DISPLAY campaign + DISPLAY_STANDARD ad group (no RDA/images). Defaults PAUSED. Spend-cap. Prefer dry_run; live confirm_phrase with customer_id. Consent C + Pro + gateway — never Consent A.",
    inputSchema: S.gadsCreateDisplayCampaign,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsCreateDisplayCampaign(ctx, args),
  },
  {
    name: "gads_create_performance_max_campaign",
    group: "gads-write",
    family: "gads",
    title: "Google Ads Performance Max create (Consent C)",
    description:
      "Paid mutate. PMax foundation: budget + PERFORMANCE_MAX + asset group + text assets linked to **existing** marketing/square/logo asset resource names (image upload still out of scope). Without those assets → NOT_IMPLEMENTED (zero hop). Defaults PAUSED. Prefer dry_run; live confirm_phrase with customer_id. Consent C + Pro + gateway.",
    inputSchema: S.gadsCreatePerformanceMaxCampaign,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsCreatePerformanceMaxCampaign(ctx, args),
  },
  {
    name: "gads_create_shopping_campaign",
    group: "gads-write",
    family: "gads",
    title: "Google Ads Shopping create (Consent C)",
    description:
      "Paid mutate. Shopping create when merchant_center_id is known (discover via gads_list_merchant_center_links). Without merchant_center_id → MERCHANT_CENTER_REQUIRED (zero hop). Budget + SHOPPING campaign only (no product groups). Defaults PAUSED. Prefer dry_run; live confirm_phrase with customer_id. Consent C + Pro + gateway.",
    inputSchema: S.gadsCreateShoppingCampaign,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsCreateShoppingCampaign(ctx, args),
  },
  {
    name: "gads_list_merchant_center_links",
    group: "gads",
    family: "gads",
    title: "Google Ads list Merchant Center links",
    description:
      "Paid read. Discover Merchant Center product_link ids for a customer (digits-only merchant_center_id for Shopping create). Consent C + Pro + gateway. Cite returned ids; do not invent.",
    inputSchema: S.gadsListMerchantCenterLinks,
    annotations: ANN_RO,
    handler: (ctx, args) => gadsListMerchantCenterLinks(ctx, args),
  },
  {
    name: "license_status",
    group: "license",
    family: "license",
    title: "License status",
    description: "Local license JWT features and expiry. No key material. gateway.reachable probes GET /v1/health when DGTL_GATEWAY_URL is set (false if unset or probe fails).",
    inputSchema: S.emptyInput,
    annotations: ANN_RO,
    handler: async (ctx) => licenseStatus(ctx),
  },
  {
    name: "support_packet",
    group: "license",
    family: "license",
    title: "Support packet",
    description:
      "Local support intake: plugin version, host hint, optional last tool / error_code / resource id. Never tokens. No Google call.",
    inputSchema: S.supportPacket,
    annotations: ANN_RO,
    handler: (ctx, args) => supportPacket(ctx, args),
  },
  {
    name: "feedback_prepare",
    group: "license",
    family: "license",
    title: "Prepare plugin feedback",
    description:
      "Build a reviewable feedback draft for support@dgtlsunrise.com from support_packet fields plus the user's message. Requires reply_to. Strips token-shaped strings. Does not send. Echo draft_id to feedback_send after the user approves.",
    inputSchema: S.feedbackPrepare,
    annotations: ANN_RO,
    handler: (ctx, args) => feedbackPrepare(ctx, args),
  },
  {
    name: "feedback_send",
    group: "license",
    family: "license",
    title: "Send approved plugin feedback",
    description:
      "POST an approved draft to the DGTL feedback endpoint. Requires confirm: true and the draft_id (or the full draft fields). Destination is support@dgtlsunrise.com; Reply-To is the address the user provided. Never emails tokens. Does not send without explicit approval.",
    inputSchema: S.feedbackSend,
    annotations: ANN_WRITE,
    handler: (ctx, args) => feedbackSend(ctx, args),
  },
  // Paid Meta — ads_read insights DX; writes/catalogs/lift deferred
  {
    name: "meta_list_ad_accounts",
    group: "meta",
    family: "meta",
    title: "Meta list ad accounts",
    description:
      "Paid. Pro $19/mo. Use FIRST to discover ad_account_id values. Cite returned ids; do not invent. Meta app secret is never in this plugin. LICENSE_REQUIRED without a license.",
    inputSchema: S.emptyInput,
    annotations: ANN_RO,
    handler: async (ctx, args) => metaDisabled(ctx, "meta_list_ad_accounts", args),
  },
  {
    name: "meta_describe_insights_schema",
    group: "meta",
    family: "meta",
    title: "Meta describe insights schema",
    description:
      "Paid. Pro $19/mo. Local insights catalog (levels, date_presets, breakdowns, fields). Call before meta_insights — do not invent Graph fields. Zero Graph/gateway HTTP. Writes/catalogs/audiences/lift stay out of v1. LICENSE_REQUIRED without a license.",
    inputSchema: S.metaDescribeInsightsSchema,
    annotations: ANN_RO,
    handler: async (ctx) => metaDescribeInsightsSchema(ctx),
  },
  {
    name: "meta_list_campaigns",
    group: "meta",
    family: "meta",
    title: "Meta list campaigns",
    description:
      "Paid. Pro $19/mo. List campaigns for an ad_account_id from meta_list_ad_accounts. Empty ≠ auth failure. LICENSE_REQUIRED without a DGTL license.",
    inputSchema: S.metaAccount,
    annotations: ANN_RO,
    handler: async (ctx, args) => metaDisabled(ctx, "meta_list_campaigns", args),
  },
  {
    name: "meta_list_adsets",
    group: "meta",
    family: "meta",
    title: "Meta list ad sets",
    description:
      "Paid. Pro $19/mo. List ad sets for an ad_account_id. LICENSE_REQUIRED without a DGTL license.",
    inputSchema: S.metaAccount,
    annotations: ANN_RO,
    handler: async (ctx, args) => metaDisabled(ctx, "meta_list_adsets", args),
  },
  {
    name: "meta_list_ads",
    group: "meta",
    family: "meta",
    title: "Meta list ads",
    description:
      "Paid. Pro $19/mo. List ads for an ad_account_id. LICENSE_REQUIRED without a DGTL license.",
    inputSchema: S.metaAccount,
    annotations: ANN_RO,
    handler: async (ctx, args) => metaDisabled(ctx, "meta_list_ads", args),
  },
  {
    name: "meta_insights",
    group: "meta",
    family: "meta",
    title: "Meta insights",
    description:
      "Paid. Pro $19/mo. Read insights: level (account/campaign/adset/ad), date_preset or date_start/date_stop, optional breakdowns (age/gender/publisher_platform/…) and fields. Call meta_describe_insights_schema first. Cite data.cited. Empty ≠ auth. ads_read only — no mutate. LICENSE_REQUIRED without a license.",
    inputSchema: S.metaInsights,
    annotations: ANN_RO,
    handler: async (ctx, args) => metaDisabled(ctx, "meta_insights", args),
  },
  {
    name: "meta_get_creative",
    group: "meta",
    family: "meta",
    title: "Meta get creative",
    description:
      "Paid. Pro $19/mo. Creative metadata and image URLs, not bytes. LICENSE_REQUIRED without a license.",
    inputSchema: S.metaCreative,
    annotations: ANN_RO,
    handler: async (ctx, args) => metaDisabled(ctx, "meta_get_creative", args),
  },
  {
    name: "meta_update_campaign",
    group: "meta-write",
    family: "meta",
    title: "Meta update campaign",
    description:
      "Paid mutate. Update Meta campaign status (ACTIVE/PAUSED) and/or name. Defaults on; opt out with DGTL_META_MUTATE_ENABLED=false (META_MUTATE_NOT_ENABLED). Worker META_MUTATE_ENABLED still required for live hop. Prefer dry_run; live needs confirm_phrase containing act_{ad_account_id} AND campaign_id after a user message this turn. Closed fields only — no budget/create/creative. Requires ads_management when scopes detectable.",
    inputSchema: S.metaUpdateCampaign,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => metaUpdateCampaign(ctx, args),
  },
  {
    name: "meta_update_adset",
    group: "meta-write",
    family: "meta",
    title: "Meta update ad set",
    description:
      "Paid mutate. Update Meta ad set status (ACTIVE/PAUSED), optional name, and/or daily_budget XOR lifetime_budget. Budgets are integer **cents** (Meta account currency smallest unit — not Google Ads micros). Spend-cap gate $100k/day equivalent. Defaults on; opt out with DGTL_META_MUTATE_ENABLED=false (META_MUTATE_NOT_ENABLED). Worker META_MUTATE_ENABLED still required for live hop. Prefer dry_run; live needs confirm_phrase containing act_{ad_account_id} AND adset_id. Do not invent objective/creative/targeting.",
    inputSchema: S.metaUpdateAdset,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => metaUpdateAdset(ctx, args),
  },
  {
    name: "meta_update_ad",
    group: "meta-write",
    family: "meta",
    title: "Meta update ad",
    description:
      "Paid mutate. Update Meta ad status (ACTIVE/PAUSED) and/or name. Defaults on; opt out with DGTL_META_MUTATE_ENABLED=false (META_MUTATE_NOT_ENABLED). Worker META_MUTATE_ENABLED still required for live hop. Prefer dry_run; live needs confirm_phrase containing act_{ad_account_id} AND ad_id. No creative fields.",
    inputSchema: S.metaUpdateAd,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => metaUpdateAd(ctx, args),
  },
  {
    name: "meta_create_campaign",
    group: "meta-write",
    family: "meta",
    title: "Meta create campaign",
    description:
      "Paid mutate. Create a Meta campaign (closed Outcome objective + special_ad_categories). Defaults PAUSED. dry_run default; live needs confirm_phrase containing act_{ad_account_id}. Spend is not set at campaign level. Requires ads_management when scopes detectable (META_SCOPE_MISSING otherwise). Opt out with DGTL_META_MUTATE_ENABLED=false.",
    inputSchema: S.metaCreateCampaign,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => metaCreateCampaign(ctx, args),
  },
  {
    name: "meta_create_adset",
    group: "meta-write",
    family: "meta",
    title: "Meta create ad set",
    description:
      "Paid mutate. Create a Meta ad set on an existing campaign. daily_budget XOR lifetime_budget in integer cents (not micros); countries → server-built geo targeting only. Spend-cap $100k. Defaults PAUSED. dry_run default; live needs confirm_phrase containing act_{ad_account_id} AND campaign_id. No targeting JSON / audiences. ads_management required when detectable.",
    inputSchema: S.metaCreateAdset,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => metaCreateAdset(ctx, args),
  },
  {
    name: "meta_create_ad",
    group: "meta-write",
    family: "meta",
    title: "Meta create ad",
    description:
      "Paid mutate. Create a Meta ad on an existing ad set using an existing creative_id (from meta_create_ad_creative / upload). Defaults PAUSED. dry_run default; live needs confirm_phrase containing act_{ad_account_id} AND adset_id AND creative_id. ads_management required when detectable.",
    inputSchema: S.metaCreateAd,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => metaCreateAd(ctx, args),
  },
  {
    name: "meta_upload_ad_image",
    group: "meta-write",
    family: "meta",
    title: "Meta upload ad image",
    description:
      "Paid mutate. Upload ad image bytes (base64) → image_hash for meta_create_ad_creative. dry_run default; live needs confirm_phrase containing act_{ad_account_id}. Closed hop — no open Graph proxy. ads_management required when detectable.",
    inputSchema: S.metaUploadAdImage,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => metaUploadAdImage(ctx, args),
  },
  {
    name: "meta_upload_ad_video",
    group: "meta-write",
    family: "meta",
    title: "Meta upload ad video",
    description:
      "Paid mutate. Optional video upload via https file_url (media source, not a hop proxy) → video_id. dry_run default; live needs confirm_phrase containing act_{ad_account_id}. ads_management required when detectable.",
    inputSchema: S.metaUploadAdVideo,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => metaUploadAdVideo(ctx, args),
  },
  {
    name: "meta_create_ad_creative",
    group: "meta-write",
    family: "meta",
    title: "Meta create ad creative",
    description:
      "Paid mutate. Create AdCreative from image_hash XOR video_id + page_id + https link; returns creative_id for meta_create_ad. dry_run default; live needs confirm_phrase containing act_{ad_account_id} AND page_id. Closed object_story_spec built server-side. ads_management required when detectable.",
    inputSchema: S.metaCreateAdCreative,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => metaCreateAdCreative(ctx, args),
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export const FREE_TOOL_NAMES = TOOLS.filter((t) => t.family === "identity" || t.family === "ga4" || t.family === "gsc" || t.family === "gtm").map(
  (t) => t.name,
);
