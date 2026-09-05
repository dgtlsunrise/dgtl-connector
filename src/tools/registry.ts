import type { z } from "zod";
import type { AppContext } from "../context.js";
import type { Envelope } from "../envelope.js";
import { gbpNotEnabled } from "../google/gbp.js";
import * as ga4 from "../google/ga4.js";
import * as gsc from "../google/gsc.js";
import * as gtm from "../google/gtm.js";
import * as gtmWrite from "../google/gtm-write.js";
import { googleWhoami } from "../google/whoami.js";
import { gadsDisabled, licenseStatus } from "../ads/gads.js";
import { metaDisabled } from "../meta/meta.js";
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
    description: `${RO} Dimensions and metrics (apiName) for this property. Use before unfamiliar names.`,
    inputSchema: S.propertyId,
    annotations: ANN_RO,
    handler: (ctx, args) => ga4.ga4GetMetadata(ctx, args),
  },
  {
    name: "ga4_run_report",
    group: "ga4-data",
    family: "ga4",
    title: "GA4 run report",
    description: `${RO} The only GA4 report tool. Denylists searchQuery/query/searchTerm/keyword with no Google call. property_id, date_ranges, metrics required. Cap 1000 rows. Echoes propertyQuota.`,
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
    description: `${RO} Search queries, pages, countries, devices. This is the tool for search queries — not ga4_run_report. Always pass data_state.`,
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
    description: `${RO} List Tag Manager accounts. Classic 403 accessNotConfigured if Tag Manager API is not Enabled.`,
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
    description: `${RO} List workspaces. If more than one, do not default to Default Workspace.`,
    inputSchema: S.gtmContainer,
    annotations: ANN_RO,
    handler: (ctx, args) => gtm.gtmListWorkspaces(ctx, args),
  },
  {
    name: "gtm_list_tags",
    group: "gtm",
    family: "gtm",
    title: "GTM list tags",
    description: `${RO} Workspace draft tags (source=workspace). Not the live container. Paginated; truncated when oversize.`,
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
    description: `${RO} Published container (source=live). This is what is on the site. Never publishes.`,
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
    description: "Paid. Pro $19/mo. Requires a DGTL license. Lists accessible Ads customers. No mutate. Returns LICENSE_REQUIRED without a license.",
    inputSchema: S.emptyInput,
    annotations: ANN_RO,
    handler: async (ctx, args) => gadsDisabled(ctx, "gads_list_accessible_customers", args),
  },
  {
    name: "gads_get_customer",
    group: "gads",
    family: "gads",
    title: "Google Ads get customer",
    description: "Paid. Pro $19/mo. Descriptive name, currency, time zone. LICENSE_REQUIRED without a DGTL license.",
    inputSchema: S.gadsCustomer,
    annotations: ANN_RO,
    handler: async (ctx, args) => gadsDisabled(ctx, "gads_get_customer", args),
  },
  {
    name: "gads_search",
    group: "gads",
    family: "gads",
    title: "Google Ads search (recipes)",
    description: "Paid. Pro $19/mo. Closed recipe enum (campaigns, ad_groups, keywords, search_terms, conversion_actions, change_status, policy_topics, performance). The model never sends raw GAQL. LICENSE_REQUIRED without a license. No developer-token on this client.",
    inputSchema: S.gadsSearch,
    annotations: ANN_RO,
    handler: async (ctx, args) => gadsDisabled(ctx, "gads_search", args),
  },
  {
    name: "gads_campaign_performance",
    group: "gads",
    family: "gads",
    title: "Google Ads campaign performance",
    description: "Paid. Pro $19/mo. Campaign performance recipe. LICENSE_REQUIRED without a DGTL license.",
    inputSchema: S.gadsSearch,
    annotations: ANN_RO,
    handler: async (ctx, args) => gadsDisabled(ctx, "gads_campaign_performance", args),
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
  // Paid Meta
  {
    name: "meta_list_ad_accounts",
    group: "meta",
    family: "meta",
    title: "Meta list ad accounts",
    description: "Paid. Pro $19/mo. LICENSE_REQUIRED without a DGTL license. Meta app secret is never in this plugin.",
    inputSchema: S.emptyInput,
    annotations: ANN_RO,
    handler: async (ctx, args) => metaDisabled(ctx, "meta_list_ad_accounts", args),
  },
  {
    name: "meta_list_campaigns",
    group: "meta",
    family: "meta",
    title: "Meta list campaigns",
    description: "Paid. Pro $19/mo. LICENSE_REQUIRED without a DGTL license.",
    inputSchema: S.metaAccount,
    annotations: ANN_RO,
    handler: async (ctx, args) => metaDisabled(ctx, "meta_list_campaigns", args),
  },
  {
    name: "meta_list_adsets",
    group: "meta",
    family: "meta",
    title: "Meta list ad sets",
    description: "Paid. Pro $19/mo. LICENSE_REQUIRED without a DGTL license.",
    inputSchema: S.metaAccount,
    annotations: ANN_RO,
    handler: async (ctx, args) => metaDisabled(ctx, "meta_list_adsets", args),
  },
  {
    name: "meta_list_ads",
    group: "meta",
    family: "meta",
    title: "Meta list ads",
    description: "Paid. Pro $19/mo. LICENSE_REQUIRED without a DGTL license.",
    inputSchema: S.metaAccount,
    annotations: ANN_RO,
    handler: async (ctx, args) => metaDisabled(ctx, "meta_list_ads", args),
  },
  {
    name: "meta_insights",
    group: "meta",
    family: "meta",
    title: "Meta insights",
    description: "Paid. Pro $19/mo. Recipe insights (account/campaign/adset/ad + date + level). LICENSE_REQUIRED without a license.",
    inputSchema: S.metaInsights,
    annotations: ANN_RO,
    handler: async (ctx, args) => metaDisabled(ctx, "meta_insights", args),
  },
  {
    name: "meta_get_creative",
    group: "meta",
    family: "meta",
    title: "Meta get creative",
    description: "Paid. Pro $19/mo. Creative metadata and image URLs, not bytes. LICENSE_REQUIRED without a license.",
    inputSchema: S.metaCreative,
    annotations: ANN_RO,
    handler: async (ctx, args) => metaDisabled(ctx, "meta_get_creative", args),
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export const FREE_TOOL_NAMES = TOOLS.filter((t) => t.family === "identity" || t.family === "ga4" || t.family === "gsc" || t.family === "gtm").map(
  (t) => t.name,
);
