import type { ReadCtx } from "./reads";
import { json } from "./http";
import { GSC_ORIGIN, googleObject, readAccess } from "./google";
import { EMPTY_LIST_HINT, listBody, readPage, slicePage } from "./paging";
import {
  arrayField,
  extraKeys,
  invalidRequest,
  isRecord,
  readInt,
  readJsonObject,
  unsupportedField,
} from "./validate";

const SEARCH_TYPES = ["web", "image", "video", "news", "discover", "googleNews"] as const;
const DATA_STATES = ["final", "all"] as const;
const DIMENSIONS = ["query", "page", "country", "device", "searchAppearance", "date", "hour"] as const;
const DIMENSION_SET = new Set<string>(DIMENSIONS);

const QUERY_FIELDS = [
  "site_url",
  "start_date",
  "end_date",
  "dimensions",
  "row_limit",
  "start_row",
  "search_type",
  "data_state",
  "aggregation_type",
  "dimension_filter_groups",
] as const;

const INSPECT_FIELDS = ["site_url", "inspection_url", "language_code"] as const;

type GscField = { readonly api_name: string; readonly description: string };

const GSC_DIMENSIONS: readonly GscField[] = [
  { api_name: "query", description: "The query string the user entered into Google Search." },
  { api_name: "page", description: "Canonical URL of the page that received impressions/clicks." },
  { api_name: "country", description: "Three-letter ISO 3166-1 alpha-3 country code." },
  { api_name: "device", description: "Device type: DESKTOP, MOBILE, or TABLET." },
  { api_name: "searchAppearance", description: "Search appearance type (rich results, etc.)." },
  { api_name: "date", description: "Calendar date of the query in YYYY-MM-DD." },
  { api_name: "hour", description: "Hour of day (0–23). Prefer date for longer ranges." },
];

const GSC_METRICS: readonly GscField[] = [
  { api_name: "clicks", description: "Clicks from search results to your property." },
  { api_name: "impressions", description: "Times a URL from your site appeared in search results." },
  { api_name: "ctr", description: "Click-through rate (clicks / impressions)." },
  { api_name: "position", description: "Average position in results (1 = top)." },
];

const SITE_URL_HINT =
  "Use siteUrl values exactly as returned. URL-prefix properties include the trailing slash. sc-domain:example.com is not https://example.com/.";

function siteUrlParam(url: URL): string | Response {
  const siteUrl = url.searchParams.get("site_url");
  if (siteUrl === null || siteUrl.length === 0 || siteUrl.length > 2048 || /[\u0000-\u001F\s]/.test(siteUrl)) {
    return invalidRequest("site_url is required and must be the exact Search Console property.");
  }
  return siteUrl;
}

function feedpathParam(url: URL): string | Response {
  const feedpath = url.searchParams.get("feedpath");
  if (feedpath === null || feedpath.length === 0 || feedpath.length > 2048 || /[\u0000-\u001F]/.test(feedpath)) {
    return invalidRequest("feedpath is required.");
  }
  return feedpath;
}

export function describeGscSchema(_ctx: ReadCtx): Response {
  return json(
    {
      dimensions: GSC_DIMENSIONS,
      metrics: GSC_METRICS,
      site_url_notes: [
        "Copy site_url exactly from GET /v1/gsc/sites.",
        "URL-prefix properties include the trailing slash (for example https://example.com/).",
        "Domain properties look like sc-domain:example.com and are not the same as https://example.com/.",
      ],
      data_state_notes: [
        "data_state=final is the default and often lags a couple of days.",
        "data_state=all includes fresh incomplete rows. Use it for today or yesterday.",
        "An empty row list is not an auth failure.",
      ],
    },
    200,
  );
}

export async function listGscSites(ctx: ReadCtx): Promise<Response> {
  const page = readPage(ctx.url);
  if (page instanceof Response) {
    return page;
  }
  const token = await readAccess(ctx.grant, ctx.env, "gsc");
  if (token instanceof Response) {
    return token;
  }
  const got = await googleObject("gsc", token, `${GSC_ORIGIN}/webmasters/v3/sites`, {
    method: "GET",
  });
  switch (got.kind) {
    case "response":
      return got.response;
    case "record": {
      const sliced = slicePage(arrayField(got.record, "siteEntry"), page.pageSize, page.pageToken);
      if (sliced instanceof Response) {
        return sliced;
      }
      const hint = sliced.items.length === 0 && page.pageToken === undefined ? EMPTY_LIST_HINT : SITE_URL_HINT;
      return json(listBody("site_entry", sliced.items, sliced.next, hint), 200);
    }
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}

export async function getGscSite(ctx: ReadCtx): Promise<Response> {
  const siteUrl = siteUrlParam(ctx.url);
  if (siteUrl instanceof Response) {
    return siteUrl;
  }
  const token = await readAccess(ctx.grant, ctx.env, "gsc");
  if (token instanceof Response) {
    return token;
  }
  const got = await googleObject(
    "gsc",
    token,
    `${GSC_ORIGIN}/webmasters/v3/sites/${encodeURIComponent(siteUrl)}`,
    { method: "GET" },
  );
  switch (got.kind) {
    case "response":
      return got.response;
    case "record":
      return json({ site_url: siteUrl, resource: got.record }, 200);
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}

function ymd(value: unknown, field: string): string | Response {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return invalidRequest(`${field} must be YYYY-MM-DD.`);
  }
  return value;
}

export async function queryGscSearchAnalytics(ctx: ReadCtx): Promise<Response> {
  const body = await readJsonObject(ctx.request);
  if (body instanceof Response) {
    return body;
  }
  const unknown = extraKeys(body, QUERY_FIELDS);
  if (unknown.length > 0) {
    return unsupportedField(`This search analytics path does not accept ${unknown.join(", ")}.`);
  }
  const siteUrl = body["site_url"];
  if (typeof siteUrl !== "string" || siteUrl.length === 0 || siteUrl.length > 2048 || /[\u0000-\u001F\s]/.test(siteUrl)) {
    return invalidRequest("site_url is required and must be the exact Search Console property.");
  }
  const start = ymd(body["start_date"], "start_date");
  if (start instanceof Response) {
    return start;
  }
  const end = ymd(body["end_date"], "end_date");
  if (end instanceof Response) {
    return end;
  }
  let dimensions: string[] = [];
  if (body["dimensions"] !== undefined) {
    if (!Array.isArray(body["dimensions"])) {
      return invalidRequest(`dimensions must be an array of: ${DIMENSIONS.join(", ")}.`);
    }
    for (const item of body["dimensions"]) {
      if (typeof item !== "string" || !DIMENSION_SET.has(item)) {
        return invalidRequest(`dimensions must be chosen from: ${DIMENSIONS.join(", ")}.`);
      }
      dimensions.push(item);
    }
  }
  const rowLimit = readInt(body["row_limit"], "row_limit", 50, 1, 1000);
  if (rowLimit instanceof Response) {
    return rowLimit;
  }
  const startRow = readInt(body["start_row"], "start_row", 0, 0, 1_000_000);
  if (startRow instanceof Response) {
    return startRow;
  }
  const searchType = body["search_type"];
  if (searchType !== undefined && (typeof searchType !== "string" || !(SEARCH_TYPES as readonly string[]).includes(searchType))) {
    return invalidRequest(`search_type must be one of: ${SEARCH_TYPES.join(", ")}.`);
  }
  const dataStateRaw = body["data_state"] ?? "final";
  if (typeof dataStateRaw !== "string" || !(DATA_STATES as readonly string[]).includes(dataStateRaw)) {
    return invalidRequest("data_state must be final or all.");
  }
  const aggregation = body["aggregation_type"];
  if (aggregation !== undefined && (typeof aggregation !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(aggregation))) {
    return invalidRequest("aggregation_type must be an identifier.");
  }
  const filters = body["dimension_filter_groups"];
  if (filters !== undefined) {
    if (!Array.isArray(filters) || filters.length > 8 || filters.some((item) => !isRecord(item))) {
      return invalidRequest("dimension_filter_groups must be an array of at most 8 objects.");
    }
  }
  const googleBody: Record<string, unknown> = {
    startDate: start,
    endDate: end,
    rowLimit,
    startRow,
    dataState: dataStateRaw,
  };
  if (dimensions.length > 0) {
    googleBody["dimensions"] = dimensions;
  }
  if (typeof searchType === "string") {
    googleBody["type"] = searchType;
  }
  if (typeof aggregation === "string") {
    googleBody["aggregationType"] = aggregation;
  }
  if (Array.isArray(filters)) {
    googleBody["dimensionFilterGroups"] = filters;
  }
  const token = await readAccess(ctx.grant, ctx.env, "gsc");
  if (token instanceof Response) {
    return token;
  }
  const got = await googleObject(
    "gsc",
    token,
    `${GSC_ORIGIN}/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    { method: "POST", body: googleBody },
  );
  switch (got.kind) {
    case "response":
      return got.response;
    case "record":
      return json(
        {
          ...got.record,
          site_url: siteUrl,
          cited: {
            site_url: siteUrl,
            start_date: start,
            end_date: end,
            data_state: dataStateRaw,
            dimensions,
            row_limit: rowLimit,
            start_row: startRow,
          },
        },
        200,
      );
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}

export async function inspectGscUrl(ctx: ReadCtx): Promise<Response> {
  const body = await readJsonObject(ctx.request);
  if (body instanceof Response) {
    return body;
  }
  const unknown = extraKeys(body, INSPECT_FIELDS);
  if (unknown.length > 0) {
    return unsupportedField(`This URL inspection path does not accept ${unknown.join(", ")}.`);
  }
  const siteUrl = body["site_url"];
  const inspectionUrl = body["inspection_url"];
  if (typeof siteUrl !== "string" || siteUrl.length === 0 || siteUrl.length > 2048) {
    return invalidRequest("site_url is required.");
  }
  if (typeof inspectionUrl !== "string" || inspectionUrl.length === 0 || inspectionUrl.length > 2048) {
    return invalidRequest("inspection_url is required.");
  }
  const language = body["language_code"] ?? "en-US";
  if (typeof language !== "string" || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language)) {
    return invalidRequest("language_code must be a BCP 47 language tag.");
  }
  const token = await readAccess(ctx.grant, ctx.env, "gsc");
  if (token instanceof Response) {
    return token;
  }
  const got = await googleObject("gsc", token, `${GSC_ORIGIN}/v1/urlInspection/index:inspect`, {
    method: "POST",
    body: { inspectionUrl, siteUrl, languageCode: language },
  });
  switch (got.kind) {
    case "response":
      return got.response;
    case "record":
      return json(
        {
          ...got.record,
          cited: { site_url: siteUrl, inspection_url: inspectionUrl },
        },
        200,
      );
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}

export async function listGscSitemaps(ctx: ReadCtx): Promise<Response> {
  const siteUrl = siteUrlParam(ctx.url);
  if (siteUrl instanceof Response) {
    return siteUrl;
  }
  const page = readPage(ctx.url);
  if (page instanceof Response) {
    return page;
  }
  const sitemapIndex = ctx.url.searchParams.get("sitemap_index");
  if (sitemapIndex !== null && (sitemapIndex.length === 0 || sitemapIndex.length > 2048)) {
    return invalidRequest("sitemap_index is not valid.");
  }
  const url = new URL(`${GSC_ORIGIN}/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`);
  if (sitemapIndex !== null) {
    url.searchParams.set("sitemapIndex", sitemapIndex);
  }
  const token = await readAccess(ctx.grant, ctx.env, "gsc");
  if (token instanceof Response) {
    return token;
  }
  const got = await googleObject("gsc", token, url.toString(), { method: "GET" });
  switch (got.kind) {
    case "response":
      return got.response;
    case "record": {
      const sliced = slicePage(arrayField(got.record, "sitemap"), page.pageSize, page.pageToken);
      if (sliced instanceof Response) {
        return sliced;
      }
      const hint = sliced.items.length === 0 && page.pageToken === undefined ? EMPTY_LIST_HINT : undefined;
      return json(
        listBody("sitemap", sliced.items, sliced.next, hint, { site_url: siteUrl }),
        200,
      );
    }
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}

export async function getGscSitemap(ctx: ReadCtx): Promise<Response> {
  const siteUrl = siteUrlParam(ctx.url);
  if (siteUrl instanceof Response) {
    return siteUrl;
  }
  const feedpath = feedpathParam(ctx.url);
  if (feedpath instanceof Response) {
    return feedpath;
  }
  const token = await readAccess(ctx.grant, ctx.env, "gsc");
  if (token instanceof Response) {
    return token;
  }
  const got = await googleObject(
    "gsc",
    token,
    `${GSC_ORIGIN}/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`,
    { method: "GET" },
  );
  switch (got.kind) {
    case "response":
      return got.response;
    case "record":
      return json({ site_url: siteUrl, feedpath, resource: got.record }, 200);
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}
