import type { AppContext } from "../context.js";
import { HINT_EMPTY_LIST, HINT_EMPTY_ROWS, okEnvelope, pageFromList, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import { asInt, encodeSiteUrl, requireId } from "../ids.js";
import { APIS, SCOPE } from "./scopes.js";
import { describeGscSchema, GSC_DIMENSION_NAMES } from "./gsc-schema.js";
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

/** Surendran-style exactness notes for NOT_FOUND / empty paths. */
export function siteUrlHint(siteUrl: string): string {
  return (
    `site_url=${JSON.stringify(siteUrl)}. Copy the exact property from gsc_list_sites. ` +
    "URL-prefix properties need the trailing slash; sc-domain:example.com is not the same as https://example.com/."
  );
}

function assertGscDimensions(dims: unknown): string[] {
  if (dims === undefined || dims === null) return [];
  if (!Array.isArray(dims)) {
    throw new ToolError("INVALID_ARGUMENT", "dimensions must be an array of api_name strings", {
      hint: "Call gsc_describe_schema for valid dimension names.",
    });
  }
  const out: string[] = [];
  for (const d of dims) {
    const name = String(d);
    if (!GSC_DIMENSION_NAMES.has(name)) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        `Invalid GSC dimension '${name}'. Valid: ${[...GSC_DIMENSION_NAMES].join(", ")}`,
        {
          hint: "Call gsc_describe_schema before querying. Do not invent dimension names.",
        },
      );
    }
    out.push(name);
  }
  return out;
}

export async function gscDescribeSchema(_ctx: AppContext, _args: Rec): Promise<Envelope> {
  const schema = describeGscSchema();
  return okEnvelope("gsc_describe_schema", {
    data: schema,
    page: { row_count: schema.dimensions.length + schema.metrics.length, truncated: false },
    hint: "Local catalog (no Google call). Use these api_name values in gsc_query_search_analytics. Cite exact site_url from gsc_list_sites.",
  });
}

export async function gscListSites(ctx: AppContext, args: Rec): Promise<Envelope> {
  const raw = (await ctx.http.get(HOST, "/webmasters/v3/sites", undefined, meta("gsc_list_sites"))) as Rec;
  const all = Array.isArray(raw.siteEntry) ? raw.siteEntry : [];
  const pageSize = asInt(args.page_size, 50, 1, 200);
  const { items, next, total } = slicePage(all, pageSize, typeof args.page_token === "string" ? args.page_token : undefined);
  return okEnvelope("gsc_list_sites", {
    data: { site_entry: items },
    page: pageFromList(items, total, next),
    ...(total === 0
      ? { hint: HINT_EMPTY_LIST }
      : {
          hint: "Use siteUrl values exactly as returned (trailing slash / sc-domain). Do not coerce property types.",
        }),
  });
}

export async function gscGetSite(ctx: AppContext, args: Rec): Promise<Envelope> {
  const siteUrl = requireId(args.site_url, "site_url");
  try {
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
  } catch (err) {
    if (err instanceof ToolError && err.error_code === "NOT_FOUND") {
      throw new ToolError("NOT_FOUND", MSG.NOT_FOUND, {
        ...err.extra,
        resource_id: siteUrl,
        hint: siteUrlHint(siteUrl),
      });
    }
    throw err;
  }
}

export async function gscQuerySearchAnalytics(ctx: AppContext, args: Rec): Promise<Envelope> {
  const siteUrl = requireId(args.site_url, "site_url");
  const start = requireId(args.start_date, "start_date");
  const end = requireId(args.end_date, "end_date");
  const dimensions = assertGscDimensions(args.dimensions);
  const rowLimit = asInt(args.row_limit, 50, 1, 1000);
  const startRow = asInt(args.start_row, 0, 0, 1_000_000);
  const dataState = typeof args.data_state === "string" ? args.data_state : "final";
  const body: Rec = {
    startDate: start,
    endDate: end,
    rowLimit,
    startRow,
    dataState,
  };
  if (dimensions.length) body.dimensions = dimensions;
  if (args.search_type) body.type = args.search_type;
  if (args.aggregation_type) body.aggregationType = args.aggregation_type;
  if (args.dimension_filter_groups) body.dimensionFilterGroups = args.dimension_filter_groups;

  let raw: Rec;
  try {
    raw = (await ctx.http.post(
      HOST,
      `/webmasters/v3/sites/${encodeSiteUrl(siteUrl)}/searchAnalytics/query`,
      body,
      meta("gsc_query_search_analytics"),
    )) as Rec;
  } catch (err) {
    if (err instanceof ToolError && err.error_code === "NOT_FOUND") {
      throw new ToolError("NOT_FOUND", MSG.NOT_FOUND, {
        ...err.extra,
        resource_id: siteUrl,
        hint: siteUrlHint(siteUrl),
      });
    }
    throw err;
  }
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  const truncated = rows.length === rowLimit;
  const emptyHint =
    `No rows for site_url=${JSON.stringify(siteUrl)} dates=${start}..${end} data_state=${dataState}` +
    (dimensions.length ? ` dimensions=[${dimensions.join(",")}]` : "") +
    `. ${HINT_EMPTY_ROWS} If investigating yesterday/today, retry with data_state=all.`;

  return okEnvelope("gsc_query_search_analytics", {
    resource: siteResource(siteUrl),
    data: {
      ...raw,
      cited: {
        site_url: siteUrl,
        start_date: start,
        end_date: end,
        data_state: dataState,
        dimensions,
        row_limit: rowLimit,
        start_row: startRow,
      },
    },
    page: {
      row_count: rows.length,
      truncated,
      ...(truncated ? { next_page_token: String(startRow + rows.length) } : {}),
    },
    ...(rows.length === 0 ? { hint: emptyHint } : {}),
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
    data: { ...(raw as Rec), cited: { site_url: siteUrl, inspection_url: inspectionUrl } },
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
    ...(total === 0 ? { hint: HINT_EMPTY_LIST } : {}),
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
