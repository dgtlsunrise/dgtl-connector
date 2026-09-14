import type { z } from "zod";
import type { AppContext } from "../context.js";
import type { Envelope } from "../envelope.js";
import {
  gbpGetLocation,
  gbpListAccounts,
  gbpListLocations,
  gbpPerformance,
  gbpSearchKeywords,
} from "../google/gbp.js";
import * as ga4 from "../google/ga4.js";
import * as ga4Write from "../google/ga4-write.js";
import * as gsc from "../google/gsc.js";
import * as gscWrite from "../google/gsc-write.js";
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
  gadsUploadAsset,
} from "../ads/gads-write.js";
import {
  gadsAddDemographics,
  gadsAddGeoTargets,
  gadsAddLanguages,
  gadsAddNegativeKeywords,
  gadsAddShoppingListingGroups,
  gadsApplyRecommendation,
  gadsApplyRecommendations,
  gadsAttachAudience,
  gadsCreateAppCampaign,
  gadsCreateConversionAction,
  gadsCreateDemandGenCampaign,
  gadsCreateExperiment,
  gadsCreateHotelCampaign,
  gadsCreateLocalCampaign,
  gadsCreatePortfolioBiddingStrategy,
  gadsCreateResponsiveDisplayAd,
  gadsCreateSharedBudget,
  gadsCreateVideoCampaign,
  gadsLinkMerchantCenter,
  gadsSetAdSchedule,
  gadsSetCampaignBidStrategy,
  gadsUnlinkMerchantCenter,
} from "../ads/gads-wave2.js";
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
import {
  metaAttachAudience,
  metaCreateCustomAudience,
  metaCreateLookalikeAudience,
  metaGetPixel,
  metaListCatalogProducts,
  metaListCatalogs,
  metaListCustomAudiences,
  metaListPixels,
  metaUpdateAdsetTargeting,
} from "../meta/meta-wave3.js";
import {
  metaCatalogItemsBatch,
  metaCreateCatalog,
  metaGetBatchStatus,
  metaSendCapiEvents,
} from "../meta/meta-wave16.js";
import { metaDisabled, metaDescribeInsightsSchema } from "../meta/meta.js";
import {
  mcGetProduct,
  mcListAccountIssues,
  mcListAccounts,
  mcListDataSources,
  mcListProductStatuses,
  mcListProducts,
} from "../google/mc.js";
import {
  mcCreateDataSource,
  mcDeleteProductInput,
  mcFetchDataSource,
  mcUpsertProductInput,
} from "../google/mc-write.js";
import {
  shopifyGetShop,
  shopifyListProducts,
  shopifyGetProduct,
  shopifyListOrders,
  shopifyGetOrder,
  shopifyListLocations,
  shopifyListInventoryLevels,
  shopifyListPublications,
  shopifyListCatalogs,
  shopifyListProductFeeds,
} from "../shopify/shopify.js";
import { shopifyAdjustInventory, shopifyProductSet } from "../shopify/shopify-write.js";
import { tiktokDisabled } from "../tiktok/tiktok.js";
import { tiktokUpdateCampaign, tiktokUpdateCampaignBudget } from "../tiktok/tiktok-write.js";
import {
  tiktokBindCatalogEventsource,
  tiktokCreateCampaign,
  tiktokCreateCatalog,
  tiktokListCatalogs,
  tiktokListPixels,
  tiktokTrackEvents,
  tiktokUploadCatalogProducts,
} from "../tiktok/tiktok-wave17.js";
import {
  klaviyoGetAccount,
  klaviyoGetFlow,
  klaviyoGetProfile,
  klaviyoGetReview,
  klaviyoListCampaigns,
  klaviyoListCatalogCategories,
  klaviyoListCatalogItems,
  klaviyoListCatalogVariants,
  klaviyoListFlows,
  klaviyoListLists,
  klaviyoListMetrics,
  klaviyoListProfiles,
  klaviyoListReviews,
  klaviyoListSegments,
} from "../klaviyo/klaviyo.js";
import {
  klaviyoCreateCampaign,
  klaviyoCreateCampaignSendJob,
  klaviyoCreateEvent,
  klaviyoUpsertCatalogItems,
  klaviyoUpsertProfile,
} from "../klaviyo/klaviyo-write.js";
import { supportPacket } from "../support/packet.js";
import { feedbackPrepare, feedbackSend } from "../support/feedback.js";
import { conversionFabricStatus, sgtmIngestTest } from "../conversion/fabric.js";
import * as S from "./schemas.js";

export type ToolFamily =
  | "identity"
  | "ga4"
  | "ga4_write"
  | "gsc"
  | "gsc_write"
  | "gtm"
  | "gtm_write"
  | "gbp"
  | "gads"
  | "meta"
  | "mc"
  | "shopify"
  | "shopify_write"
  | "tiktok"
  | "klaviyo"
  | "klaviyo_write"
  | "license";

export type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type StampHopAnnotation = {
  family: "gads" | "meta" | "tiktok";
  kind: "read_hop" | "mutate" | "plugin_local";
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
  /** Wave 9: stamp hop classification derived from family+group. Not an MCP tools/list field. */
  stampHop?: StampHopAnnotation;
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
    description: `${RO} The only GA4 report tool. Denylists searchQuery/query/searchTerm/keyword with no Google call. Optional closed Ads-id MTA recipes (campaign/ad group/creative/customer ids). v1beta has no conversionSpec — use keyEvents:{name} or key_event_names. property_id and date_ranges required. Cap 1000 rows. Echoes propertyQuota. Cite data.cited; do not invent apiNames (use ga4_get_metadata).`,
    inputSchema: S.ga4RunReport,
    annotations: ANN_RO,
    handler: (ctx, args) => ga4.ga4RunReport(ctx, args),
  },
  {
    name: "ga4_list_google_ads_links",
    group: "ga4-write",
    family: "ga4_write",
    title: "GA4 list Google Ads links",
    description:
      "List Google Ads links on a property. Admin GET accepts analytics.readonly (Consent A). Not in the 24-tool Consent A kernel. property_id required.",
    inputSchema: S.ga4ListGoogleAdsLinks,
    annotations: ANN_RO,
    handler: (ctx, args) => ga4Write.ga4ListGoogleAdsLinks(ctx, args),
  },
  {
    name: "ga4_create_google_ads_link",
    group: "ga4-write",
    family: "ga4_write",
    title: "GA4 create Google Ads link (Consent G)",
    description:
      "Create a Google Ads link on a property. Needs analytics.edit on Free Google. dry_run default; live needs confirm_phrase containing properties/{id}.",
    inputSchema: S.ga4CreateGoogleAdsLink,
    annotations: ANN_WRITE,
    handler: (ctx, args) => ga4Write.ga4CreateGoogleAdsLink(ctx, args),
  },
  {
    name: "ga4_delete_google_ads_link",
    group: "ga4-write",
    family: "ga4_write",
    title: "GA4 delete Google Ads link (Consent G)",
    description:
      "Delete a Google Ads link. Consent G. dry_run default; live needs confirm_phrase containing properties/{id}.",
    inputSchema: S.ga4DeleteGoogleAdsLink,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => ga4Write.ga4DeleteGoogleAdsLink(ctx, args),
  },
  {
    name: "ga4_get_attribution_settings",
    group: "ga4-write",
    family: "ga4_write",
    title: "GA4 get attribution settings",
    description:
      "Get property attributionSettings. v1beta has no this RPC — uses Admin v1alpha GET, which accepts analytics.readonly (Consent A). property_id required.",
    inputSchema: S.ga4GetAttributionSettings,
    annotations: ANN_RO,
    handler: (ctx, args) => ga4Write.ga4GetAttributionSettings(ctx, args),
  },
  {
    name: "ga4_update_attribution_settings",
    group: "ga4-write",
    family: "ga4_write",
    title: "GA4 update attribution settings (Consent G)",
    description:
      "Patch attributionSettings (v1alpha). Consent G. Closed enums only. dry_run default; live needs confirm_phrase containing properties/{id}.",
    inputSchema: S.ga4UpdateAttributionSettings,
    annotations: ANN_WRITE,
    handler: (ctx, args) => ga4Write.ga4UpdateAttributionSettings(ctx, args),
  },
  {
    name: "ga4_create_data_stream",
    group: "ga4-write",
    family: "ga4_write",
    title: "GA4 create web data stream (Consent G)",
    description:
      "Create a WEB_DATA_STREAM. Consent G. dry_run default; live needs confirm_phrase containing properties/{id}.",
    inputSchema: S.ga4CreateDataStream,
    annotations: ANN_WRITE,
    handler: (ctx, args) => ga4Write.ga4CreateDataStream(ctx, args),
  },
  {
    name: "ga4_update_data_stream",
    group: "ga4-write",
    family: "ga4_write",
    title: "GA4 update data stream (Consent G)",
    description:
      "Patch a data stream display name and/or default URI. Consent G. dry_run default; live needs confirm_phrase containing properties/{id}.",
    inputSchema: S.ga4UpdateDataStream,
    annotations: ANN_WRITE,
    handler: (ctx, args) => ga4Write.ga4UpdateDataStream(ctx, args),
  },
  {
    name: "ga4_create_key_event",
    group: "ga4-write",
    family: "ga4_write",
    title: "GA4 create key event (Consent G)",
    description:
      "Create a key event / conversion. Consent G. dry_run default; live needs confirm_phrase containing properties/{id}.",
    inputSchema: S.ga4CreateKeyEvent,
    annotations: ANN_WRITE,
    handler: (ctx, args) => ga4Write.ga4CreateKeyEvent(ctx, args),
  },
  {
    name: "ga4_update_key_event",
    group: "ga4-write",
    family: "ga4_write",
    title: "GA4 update key event (Consent G)",
    description:
      "Patch a key event counting method. Consent G. dry_run default; live needs confirm_phrase containing properties/{id}.",
    inputSchema: S.ga4UpdateKeyEvent,
    annotations: ANN_WRITE,
    handler: (ctx, args) => ga4Write.ga4UpdateKeyEvent(ctx, args),
  },
  {
    name: "ga4_create_custom_dimension",
    group: "ga4-write",
    family: "ga4_write",
    title: "GA4 create custom dimension (Consent G)",
    description:
      "Create a custom dimension (EVENT/USER/ITEM). Consent G. dry_run default; live needs confirm_phrase containing properties/{id}.",
    inputSchema: S.ga4CreateCustomDimension,
    annotations: ANN_WRITE,
    handler: (ctx, args) => ga4Write.ga4CreateCustomDimension(ctx, args),
  },
  {
    name: "ga4_create_custom_metric",
    group: "ga4-write",
    family: "ga4_write",
    title: "GA4 create custom metric (Consent G)",
    description:
      "Create an EVENT-scoped custom metric. Consent G. dry_run default; live needs confirm_phrase containing properties/{id}.",
    inputSchema: S.ga4CreateCustomMetric,
    annotations: ANN_WRITE,
    handler: (ctx, args) => ga4Write.ga4CreateCustomMetric(ctx, args),
  },
  {
    name: "ga4_list_mp_secrets",
    group: "ga4-write",
    family: "ga4_write",
    title: "GA4 list Measurement Protocol secrets (Consent G)",
    description:
      "List MP secrets for a data stream. Needs analytics.edit on Free Google. secretValue is redacted in the envelope and never written to logs. Writes flag is not required for this read.",
    inputSchema: S.ga4ListMpSecrets,
    annotations: ANN_RO,
    handler: (ctx, args) => ga4Write.ga4ListMpSecrets(ctx, args),
  },
  {
    name: "ga4_create_mp_secret",
    group: "ga4-write",
    family: "ga4_write",
    title: "GA4 create Measurement Protocol secret (Consent G)",
    description:
      "Create an MP secret. Consent G. dry_run default; live needs confirm_phrase containing properties/{id}. secretValue is never written to logs.",
    inputSchema: S.ga4CreateMpSecret,
    annotations: ANN_WRITE,
    handler: (ctx, args) => ga4Write.ga4CreateMpSecret(ctx, args),
  },
  {
    name: "ga4_create_property",
    group: "ga4-write",
    family: "ga4_write",
    title: "GA4 create property (Consent G)",
    description:
      "Create an ordinary GA4 property under an account. Consent G. dry_run default; live needs confirm_phrase containing accounts/{id}. Disposable DGTL property only.",
    inputSchema: S.ga4CreateProperty,
    annotations: ANN_WRITE,
    handler: (ctx, args) => ga4Write.ga4CreateProperty(ctx, args),
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
    name: "gsc_submit_sitemap",
    group: "gsc-write",
    family: "gsc_write",
    title: "GSC submit sitemap (Consent S)",
    description:
      "PUT sitemaps.submit for an exact site_url + feedpath. Needs webmasters write on Free Google. dry_run default; live needs confirm_phrase containing that site_url. No request-indexing tool.",
    inputSchema: S.gscSubmitSitemap,
    annotations: ANN_WRITE,
    handler: (ctx, args) => gscWrite.gscSubmitSitemap(ctx, args),
  },
  {
    name: "gsc_delete_sitemap",
    group: "gsc-write",
    family: "gsc_write",
    title: "GSC delete sitemap (Consent S)",
    description:
      "DELETE sitemaps.delete for an exact site_url + feedpath. Consent S. dry_run default; live needs confirm_phrase containing that site_url.",
    inputSchema: S.gscDeleteSitemap,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gscWrite.gscDeleteSitemap(ctx, args),
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
  {
    name: "gtm_list_clients",
    group: "gtm",
    family: "gtm",
    title: "GTM list clients",
    description: `${RO} Workspace draft sGTM clients (source=workspace). Consent A tagmanager.readonly. Server containers expose clients; web containers are often empty. Not stamp ingest.`,
    inputSchema: S.gtmWorkspaceList,
    annotations: ANN_RO,
    handler: (ctx, args) => gtm.gtmListClients(ctx, args),
  },
  {
    name: "gtm_list_environments",
    group: "gtm",
    family: "gtm",
    title: "GTM list environments",
    description: `${RO} Container environments (USER / live / latest / workspace). Consent A tagmanager.readonly. Not workspace-scoped.`,
    inputSchema: S.gtmContainer,
    annotations: ANN_RO,
    handler: (ctx, args) => gtm.gtmListEnvironments(ctx, args),
  },

  // GTM write/publish via GoogleWriteHttp (Free Google manage scopes + confirm; not DGTL_WRITES_ENABLED)
  {
    name: "gtm_create_tag",
    group: "gtm-write",
    family: "gtm_write",
    title: "GTM create tag (Consent W)",
    description:
      "Create a workspace tag. Needs tagmanager.edit.containers on Free Google. Prefer dry_run; live mutate needs an explicit user confirm that includes the container publicId.",
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
      "Update a workspace tag. Needs Free Google GTM write scopes. Prefer dry_run; live mutate needs an explicit user confirm that includes the container publicId.",
    inputSchema: S.gtmUpdateTag,
    annotations: ANN_WRITE,
    handler: (ctx, args) => gtmWrite.gtmUpdateTag(ctx, args),
  },
  {
    name: "gtm_create_trigger",
    group: "gtm-write",
    family: "gtm_write",
    title: "GTM create trigger (Consent W)",
    description:
      "Create a workspace trigger. Needs Free Google GTM write scopes. Prefer dry_run; live mutate needs an explicit user confirm that includes the container publicId.",
    inputSchema: S.gtmCreateTrigger,
    annotations: ANN_WRITE,
    handler: (ctx, args) => gtmWrite.gtmCreateTrigger(ctx, args),
  },
  {
    name: "gtm_update_trigger",
    group: "gtm-write",
    family: "gtm_write",
    title: "GTM update trigger (Consent W)",
    description:
      "Update a workspace trigger. Needs Free Google GTM write scopes. Prefer dry_run; live mutate needs an explicit user confirm that includes the container publicId.",
    inputSchema: S.gtmUpdateTrigger,
    annotations: ANN_WRITE,
    handler: (ctx, args) => gtmWrite.gtmUpdateTrigger(ctx, args),
  },
  {
    name: "gtm_create_variable",
    group: "gtm-write",
    family: "gtm_write",
    title: "GTM create variable (Consent W)",
    description:
      "Create a workspace variable. Needs Free Google GTM write scopes. Prefer dry_run; live mutate needs an explicit user confirm that includes the container publicId.",
    inputSchema: S.gtmCreateVariable,
    annotations: ANN_WRITE,
    handler: (ctx, args) => gtmWrite.gtmCreateVariable(ctx, args),
  },
  {
    name: "gtm_update_variable",
    group: "gtm-write",
    family: "gtm_write",
    title: "GTM update variable (Consent W)",
    description:
      "Update a workspace variable. Needs Free Google GTM write scopes. Prefer dry_run; live mutate needs an explicit user confirm that includes the container publicId.",
    inputSchema: S.gtmUpdateVariable,
    annotations: ANN_WRITE,
    handler: (ctx, args) => gtmWrite.gtmUpdateVariable(ctx, args),
  },
  {
    name: "gtm_publish_container",
    group: "gtm-write",
    family: "gtm_write",
    title: "GTM publish container (Consent W)",
    description:
      "Publish a GTM container version. Highest-risk write. Needs tagmanager.publish on Free Google. Prefer dry_run first; live publish requires an explicit confirm that includes the container publicId from the user this turn.",
    inputSchema: S.gtmPublishContainer,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gtmWrite.gtmPublishContainer(ctx, args),
  },
  {
    name: "gtm_create_client",
    group: "gtm-write",
    family: "gtm_write",
    title: "GTM create client (Consent W)",
    description:
      "Create a workspace sGTM client. Needs tagmanager.edit.containers on Free Google. Closed type enum (gaawp/googtag/gclidw/flc/ua/mp). Prefer dry_run; live mutate needs confirm_phrase containing the container publicId or accounts/{id}/containers/{id} path. Not stamp ingest.",
    inputSchema: S.gtmCreateClient,
    annotations: ANN_WRITE,
    handler: (ctx, args) => gtmWrite.gtmCreateClient(ctx, args),
  },
  {
    name: "gtm_update_client",
    group: "gtm-write",
    family: "gtm_write",
    title: "GTM update client (Consent W)",
    description:
      "Update a workspace sGTM client. Needs Free Google GTM write scopes. Closed type enum. Prefer dry_run; live mutate needs confirm_phrase containing the container publicId or container path.",
    inputSchema: S.gtmUpdateClient,
    annotations: ANN_WRITE,
    handler: (ctx, args) => gtmWrite.gtmUpdateClient(ctx, args),
  },
  {
    name: "gtm_create_container",
    group: "gtm-write",
    family: "gtm_write",
    title: "GTM create container (Consent W)",
    description:
      "Create a GTM container. Needs Free Google GTM write scopes. Closed usage_context enum (server = sGTM; web/android/ios/amp locked). Prefer dry_run; live mutate needs confirm_phrase containing accounts/{account_id}.",
    inputSchema: S.gtmCreateContainer,
    annotations: ANN_WRITE,
    handler: (ctx, args) => gtmWrite.gtmCreateContainer(ctx, args),
  },
  {
    name: "gtm_create_environment",
    group: "gtm-write",
    family: "gtm_write",
    title: "GTM create environment (Consent W)",
    description:
      "Create a USER GTM environment. Needs Free Google GTM write scopes. Prefer dry_run; live mutate needs confirm_phrase containing the container publicId or container path. Does not reauthorize preview.",
    inputSchema: S.gtmCreateEnvironment,
    annotations: ANN_WRITE,
    handler: (ctx, args) => gtmWrite.gtmCreateEnvironment(ctx, args),
  },
  // GBP — Consent B GET-only. Flag default off. Never Consent A / stamp.
  {
    name: "gbp_list_accounts",
    group: "gbp",
    family: "gbp",
    title: "GBP list accounts",
    description:
      "Google Business Profile accounts (Account Management API). Flag off → GBP_NOT_ENABLED. Flag on needs Consent B (business.manage). GET-only; not Consent A.",
    inputSchema: S.gbpAccounts,
    annotations: ANN_RO,
    handler: (ctx, args) => gbpListAccounts(ctx, args),
  },
  {
    name: "gbp_list_locations",
    group: "gbp",
    family: "gbp",
    title: "GBP list locations",
    description:
      "GBP locations for an account. Requires account_name from gbp_list_accounts. Consent B, not Consent A. GET-only.",
    inputSchema: S.gbpLocations,
    annotations: ANN_RO,
    handler: (ctx, args) => gbpListLocations(ctx, args),
  },
  {
    name: "gbp_get_location",
    group: "gbp",
    family: "gbp",
    title: "GBP get location",
    description: "GBP location (title, place_id, website, labels). Requires location_name. GET-only; no location mutate.",
    inputSchema: S.gbpGetLocation,
    annotations: ANN_RO,
    handler: (ctx, args) => gbpGetLocation(ctx, args),
  },
  {
    name: "gbp_performance",
    group: "gbp",
    family: "gbp",
    title: "GBP performance",
    description:
      "GBP Performance daily metrics time series. Requires location_name + start_date + end_date. Performance API does not list locations. GET-only.",
    inputSchema: S.gbpPerformance,
    annotations: ANN_RO,
    handler: (ctx, args) => gbpPerformance(ctx, args),
  },
  {
    name: "gbp_search_keywords",
    group: "gbp",
    family: "gbp",
    title: "GBP search keywords",
    description: "Monthly search-keyword impressions for a location. Requires location_name. GET-only.",
    inputSchema: S.gbpKeywords,
    annotations: ANN_RO,
    handler: (ctx, args) => gbpSearchKeywords(ctx, args),
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
      "Paid. Pro $19/mo. Closed recipe enum only (campaigns, ad_groups, keywords, search_terms, conversion_actions, change_status, policy_topics, performance, assets, asset_groups, audiences, shared_sets, bidding_strategies, geo, demographics, shopping_performance, recommendations, change_event, account_budget, negatives, experiments, click_view, keyword_performance, ad_performance). Call gads_describe_recipes first — do not invent GAQL. customer_id digits without hyphens; cite data.cited. LICENSE_REQUIRED without a license. No developer-token on this client.",
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
      "Paid mutate. Add up to 20 Search keywords to an ad group (EXACT/PHRASE/BROAD). Defaults PAUSED. ENABLED only with explicit status + confirm. Prefer dry_run; live confirm_phrase with customer_id. Consent C + Pro + gateway.",
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
      "Paid mutate. Display foundation: budget + DISPLAY campaign + DISPLAY_STANDARD ad group. Campaign defaults PAUSED; child ad group ENABLED. Add RDA via gads_create_responsive_display_ad after gads_upload_asset. Spend-cap. Prefer dry_run; live confirm_phrase with customer_id. Consent C + Pro + gateway — never Consent A.",
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
      "Paid mutate. PMax: budget + PERFORMANCE_MAX + asset group + text assets + marketing/square/logo images. Pass existing asset resource names from gads_upload_asset, or https file_url / base64 bytes (Worker uploads inline). Defaults PAUSED. Prefer dry_run; live confirm_phrase with customer_id. Consent C + Pro + gateway.",
    inputSchema: S.gadsCreatePerformanceMaxCampaign,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsCreatePerformanceMaxCampaign(ctx, args),
  },
  {
    name: "gads_upload_asset",
    group: "gads-write",
    family: "gads",
    title: "Google Ads upload image asset (Consent C)",
    description:
      "Paid mutate. Upload an IMAGE asset via stamp AssetService (base64 bytes XOR https file_url). Returns asset resource_name for PMax. dry_run default; live confirm_phrase with customer_id. Consent C + Pro + gateway.",
    inputSchema: S.gadsUploadAsset,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsUploadAsset(ctx, args),
  },
  {
    name: "gads_create_shopping_campaign",
    group: "gads-write",
    family: "gads",
    title: "Google Ads Shopping create (Consent C)",
    description:
      "Paid mutate. Shopping create when merchant_center_id is known (discover via gads_list_merchant_center_links). Without merchant_center_id → MERCHANT_CENTER_REQUIRED (zero hop). Budget + SHOPPING campaign. Add listing groups with gads_add_shopping_listing_groups. Defaults PAUSED. Prefer dry_run; live confirm_phrase with customer_id. Consent C + Pro + gateway.",
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
    name: "gads_create_responsive_display_ad",
    group: "gads-write",
    family: "gads",
    title: "Google Ads create RDA (Consent C)",
    description:
      "Paid mutate. Create a Responsive Display Ad on an existing Display ad group (marketing + square images from gads_upload_asset or file_url/bytes, headlines, long_headline, descriptions, business_name, https final_url). Defaults PAUSED. Prefer dry_run; live confirm_phrase with customer_id. Consent C + Pro + gateway.",
    inputSchema: S.gadsCreateResponsiveDisplayAd,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsCreateResponsiveDisplayAd(ctx, args),
  },
  {
    name: "gads_add_shopping_listing_groups",
    group: "gads-write",
    family: "gads",
    title: "Google Ads shopping listing groups (Consent C)",
    description:
      "Paid mutate. Add Shopping listing groups (ALL_PRODUCTS UNIT, or BRAND/ITEM_ID subdivision) on an existing shopping campaign/ad group. New shopping ad group is ENABLED under a PAUSED campaign. Prefer dry_run; live confirm_phrase with customer_id.",
    inputSchema: S.gadsAddShoppingListingGroups,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsAddShoppingListingGroups(ctx, args),
  },
  {
    name: "gads_create_video_campaign",
    group: "gads-write",
    family: "gads",
    title: "Google Ads Video create (Consent C)",
    description:
      "Paid mutate. VIDEO campaign + VIDEO_RESPONSIVE ad group. Optional youtube_video_id adds a PAUSED video responsive ad. Campaign defaults PAUSED; child ad group ENABLED. Prefer dry_run; live confirm_phrase with customer_id. Intended-use paste is Noel-owned — live smoke blocked until pasted.",
    inputSchema: S.gadsCreateVideoCampaign,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsCreateVideoCampaign(ctx, args),
  },
  {
    name: "gads_create_demand_gen_campaign",
    group: "gads-write",
    family: "gads",
    title: "Google Ads Demand Gen create (Consent C)",
    description:
      "Paid mutate. DEMAND_GEN campaign + ad group. Optional DemandGenMultiAssetAd when marketing+square images are supplied. Defaults PAUSED. Prefer dry_run; live confirm_phrase with customer_id.",
    inputSchema: S.gadsCreateDemandGenCampaign,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsCreateDemandGenCampaign(ctx, args),
  },
  {
    name: "gads_create_app_campaign",
    group: "gads-write",
    family: "gads",
    title: "Google Ads App create (Consent C)",
    description:
      "Paid mutate. MULTI_CHANNEL APP_CAMPAIGN with app_id + app_store (GOOGLE_APP_STORE|APPLE_APP_STORE). Google generates ads. Defaults PAUSED. Prefer dry_run; live confirm_phrase with customer_id.",
    inputSchema: S.gadsCreateAppCampaign,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsCreateAppCampaign(ctx, args),
  },
  {
    name: "gads_create_hotel_campaign",
    group: "gads-write",
    family: "gads",
    title: "Google Ads Hotel create (Consent C)",
    description:
      "Paid mutate. HOTEL campaign with hotel_center_id + HOTELS_ADS ad group. Defaults PAUSED. Prefer dry_run; live confirm_phrase with customer_id.",
    inputSchema: S.gadsCreateHotelCampaign,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsCreateHotelCampaign(ctx, args),
  },
  {
    name: "gads_create_local_campaign",
    group: "gads-write",
    family: "gads",
    title: "Google Ads Local create (sunset)",
    description:
      "Named tool. Google sunset Local campaigns — returns NOT_IMPLEMENTED (zero hop). Use gads_create_performance_max_campaign. Smart create is not advertised.",
    inputSchema: S.gadsCreateLocalCampaign,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsCreateLocalCampaign(ctx, args),
  },
  {
    name: "gads_add_negative_keywords",
    group: "gads-write",
    family: "gads",
    title: "Google Ads add negative keywords (Consent C)",
    description:
      "Paid mutate. Campaign- or ad-group-level negative keywords (campaign_id XOR ad_group_id). Defaults PAUSED. Prefer dry_run; live confirm_phrase with customer_id.",
    inputSchema: S.gadsAddNegativeKeywords,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsAddNegativeKeywords(ctx, args),
  },
  {
    name: "gads_attach_audience",
    group: "gads-write",
    family: "gads",
    title: "Google Ads attach audience (Consent C)",
    description:
      "Paid mutate. Attach an audience or user list resource name to a campaign or ad group. Defaults PAUSED. Cite ids from gads_search recipe=audiences. Prefer dry_run; live confirm_phrase with customer_id.",
    inputSchema: S.gadsAttachAudience,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsAttachAudience(ctx, args),
  },
  {
    name: "gads_add_geo_targets",
    group: "gads-write",
    family: "gads",
    title: "Google Ads add geo targets (Consent C)",
    description:
      "Paid mutate. Campaign location criteria from geo_target_constant_ids (gads_search recipe=geo). Optional negative. Defaults PAUSED. Prefer dry_run; live confirm_phrase with customer_id.",
    inputSchema: S.gadsAddGeoTargets,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsAddGeoTargets(ctx, args),
  },
  {
    name: "gads_add_languages",
    group: "gads-write",
    family: "gads",
    title: "Google Ads add languages (Consent C)",
    description:
      "Paid mutate. Campaign language criteria from language_constant_ids. Defaults PAUSED. Prefer dry_run; live confirm_phrase with customer_id.",
    inputSchema: S.gadsAddLanguages,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsAddLanguages(ctx, args),
  },
  {
    name: "gads_add_demographics",
    group: "gads-write",
    family: "gads",
    title: "Google Ads add demographics (Consent C)",
    description:
      "Paid mutate. Ad-group age/gender/parental/income criteria (closed enums). Defaults PAUSED. Prefer dry_run; live confirm_phrase with customer_id.",
    inputSchema: S.gadsAddDemographics,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsAddDemographics(ctx, args),
  },
  {
    name: "gads_set_ad_schedule",
    group: "gads-write",
    family: "gads",
    title: "Google Ads set ad schedule (Consent C)",
    description:
      "Paid mutate. Campaign ad-schedule criteria (day_of_week + hours). Defaults PAUSED. Prefer dry_run; live confirm_phrase with customer_id.",
    inputSchema: S.gadsSetAdSchedule,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsSetAdSchedule(ctx, args),
  },
  {
    name: "gads_set_campaign_bid_strategy",
    group: "gads-write",
    family: "gads",
    title: "Google Ads set bid strategy (Consent C)",
    description:
      "Paid mutate. Closed-enum campaign bidding (MANUAL_CPC, MAXIMIZE_CONVERSIONS, TARGET_CPA, TARGET_ROAS, …) or attach a portfolio bidding_strategy_resource_name. Prefer dry_run; live confirm_phrase with customer_id.",
    inputSchema: S.gadsSetCampaignBidStrategy,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsSetCampaignBidStrategy(ctx, args),
  },
  {
    name: "gads_create_shared_budget",
    group: "gads-write",
    family: "gads",
    title: "Google Ads create shared budget (Consent C)",
    description:
      "Paid mutate. Create an explicitly-shared campaign budget (spend-capped). Prefer dry_run; live confirm_phrase with customer_id.",
    inputSchema: S.gadsCreateSharedBudget,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsCreateSharedBudget(ctx, args),
  },
  {
    name: "gads_create_portfolio_bidding_strategy",
    group: "gads-write",
    family: "gads",
    title: "Google Ads create portfolio bid strategy (Consent C)",
    description:
      "Paid mutate. Create a shared/portfolio BiddingStrategy (closed enum). Attach with gads_set_campaign_bid_strategy. Prefer dry_run; live confirm_phrase with customer_id.",
    inputSchema: S.gadsCreatePortfolioBiddingStrategy,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsCreatePortfolioBiddingStrategy(ctx, args),
  },
  {
    name: "gads_create_conversion_action",
    group: "gads-write",
    family: "gads",
    title: "Google Ads create conversion action (Consent C)",
    description:
      "Paid mutate. Create a conversion action (WEBPAGE/UPLOAD_CLICKS/… + category). Tracking, not spend. Prefer dry_run; live confirm_phrase with customer_id.",
    inputSchema: S.gadsCreateConversionAction,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsCreateConversionAction(ctx, args),
  },
  {
    name: "gads_apply_recommendation",
    group: "gads-write",
    family: "gads",
    title: "Google Ads apply recommendation (Consent C)",
    description:
      "Paid mutate. Apply one recommendation from gads_search recipe=recommendations (resource name or id). Confirm-gated. Prefer dry_run; live confirm_phrase with customer_id and that RN. ENABLED is not a side effect. No apply-all.",
    inputSchema: S.gadsApplyRecommendation,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsApplyRecommendation(ctx, args),
  },
  {
    name: "gads_apply_recommendations",
    group: "gads-write",
    family: "gads",
    title: "Google Ads apply recommendations (Consent C)",
    description:
      "Paid mutate. Apply an explicit recommendation RN list (not apply-all). Live confirm_phrase must include customer_id and each RN. ENABLED is not a side effect. Prefer dry_run.",
    inputSchema: S.gadsApplyRecommendations,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsApplyRecommendations(ctx, args),
  },
  {
    name: "gads_link_merchant_center",
    group: "gads-write",
    family: "gads",
    title: "Google Ads link Merchant Center (Consent C)",
    description:
      "Paid mutate. ProductLink create for merchant_center_id (not MCC link; not Content API). Prefer dry_run; live confirm_phrase with customer_id.",
    inputSchema: S.gadsLinkMerchantCenter,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsLinkMerchantCenter(ctx, args),
  },
  {
    name: "gads_unlink_merchant_center",
    group: "gads-write",
    family: "gads",
    title: "Google Ads unlink Merchant Center (Consent C)",
    description:
      "Paid mutate. ProductLink remove by product_link_resource_name or product_link_id. Prefer dry_run; live confirm_phrase with customer_id.",
    inputSchema: S.gadsUnlinkMerchantCenter,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsUnlinkMerchantCenter(ctx, args),
  },
  {
    name: "gads_create_experiment",
    group: "gads-write",
    family: "gads",
    title: "Google Ads create experiment (Consent C)",
    description:
      "Paid mutate. Create an experiment in SETUP (not live) with control arm on an existing campaign and in-design treatment. Prefer dry_run; live confirm_phrase with customer_id.",
    inputSchema: S.gadsCreateExperiment,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => gadsCreateExperiment(ctx, args),
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
      "Local support intake: plugin version, host, plugin/Worker flag matrix (booleans), gateway configured/reachable, license feature names, consent-store presence. Optional last_tool / error_code / resource_id. Never tokens or JWT. No Google call.",
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
  {
    name: "conversion_fabric_status",
    group: "conversion-fabric",
    family: "license",
    title: "Conversion fabric status",
    description:
      "Wave 20. Local + optional GET /v1/health: sink/flag health for Ads Data Manager IngestEvents, Meta CAPI, TikTok Events, and sGTM apply ingest. Never keys, JWT, or user_data. Polar sgtm is reserved default-off (not minted). Ads upload stays on stamp FundedUploadSink.",
    inputSchema: S.conversionFabricStatus,
    annotations: ANN_RO,
    handler: async (ctx) => conversionFabricStatus(ctx),
  },
  {
    name: "sgtm_ingest_test",
    group: "conversion-fabric",
    family: "license",
    title: "sGTM apply ingest test",
    description:
      "Wave 20. Thin HTTP POST {gateway}/v1/sgtm/ingest on the apply path only (X-DGTL-Apply-Key). Closed event_name=apply. dry_run default true; live needs confirm:true. Plugin flag default off. Never funded ingest keys, never web GTM variables, never user_data. Not a hop-catalog MCP hop.",
    inputSchema: S.sgtmIngestTest,
    annotations: ANN_WRITE,
    handler: (ctx, args) => sgtmIngestTest(ctx, args),
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
      "Paid. Pro $19/mo. Local insights catalog (levels, date_presets, breakdowns, fields). Call before meta_insights — do not invent Graph fields. Zero Graph/gateway HTTP. LICENSE_REQUIRED without a license.",
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
      "Paid mutate. Create a Meta ad set on an existing campaign. daily_budget XOR lifetime_budget in integer cents (not micros). Named targeting packs (countries required; age/genders/locales/interests/behaviors/custom audiences/placements) — server builds targeting JSON; never send a targeting bag. Optional pixel_id/catalog_id → promoted_object. Spend-cap $100k. Defaults PAUSED. dry_run default; live needs confirm_phrase containing act_{ad_account_id} AND campaign_id. ads_management required when detectable.",
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
  {
    name: "meta_list_pixels",
    group: "meta",
    family: "meta",
    title: "Meta list pixels",
    description:
      "Paid. Pro $19/mo. List Ads pixels for an ad_account_id (id, name, last_fired_time). Cite returned pixel_id; do not invent. ads_read. LICENSE_REQUIRED without a license.",
    inputSchema: S.metaAccountOptionalLimit,
    annotations: ANN_RO,
    handler: (ctx, args) => metaListPixels(ctx, args),
  },
  {
    name: "meta_get_pixel",
    group: "meta",
    family: "meta",
    title: "Meta get pixel",
    description:
      "Paid. Pro $19/mo. Pixel metadata. CAPI event upload is meta_send_capi_events (separate META_CAPI_ENABLED dual-gate). Cite pixel_id from meta_list_pixels.",
    inputSchema: S.metaPixel,
    annotations: ANN_RO,
    handler: (ctx, args) => metaGetPixel(ctx, args),
  },
  {
    name: "meta_list_catalogs",
    group: "meta",
    family: "meta",
    title: "Meta list catalogs",
    description:
      "Paid. Pro $19/mo. List owned product catalogs for an ad_account_id. Writes use meta_create_catalog / meta_catalog_items_batch. LICENSE_REQUIRED without a license.",
    inputSchema: S.metaAccountOptionalLimit,
    annotations: ANN_RO,
    handler: (ctx, args) => metaListCatalogs(ctx, args),
  },
  {
    name: "meta_list_catalog_products",
    group: "meta",
    family: "meta",
    title: "Meta list catalog products",
    description:
      "Paid. Pro $19/mo. List products in a catalog_id from meta_list_catalogs. Read only. LICENSE_REQUIRED without a license.",
    inputSchema: S.metaCatalog,
    annotations: ANN_RO,
    handler: (ctx, args) => metaListCatalogProducts(ctx, args),
  },
  {
    name: "meta_list_custom_audiences",
    group: "meta",
    family: "meta",
    title: "Meta list custom audiences",
    description:
      "Paid. Pro $19/mo. List custom audiences for an ad_account_id. Use returned ids with meta_attach_audience / lookalike origin. LICENSE_REQUIRED without a license.",
    inputSchema: S.metaAccountOptionalLimit,
    annotations: ANN_RO,
    handler: (ctx, args) => metaListCustomAudiences(ctx, args),
  },
  {
    name: "meta_update_adset_targeting",
    group: "meta-write",
    family: "meta",
    title: "Meta update ad set targeting",
    description:
      "Paid mutate. Replace ad set targeting from named packs (countries required; age/genders/locales/interests/behaviors/custom audiences/placements). Server builds targeting JSON — do not send a targeting bag. Optional pixel_id/catalog_id promoted_object. dry_run default; live needs confirm_phrase containing act_{ad_account_id} AND adset_id. ads_management when detectable.",
    inputSchema: S.metaUpdateAdsetTargeting,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => metaUpdateAdsetTargeting(ctx, args),
  },
  {
    name: "meta_create_custom_audience",
    group: "meta-write",
    family: "meta",
    title: "Meta create custom audience",
    description:
      "Paid mutate. Website custom audience from pixel_id (retention_days, optional url_contains). No hashed PII / Customer Match. dry_run default; live needs confirm_phrase containing act_{ad_account_id} AND pixel_id. ads_management when detectable.",
    inputSchema: S.metaCreateCustomAudience,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => metaCreateCustomAudience(ctx, args),
  },
  {
    name: "meta_create_lookalike_audience",
    group: "meta-write",
    family: "meta",
    title: "Meta create lookalike audience",
    description:
      "Paid mutate. Lookalike from origin_audience_id + country (ISO-2) + optional lookalike_ratio 0.01–0.20. Server-built lookalike_spec. dry_run default; live needs confirm_phrase containing act_{ad_account_id} AND origin_audience_id. ads_management when detectable.",
    inputSchema: S.metaCreateLookalikeAudience,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => metaCreateLookalikeAudience(ctx, args),
  },
  {
    name: "meta_attach_audience",
    group: "meta-write",
    family: "meta",
    title: "Meta attach audience",
    description:
      "Paid mutate. Attach custom_audience_ids to an ad set. Replaces targeting — countries required plus named packs. dry_run default; live needs confirm_phrase containing act_{ad_account_id} AND adset_id. ads_management when detectable.",
    inputSchema: S.metaAttachAudience,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => metaAttachAudience(ctx, args),
  },
  {
    name: "meta_catalog_items_batch",
    group: "meta-write",
    family: "meta",
    title: "Meta catalog items batch",
    description:
      "Paid mutate. Marketing API catalog items_batch upsert (CREATE/UPDATE/DELETE). dry_run default; live needs confirm_phrase containing act_{ad_account_id} AND catalog_id. HTTPS image_link/link only. ads_management or catalog_management when detectable. Polar Pro meta bit. Opt out with DGTL_META_MUTATE_ENABLED=false.",
    inputSchema: S.metaCatalogItemsBatch,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => metaCatalogItemsBatch(ctx, args),
  },
  {
    name: "meta_get_batch_status",
    group: "meta",
    family: "meta",
    title: "Meta get catalog batch status",
    description:
      "Paid. Pro $19/mo. Read catalog check_batch_request_status for a handle from meta_catalog_items_batch. ads_read. LICENSE_REQUIRED without a license.",
    inputSchema: S.metaGetBatchStatus,
    annotations: ANN_RO,
    handler: (ctx, args) => metaGetBatchStatus(ctx, args),
  },
  {
    name: "meta_create_catalog",
    group: "meta-write",
    family: "meta",
    title: "Meta create catalog",
    description:
      "Paid mutate. Create an owned product catalog on act_{ad_account_id}. dry_run default; live needs confirm_phrase containing act_{ad_account_id}. Closed vertical enum. ads_management or catalog_management when detectable. Polar Pro meta bit.",
    inputSchema: S.metaCreateCatalog,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => metaCreateCatalog(ctx, args),
  },
  {
    name: "meta_send_capi_events",
    group: "meta-capi",
    family: "meta",
    title: "Meta send CAPI events",
    description:
      "Paid CAPI. Closed event_name enum; hashed user_data (SHA-256); required event_id. dry_run default; live needs confirm_phrase containing act_{ad_account_id} AND pixel_id. Dual-gate: plugin DGTL_META_CAPI_ENABLED (default on) AND Worker META_CAPI_ENABLED (fail-closed, not META_MUTATE_ENABLED). Polar Pro meta bit. App secret stays on Worker. Never unhashed PII in logs.",
    inputSchema: S.metaSendCapiEvents,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => metaSendCapiEvents(ctx, args),
  },
  {
    name: "mc_list_accounts",
    group: "mc",
    family: "mc",
    title: "Merchant Center list accounts",
    description:
      "Paid. Pro (Polar ads). Direct Merchant API — not Ads product_link, not stamp. Consent MC (scope content) only; never Consent A. List merchant_id values. LICENSE_REQUIRED / MC_NOT_CONNECTED fail closed.",
    inputSchema: S.mcListAccounts,
    annotations: ANN_RO,
    handler: (ctx, args) => mcListAccounts(ctx, args),
  },
  {
    name: "mc_list_products",
    group: "mc",
    family: "mc",
    title: "Merchant Center list products",
    description:
      "Paid. Direct Merchant API products.list (processed Product). Requires merchant_id (from mc_list_accounts or gads_list_merchant_center_links). Never guess. Reads stay GET-only.",
    inputSchema: S.mcListProducts,
    annotations: ANN_RO,
    handler: (ctx, args) => mcListProducts(ctx, args),
  },
  {
    name: "mc_get_product",
    group: "mc",
    family: "mc",
    title: "Merchant Center get product",
    description:
      "Paid. Direct Merchant API products.get including nested productStatus. Requires merchant_id + product_id (contentLanguage~feedLabel~offerId).",
    inputSchema: S.mcGetProduct,
    annotations: ANN_RO,
    handler: (ctx, args) => mcGetProduct(ctx, args),
  },
  {
    name: "mc_list_product_statuses",
    group: "mc",
    family: "mc",
    title: "Merchant Center list product statuses",
    description:
      "Paid. Product readiness for Shopping ads: destinationStatuses + itemLevelIssues. shopping_ads_ready when SHOPPING_ADS has approvedCountries. Same Merchant API products.list; not Ads GAQL.",
    inputSchema: S.mcListProductStatuses,
    annotations: ANN_RO,
    handler: (ctx, args) => mcListProductStatuses(ctx, args),
  },
  {
    name: "mc_list_account_issues",
    group: "mc",
    family: "mc",
    title: "Merchant Center list account issues",
    description:
      "Paid. Account-level diagnostics (website, feeds, suspensions). Feed issues that block Shopping ads even when products look ready. GET-only.",
    inputSchema: S.mcListAccountIssues,
    annotations: ANN_RO,
    handler: (ctx, args) => mcListAccountIssues(ctx, args),
  },
  {
    name: "mc_list_data_sources",
    group: "mc",
    family: "mc",
    title: "Merchant Center list data sources",
    description:
      "Paid. Merchant API data sources (feeds). Pair with mc_list_account_issues. Reads stay GET-only. Create/fetch are named write tools.",
    inputSchema: S.mcListDataSources,
    annotations: ANN_RO,
    handler: (ctx, args) => mcListDataSources(ctx, args),
  },
  {
    name: "mc_create_data_source",
    group: "mc-write",
    family: "mc",
    title: "Merchant Center create API data source",
    description:
      "Paid mutate. Create an API-type primary or supplemental product data source (no fileInput). Consent MC (content), not Consent A. Polar ads (no mc bit). dry_run default; live needs confirm_phrase containing merchant_id plus DGTL_WRITES_ENABLED. Never guess merchant_id.",
    inputSchema: S.mcCreateDataSource,
    annotations: ANN_WRITE,
    handler: (ctx, args) => mcCreateDataSource(ctx, args),
  },
  {
    name: "mc_upsert_product_input",
    group: "mc-write",
    family: "mc",
    title: "Merchant Center upsert ProductInput",
    description:
      "Paid mutate. Merchant API productInputs insert (default) or patch when update_mask is set. Requires merchant_id + data_source (API data source). Writes ProductInput, not processed Product. Consent MC. Polar ads. dry_run default; live confirm_phrase must include merchant_id.",
    inputSchema: S.mcUpsertProductInput,
    annotations: ANN_WRITE,
    handler: (ctx, args) => mcUpsertProductInput(ctx, args),
  },
  {
    name: "mc_delete_product_input",
    group: "mc-write",
    family: "mc",
    title: "Merchant Center delete ProductInput",
    description:
      "Paid mutate. Delete a ProductInput (contentLanguage~feedLabel~offerId) from an API data_source. Not processed Product. Consent MC. Polar ads. dry_run default; live confirm_phrase must include merchant_id.",
    inputSchema: S.mcDeleteProductInput,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => mcDeleteProductInput(ctx, args),
  },
  {
    name: "mc_fetch_data_source",
    group: "mc-write",
    family: "mc",
    title: "Merchant Center fetch file data source",
    description:
      "Paid mutate. Immediate fetch on a FILE data source (not API ProductInput insert). Consent MC. Polar ads. dry_run default; live confirm_phrase must include merchant_id.",
    inputSchema: S.mcFetchDataSource,
    annotations: ANN_WRITE,
    handler: (ctx, args) => mcFetchDataSource(ctx, args),
  },
  {
    name: "shopify_get_shop",
    group: "shopify",
    family: "shopify",
    title: "Shopify get shop",
    description: `${RO} Confirm merchant shop domain + name via Admin GraphQL (API 2026-04). Local SHOPIFY_STORE + SHOPIFY_ACCESS_TOKEN or PLUGIN_DATA/shopify-oauth.json. Fail closed SHOPIFY_NOT_CONNECTED. Free local — no Polar / stamp.`,
    inputSchema: S.shopifyGetShop,
    annotations: ANN_RO,
    handler: (ctx) => shopifyGetShop(ctx),
  },
  {
    name: "shopify_list_products",
    group: "shopify",
    family: "shopify",
    title: "Shopify list products",
    description: `${RO} Paginated products (title, handle, status, id). Merchant token with read_products. SHOPIFY_NOT_CONNECTED without credentials. No Polar.`,
    inputSchema: S.shopifyListProducts,
    annotations: ANN_RO,
    handler: (ctx, args) => shopifyListProducts(ctx, args),
  },
  {
    name: "shopify_get_product",
    group: "shopify",
    family: "shopify",
    title: "Shopify get product",
    description: `${RO} One product by id (gid or numeric). Requires product_id. read_products. No writes.`,
    inputSchema: S.shopifyGetProduct,
    annotations: ANN_RO,
    handler: (ctx, args) => shopifyGetProduct(ctx, args),
  },
  {
    name: "shopify_list_orders",
    group: "shopify",
    family: "shopify",
    title: "Shopify list orders",
    description: `${RO} Paginated orders with closed status/financial/fulfillment/date filters. read_orders. No customers dump. No Polar.`,
    inputSchema: S.shopifyListOrders,
    annotations: ANN_RO,
    handler: (ctx, args) => shopifyListOrders(ctx, args),
  },
  {
    name: "shopify_get_order",
    group: "shopify",
    family: "shopify",
    title: "Shopify get order",
    description: `${RO} One order by id (gid or numeric) with line items. Requires order_id. read_orders. No writes.`,
    inputSchema: S.shopifyGetOrder,
    annotations: ANN_RO,
    handler: (ctx, args) => shopifyGetOrder(ctx, args),
  },
  {
    name: "shopify_list_locations",
    group: "shopify",
    family: "shopify",
    title: "Shopify list locations",
    description: `${RO} Paginated locations (id, name, active, fulfillsOnlineOrders). Merchant token with read_locations. SHOPIFY_NOT_CONNECTED without credentials. No Polar / stamp.`,
    inputSchema: S.shopifyListLocations,
    annotations: ANN_RO,
    handler: (ctx, args) => shopifyListLocations(ctx, args),
  },
  {
    name: "shopify_list_inventory_levels",
    group: "shopify",
    family: "shopify",
    title: "Shopify list inventory levels",
    description: `${RO} Inventory quantities at one location. Requires location_id. read_inventory. Copy inventoryItem id + sku for Ads/MC join or shopify_adjust_inventory. No Polar.`,
    inputSchema: S.shopifyListInventoryLevels,
    annotations: ANN_RO,
    handler: (ctx, args) => shopifyListInventoryLevels(ctx, args),
  },
  {
    name: "shopify_adjust_inventory",
    group: "shopify-write",
    family: "shopify_write",
    title: "Shopify adjust inventory",
    description:
      "Write. inventoryAdjustQuantities (delta) at one location. dry_run defaults true. Live needs confirm_phrase containing the shop domain (*.myshopify.com) plus write_inventory on the merchant app. Local — no Polar, no stamp vault.",
    inputSchema: S.shopifyAdjustInventory,
    annotations: ANN_WRITE,
    handler: (ctx, args) => shopifyAdjustInventory(ctx, args),
  },
  {
    name: "shopify_list_publications",
    group: "shopify",
    family: "shopify",
    title: "Shopify list publications",
    description: `${RO} Paginated publications (id, autoPublish, catalog id/title). Merchant token with read_publications (explicit expand; not default install). SHOPIFY_NOT_CONNECTED without credentials. No Polar / stamp. Admin API 2026-04.`,
    inputSchema: S.shopifyListPublications,
    annotations: ANN_RO,
    handler: (ctx, args) => shopifyListPublications(ctx, args),
  },
  {
    name: "shopify_list_catalogs",
    group: "shopify",
    family: "shopify",
    title: "Shopify list catalogs",
    description: `${RO} Paginated Shopify catalogs (id, title, status, priceList). Existing read_products. Optional catalog_type APP|COMPANY_LOCATION|MARKET|NONE. Not Meta catalog. No Polar.`,
    inputSchema: S.shopifyListCatalogs,
    annotations: ANN_RO,
    handler: (ctx, args) => shopifyListCatalogs(ctx, args),
  },
  {
    name: "shopify_list_product_feeds",
    group: "shopify",
    family: "shopify",
    title: "Shopify list product feeds",
    description: `${RO} Paginated Shopify product feeds (id, channelId, country, language, status). read_product_listings (explicit expand). Not Meta catalog/CAPI. No Polar.`,
    inputSchema: S.shopifyListProductFeeds,
    annotations: ANN_RO,
    handler: (ctx, args) => shopifyListProductFeeds(ctx, args),
  },
  {
    name: "shopify_product_set",
    group: "shopify-write",
    family: "shopify_write",
    title: "Shopify productSet",
    description:
      "Write. Allowlisted productSet GraphQL only (title/handle/status/variants). dry_run defaults true. Live needs confirm_phrase containing the shop domain plus write_products. List fields replace omitted variants/tags. No raw GraphQL. No customers. Local — no Polar, no stamp vault. Not Meta CAPI.",
    inputSchema: S.shopifyProductSet,
    annotations: ANN_WRITE,
    handler: (ctx, args) => shopifyProductSet(ctx, args),
  },
  {
    name: "tiktok_list_advertisers",
    group: "tiktok",
    family: "tiktok",
    title: "TikTok list advertisers",
    description:
      "Paid. Polar feature `tiktok` (not ads/meta). Use FIRST to discover advertiser_id values. Cite returned ids; do not invent. TikTok app secret is never in this plugin. LICENSE_REQUIRED without a tiktok license. Live app is a Noel gate — fixtures until then.",
    inputSchema: S.tiktokListAdvertisers,
    annotations: ANN_RO,
    handler: async (ctx, args) => tiktokDisabled(ctx, "tiktok_list_advertisers", args),
  },
  {
    name: "tiktok_list_campaigns",
    group: "tiktok",
    family: "tiktok",
    title: "TikTok list campaigns",
    description:
      "Paid. Polar `tiktok`. List campaigns for an advertiser_id from tiktok_list_advertisers. Empty ≠ auth failure. LICENSE_REQUIRED without a tiktok license.",
    inputSchema: S.tiktokListCampaigns,
    annotations: ANN_RO,
    handler: async (ctx, args) => tiktokDisabled(ctx, "tiktok_list_campaigns", args),
  },
  {
    name: "tiktok_insights",
    group: "tiktok",
    family: "tiktok",
    title: "TikTok insights",
    description:
      "Paid. Polar `tiktok`. BASIC integrated report: advertiser_id, date_start/date_stop (YYYY-MM-DD), optional level advertiser/campaign/adgroup/ad. Closed metrics (spend/impressions/clicks/ctr/cpc/conversion). Cite data.cited. LICENSE_REQUIRED without a tiktok license.",
    inputSchema: S.tiktokInsights,
    annotations: ANN_RO,
    handler: async (ctx, args) => tiktokDisabled(ctx, "tiktok_insights", args),
  },
  {
    name: "tiktok_update_campaign",
    group: "tiktok-write",
    family: "tiktok",
    title: "TikTok update campaign",
    description:
      "Paid mutate. Update TikTok campaign status (ENABLE/DISABLE; ACTIVE→ENABLE, PAUSED→DISABLE). Defaults on; opt out with DGTL_TIKTOK_MUTATE_ENABLED=false. Worker TIKTOK_MUTATE_ENABLED still required for live hop. Prefer dry_run; live needs confirm_phrase containing advertiser_id AND campaign_id after a user message this turn. Closed fields only — no budget/create/DELETE. App secret stays on the Worker.",
    inputSchema: S.tiktokUpdateCampaign,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => tiktokUpdateCampaign(ctx, args),
  },
  {
    name: "tiktok_list_catalogs",
    group: "tiktok",
    family: "tiktok",
    title: "TikTok list catalogs",
    description:
      "Paid. Polar `tiktok`. List product catalogs for advertiser_id (optional bc_id / catalog_id). Stamp hop. App secret stays on the Worker. LICENSE_REQUIRED without a tiktok license. Not Shopify catalogs. Never Axos.",
    inputSchema: S.tiktokListCatalogs,
    annotations: ANN_RO,
    handler: (ctx, args) => tiktokListCatalogs(ctx, args),
  },
  {
    name: "tiktok_create_catalog",
    group: "tiktok-write",
    family: "tiktok",
    title: "TikTok create catalog",
    description:
      "Paid mutate. Create a TikTok catalog (closed catalog_type, default ECOM). dry_run default; live needs confirm_phrase containing advertiser_id. Dual-gate TIKTOK_MUTATE_ENABLED. Catalog API often needs bc_id. App secret stays on the Worker.",
    inputSchema: S.tiktokCreateCatalog,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => tiktokCreateCatalog(ctx, args),
  },
  {
    name: "tiktok_upload_catalog_products",
    group: "tiktok-write",
    family: "tiktok",
    title: "TikTok upload catalog products",
    description:
      "Paid mutate. JSON catalog product upload. sku_id is the Events API content_id. HTTPS image_url / landing_page_url only. dry_run default; live needs confirm_phrase containing advertiser_id AND catalog_id. Dual-gate TIKTOK_MUTATE_ENABLED. App secret stays on the Worker.",
    inputSchema: S.tiktokUploadCatalogProducts,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => tiktokUploadCatalogProducts(ctx, args),
  },
  {
    name: "tiktok_bind_catalog_eventsource",
    group: "tiktok-write",
    family: "tiktok",
    title: "TikTok bind catalog event source",
    description:
      "Paid mutate. Bind pixel_code XOR app_id to a catalog. dry_run default; live needs confirm_phrase containing advertiser_id AND catalog_id. Dual-gate TIKTOK_MUTATE_ENABLED. App secret stays on the Worker.",
    inputSchema: S.tiktokBindCatalogEventsource,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => tiktokBindCatalogEventsource(ctx, args),
  },
  {
    name: "tiktok_list_pixels",
    group: "tiktok",
    family: "tiktok",
    title: "TikTok list pixels",
    description:
      "Paid. Polar `tiktok`. List pixels for advertiser_id. Copy pixel_code for tiktok_track_events (Events API event_source_id). Stamp hop. LICENSE_REQUIRED without a tiktok license.",
    inputSchema: S.tiktokListPixels,
    annotations: ANN_RO,
    handler: (ctx, args) => tiktokListPixels(ctx, args),
  },
  {
    name: "tiktok_track_events",
    group: "tiktok-events",
    family: "tiktok",
    title: "TikTok track events",
    description:
      "Paid Events API. Closed event_name; hashed email/phone; required event_id. content_id must match catalog sku_id. dry_run default; live needs confirm_phrase containing advertiser_id AND pixel_code. Dual-gate: plugin DGTL_TIKTOK_EVENTS_ENABLED (default on) AND Worker TIKTOK_EVENTS_ENABLED (fail-closed, not TIKTOK_MUTATE_ENABLED). Polar tiktok bit. App secret stays on Worker. Never unhashed PII in logs.",
    inputSchema: S.tiktokTrackEvents,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => tiktokTrackEvents(ctx, args),
  },
  {
    name: "tiktok_create_campaign",
    group: "tiktok-write",
    family: "tiktok",
    title: "TikTok create campaign",
    description:
      "Paid mutate. Create a TikTok campaign. Defaults DISABLE (PAUSED maps to DISABLE). Closed objective_type. dry_run default; live needs confirm_phrase containing advertiser_id. Dual-gate TIKTOK_MUTATE_ENABLED. Spend cap $100,000. App secret stays on the Worker. Never Axos.",
    inputSchema: S.tiktokCreateCampaign,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => tiktokCreateCampaign(ctx, args),
  },
  {
    name: "tiktok_update_campaign_budget",
    group: "tiktok-write",
    family: "tiktok",
    title: "TikTok update campaign budget",
    description:
      "Paid mutate. Update TikTok campaign budget (BUDGET_MODE_DAY or BUDGET_MODE_TOTAL). dry_run default; live needs confirm_phrase containing advertiser_id AND campaign_id after a user message this turn. Dual-gate TIKTOK_MUTATE_ENABLED. Spend cap $100,000. Status stays on tiktok_update_campaign. App secret stays on the Worker. One platform per confirm.",
    inputSchema: S.tiktokUpdateCampaignBudget,
    annotations: ANN_DESTRUCTIVE,
    handler: (ctx, args) => tiktokUpdateCampaignBudget(ctx, args),
  },
  {
    name: "klaviyo_get_account",
    group: "klaviyo",
    family: "klaviyo",
    title: "Klaviyo get account",
    description: `${RO} Confirm the Klaviyo account for a local pk_ key (revision 2026-07-15). KLAVIYO_API_KEY or PLUGIN_DATA/klaviyo.json. Fail closed KLAVIYO_NOT_CONNECTED. Local-free — no Polar / stamp / Consent A.`,
    inputSchema: S.klaviyoGetAccount,
    annotations: ANN_RO,
    handler: (ctx) => klaviyoGetAccount(ctx),
  },
  {
    name: "klaviyo_list_profiles",
    group: "klaviyo",
    family: "klaviyo",
    title: "Klaviyo list profiles",
    description: `${RO} Sparse profiles (email, created, updated, external_id). Never dumps phone/location/properties. Optional email filter + first_name/last_name extra_fields. Local pk_. No Polar.`,
    inputSchema: S.klaviyoListProfiles,
    annotations: ANN_RO,
    handler: (ctx, args) => klaviyoListProfiles(ctx, args),
  },
  {
    name: "klaviyo_get_profile",
    group: "klaviyo",
    family: "klaviyo",
    title: "Klaviyo get profile",
    description: `${RO} One profile by id with the same sparse fieldset. Requires profile_id. Not a PII dump.`,
    inputSchema: S.klaviyoGetProfile,
    annotations: ANN_RO,
    handler: (ctx, args) => klaviyoGetProfile(ctx, args),
  },
  {
    name: "klaviyo_list_lists",
    group: "klaviyo",
    family: "klaviyo",
    title: "Klaviyo list lists",
    description: `${RO} Paginated Klaviyo lists. Local pk_. No CSV import mega-tool.`,
    inputSchema: S.klaviyoListLists,
    annotations: ANN_RO,
    handler: (ctx, args) => klaviyoListLists(ctx, args),
  },
  {
    name: "klaviyo_list_segments",
    group: "klaviyo",
    family: "klaviyo",
    title: "Klaviyo list segments",
    description: `${RO} Paginated Klaviyo segments. Local pk_. Revision 2026-07-15.`,
    inputSchema: S.klaviyoListSegments,
    annotations: ANN_RO,
    handler: (ctx, args) => klaviyoListSegments(ctx, args),
  },
  {
    name: "klaviyo_list_flows",
    group: "klaviyo",
    family: "klaviyo",
    title: "Klaviyo list flows",
    description: `${RO} Paginated flows. Local pk_. Enable/disable is not registered.`,
    inputSchema: S.klaviyoListFlows,
    annotations: ANN_RO,
    handler: (ctx, args) => klaviyoListFlows(ctx, args),
  },
  {
    name: "klaviyo_get_flow",
    group: "klaviyo",
    family: "klaviyo",
    title: "Klaviyo get flow",
    description: `${RO} One flow by id. Requires flow_id.`,
    inputSchema: S.klaviyoGetFlow,
    annotations: ANN_RO,
    handler: (ctx, args) => klaviyoGetFlow(ctx, args),
  },
  {
    name: "klaviyo_list_campaigns",
    group: "klaviyo",
    family: "klaviyo",
    title: "Klaviyo list campaigns",
    description: `${RO} Paginated campaigns. Required channel filter (default email). Local pk_. No send job.`,
    inputSchema: S.klaviyoListCampaigns,
    annotations: ANN_RO,
    handler: (ctx, args) => klaviyoListCampaigns(ctx, args),
  },
  {
    name: "klaviyo_list_metrics",
    group: "klaviyo",
    family: "klaviyo",
    title: "Klaviyo list metrics",
    description: `${RO} Paginated metrics catalog. Not an open Metric Aggregates passthrough.`,
    inputSchema: S.klaviyoListMetrics,
    annotations: ANN_RO,
    handler: (ctx, args) => klaviyoListMetrics(ctx, args),
  },
  {
    name: "klaviyo_create_campaign",
    group: "klaviyo-write",
    family: "klaviyo_write",
    title: "Klaviyo create campaign",
    description:
      "Write. Draft email campaign only (POST /api/campaigns). dry_run default true. Live needs confirm_phrase containing the account id. Never posts campaign-send-jobs — use klaviyo_create_campaign_send_job with SEND. Local pk_ — no Polar.",
    inputSchema: S.klaviyoCreateCampaign,
    annotations: ANN_WRITE,
    handler: (ctx, args) => klaviyoCreateCampaign(ctx, args),
  },
  {
    name: "klaviyo_create_campaign_send_job",
    group: "klaviyo-write",
    family: "klaviyo_write",
    title: "Klaviyo create campaign send job",
    description:
      "Write. POST /api/campaign-send-jobs for an existing draft campaign_id. dry_run default true. Live needs confirm_phrase containing the account id, campaign id, and SEND. Cannot fire from klaviyo_create_campaign. Local pk_ — no Polar.",
    inputSchema: S.klaviyoCreateCampaignSendJob,
    annotations: ANN_WRITE,
    handler: (ctx, args) => klaviyoCreateCampaignSendJob(ctx, args),
  },
  {
    name: "klaviyo_upsert_profile",
    group: "klaviyo-write",
    family: "klaviyo_write",
    title: "Klaviyo upsert profile",
    description:
      "Write. POST /api/profile-import (email / external_id / profile_id). Closed fields only — no properties bag. dry_run default true. Live needs account-id confirm. Local pk_.",
    inputSchema: S.klaviyoUpsertProfile,
    annotations: ANN_WRITE,
    handler: (ctx, args) => klaviyoUpsertProfile(ctx, args),
  },
  {
    name: "klaviyo_create_event",
    group: "klaviyo-write",
    family: "klaviyo_write",
    title: "Klaviyo create event",
    description:
      "Write. POST /api/events backfill (backfill defaults true so flows do not re-fire). Closed properties. dry_run default true. Live needs account-id confirm. Local pk_.",
    inputSchema: S.klaviyoCreateEvent,
    annotations: ANN_WRITE,
    handler: (ctx, args) => klaviyoCreateEvent(ctx, args),
  },
  {
    name: "klaviyo_list_catalog_items",
    group: "klaviyo",
    family: "klaviyo",
    title: "Klaviyo list catalog items",
    description: `${RO} Paginated custom catalog items (revision 2026-07-15). Local pk_. Not Shopify $shopify::: ids. No Polar / stamp / Consent A.`,
    inputSchema: S.klaviyoListCatalogItems,
    annotations: ANN_RO,
    handler: (ctx, args) => klaviyoListCatalogItems(ctx, args),
  },
  {
    name: "klaviyo_list_catalog_categories",
    group: "klaviyo",
    family: "klaviyo",
    title: "Klaviyo list catalog categories",
    description: `${RO} Paginated catalog categories. Local pk_. catalogs:read.`,
    inputSchema: S.klaviyoListCatalogCategories,
    annotations: ANN_RO,
    handler: (ctx, args) => klaviyoListCatalogCategories(ctx, args),
  },
  {
    name: "klaviyo_list_catalog_variants",
    group: "klaviyo",
    family: "klaviyo",
    title: "Klaviyo list catalog variants",
    description: `${RO} Paginated catalog variants. Local pk_. catalogs:read.`,
    inputSchema: S.klaviyoListCatalogVariants,
    annotations: ANN_RO,
    handler: (ctx, args) => klaviyoListCatalogVariants(ctx, args),
  },
  {
    name: "klaviyo_upsert_catalog_items",
    group: "klaviyo-write",
    family: "klaviyo_write",
    title: "Klaviyo upsert catalog items",
    description:
      "Write. Closed bulk create/update jobs (POST /api/catalog-item-bulk-create-jobs or bulk-update-jobs). $custom / $default only — never invent $shopify::: ids. dry_run default true. Live needs account-id confirm. Local pk_. Not a mega upsert-all across MC/Meta/TikTok.",
    inputSchema: S.klaviyoUpsertCatalogItems,
    annotations: ANN_WRITE,
    handler: (ctx, args) => klaviyoUpsertCatalogItems(ctx, args),
  },
  {
    name: "klaviyo_list_reviews",
    group: "klaviyo",
    family: "klaviyo",
    title: "Klaviyo list reviews",
    description: `${RO} Paginated reviews. Sparse fields — email / author stripped. Optional status filter. Local pk_. reviews:read.`,
    inputSchema: S.klaviyoListReviews,
    annotations: ANN_RO,
    handler: (ctx, args) => klaviyoListReviews(ctx, args),
  },
  {
    name: "klaviyo_get_review",
    group: "klaviyo",
    family: "klaviyo",
    title: "Klaviyo get review",
    description: `${RO} One review by review_id. Same sparse fieldset. Local pk_.`,
    inputSchema: S.klaviyoGetReview,
    annotations: ANN_RO,
    handler: (ctx, args) => klaviyoGetReview(ctx, args),
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/**
 * Consent A readonly kernel (identity + GA4 + GSC + GTM list/get).
 * Wave 13 added gtm_list_clients + gtm_list_environments (honest count 26).
 * Do not add Shopify, GBP, Klaviyo, Consent W writes, Consent G/S writes, Ads, Meta, MC, or diagnostics.
 */
export const CONSENT_A_TOOLS = TOOLS.filter(
  (t) => t.family === "identity" || t.family === "ga4" || t.family === "gsc" || t.family === "gtm",
).map((t) => t.name);

/** Honest Consent A kernel size (contract / catalog / plugin.json). */
export const CONSENT_A_KERNEL_COUNT = 26;

/** Consent G Admin tools (reads that stay on A HTTP still use this family so they stay out of the kernel). */
export const GA4_WRITE_TOOL_NAMES = TOOLS.filter((t) => t.family === "ga4_write").map((t) => t.name);

/** Consent S sitemap submit/delete — never in the Consent A kernel. */
export const GSC_WRITE_TOOL_NAMES = TOOLS.filter((t) => t.family === "gsc_write").map((t) => t.name);

/** Consent MC ProductInput / API data-source writes — Polar ads, never Consent A. */
export const MC_WRITE_TOOL_NAMES = TOOLS.filter((t) => t.group === "mc-write").map((t) => t.name);

/**
 * Alias of CONSENT_A_TOOLS (W0.4). Not the commercial free set.
 * Shopify + Klaviyo are LOCAL_FREE_TOOLS; Ads/Meta/MC/TikTok are LICENSE_GATED_TOOLS.
 */
export const FREE_TOOL_NAMES = CONSENT_A_TOOLS;

/** Local-free, not Polar: Shopify merchant token; Klaviyo pk_; GBP. */
export const LOCAL_FREE_TOOLS = TOOLS.filter(
  (t) =>
    t.family === "shopify" ||
    t.family === "shopify_write" ||
    t.family === "gbp" ||
    t.family === "klaviyo" ||
    t.family === "klaviyo_write",
).map((t) => t.name);

export const KLAVIYO_TOOL_NAMES = TOOLS.filter(
  (t) => t.family === "klaviyo" || t.family === "klaviyo_write",
).map((t) => t.name);

export const KLAVIYO_WRITE_TOOL_NAMES = TOOLS.filter((t) => t.family === "klaviyo_write").map((t) => t.name);

/** Polar Pro surface: Google Ads + Meta Ads + Merchant Center + TikTok (including plugin-local describe tools). */
export const LICENSE_GATED_TOOLS = TOOLS.filter(
  (t) => t.family === "gads" || t.family === "meta" || t.family === "mc" || t.family === "tiktok",
).map((t) => t.name);

/**
 * Plugin-local describe/recipe tools: zero Ads/Graph HTTP.
 * W0.2 A18 — must not be required in stamp GADS_TOOLS / META_TOOLS.
 */
export const PLUGIN_LOCAL_DESCRIBE_TOOLS = [
  "gads_describe_recipes",
  "meta_describe_insights_schema",
] as const;

/**
 * Registry hop annotation (Wave 9). family+group are the source.
 * plugin_local describe tools are not stamp hops.
 */
export function stampHopAnnotation(t: Pick<ToolSpec, "name" | "family" | "group">): StampHopAnnotation | null {
  if ((PLUGIN_LOCAL_DESCRIBE_TOOLS as readonly string[]).includes(t.name)) {
    return {
      family: t.name.startsWith("gads_") ? "gads" : "meta",
      kind: "plugin_local",
    };
  }
  if (t.family === "gads") return { family: "gads", kind: t.group === "gads-write" ? "mutate" : "read_hop" };
  if (t.family === "meta") {
    return {
      family: "meta",
      kind: t.group === "meta-write" || t.group === "meta-capi" ? "mutate" : "read_hop",
    };
  }
  if (t.family === "tiktok") {
    return {
      family: "tiktok",
      kind: t.group === "tiktok-write" || t.group === "tiktok-events" ? "mutate" : "read_hop",
    };
  }
  return null;
}

for (const t of TOOLS) {
  const hop = stampHopAnnotation(t);
  if (hop) t.stampHop = hop;
}

/** Registry mutate surface (stamp hop). Keep ⊆ stamp GADS_MUTATE_TOOLS. */
export const GADS_MUTATE_TOOL_NAMES = TOOLS.filter((t) => t.group === "gads-write").map((t) => t.name);

/** Registry mutate surface (stamp hop). Keep ⊆ stamp META_MUTATE_TOOLS. */
export const META_MUTATE_TOOL_NAMES = TOOLS.filter(
  (t) => t.group === "meta-write" || t.group === "meta-capi",
).map((t) => t.name);

/** CAPI-only mutate surface. Dual-gates META_CAPI_ENABLED, not META_MUTATE_ENABLED. */
export const META_CAPI_TOOL_NAMES = TOOLS.filter((t) => t.group === "meta-capi").map((t) => t.name);

/** Registry mutate surface (stamp hop). Keep ⊆ stamp TIKTOK_MUTATE_TOOLS. */
export const TIKTOK_MUTATE_TOOL_NAMES = TOOLS.filter(
  (t) => t.group === "tiktok-write" || t.group === "tiktok-events",
).map((t) => t.name);

/** Events API-only mutate surface. Dual-gates TIKTOK_EVENTS_ENABLED, not TIKTOK_MUTATE_ENABLED. */
export const TIKTOK_EVENTS_TOOL_NAMES = TOOLS.filter((t) => t.group === "tiktok-events").map((t) => t.name);
