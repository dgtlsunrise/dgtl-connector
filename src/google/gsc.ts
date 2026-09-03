import type { AppContext } from "../context.js";
import { okEnvelope, pageFromList, type Envelope } from "../envelope.js";
import { asInt, encodeSiteUrl, requireId } from "../ids.js";
import { APIS, SCOPE } from "./scopes.js";
import { slicePage } from "../tools/dates.js";

const HOST = APIS.searchconsole;
const scope = SCOPE.webmasters;
type Rec = Record<string, unknown>;

function meta(tool: string) {
  return { api: HOST, requiredScope: scope, tool };
}

function siteResource(siteUrl: string) {
  return { type: "gsc_site", id: siteUrl, display_name: siteUrl };
}

export async function gscListSites(ctx: AppContext, args: Rec): Promise<Envelope> {
  const raw = (await ctx.http.get(HOST, "/webmasters/v3/sites", undefined, meta("gsc_list_sites"))) as Rec;
  const all = Array.isArray(raw.siteEntry) ? raw.siteEntry : [];
  const pageSize = asInt(args.page_size, 50, 1, 200);
  const { items, next, total } = slicePage(all, pageSize, typeof args.page_token === "string" ? args.page_token : undefined);
  return okEnvelope("gsc_list_sites", {
    data: { site_entry: items },
    page: pageFromList(items, total, next),
  });
}

export async function gscGetSite(ctx: AppContext, args: Rec): Promise<Envelope> {
  const siteUrl = requireId(args.site_url, "site_url");
  const raw = await ctx.http.get(
    HOST,
    `/webmasters/v3/sites/${encodeSiteUrl(siteUrl)}`,
    undefined,
    meta("gsc_get_site"),
  );
  return okEnvelope("gsc_get_site", {
    resource: siteResource(siteUrl),
    data: raw,
  });
}

export async function gscQuerySearchAnalytics(ctx: AppContext, args: Rec): Promise<Envelope> {
  const siteUrl = requireId(args.site_url, "site_url");
  const start = requireId(args.start_date, "start_date");
  const end = requireId(args.end_date, "end_date");
  const rowLimit = asInt(args.row_limit, 50, 1, 1000);
  const startRow = asInt(args.start_row, 0, 0, 1_000_000);
  const body: Rec = {
    startDate: start,
    endDate: end,
    rowLimit,
    startRow,
  };
  if (Array.isArray(args.dimensions)) body.dimensions = args.dimensions;
  if (args.search_type) body.type = args.search_type;
  if (args.data_state) body.dataState = args.data_state;
  else body.dataState = "final";
  if (args.aggregation_type) body.aggregationType = args.aggregation_type;
  if (args.dimension_filter_groups) body.dimensionFilterGroups = args.dimension_filter_groups;

  const raw = (await ctx.http.post(
    HOST,
    `/webmasters/v3/sites/${encodeSiteUrl(siteUrl)}/searchAnalytics/query`,
    body,
    meta("gsc_query_search_analytics"),
  )) as Rec;
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  const truncated = rows.length === rowLimit;
  return okEnvelope("gsc_query_search_analytics", {
    resource: siteResource(siteUrl),
    data: raw,
    page: {
      row_count: rows.length,
      truncated,
      ...(truncated ? { next_page_token: String(startRow + rows.length) } : {}),
    },
  });
}

export async function gscInspectUrl(ctx: AppContext, args: Rec): Promise<Envelope> {
  const siteUrl = requireId(args.site_url, "site_url");
  const inspectionUrl = requireId(args.inspection_url, "inspection_url");
  const body: Rec = {
    inspectionUrl,
    siteUrl,
    languageCode: typeof args.language_code === "string" ? args.language_code : "en-US",
  };
  const raw = await ctx.http.post(HOST, "/v1/urlInspection/index:inspect", body, meta("gsc_inspect_url"));
  return okEnvelope("gsc_inspect_url", {
    resource: siteResource(siteUrl),
    data: raw,
  });
}

export async function gscListSitemaps(ctx: AppContext, args: Rec): Promise<Envelope> {
  const siteUrl = requireId(args.site_url, "site_url");
  const query: Rec = {};
  if (typeof args.sitemap_index === "string") query.sitemapIndex = args.sitemap_index;
  const raw = (await ctx.http.get(
    HOST,
    `/webmasters/v3/sites/${encodeSiteUrl(siteUrl)}/sitemaps`,
    query as Record<string, string>,
    meta("gsc_list_sitemaps"),
  )) as Rec;
  const all = Array.isArray(raw.sitemap) ? raw.sitemap : [];
  const pageSize = asInt(args.page_size, 50, 1, 200);
  const { items, next, total } = slicePage(all, pageSize, typeof args.page_token === "string" ? args.page_token : undefined);
  return okEnvelope("gsc_list_sitemaps", {
    resource: siteResource(siteUrl),
    data: { sitemap: items },
    page: pageFromList(items, total, next),
  });
}

export async function gscGetSitemap(ctx: AppContext, args: Rec): Promise<Envelope> {
  const siteUrl = requireId(args.site_url, "site_url");
  const feedpath = requireId(args.feedpath, "feedpath");
  const raw = await ctx.http.get(
    HOST,
    `/webmasters/v3/sites/${encodeSiteUrl(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`,
    undefined,
    meta("gsc_get_sitemap"),
  );
  return okEnvelope("gsc_get_sitemap", {
    resource: siteResource(siteUrl),
    data: raw,
  });
}
