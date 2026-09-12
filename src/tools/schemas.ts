import { z } from "zod";

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

/** Create ad set — geo from countries only; spend-cap on budget cents. */
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
    countries: z.union([z.array(z.string().min(2).max(2)), z.string().min(2)]),
    end_time: z.string().min(10).optional(),
    dry_run: z.boolean().default(true),
    confirm_phrase: z.string().optional(),
  })
  .strict()
  .superRefine(requireMetaCreateAdsetBudget);

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

