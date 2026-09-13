import { z } from "zod";
import { GTM_CLIENT_TYPES, GTM_USAGE_CONTEXTS } from "../google/gtm-types.js";

const pageSize = z.number().int().min(1).max(200).optional();
const pageToken = z.string().optional();
const str = z.string().optional();

export const emptyInput = z.object({}).strict();

/** Support intake — optional last-failure fields. Never tokens. */
export const supportPacket = z
  .object({
    last_tool: z.string().max(80).optional(),
    error_code: z.string().max(64).optional(),
    resource_id: z.string().max(256).optional(),
  })
  .strict();

export const feedbackPrepare = z
  .object({
    message: z.string().min(1),
    reply_to: z.string().min(3).max(254),
    kind: z.enum(["bug", "feature", "other"]).optional(),
    last_tool: z.string().max(80).optional(),
    error_code: z.string().max(64).optional(),
    resource_id: z.string().max(256).optional(),
  })
  .strict();

export const feedbackSend = z
  .object({
    /** Exact true after the user approves the draft. Missing/false refuses send. */
    confirm: z.literal(true),
    draft_id: z.string().min(1).max(64).optional(),
    message: z.string().min(1).optional(),
    reply_to: z.string().min(3).max(254).optional(),
    kind: z.enum(["bug", "feature", "other"]).optional(),
    last_tool: z.string().max(80).optional(),
    error_code: z.string().max(64).optional(),
    resource_id: z.string().max(256).optional(),
  })
  .strict();

export const pageInput = z.object({ page_size: pageSize, page_token: pageToken }).strict();

export const accountPage = z
  .object({ account_id: str, page_size: pageSize, page_token: pageToken })
  .strict();

export const propertyId = z.object({ property_id: str }).strict();

/** Optional search over property metadata (anti-hallucination). */
export const ga4GetMetadata = z
  .object({
    property_id: str,
    /** Substring match on apiName / uiName / description (case-insensitive). */
    query: z.string().min(1).max(120).optional(),
    kind: z.enum(["dimension", "metric", "all"]).optional(),
    /** When true, only customDefinition=true rows. */
    custom_only: z.boolean().optional(),
  })
  .strict();

/** Local GSC dimension/metric catalog — no Google call. */
export const gscDescribeSchema = emptyInput;

export const propertyPage = z
  .object({ property_id: str, page_size: pageSize, page_token: pageToken })
  .strict();

const dateRange = z
  .object({ start_date: z.string(), end_date: z.string() })
  .strict();

export const ga4RunReport = z
  .object({
    property_id: str,
    date_ranges: z.array(dateRange).min(1).max(2).optional(),
    metrics: z.array(z.string().min(1)).min(1).max(10).optional(),
    /** Closed Ads-id MTA recipes. conversionSpec is v1alpha-only — see docs/ops/GA4-CONVERSIONSPEC-SPIKE.md */
    recipe: z
      .enum([
        "ads_mta_campaign_ids",
        "ads_mta_adgroup_ids",
        "ads_mta_creative_ids",
        "ads_mta_customer_ids",
        "ads_mta_ids",
        "ads_mta_keyword_ids",
      ])
      .optional(),
    /** Expand to keyEvents:{name} metrics (v1beta has no conversionSpec). */
    key_event_names: z.array(z.string().min(1)).max(10).optional(),
    dimensions: z.array(z.string().min(1)).max(9).optional(),
    dimension_filter: z.unknown().optional(),
    metric_filter: z.unknown().optional(),
    order_bys: z
      .array(
        z
          .object({
            field: z.string(),
            kind: z.enum(["dimension", "metric"]).optional(),
            desc: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    offset: z.number().int().min(0).optional(),
    keep_empty_rows: z.boolean().optional(),
    currency_code: z.string().min(3).max(3).optional(),
    allow_long_range: z.boolean().optional(),
  })
  .strict();

export const siteUrl = z.object({ site_url: str }).strict();

export const gscQuery = z
  .object({
    site_url: str,
    start_date: str,
    end_date: str,
    dimensions: z
      .array(z.enum(["query", "page", "country", "device", "searchAppearance", "date", "hour"]))
      .optional(),
    row_limit: z.number().int().min(1).max(1000).optional(),
    start_row: z.number().int().min(0).optional(),
    search_type: z.enum(["web", "image", "video", "news", "discover", "googleNews"]).optional(),
    data_state: z.enum(["final", "all"]).optional(),
    aggregation_type: z.string().optional(),
    dimension_filter_groups: z.array(z.unknown()).optional(),
  })
  .strict();

export const gscInspect = z
  .object({
    site_url: str,
    inspection_url: str,
    language_code: z.string().optional(),
  })
  .strict();

export const gscSitemaps = z
  .object({ site_url: str, sitemap_index: z.string().optional(), page_size: pageSize, page_token: pageToken })
  .strict();

export const gscSitemap = z.object({ site_url: str, feedpath: str }).strict();

/** Consent S sitemap submit/delete — dry_run defaults true; live needs confirm containing site_url. */
export const gscSubmitSitemap = z
  .object({
    site_url: str,
    feedpath: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
    confirm: z.string().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.dry_run === false) {
      const phrase = val.confirm_phrase ?? val.confirm;
      if (!phrase || !String(phrase).trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "confirm_phrase is required when dry_run is false",
          path: ["confirm_phrase"],
        });
      }
    }
  });

export const gscDeleteSitemap = gscSubmitSitemap;

export const gtmContainer = z
  .object({ account_id: str, container_id: str, page_size: pageSize, page_token: pageToken })
  .strict();

export const gtmWorkspaceList = z
  .object({
    account_id: str,
    container_id: str,
    workspace_id: str,
    page_size: pageSize,
    page_token: pageToken,
  })
  .strict();

export const gbpAccounts = z.object({ page_size: pageSize, page_token: pageToken }).strict();
export const gbpLocations = z
  .object({ account_name: str, page_size: pageSize, page_token: pageToken })
  .strict();
export const gbpGetLocation = z.object({ location_name: str }).strict();
export const gbpPerformance = z
  .object({
    location_name: str,
    start_date: str,
    end_date: str,
    daily_metric: z.string().optional(),
  })
  .strict();
export const gbpKeywords = z
  .object({ location_name: str, month: z.string().optional() })
  .strict();

export const gadsCustomer = z.object({ customer_id: str, login_customer_id: str }).strict();
export const gadsSearch = z
  .object({
    customer_id: str,
    login_customer_id: str,
    recipe: z
      .enum([
        "campaigns",
        "ad_groups",
        "keywords",
        "search_terms",
        "conversion_actions",
        "change_status",
        "policy_topics",
        "performance",
        "assets",
        "asset_groups",
        "audiences",
        "shared_sets",
        "bidding_strategies",
        "geo",
        "demographics",
        "shopping_performance",
        "recommendations",
        "change_event",
        "account_budget",
        "negatives",
        "experiments",
      ])
      .optional(),
    date_range: dateRange.optional(),
    where: z
      .object({
        status: z.string().optional(),
        campaign_id: z.string().optional(),
      })
      .strict()
      .optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

export const metaAccount = z.object({ ad_account_id: str }).strict();
export const metaDescribeInsightsSchema = emptyInput;
export const metaInsights = z
  .object({
    ad_account_id: str,
    level: z.enum(["account", "campaign", "adset", "ad"]).optional(),
    /** Campaign/adset/ad id when level is not account; omit for account rollup. */
    object_id: z.string().min(1).optional(),
    /** YYYY-MM-DD — use with date_stop, or pass date_preset instead. */
    date_start: z.string().min(1).optional(),
    date_stop: z.string().min(1).optional(),
    /** Marketing API date_preset (see meta_describe_insights_schema). */
    date_preset: z
      .enum([
        "today",
        "yesterday",
        "last_7d",
        "last_14d",
        "last_28d",
        "last_30d",
        "last_90d",
        "this_month",
        "last_month",
        "lifetime",
        "maximum",
      ])
      .optional(),
    /** age/gender/publisher_platform/… — validate via meta_describe_insights_schema. */
    breakdowns: z.array(z.string().min(1)).max(8).optional(),
    /** Closed insight field names — do not invent Graph fields. */
    fields: z.array(z.string().min(1)).max(40).optional(),
    /** 1 = daily; all_days = single total; or integer days. Gateway interprets. */
    time_increment: z.union([z.string(), z.number().int().positive()]).optional(),
  })
  .strict();
export const metaCreative = z.object({ creative_id: str }).strict();
export const metaPixel = z.object({ pixel_id: str }).strict();
export const metaCatalog = z
  .object({
    catalog_id: str,
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();
export const metaAccountOptionalLimit = z
  .object({
    ad_account_id: str,
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();
export const gadsDescribeRecipes = emptyInput;

/** Require confirm_phrase when dry_run is explicitly false. */
function requireConfirmWhenLive(val: { dry_run: boolean; confirm_phrase?: string }, ctx: z.RefinementCtx): void {
  if (val.dry_run === false && (!val.confirm_phrase || !String(val.confirm_phrase).trim())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "confirm_phrase is required when dry_run is false",
      path: ["confirm_phrase"],
    });
  }
}

/** Consent W GTM write tools — dry_run defaults true; live needs confirm_phrase. */
export const gtmCreateTag = z
  .object({
    account_id: str,
    container_id: str,
    workspace_id: str,
    name: str,
    type: str,
    /** Default true in code — live mutate only when explicitly false. */
    dry_run: z.boolean().default(true),
    /** Required when dry_run=false; must include resolved publicId (checked in handler). */
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gtmUpdateTag = z
  .object({
    account_id: str,
    container_id: str,
    workspace_id: str,
    tag_id: str,
    name: str,
    type: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

/** Closed GTM parameter (trigger/variable). Keys are type/key/value only. */
const gtmParameter = z
  .object({
    type: z.string().min(1),
    key: z.string().min(1).optional(),
    value: z.string().optional(),
  })
  .strict();

export const gtmCreateTrigger = z
  .object({
    account_id: str,
    container_id: str,
    workspace_id: str,
    name: str,
    type: str,
    parameter: z.array(gtmParameter).max(20).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gtmUpdateTrigger = z
  .object({
    account_id: str,
    container_id: str,
    workspace_id: str,
    trigger_id: str,
    name: str,
    type: str,
    parameter: z.array(gtmParameter).max(20).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gtmCreateVariable = z
  .object({
    account_id: str,
    container_id: str,
    workspace_id: str,
    name: str,
    type: str,
    parameter: z.array(gtmParameter).max(20).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gtmUpdateVariable = z
  .object({
    account_id: str,
    container_id: str,
    workspace_id: str,
    variable_id: str,
    name: str,
    type: str,
    parameter: z.array(gtmParameter).max(20).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gtmPublishContainer = z
  .object({
    account_id: str,
    container_id: str,
    workspace_id: str,
    /** Default true — no publish side effect unless explicitly false. */
    dry_run: z.boolean().default(true),
    /** When dry_run is false, must include the container publicId (GTM-XXXX). Do not invent. */
    confirm_phrase: z.string().optional(),
    version_name: str,
    version_notes: str,
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

const gtmClientType = z.enum(GTM_CLIENT_TYPES);
const gtmUsageContext = z.enum(GTM_USAGE_CONTEXTS);

export const gtmCreateClient = z
  .object({
    account_id: str,
    container_id: str,
    workspace_id: str,
    name: str,
    type: gtmClientType,
    parameter: z.array(gtmParameter).max(20).optional(),
    priority: z.number().int().optional(),
    notes: z.string().optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gtmUpdateClient = z
  .object({
    account_id: str,
    container_id: str,
    workspace_id: str,
    client_id: str,
    name: str,
    type: gtmClientType,
    parameter: z.array(gtmParameter).max(20).optional(),
    priority: z.number().int().optional(),
    notes: z.string().optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gtmCreateContainer = z
  .object({
    account_id: str,
    name: str,
    usage_context: z.union([gtmUsageContext, z.array(gtmUsageContext).min(1).max(4)]),
    notes: z.string().optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gtmCreateEnvironment = z
  .object({
    account_id: str,
    container_id: str,
    name: str,
    description: z.string().optional(),
    url: z.string().optional(),
    enable_debug: z.boolean().optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

/** Google Ads mutate — dry_run default true; live needs confirm_phrase with customer_id. */
export const gadsSetCampaignStatus = z
  .object({
    customer_id: str,
    campaign_id: str,
    status: z.enum(["ENABLED", "PAUSED"]),
    login_customer_id: str,
    /** Default true — no Ads mutate HTTP unless explicitly false. */
    dry_run: z.boolean().default(true),
    /** Required when dry_run=false; must include digits-only customer_id (checked in handler). */
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

/** Google Ads budget mutate — amount_micros canonical; dollars helper optional. */
export const gadsUpdateCampaignBudget = z
  .object({
    customer_id: str,
    /** Digits-only budget id (preferred; mirrors campaign_id on status tool). */
    campaign_budget_id: str,
    /** Optional full resource name customers/{customer_id}/campaignBudgets/{id}. */
    campaign_budget_resource_name: str,
    /** Canonical daily budget in micros (string or number). */
    amount_micros: z.union([z.string(), z.number()]).optional(),
    /** Dollars helper → amount_micros via ×1_000_000. */
    daily_budget_dollars: z.number().positive().optional(),
    login_customer_id: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    requireConfirmWhenLive(val, ctx);
    const hasId = Boolean(val.campaign_budget_id && String(val.campaign_budget_id).trim());
    const hasRn = Boolean(
      val.campaign_budget_resource_name && String(val.campaign_budget_resource_name).trim(),
    );
    if (!hasId && !hasRn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "campaign_budget_id or campaign_budget_resource_name is required",
        path: ["campaign_budget_id"],
      });
    }
    const hasMicros = val.amount_micros !== undefined && val.amount_micros !== null && val.amount_micros !== "";
    const hasDollars = val.daily_budget_dollars !== undefined;
    if (!hasMicros && !hasDollars) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "amount_micros or daily_budget_dollars is required",
        path: ["amount_micros"],
      });
    }
  });

const keywordItem = z
  .object({
    text: z.string().min(1).max(80),
    match_type: z.enum(["EXACT", "PHRASE", "BROAD"]).optional(),
  })
  .strict();

export const gadsSetKeywordStatus = z
  .object({
    customer_id: str,
    ad_group_id: str,
    criterion_id: str,
    status: z.enum(["ENABLED", "PAUSED"]),
    login_customer_id: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsAddKeywords = z
  .object({
    customer_id: str,
    ad_group_id: str,
    keywords: z.array(keywordItem).min(1).max(20),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
    login_customer_id: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsSetAdStatus = z
  .object({
    customer_id: str,
    ad_group_id: str,
    ad_id: str,
    status: z.enum(["ENABLED", "PAUSED"]),
    login_customer_id: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsCreateResponsiveSearchAd = z
  .object({
    customer_id: str,
    ad_group_id: str,
    headlines: z.array(z.string().min(1).max(30)).min(3).max(15),
    descriptions: z.array(z.string().min(1).max(90)).min(2).max(4),
    final_url: z.string().url().max(2048),
    path1: z.string().max(15).optional(),
    path2: z.string().max(15).optional(),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
    login_customer_id: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsCreateSearchCampaign = z
  .object({
    customer_id: str,
    campaign_name: z.string().min(1).max(255),
    ad_group_name: z.string().min(1).max(255),
    amount_micros: z.union([z.string(), z.number()]).optional(),
    daily_budget_dollars: z.number().positive().optional(),
    keywords: z.array(keywordItem).min(1).max(20),
    cpc_bid_micros: z.union([z.string(), z.number()]).optional(),
    /** Optional RSA stub on the new ad group. */
    headlines: z.array(z.string().min(1).max(30)).min(3).max(15).optional(),
    descriptions: z.array(z.string().min(1).max(90)).min(2).max(4).optional(),
    final_url: z.string().url().max(2048).optional(),
    path1: z.string().max(15).optional(),
    path2: z.string().max(15).optional(),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
    login_customer_id: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    requireConfirmWhenLive(val, ctx);
    const hasMicros = val.amount_micros !== undefined && val.amount_micros !== null && val.amount_micros !== "";
    const hasDollars = val.daily_budget_dollars !== undefined;
    if (!hasMicros && !hasDollars) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "amount_micros or daily_budget_dollars is required",
        path: ["amount_micros"],
      });
    }
    const hasRsa =
      (val.headlines && val.headlines.length > 0) ||
      (val.descriptions && val.descriptions.length > 0) ||
      Boolean(val.final_url);
    if (hasRsa) {
      if (!val.headlines || val.headlines.length < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "RSA stub requires ≥3 headlines",
          path: ["headlines"],
        });
      }
      if (!val.descriptions || val.descriptions.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "RSA stub requires ≥2 descriptions",
          path: ["descriptions"],
        });
      }
      if (!val.final_url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "RSA stub requires final_url (https)",
          path: ["final_url"],
        });
      }
    }
  });

export const gadsSetAdGroupStatus = z
  .object({
    customer_id: str,
    ad_group_id: str,
    status: z.enum(["ENABLED", "PAUSED"]),
    login_customer_id: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

/** Honest minimal Display create: budget + DISPLAY campaign + ad group (no RDA/images). */
export const gadsCreateDisplayCampaign = z
  .object({
    customer_id: str,
    campaign_name: z.string().min(1).max(255),
    ad_group_name: z.string().min(1).max(255),
    amount_micros: z.union([z.string(), z.number()]).optional(),
    daily_budget_dollars: z.number().positive().optional(),
    cpc_bid_micros: z.union([z.string(), z.number()]).optional(),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
    login_customer_id: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    requireConfirmWhenLive(val, ctx);
    const hasMicros = val.amount_micros !== undefined && val.amount_micros !== null && val.amount_micros !== "";
    const hasDollars = val.daily_budget_dollars !== undefined;
    if (!hasMicros && !hasDollars) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "amount_micros or daily_budget_dollars is required",
        path: ["amount_micros"],
      });
    }
  });

/**
 * Named image asset upload via stamp AssetService. bytes XOR https file_url.
 */
export const gadsUploadAsset = z
  .object({
    customer_id: str,
    asset_type: z.enum(["IMAGE"]).optional(),
    name: z.string().min(1).max(255).optional(),
    bytes: z.string().min(32).max(4_000_000).optional(),
    file_url: z.string().url().max(2048).optional(),
    login_customer_id: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasBytes = Boolean(val.bytes && val.bytes.trim());
    const hasUrl = Boolean(val.file_url && val.file_url.trim());
    if (hasBytes === hasUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one of bytes (base64) or file_url (https image)",
        path: hasBytes ? ["file_url"] : ["bytes"],
      });
    }
    requireConfirmWhenLive(val, ctx);
  });

/**
 * Performance Max create — existing image/logo asset RNs and/or upload sources
 * (file_url / bytes) for marketing + square + logo. Defaults PAUSED.
 */
export const gadsCreatePerformanceMaxCampaign = z
  .object({
    customer_id: str,
    campaign_name: z.string().min(1).max(255),
    asset_group_name: z.string().min(1).max(255),
    amount_micros: z.union([z.string(), z.number()]).optional(),
    daily_budget_dollars: z.number().positive().optional(),
    final_url: z.string().url().max(2048),
    headlines: z.array(z.string().min(1).max(30)).min(3).max(15),
    long_headlines: z.array(z.string().min(1).max(90)).min(1).max(5),
    descriptions: z.array(z.string().min(1).max(90)).min(2).max(5),
    business_name: z.string().min(1).max(25),
    marketing_image_asset_resource_names: z.array(z.string().min(1)).max(20).optional(),
    square_marketing_image_asset_resource_names: z.array(z.string().min(1)).max(20).optional(),
    logo_asset_resource_names: z.array(z.string().min(1)).max(5).optional(),
    marketing_image_file_url: z.string().url().max(2048).optional(),
    square_marketing_image_file_url: z.string().url().max(2048).optional(),
    logo_file_url: z.string().url().max(2048).optional(),
    marketing_image_bytes: z.string().min(32).max(4_000_000).optional(),
    square_marketing_image_bytes: z.string().min(32).max(4_000_000).optional(),
    logo_bytes: z.string().min(32).max(4_000_000).optional(),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
    login_customer_id: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasAmt =
      (val.amount_micros !== undefined && val.amount_micros !== null && val.amount_micros !== "") ||
      typeof val.daily_budget_dollars === "number";
    if (!hasAmt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "amount_micros or daily_budget_dollars is required",
        path: ["amount_micros"],
      });
    }
    requireConfirmWhenLive(val, ctx);
  });

/**
 * Shopping create — needs merchant_center_id (discover via gads_list_merchant_center_links).
 */
export const gadsCreateShoppingCampaign = z
  .object({
    customer_id: str,
    campaign_name: z.string().min(1).max(255),
    merchant_center_id: z.union([z.string(), z.number()]).optional(),
    sales_country: z.string().length(2).optional(),
    amount_micros: z.union([z.string(), z.number()]).optional(),
    daily_budget_dollars: z.number().positive().optional(),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
    login_customer_id: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasAmt =
      (val.amount_micros !== undefined && val.amount_micros !== null && val.amount_micros !== "") ||
      typeof val.daily_budget_dollars === "number";
    if (!hasAmt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "amount_micros or daily_budget_dollars is required",
        path: ["amount_micros"],
      });
    }
    requireConfirmWhenLive(val, ctx);
  });

/** Discover linked Merchant Center product links (read; Consent C). */
export const gadsListMerchantCenterLinks = z
  .object({
    customer_id: str,
    login_customer_id: str,
    limit: z.number().int().positive().max(200).optional(),
  })
  .strict();

const gadsMutateBase = {
  customer_id: str,
  login_customer_id: str,
  dry_run: z.boolean().default(true),
  confirm_phrase: z.string().optional(),
};

const amountFields = {
  amount_micros: z.union([z.string(), z.number()]).optional(),
  daily_budget_dollars: z.number().positive().optional(),
};

function requireAmountWhenCreate(
  val: { amount_micros?: unknown; daily_budget_dollars?: number },
  ctx: z.RefinementCtx,
): void {
  const hasMicros = val.amount_micros !== undefined && val.amount_micros !== null && val.amount_micros !== "";
  if (!hasMicros && val.daily_budget_dollars === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "amount_micros or daily_budget_dollars is required",
      path: ["amount_micros"],
    });
  }
}

const scheduleItem = z
  .object({
    day_of_week: z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]),
    start_hour: z.number().int().min(0).max(23),
    start_minute: z.enum(["ZERO", "FIFTEEN", "THIRTY", "FORTY_FIVE"]).optional(),
    end_hour: z.number().int().min(0).max(24),
    end_minute: z.enum(["ZERO", "FIFTEEN", "THIRTY", "FORTY_FIVE"]).optional(),
  })
  .strict();

export const gadsCreateResponsiveDisplayAd = z
  .object({
    ...gadsMutateBase,
    ad_group_id: str,
    headlines: z.array(z.string().min(1).max(30)).min(1).max(5),
    long_headline: z.string().min(1).max(90).optional(),
    long_headlines: z.array(z.string().min(1).max(90)).max(1).optional(),
    descriptions: z.array(z.string().min(1).max(90)).min(1).max(5),
    business_name: z.string().min(1).max(25),
    final_url: z.string().url().max(2048),
    marketing_image_asset_resource_names: z.array(z.string().min(1)).max(20).optional(),
    square_marketing_image_asset_resource_names: z.array(z.string().min(1)).max(20).optional(),
    logo_asset_resource_names: z.array(z.string().min(1)).max(5).optional(),
    marketing_image_file_url: z.string().url().max(2048).optional(),
    square_marketing_image_file_url: z.string().url().max(2048).optional(),
    logo_file_url: z.string().url().max(2048).optional(),
    marketing_image_bytes: z.string().min(32).max(4_000_000).optional(),
    square_marketing_image_bytes: z.string().min(32).max(4_000_000).optional(),
    logo_bytes: z.string().min(32).max(4_000_000).optional(),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsAddShoppingListingGroups = z
  .object({
    ...gadsMutateBase,
    campaign_id: str,
    ad_group_id: str,
    ad_group_name: z.string().min(1).max(255).optional(),
    listing_group_type: z.enum(["ALL_PRODUCTS", "BRAND", "ITEM_ID"]).optional(),
    listing_group_values: z.array(z.string().min(1).max(80)).max(20).optional(),
    brands: z.array(z.string().min(1).max(80)).max(20).optional(),
    cpc_bid_micros: z.union([z.string(), z.number()]).optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsCreateVideoCampaign = z
  .object({
    ...gadsMutateBase,
    campaign_name: z.string().min(1).max(255),
    ad_group_name: z.string().min(1).max(255).optional(),
    ...amountFields,
    youtube_video_id: z.string().min(11).max(11).optional(),
    headlines: z.array(z.string().min(1).max(30)).max(5).optional(),
    long_headlines: z.array(z.string().min(1).max(90)).max(5).optional(),
    descriptions: z.array(z.string().min(1).max(90)).max(5).optional(),
    final_url: z.string().url().max(2048).optional(),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    requireConfirmWhenLive(val, ctx);
    requireAmountWhenCreate(val, ctx);
  });

export const gadsCreateDemandGenCampaign = z
  .object({
    ...gadsMutateBase,
    campaign_name: z.string().min(1).max(255),
    ad_group_name: z.string().min(1).max(255).optional(),
    ...amountFields,
    headlines: z.array(z.string().min(1).max(30)).max(5).optional(),
    descriptions: z.array(z.string().min(1).max(90)).max(5).optional(),
    business_name: z.string().min(1).max(25).optional(),
    final_url: z.string().url().max(2048).optional(),
    marketing_image_asset_resource_names: z.array(z.string().min(1)).max(20).optional(),
    square_marketing_image_asset_resource_names: z.array(z.string().min(1)).max(20).optional(),
    logo_asset_resource_names: z.array(z.string().min(1)).max(5).optional(),
    marketing_image_file_url: z.string().url().max(2048).optional(),
    square_marketing_image_file_url: z.string().url().max(2048).optional(),
    logo_file_url: z.string().url().max(2048).optional(),
    marketing_image_bytes: z.string().min(32).max(4_000_000).optional(),
    square_marketing_image_bytes: z.string().min(32).max(4_000_000).optional(),
    logo_bytes: z.string().min(32).max(4_000_000).optional(),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    requireConfirmWhenLive(val, ctx);
    requireAmountWhenCreate(val, ctx);
  });

export const gadsCreateAppCampaign = z
  .object({
    ...gadsMutateBase,
    campaign_name: z.string().min(1).max(255),
    ...amountFields,
    app_id: z.string().min(1).max(255),
    app_store: z.enum(["GOOGLE_APP_STORE", "APPLE_APP_STORE"]).optional(),
    target_cpa_micros: z.union([z.string(), z.number()]).optional(),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    requireConfirmWhenLive(val, ctx);
    requireAmountWhenCreate(val, ctx);
  });

export const gadsCreateHotelCampaign = z
  .object({
    ...gadsMutateBase,
    campaign_name: z.string().min(1).max(255),
    ad_group_name: z.string().min(1).max(255).optional(),
    ...amountFields,
    hotel_center_id: z.union([z.string(), z.number()]).optional(),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    requireConfirmWhenLive(val, ctx);
    requireAmountWhenCreate(val, ctx);
  });

export const gadsCreateLocalCampaign = z
  .object({
    ...gadsMutateBase,
    campaign_name: z.string().min(1).max(255),
    ...amountFields,
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    requireConfirmWhenLive(val, ctx);
    requireAmountWhenCreate(val, ctx);
  });

export const gadsAddNegativeKeywords = z
  .object({
    ...gadsMutateBase,
    campaign_id: str,
    ad_group_id: str,
    keywords: z.array(keywordItem).min(1).max(20),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsAttachAudience = z
  .object({
    ...gadsMutateBase,
    campaign_id: str,
    ad_group_id: str,
    audience_resource_name: z.string().min(1).max(256),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsAddGeoTargets = z
  .object({
    ...gadsMutateBase,
    campaign_id: str,
    geo_target_constant_ids: z.array(z.string().min(1).max(20)).min(1).max(50),
    negative: z.boolean().optional(),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsAddLanguages = z
  .object({
    ...gadsMutateBase,
    campaign_id: str,
    language_constant_ids: z.array(z.string().min(1).max(20)).min(1).max(50).optional(),
    language_ids: z.array(z.string().min(1).max(20)).min(1).max(50).optional(),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsAddDemographics = z
  .object({
    ...gadsMutateBase,
    ad_group_id: str,
    age_ranges: z
      .array(
        z.enum([
          "AGE_RANGE_18_24",
          "AGE_RANGE_25_34",
          "AGE_RANGE_35_44",
          "AGE_RANGE_45_54",
          "AGE_RANGE_55_64",
          "AGE_RANGE_65_UP",
          "AGE_RANGE_UNDETERMINED",
        ]),
      )
      .max(10)
      .optional(),
    genders: z.array(z.enum(["MALE", "FEMALE", "UNDETERMINED"])).max(3).optional(),
    parental_statuses: z.array(z.enum(["PARENT", "NOT_A_PARENT", "UNDETERMINED"])).max(3).optional(),
    income_ranges: z
      .array(
        z.enum([
          "INCOME_RANGE_0_50",
          "INCOME_RANGE_50_60",
          "INCOME_RANGE_60_70",
          "INCOME_RANGE_70_80",
          "INCOME_RANGE_80_90",
          "INCOME_RANGE_90_UP",
          "INCOME_RANGE_UNDETERMINED",
        ]),
      )
      .max(10)
      .optional(),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsSetAdSchedule = z
  .object({
    ...gadsMutateBase,
    campaign_id: str,
    schedules: z.array(scheduleItem).min(1).max(42),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsSetCampaignBidStrategy = z
  .object({
    ...gadsMutateBase,
    campaign_id: str,
    bid_strategy_type: z
      .enum([
        "MANUAL_CPC",
        "MANUAL_CPM",
        "MAXIMIZE_CLICKS",
        "MAXIMIZE_CONVERSIONS",
        "MAXIMIZE_CONVERSION_VALUE",
        "TARGET_CPA",
        "TARGET_ROAS",
        "TARGET_SPEND",
        "TARGET_IMPRESSION_SHARE",
        "TARGET_CPM",
        "PERCENT_CPC",
      ])
      .optional(),
    target_cpa_micros: z.union([z.string(), z.number()]).optional(),
    target_roas: z.number().positive().optional(),
    target_cpm_micros: z.union([z.string(), z.number()]).optional(),
    cpc_bid_ceiling_micros: z.union([z.string(), z.number()]).optional(),
    location: z.enum(["ANYWHERE_ON_PAGE", "TOP_OF_PAGE", "ABSOLUTE_TOP_OF_PAGE"]).optional(),
    location_fraction_micros: z.union([z.string(), z.number()]).optional(),
    bidding_strategy_resource_name: z.string().min(1).max(256).optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsCreateSharedBudget = z
  .object({
    ...gadsMutateBase,
    name: z.string().min(1).max(255).optional(),
    campaign_name: z.string().min(1).max(255).optional(),
    ...amountFields,
  })
  .strict()
  .superRefine((val, ctx) => {
    requireConfirmWhenLive(val, ctx);
    requireAmountWhenCreate(val, ctx);
  });

export const gadsCreatePortfolioBiddingStrategy = z
  .object({
    ...gadsMutateBase,
    name: z.string().min(1).max(255).optional(),
    bidding_strategy_name: z.string().min(1).max(255).optional(),
    bid_strategy_type: z
      .enum([
        "MANUAL_CPC",
        "MANUAL_CPM",
        "MAXIMIZE_CLICKS",
        "MAXIMIZE_CONVERSIONS",
        "MAXIMIZE_CONVERSION_VALUE",
        "TARGET_CPA",
        "TARGET_ROAS",
        "TARGET_SPEND",
        "TARGET_IMPRESSION_SHARE",
        "TARGET_CPM",
        "PERCENT_CPC",
      ])
      .optional(),
    target_cpa_micros: z.union([z.string(), z.number()]).optional(),
    target_roas: z.number().positive().optional(),
    target_cpm_micros: z.union([z.string(), z.number()]).optional(),
    cpc_bid_ceiling_micros: z.union([z.string(), z.number()]).optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsCreateConversionAction = z
  .object({
    ...gadsMutateBase,
    name: z.string().min(1).max(255).optional(),
    conversion_action_name: z.string().min(1).max(255).optional(),
    conversion_action_type: z
      .enum(["WEBPAGE", "UPLOAD_CLICKS", "UPLOAD_CALLS", "CLICK_TO_CALL", "WEBSITE_CALL", "STORE_SALES"])
      .optional(),
    conversion_category: z
      .enum([
        "DEFAULT",
        "PAGE_VIEW",
        "PURCHASE",
        "SIGNUP",
        "LEAD",
        "DOWNLOAD",
        "ADD_TO_CART",
        "BEGIN_CHECKOUT",
        "SUBSCRIBE_PAID",
        "CONTACT",
        "SUBMIT_LEAD_FORM",
        "BOOK_APPOINTMENT",
        "REQUEST_QUOTE",
        "PHONE_CALL_LEAD",
      ])
      .optional(),
    default_value: z.number().min(0).optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsApplyRecommendation = z
  .object({
    ...gadsMutateBase,
    recommendation_resource_name: z.string().min(1).max(256).optional(),
    recommendation_id: str,
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsLinkMerchantCenter = z
  .object({
    ...gadsMutateBase,
    merchant_center_id: z.union([z.string(), z.number()]).optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsUnlinkMerchantCenter = z
  .object({
    ...gadsMutateBase,
    product_link_resource_name: z.string().min(1).max(256).optional(),
    product_link_id: str,
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const gadsCreateExperiment = z
  .object({
    ...gadsMutateBase,
    campaign_id: str,
    name: z.string().min(1).max(255).optional(),
    experiment_name: z.string().min(1).max(255).optional(),
    experiment_type: z
      .enum(["SEARCH_CUSTOM", "DISPLAY_CUSTOM", "HOTEL_ADS", "SMART_MATCHING", "YOUTUBE_CUSTOM"])
      .optional(),
    traffic_split_percent: z.number().int().min(1).max(99).optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);


/** Meta mutate — dry_run default true; live needs confirm_phrase with act_{ad_account_id} + object id. */
function requireMetaUpdateFieldsCampaign(
  val: { dry_run: boolean; confirm_phrase?: string; status?: string; name?: string },
  ctx: z.RefinementCtx,
): void {
  requireConfirmWhenLive(val, ctx);
  if (!val.status && !(val.name && String(val.name).trim())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide at least one of: status, name",
      path: ["status"],
    });
  }
}

function requireMetaUpdateFieldsAdset(
  val: {
    dry_run: boolean;
    confirm_phrase?: string;
    status?: string;
    name?: string;
    daily_budget?: string | number;
    lifetime_budget?: string | number;
  },
  ctx: z.RefinementCtx,
): void {
  requireConfirmWhenLive(val, ctx);
  const hasStatus = Boolean(val.status);
  const hasName = Boolean(val.name && String(val.name).trim());
  const hasDaily = val.daily_budget !== undefined && val.daily_budget !== null && val.daily_budget !== "";
  const hasLife =
    val.lifetime_budget !== undefined && val.lifetime_budget !== null && val.lifetime_budget !== "";
  if (hasDaily && hasLife) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide daily_budget OR lifetime_budget (not both). Units: integer cents.",
      path: ["daily_budget"],
    });
  }
  if (!hasStatus && !hasName && !hasDaily && !hasLife) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide at least one of: status, name, daily_budget, lifetime_budget",
      path: ["status"],
    });
  }
}

export const metaUpdateCampaign = z
  .object({
    ad_account_id: str,
    campaign_id: str,
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
    /** Optional rename (closed allowlist; no creative fields). */
    name: str,
    /** Default true — no Meta Graph mutate HTTP unless explicitly false. */
    dry_run: z.boolean().default(true),
    /** Required when dry_run=false; must include act_{ad_account_id} and campaign_id (checked in handler). */
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireMetaUpdateFieldsCampaign);

export const metaUpdateAdset = z
  .object({
    ad_account_id: str,
    adset_id: str,
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
    name: str,
    /**
     * Primary budget field. Meta Marketing API integer in **cents**
     * (account currency smallest unit). Not Google Ads micros. XOR lifetime_budget.
     */
    daily_budget: z.union([z.string(), z.number().int().positive()]).optional(),
    /** Alternative to daily_budget — same cents units. Do not send both. */
    lifetime_budget: z.union([z.string(), z.number().int().positive()]).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireMetaUpdateFieldsAdset);

export const metaUpdateAd = z
  .object({
    ad_account_id: str,
    ad_id: str,
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
    /** Optional rename — creative fields remain out of allowlist. */
    name: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireMetaUpdateFieldsCampaign);

const META_OBJECTIVES = [
  "OUTCOME_AWARENESS",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
  "OUTCOME_TRAFFIC",
  "OUTCOME_APP_PROMOTION",
] as const;

const META_SPECIAL_AD_CATS = [
  "NONE",
  "EMPLOYMENT",
  "HOUSING",
  "CREDIT",
  "ISSUES_ELECTIONS_POLITICS",
] as const;

const META_BILLING = ["IMPRESSIONS", "LINK_CLICKS"] as const;
const META_OPT_GOALS = [
  "LINK_CLICKS",
  "LANDING_PAGE_VIEWS",
  "IMPRESSIONS",
  "REACH",
  "OFFSITE_CONVERSIONS",
  "LEAD_GENERATION",
  "VALUE",
  "THRUPLAY",
] as const;
const META_BID = ["LOWEST_COST_WITHOUT_CAP"] as const;

function requireMetaCreateAdsetBudget(
  val: {
    dry_run: boolean;
    confirm_phrase?: string;
    daily_budget?: string | number;
    lifetime_budget?: string | number;
    end_time?: string;
  },
  ctx: z.RefinementCtx,
): void {
  requireConfirmWhenLive(val, ctx);
  const hasDaily = val.daily_budget !== undefined && val.daily_budget !== null && val.daily_budget !== "";
  const hasLife =
    val.lifetime_budget !== undefined && val.lifetime_budget !== null && val.lifetime_budget !== "";
  if (hasDaily === hasLife) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide daily_budget OR lifetime_budget (not both). Units: integer cents.",
      path: ["daily_budget"],
    });
  }
  if (hasLife && !(val.end_time && String(val.end_time).trim())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "end_time is required when using lifetime_budget",
      path: ["end_time"],
    });
  }
}

/** Create campaign — defaults PAUSED; confirm live with act_{ad_account_id}. */
export const metaCreateCampaign = z
  .object({
    ad_account_id: z.string().min(1),
    name: z.string().min(1).max(400),
    objective: z.enum(META_OBJECTIVES),
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
    special_ad_categories: z
      .union([z.array(z.enum(META_SPECIAL_AD_CATS)), z.string()])
      .optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

const META_GENDERS = ["MALE", "FEMALE"] as const;
const META_PUBLISHERS = ["facebook", "instagram", "audience_network", "messenger"] as const;
const META_FB_POSITIONS = [
  "feed",
  "right_hand_column",
  "marketplace",
  "video_feeds",
  "story",
  "search",
  "instream_video",
  "facebook_reels",
  "facebook_reels_overlay",
  "profile_feed",
] as const;
const META_IG_POSITIONS = [
  "stream",
  "story",
  "explore",
  "explore_home",
  "reels",
  "profile_feed",
  "ig_search",
  "profile_reels",
] as const;
const META_AN_POSITIONS = ["classic", "rewarded_video", "instream_video"] as const;
const META_MSG_POSITIONS = ["messenger_home", "sponsored_messages", "story"] as const;
const META_DEVICES = ["mobile", "desktop"] as const;
const META_CUSTOM_EVENTS = [
  "PURCHASE",
  "LEAD",
  "COMPLETE_REGISTRATION",
  "ADD_TO_CART",
  "VIEW_CONTENT",
  "INITIATED_CHECKOUT",
  "SEARCH",
  "ADD_PAYMENT_INFO",
  "ADD_TO_WISHLIST",
  "CONTACT",
  "CUSTOMIZE_PRODUCT",
  "DONATE",
  "FIND_LOCATION",
  "SCHEDULE",
  "START_TRIAL",
  "SUBMIT_APPLICATION",
  "SUBSCRIBE",
  "OTHER",
] as const;

const idList = z.union([z.array(z.string().min(1).max(30)).max(50), z.string().min(1)]);
const strList = z.union([z.array(z.string().min(1)).max(50), z.string().min(1)]);

/** Named targeting packs shared by create ad set + targeting update. Never a targeting JSON bag. */
const metaTargetingPackFields = {
  countries: z.union([z.array(z.string().min(2).max(2)), z.string().min(2)]),
  age_min: z.union([z.number().int().min(13).max(65), z.string()]).optional(),
  age_max: z.union([z.number().int().min(13).max(65), z.string()]).optional(),
  genders: z.union([z.array(z.enum(META_GENDERS)), z.enum(META_GENDERS), z.string()]).optional(),
  locales: idList.optional(),
  interest_ids: idList.optional(),
  behavior_ids: idList.optional(),
  custom_audience_ids: idList.optional(),
  excluded_custom_audience_ids: idList.optional(),
  publisher_platforms: z.union([z.array(z.enum(META_PUBLISHERS)), z.string()]).optional(),
  facebook_positions: z.union([z.array(z.enum(META_FB_POSITIONS)), strList]).optional(),
  instagram_positions: z.union([z.array(z.enum(META_IG_POSITIONS)), strList]).optional(),
  audience_network_positions: z.union([z.array(z.enum(META_AN_POSITIONS)), strList]).optional(),
  messenger_positions: z.union([z.array(z.enum(META_MSG_POSITIONS)), strList]).optional(),
  device_platforms: z.union([z.array(z.enum(META_DEVICES)), z.string()]).optional(),
};

const metaPromotedObjectFields = {
  pixel_id: z.string().min(1).max(30).optional(),
  custom_event_type: z.enum(META_CUSTOM_EVENTS).optional(),
  catalog_id: z.string().min(1).max(30).optional(),
  product_set_id: z.string().min(1).max(30).optional(),
};

/** Create ad set — named targeting packs + placements; spend-cap on budget cents. */
export const metaCreateAdset = z
  .object({
    ad_account_id: z.string().min(1),
    campaign_id: z.string().min(1),
    name: z.string().min(1).max(400),
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
    daily_budget: z.union([z.string(), z.number().int().positive()]).optional(),
    lifetime_budget: z.union([z.string(), z.number().int().positive()]).optional(),
    billing_event: z.enum(META_BILLING).optional(),
    optimization_goal: z.enum(META_OPT_GOALS).optional(),
    bid_strategy: z.enum(META_BID).optional(),
    ...metaTargetingPackFields,
    ...metaPromotedObjectFields,
    end_time: z.string().min(10).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireMetaCreateAdsetBudget);

/** Replace ad set targeting from named packs (countries required). */
export const metaUpdateAdsetTargeting = z
  .object({
    ad_account_id: z.string().min(1),
    adset_id: z.string().min(1),
    ...metaTargetingPackFields,
    ...metaPromotedObjectFields,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

/** Attach custom audience ids to an ad set (replaces targeting; countries required). */
export const metaAttachAudience = z
  .object({
    ad_account_id: z.string().min(1),
    adset_id: z.string().min(1),
    ...metaTargetingPackFields,
    custom_audience_ids: idList,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

/** Website custom audience from a pixel — no hashed PII / Customer Match. */
export const metaCreateCustomAudience = z
  .object({
    ad_account_id: z.string().min(1),
    name: z.string().min(1).max(400),
    pixel_id: z.string().min(1),
    retention_days: z.union([z.number().int().min(1).max(180), z.string()]).optional(),
    url_contains: z.string().min(1).max(200).optional(),
    prefill: z.union([z.boolean(), z.string(), z.number()]).optional(),
    subtype: z.literal("WEBSITE").optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

/** Lookalike from an existing custom audience id. */
export const metaCreateLookalikeAudience = z
  .object({
    ad_account_id: z.string().min(1),
    name: z.string().min(1).max(400),
    origin_audience_id: z.string().min(1),
    country: z.string().length(2),
    lookalike_ratio: z.union([z.number().min(0.01).max(0.2), z.string()]).optional(),
    lookalike_type: z.enum(["similarity", "reach"]).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

/** Create ad — existing creative_id only (use meta_create_ad_creative / upload first). */
export const metaCreateAd = z
  .object({
    ad_account_id: z.string().min(1),
    adset_id: z.string().min(1),
    name: z.string().min(1).max(400),
    creative_id: z.string().min(1),
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);


const META_CTA = [
  "LEARN_MORE",
  "SHOP_NOW",
  "SIGN_UP",
  "CONTACT_US",
  "DOWNLOAD",
  "BOOK_TRAVEL",
  "GET_OFFER",
  "SUBSCRIBE",
  "APPLY_NOW",
  "GET_QUOTE",
  "BUY_NOW",
  "NO_BUTTON",
] as const;

/** Upload Meta ad image (base64 bytes) → image_hash for AdCreative. */
export const metaUploadAdImage = z
  .object({
    ad_account_id: z.string().min(1),
    bytes: z.string().min(32).max(4_000_000),
    name: z.string().min(1).max(400).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

/** Optional Meta ad video upload via https file_url (not a hop proxy). */
export const metaUploadAdVideo = z
  .object({
    ad_account_id: z.string().min(1),
    file_url: z.string().url().max(2048),
    title: z.string().min(1).max(400).optional(),
    name: z.string().min(1).max(400).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

/** Create Meta AdCreative from image_hash XOR video_id; returns creative_id. */
export const metaCreateAdCreative = z
  .object({
    ad_account_id: z.string().min(1),
    name: z.string().min(1).max(400),
    page_id: z.string().min(1),
    image_hash: z.string().min(8).max(128).optional(),
    video_id: z.string().min(1).optional(),
    link: z.string().url().max(2048),
    message: z.string().max(2000).optional(),
    title: z.string().max(255).optional(),
    description: z.string().max(500).optional(),
    call_to_action_type: z.enum(META_CTA).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    requireConfirmWhenLive(val, ctx);
    const hasImage = Boolean(val.image_hash && String(val.image_hash).trim());
    const hasVideo = Boolean(val.video_id && String(val.video_id).trim());
    if (hasImage === hasVideo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide image_hash XOR video_id",
        path: ["image_hash"],
      });
    }
  });

const META_CATALOG_ITEM_TYPES = [
  "PRODUCT_ITEM",
  "DESTINATION",
  "FLIGHT",
  "HOME_LISTING",
  "HOTEL",
  "VEHICLE",
] as const;
const META_CATALOG_METHODS = ["CREATE", "UPDATE", "DELETE"] as const;
const META_CATALOG_AVAIL = [
  "in stock",
  "out of stock",
  "preorder",
  "available for order",
  "discontinued",
] as const;
const META_CATALOG_CONDITION = ["new", "refurbished", "used"] as const;
const META_CATALOG_VERTICAL = [
  "commerce",
  "hotels",
  "flights",
  "destinations",
  "vehicles",
  "home_listings",
] as const;
const META_CAPI_EVENT_NAMES = [
  "Purchase",
  "Lead",
  "CompleteRegistration",
  "AddToCart",
  "AddToWishlist",
  "InitiateCheckout",
  "ViewContent",
  "Search",
  "AddPaymentInfo",
  "Subscribe",
  "StartTrial",
  "SubmitApplication",
  "Contact",
  "CustomizeProduct",
  "Donate",
  "FindLocation",
  "Schedule",
  "PageView",
] as const;
const META_CAPI_ACTION_SOURCES = [
  "website",
  "app",
  "email",
  "phone_call",
  "chat",
  "physical_store",
  "system_generated",
  "business_messaging",
  "other",
] as const;

const metaCatalogItem = z
  .object({
    method: z.enum(META_CATALOG_METHODS),
    retailer_id: z.string().min(1).max(100),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    availability: z.enum(META_CATALOG_AVAIL).optional(),
    condition: z.enum(META_CATALOG_CONDITION).optional(),
    price: z.string().min(3).max(40).optional(),
    link: z.string().url().max(2048).optional(),
    image_link: z.string().url().max(2048).optional(),
    additional_image_link: z.string().url().max(2048).optional(),
    brand: z.string().max(200).optional(),
    item_group_id: z.string().max(100).optional(),
    sale_price: z.string().max(40).optional(),
    google_product_category: z.string().max(200).optional(),
    color: z.string().max(80).optional(),
    size: z.string().max(80).optional(),
    gender: z.string().max(40).optional(),
    age_group: z.string().max(40).optional(),
    material: z.string().max(80).optional(),
    pattern: z.string().max(80).optional(),
    product_type: z.string().max(200).optional(),
    quantity: z.union([z.number().int().min(0), z.string()]).optional(),
    status: z.string().max(40).optional(),
  })
  .strict();

const metaCapiEvent = z
  .object({
    event_name: z.enum(META_CAPI_EVENT_NAMES),
    event_id: z.string().min(1).max(128),
    event_time: z.union([z.number().int().positive(), z.string()]).optional(),
    action_source: z.enum(META_CAPI_ACTION_SOURCES).optional(),
    event_source_url: z.string().url().max(2048).optional(),
    em: z.string().min(1).max(256).optional(),
    ph: z.string().min(1).max(64).optional(),
    fn: z.string().min(1).max(256).optional(),
    ln: z.string().min(1).max(256).optional(),
    ct: z.string().min(1).max(256).optional(),
    st: z.string().min(1).max(256).optional(),
    zp: z.string().min(1).max(64).optional(),
    country: z.string().min(2).max(64).optional(),
    external_id: z.string().min(1).max(256).optional(),
    client_ip_address: z.string().min(1).max(64).optional(),
    client_user_agent: z.string().min(1).max(512).optional(),
    fbc: z.string().min(1).max(256).optional(),
    fbp: z.string().min(1).max(256).optional(),
    event_value: z.union([z.number().min(0), z.string()]).optional(),
    currency: z.string().length(3).optional(),
    content_ids: z.union([z.array(z.string().min(1)).max(50), z.string()]).optional(),
    content_type: z.string().max(64).optional(),
    content_name: z.string().max(256).optional(),
    num_items: z.union([z.number().int().positive(), z.string()]).optional(),
    order_id: z.string().max(128).optional(),
  })
  .strict();

/** Catalog items_batch upsert — HTTPS image URLs; confirm act_ + catalog_id. */
export const metaCatalogItemsBatch = z
  .object({
    ad_account_id: z.string().min(1),
    catalog_id: z.string().min(1),
    item_type: z.enum(META_CATALOG_ITEM_TYPES).optional(),
    allow_upsert: z.boolean().optional(),
    items: z.array(metaCatalogItem).min(1).max(50),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

/** Batch handle status read. */
export const metaGetBatchStatus = z
  .object({
    catalog_id: z.string().min(1),
    handle: z.string().min(1).max(128),
    ad_account_id: z.string().min(1).optional(),
  })
  .strict();

/** Create owned product catalog — confirm act_. */
export const metaCreateCatalog = z
  .object({
    ad_account_id: z.string().min(1),
    name: z.string().min(1).max(400),
    vertical: z.enum(META_CATALOG_VERTICAL).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

/** Closed CAPI events — hashed user_data; required event_id; confirm act_ + pixel_id. */
export const metaSendCapiEvents = z
  .object({
    ad_account_id: z.string().min(1),
    pixel_id: z.string().min(1),
    events: z.array(metaCapiEvent).min(1).max(10),
    test_event_code: z.string().min(1).max(64).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

/** Merchant Center — Merchant API reads. merchant_id never guessed. */
export const mcListAccounts = pageInput;

export const mcMerchantPage = z
  .object({
    merchant_id: str,
    page_size: pageSize,
    page_token: pageToken,
  })
  .strict();

export const mcGetProduct = z
  .object({
    merchant_id: str,
    product_id: str,
  })
  .strict();

export const mcListAccountIssues = z
  .object({
    merchant_id: str,
    page_size: pageSize,
    page_token: pageToken,
    language_code: z.string().min(2).max(16).optional(),
  })
  .strict();

export const mcListProducts = mcMerchantPage;
export const mcListProductStatuses = mcMerchantPage;
export const mcListDataSources = mcMerchantPage;

function requireMcConfirmWhenLive(
  val: { dry_run: boolean; confirm_phrase?: string; confirm?: string },
  ctx: z.RefinementCtx,
): void {
  if (val.dry_run === false) {
    const phrase = val.confirm_phrase ?? val.confirm;
    if (!phrase || !String(phrase).trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "confirm_phrase is required when dry_run is false (must include merchant_id)",
        path: ["confirm_phrase"],
      });
    }
  }
}

/** Wave 14 — API-type data source create. merchant_id required; dry_run default; live confirm contains merchant_id. */
export const mcCreateDataSource = z
  .object({
    merchant_id: z.string().min(1),
    display_name: z.string().min(1),
    kind: z.enum(["primary", "supplemental"]).optional(),
    channel: z.enum(["ONLINE_PRODUCTS"]).optional(),
    feed_label: z.string().optional(),
    content_language: z.string().optional(),
    countries: z.union([z.array(z.string().min(2).max(2)), z.string().min(2).max(2)]).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
    confirm: z.string().optional(),
  })
  .strict()
  .superRefine(requireMcConfirmWhenLive);

/** Wave 14 — ProductInput insert (default) or patch when update_mask is set. data_source required. */
export const mcUpsertProductInput = z
  .object({
    merchant_id: z.string().min(1),
    data_source: z.string().min(1).optional(),
    dataSource: z.string().min(1).optional(),
    offer_id: z.string().optional(),
    content_language: z.string().optional(),
    feed_label: z.string().optional(),
    product_id: z.string().optional(),
    update_mask: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    link: z.string().optional(),
    image_link: z.string().optional(),
    availability: z.enum(["IN_STOCK", "OUT_OF_STOCK", "PREORDER", "BACKORDER"]).optional(),
    condition: z.enum(["NEW", "USED", "REFURBISHED"]).optional(),
    price_micros: z.union([z.string(), z.number()]).optional(),
    currency: z.string().optional(),
    brand: z.string().optional(),
    gtin: z.string().optional(),
    mpn: z.string().optional(),
    google_product_category: z.string().optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
    confirm: z.string().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    requireMcConfirmWhenLive(val, ctx);
    if (!val.data_source && !val.dataSource) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "data_source is required (API data source name or id). ProductInput writes are not processed Product.",
        path: ["data_source"],
      });
    }
  });

export const mcDeleteProductInput = z
  .object({
    merchant_id: z.string().min(1),
    data_source: z.string().min(1).optional(),
    dataSource: z.string().min(1).optional(),
    product_id: z.string().min(1),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
    confirm: z.string().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    requireMcConfirmWhenLive(val, ctx);
    if (!val.data_source && !val.dataSource) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "data_source is required",
        path: ["data_source"],
      });
    }
  });

export const mcFetchDataSource = z
  .object({
    merchant_id: z.string().min(1),
    data_source: z.string().min(1).optional(),
    dataSource: z.string().min(1).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
    confirm: z.string().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    requireMcConfirmWhenLive(val, ctx);
    if (!val.data_source && !val.dataSource) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "data_source is required",
        path: ["data_source"],
      });
    }
  });

/** Shopify local read — merchant credentials; no Polar. */
export const shopifyGetShop = emptyInput;

export const shopifyListProducts = z
  .object({
    page_size: pageSize,
    page_token: pageToken,
  })
  .strict();

export const shopifyGetProduct = z
  .object({
    product_id: z.string().min(1),
  })
  .strict();

export const shopifyListOrders = z
  .object({
    page_size: pageSize,
    page_token: pageToken,
    status: z.enum(["any", "open", "closed", "cancelled"]).optional(),
    financial_status: z
      .enum([
        "any",
        "authorized",
        "pending",
        "paid",
        "partially_paid",
        "refunded",
        "voided",
        "partially_refunded",
        "unpaid",
      ])
      .optional(),
    fulfillment_status: z
      .enum(["any", "shipped", "partial", "unshipped", "unfulfilled", "fulfilled"])
      .optional(),
    created_at_min: z.string().min(1).optional(),
    created_at_max: z.string().min(1).optional(),
  })
  .strict();

export const shopifyGetOrder = z
  .object({
    order_id: z.string().min(1),
  })
  .strict();

export const shopifyListLocations = z
  .object({
    page_size: pageSize,
    page_token: pageToken,
  })
  .strict();

export const shopifyListInventoryLevels = z
  .object({
    location_id: z.string().min(1),
    page_size: pageSize,
    page_token: pageToken,
  })
  .strict();

/** Shopify inventory write — dry_run defaults true; live needs confirm_phrase with shop domain. */
export const shopifyAdjustInventory = z
  .object({
    inventory_item_id: z.string().min(1),
    location_id: z.string().min(1),
    delta: z.number().int(),
    reason: z.enum(["correction", "restock", "shrinkage", "received", "damaged", "other"]).optional(),
    quantity_name: z.enum(["available", "on_hand"]).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

const shopifyCatalogType = z.enum(["APP", "COMPANY_LOCATION", "MARKET", "NONE"]).optional();

export const shopifyListPublications = z
  .object({
    page_size: pageSize,
    page_token: pageToken,
    catalog_type: shopifyCatalogType,
  })
  .strict();

export const shopifyListCatalogs = z
  .object({
    page_size: pageSize,
    page_token: pageToken,
    catalog_type: shopifyCatalogType,
    type: shopifyCatalogType,
  })
  .strict();

export const shopifyListProductFeeds = z
  .object({
    page_size: pageSize,
    page_token: pageToken,
  })
  .strict();

const shopifyProductSetOptionValue = z
  .object({
    option_name: z.string().min(1).max(255),
    name: z.string().min(1).max(255),
  })
  .strict();

const shopifyProductSetVariant = z
  .object({
    variant_id: z.string().min(1).optional(),
    sku: z.string().min(1).max(255).optional(),
    price: z.union([z.string().min(1), z.number()]).optional(),
    compare_at_price: z.union([z.string().min(1), z.number()]).optional(),
    barcode: z.string().min(1).max(255).optional(),
    option_values: z.array(shopifyProductSetOptionValue).min(1).max(3),
  })
  .strict();

const shopifyProductSetOption = z
  .object({
    name: z.string().min(1).max(255),
    values: z.array(z.string().min(1).max(255)).min(1).max(50),
  })
  .strict();

/** Allowlisted productSet — dry_run default true; live confirm must include shop domain. */
export const shopifyProductSet = z
  .object({
    product_id: z.string().min(1).optional(),
    handle: z.string().min(1).max(255).optional(),
    title: z.string().min(1).max(255).optional(),
    status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional(),
    description_html: z.string().min(1).max(20_000).optional(),
    vendor: z.string().min(1).max(255).optional(),
    product_type: z.string().min(1).max(255).optional(),
    tags: z.array(z.string().min(1).max(255)).max(50).optional(),
    product_options: z.array(shopifyProductSetOption).max(3).optional(),
    variants: z.array(shopifyProductSetVariant).min(1).max(50).optional(),
    synchronous: z.boolean().optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
    confirm: z.string().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.dry_run === false) {
      const phrase = (val.confirm_phrase ?? val.confirm ?? "").trim();
      if (!phrase) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "confirm_phrase (or confirm) is required when dry_run is false",
          path: ["confirm_phrase"],
        });
      }
    }
    if (!val.product_id && !val.handle && !val.title) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "title (create) or product_id / handle (update) is required",
        path: ["title"],
      });
    }
  });

/** TikTok Ads — Polar `tiktok` + stamp hop. App secret never in this plugin. */
export const tiktokListAdvertisers = emptyInput;

export const tiktokListCampaigns = z
  .object({
    advertiser_id: z.string().min(1),
    page_size: pageSize,
  })
  .strict();

export const tiktokInsights = z
  .object({
    advertiser_id: z.string().min(1),
    level: z.enum(["advertiser", "campaign", "adgroup", "ad"]).optional(),
    date_start: z.string().min(1),
    date_stop: z.string().min(1),
    page_size: pageSize,
  })
  .strict();

export const tiktokUpdateCampaign = z
  .object({
    advertiser_id: z.string().min(1),
    campaign_id: z.string().min(1),
    status: z.enum(["ENABLE", "DISABLE", "ACTIVE", "PAUSED"]),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

/** Consent G / Consent A GA4 Admin Wave 11 — dry_run defaults true on writes. */
export const ga4ListGoogleAdsLinks = propertyPage;

export const ga4CreateGoogleAdsLink = z
  .object({
    property_id: str,
    customer_id: str,
    ads_personalization_enabled: z.boolean().optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const ga4DeleteGoogleAdsLink = z
  .object({
    property_id: str,
    ads_link_id: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const ga4GetAttributionSettings = propertyId;

export const ga4UpdateAttributionSettings = z
  .object({
    property_id: str,
    reporting_attribution_model: z
      .enum([
        "PAID_AND_ORGANIC_CHANNELS_DATA_DRIVEN",
        "PAID_AND_ORGANIC_CHANNELS_LAST_CLICK",
        "GOOGLE_PAID_CHANNELS_LAST_CLICK",
      ])
      .optional(),
    acquisition_lookback: z
      .enum([
        "ACQUISITION_CONVERSION_EVENT_LOOKBACK_WINDOW_7_DAYS",
        "ACQUISITION_CONVERSION_EVENT_LOOKBACK_WINDOW_30_DAYS",
        "ACQUISITION_CONVERSION_EVENT_LOOKBACK_WINDOW_90_DAYS",
      ])
      .optional(),
    other_lookback: z
      .enum([
        "OTHER_CONVERSION_EVENT_LOOKBACK_WINDOW_30_DAYS",
        "OTHER_CONVERSION_EVENT_LOOKBACK_WINDOW_60_DAYS",
        "OTHER_CONVERSION_EVENT_LOOKBACK_WINDOW_90_DAYS",
      ])
      .optional(),
    ads_web_conversion_data_export_scope: z
      .enum(["NOT_SELECTED_YET", "PAID_AND_ORGANIC_CHANNELS", "GOOGLE_PAID_CHANNELS"])
      .optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const ga4CreateDataStream = z
  .object({
    property_id: str,
    display_name: str,
    default_uri: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const ga4UpdateDataStream = z
  .object({
    property_id: str,
    stream_id: str,
    display_name: str,
    default_uri: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const ga4CreateKeyEvent = z
  .object({
    property_id: str,
    event_name: str,
    counting_method: z.enum(["ONCE_PER_EVENT", "ONCE_PER_SESSION"]).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const ga4UpdateKeyEvent = z
  .object({
    property_id: str,
    key_event_id: str,
    counting_method: z.enum(["ONCE_PER_EVENT", "ONCE_PER_SESSION"]),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const ga4CreateCustomDimension = z
  .object({
    property_id: str,
    parameter_name: str,
    display_name: str,
    scope: z.enum(["EVENT", "USER", "ITEM"]),
    description: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const ga4CreateCustomMetric = z
  .object({
    property_id: str,
    parameter_name: str,
    display_name: str,
    measurement_unit: z
      .enum([
        "STANDARD",
        "CURRENCY",
        "FEET",
        "METERS",
        "KILOMETERS",
        "MILES",
        "MILLISECONDS",
        "SECONDS",
        "MINUTES",
        "HOURS",
      ])
      .optional(),
    description: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const ga4ListMpSecrets = z
  .object({
    property_id: str,
    stream_id: str,
    page_size: pageSize,
    page_token: pageToken,
  })
  .strict();

export const ga4CreateMpSecret = z
  .object({
    property_id: str,
    stream_id: str,
    display_name: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

export const ga4CreateProperty = z
  .object({
    account_id: str,
    display_name: str,
    time_zone: str,
    currency_code: str,
    industry_category: str,
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireConfirmWhenLive);

