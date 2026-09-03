import { z } from "zod";

const pageSize = z.number().int().min(1).max(200).optional();
const pageToken = z.string().optional();
const str = z.string().optional();

export const emptyInput = z.object({}).strict();

export const pageInput = z.object({ page_size: pageSize, page_token: pageToken }).strict();

export const accountPage = z
  .object({ account_id: str, page_size: pageSize, page_token: pageToken })
  .strict();

export const propertyId = z.object({ property_id: str }).strict();

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
export const metaInsights = z
  .object({
    ad_account_id: str,
    level: z.enum(["account", "campaign", "adset", "ad"]).optional(),
    object_id: str,
    date_start: str,
    date_stop: str,
  })
  .strict();
export const metaCreative = z.object({ creative_id: str }).strict();
