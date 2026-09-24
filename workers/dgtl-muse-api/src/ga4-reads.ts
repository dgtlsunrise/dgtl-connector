import type { ReadCtx } from "./reads";
import { json } from "./http";
import { ADMIN_ORIGIN, DATA_ORIGIN, googleObject, readAccess, withQuery } from "./google";
import { EMPTY_LIST_HINT, listBody, readPage } from "./paging";
import {
  arrayField,
  extraKeys,
  invalidRequest,
  isRecord,
  readInt,
  readJsonObject,
  readNames,
  requireDigits,
  stringField,
  unsupportedDimension,
  unsupportedField,
} from "./validate";

const REPORT_FIELDS = [
  "date_ranges",
  "metrics",
  "dimensions",
  "key_event_names",
  "limit",
  "offset",
  "keep_empty_rows",
  "currency_code",
  "allow_long_range",
] as const;

const OMITTED_REPORT_FIELDS = ["recipe", "dimension_filter", "metric_filter", "order_bys"] as const;

const SEARCH_QUERY_DENY = new Set(["searchquery", "query", "searchterm", "keyword"]);
const GCLID_DENY = new Set(["gclid", "sessiongclid", "firstusergclid", "googleadsgclid"]);
const ADS_TEXT_DENY = new Set([
  "sessiongoogleadskeyword",
  "sessiongoogleadsquery",
  "googleadskeyword",
  "googleadsquery",
  "firstusergoogleadskeyword",
  "firstusergoogleadsquery",
]);

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

type CompiledRange = { readonly startDate: string; readonly endDate: string };

function denyGa4Names(names: readonly string[]): Response | null {
  for (const raw of names) {
    const key = raw.trim().toLowerCase();
    if (SEARCH_QUERY_DENY.has(key)) {
      return unsupportedDimension(
        "GA4 reports do not accept search query dimensions. Use POST /v1/gsc/search-analytics.",
      );
    }
    if (GCLID_DENY.has(key) || key.endsWith("gclid")) {
      return unsupportedDimension("gclid is not a GA4 dimension.");
    }
    if (ADS_TEXT_DENY.has(key)) {
      return unsupportedDimension(
        "GA4 Ads keyword and query text dimensions are not accepted on this report path.",
      );
    }
  }
  return null;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseGa4Date(raw: string, now: Date): Date | null {
  const value = raw.trim();
  if (value === "today") {
    return startOfUtcDay(now);
  }
  if (value === "yesterday") {
    const date = startOfUtcDay(now);
    date.setUTCDate(date.getUTCDate() - 1);
    return date;
  }
  const ago = /^(\d+)daysAgo$/i.exec(value);
  if (ago !== null) {
    const days = ago[1];
    if (days === undefined) {
      return null;
    }
    const date = startOfUtcDay(now);
    date.setUTCDate(date.getUTCDate() - Number(days));
    return date;
  }
  const match = YMD.exec(value);
  if (match === null) {
    return null;
  }
  const year = match[1];
  const month = match[2];
  const day = match[3];
  if (year === undefined || month === undefined || day === undefined) {
    return null;
  }
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function inclusiveDays(start: Date, end: Date): number {
  const ms = startOfUtcDay(end).getTime() - startOfUtcDay(start).getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

async function adminList(
  token: string,
  url: URL,
  googleUrl: string,
  googleKey: string,
  responseKey: string,
  fallbackKey?: string,
): Promise<Response> {
  const page = readPage(url);
  if (page instanceof Response) {
    return page;
  }
  const got = await googleObject(
    "ga4",
    token,
    withQuery(googleUrl, { pageSize: page.pageSize, pageToken: page.pageToken }),
    { method: "GET" },
  );
  switch (got.kind) {
    case "response":
      return got.response;
    case "record": {
      const primary = arrayField(got.record, googleKey);
      const items = primary.length > 0 || fallbackKey === undefined ? primary : arrayField(got.record, fallbackKey);
      const hint = items.length === 0 ? EMPTY_LIST_HINT : undefined;
      return json(listBody(responseKey, items, stringField(got.record, "nextPageToken"), hint), 200);
    }
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}

export async function listGa4Accounts(ctx: ReadCtx): Promise<Response> {
  const page = readPage(ctx.url);
  if (page instanceof Response) {
    return page;
  }
  const token = await readAccess(ctx.grant, ctx.env, "ga4");
  if (token instanceof Response) {
    return token;
  }
  return adminList(token, ctx.url, `${ADMIN_ORIGIN}/v1beta/accounts`, "accounts", "accounts");
}

export async function listGa4AccountSummaries(ctx: ReadCtx): Promise<Response> {
  const page = readPage(ctx.url);
  if (page instanceof Response) {
    return page;
  }
  const token = await readAccess(ctx.grant, ctx.env, "ga4");
  if (token instanceof Response) {
    return token;
  }
  return adminList(
    token,
    ctx.url,
    `${ADMIN_ORIGIN}/v1beta/accountSummaries`,
    "accountSummaries",
    "account_summaries",
  );
}

export async function listGa4Properties(ctx: ReadCtx): Promise<Response> {
  const accountId = requireDigits(ctx.params[0], "account_id");
  if (accountId instanceof Response) {
    return accountId;
  }
  const page = readPage(ctx.url);
  if (page instanceof Response) {
    return page;
  }
  const token = await readAccess(ctx.grant, ctx.env, "ga4");
  if (token instanceof Response) {
    return token;
  }
  const got = await googleObject(
    "ga4",
    token,
    withQuery(`${ADMIN_ORIGIN}/v1beta/properties`, {
      filter: `parent:accounts/${accountId}`,
      pageSize: page.pageSize,
      pageToken: page.pageToken,
    }),
    { method: "GET" },
  );
  switch (got.kind) {
    case "response":
      return got.response;
    case "record": {
      const properties = arrayField(got.record, "properties");
      const hint = properties.length === 0 ? EMPTY_LIST_HINT : undefined;
      return json(
        listBody("properties", properties, stringField(got.record, "nextPageToken"), hint, {
          account_id: accountId,
        }),
        200,
      );
    }
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}

export async function getGa4Property(ctx: ReadCtx): Promise<Response> {
  const propertyId = requireDigits(ctx.params[0], "property_id");
  if (propertyId instanceof Response) {
    return propertyId;
  }
  const token = await readAccess(ctx.grant, ctx.env, "ga4");
  if (token instanceof Response) {
    return token;
  }
  const got = await googleObject(
    "ga4",
    token,
    `${ADMIN_ORIGIN}/v1beta/properties/${propertyId}`,
    { method: "GET" },
  );
  switch (got.kind) {
    case "response":
      return got.response;
    case "record":
      return json({ property_id: propertyId, resource: got.record }, 200);
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}

export async function listGa4DataStreams(ctx: ReadCtx): Promise<Response> {
  const propertyId = requireDigits(ctx.params[0], "property_id");
  if (propertyId instanceof Response) {
    return propertyId;
  }
  const token = await readAccess(ctx.grant, ctx.env, "ga4");
  if (token instanceof Response) {
    return token;
  }
  return adminList(
    token,
    ctx.url,
    `${ADMIN_ORIGIN}/v1beta/properties/${propertyId}/dataStreams`,
    "dataStreams",
    "data_streams",
  );
}

export async function listGa4KeyEvents(ctx: ReadCtx): Promise<Response> {
  const propertyId = requireDigits(ctx.params[0], "property_id");
  if (propertyId instanceof Response) {
    return propertyId;
  }
  const token = await readAccess(ctx.grant, ctx.env, "ga4");
  if (token instanceof Response) {
    return token;
  }
  return adminList(
    token,
    ctx.url,
    `${ADMIN_ORIGIN}/v1beta/properties/${propertyId}/keyEvents`,
    "keyEvents",
    "key_events",
    "conversionEvents",
  );
}

function filterMetadata(items: unknown[], query: string | undefined, customOnly: boolean): unknown[] {
  const needle = query?.trim().toLowerCase() ?? "";
  return items.filter((item) => {
    if (!isRecord(item)) {
      return false;
    }
    if (customOnly && item["customDefinition"] !== true) {
      return false;
    }
    if (needle.length === 0) {
      return true;
    }
    const hay = [item["apiName"], item["uiName"], item["description"]]
      .filter((value) => typeof value === "string")
      .join(" ")
      .toLowerCase();
    return hay.includes(needle);
  });
}

export async function getGa4Metadata(ctx: ReadCtx): Promise<Response> {
  const propertyId = requireDigits(ctx.params[0], "property_id");
  if (propertyId instanceof Response) {
    return propertyId;
  }
  const kindRaw = ctx.url.searchParams.get("kind") ?? "all";
  if (kindRaw !== "dimension" && kindRaw !== "metric" && kindRaw !== "all") {
    return invalidRequest('kind must be "dimension", "metric", or "all".');
  }
  const queryRaw = ctx.url.searchParams.get("query");
  if (queryRaw !== null && (queryRaw.length === 0 || queryRaw.length > 120)) {
    return invalidRequest("query must be 1–120 characters.");
  }
  const customRaw = ctx.url.searchParams.get("custom_only");
  if (customRaw !== null && customRaw !== "true" && customRaw !== "false") {
    return invalidRequest("custom_only must be true or false.");
  }
  const token = await readAccess(ctx.grant, ctx.env, "ga4");
  if (token instanceof Response) {
    return token;
  }
  const got = await googleObject(
    "ga4",
    token,
    `${DATA_ORIGIN}/v1beta/properties/${propertyId}/metadata`,
    { method: "GET" },
  );
  switch (got.kind) {
    case "response":
      return got.response;
    case "record": {
      const customOnly = customRaw === "true";
      const query = queryRaw ?? undefined;
      const dimensions =
        kindRaw === "metric" ? [] : filterMetadata(arrayField(got.record, "dimensions"), query, customOnly);
      const metrics =
        kindRaw === "dimension" ? [] : filterMetadata(arrayField(got.record, "metrics"), query, customOnly);
      return json(
        {
          property_id: propertyId,
          name: stringField(got.record, "name") ?? `properties/${propertyId}/metadata`,
          kind: kindRaw,
          query: query ?? null,
          custom_only: customOnly,
          dimension_count: dimensions.length,
          metric_count: metrics.length,
          dimensions,
          metrics,
        },
        200,
      );
    }
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}

function compileRanges(
  value: unknown,
  allowLong: boolean,
  now: Date,
): CompiledRange[] | Response {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    return invalidRequest("date_ranges must have 1 or 2 {start_date, end_date} objects.");
  }
  const compiled: CompiledRange[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const row = value[index];
    if (!isRecord(row)) {
      return invalidRequest(`date_ranges[${index}] must be an object.`);
    }
    const unknown = extraKeys(row, ["start_date", "end_date"]);
    if (unknown.length > 0) {
      return unsupportedField(`date_ranges[${index}] does not accept ${unknown.join(", ")}.`);
    }
    const start = row["start_date"];
    const end = row["end_date"];
    if (typeof start !== "string" || typeof end !== "string" || start.length === 0 || end.length === 0) {
      return invalidRequest(`date_ranges[${index}] requires start_date and end_date.`);
    }
    const startDate = parseGa4Date(start, now);
    const endDate = parseGa4Date(end, now);
    if (startDate === null || endDate === null) {
      return invalidRequest("Dates must be YYYY-MM-DD, today, yesterday, or NdaysAgo.");
    }
    if (endDate.getTime() < startDate.getTime()) {
      return invalidRequest("end_date is before start_date.");
    }
    if (inclusiveDays(startDate, endDate) > 366 && !allowLong) {
      return invalidRequest("Date range is longer than 366 days. Pass allow_long_range true to send it.");
    }
    compiled.push({ startDate: start, endDate: end });
  }
  return compiled;
}

export async function runGa4Report(ctx: ReadCtx): Promise<Response> {
  const propertyId = requireDigits(ctx.params[0], "property_id");
  if (propertyId instanceof Response) {
    return propertyId;
  }
  const body = await readJsonObject(ctx.request);
  if (body instanceof Response) {
    return body;
  }
  const unknown = extraKeys(body, REPORT_FIELDS);
  if (unknown.length > 0) {
    const omitted = unknown.filter((key) => (OMITTED_REPORT_FIELDS as readonly string[]).includes(key));
    if (omitted.length > 0) {
      return unsupportedField(
        `This report path does not accept ${omitted.join(", ")}. Pass metrics and dimensions directly.`,
      );
    }
    return unsupportedField(`This report path does not accept ${unknown.join(", ")}.`);
  }
  const allowLong = body["allow_long_range"];
  if (allowLong !== undefined && typeof allowLong !== "boolean") {
    return invalidRequest("allow_long_range must be a boolean.");
  }
  const ranges = compileRanges(body["date_ranges"], allowLong === true, new Date());
  if (ranges instanceof Response) {
    return ranges;
  }
  const metricsResult = readNames(body["metrics"], "metrics", 10);
  if (metricsResult instanceof Response) {
    return metricsResult;
  }
  const keyEvents = readNames(body["key_event_names"], "key_event_names", 10);
  if (keyEvents instanceof Response) {
    return keyEvents;
  }
  if (keyEvents.some((name) => !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(name))) {
    return invalidRequest("key_event_names must be event names.");
  }
  const metrics = [...metricsResult];
  for (const name of keyEvents) {
    const metric = `keyEvents:${name}`;
    if (!metrics.includes(metric)) {
      metrics.push(metric);
    }
  }
  if (metrics.length < 1 || metrics.length > 10) {
    return invalidRequest("metrics and key_event_names together must name 1–10 metrics.");
  }
  const dimensions = readNames(body["dimensions"], "dimensions", 9);
  if (dimensions instanceof Response) {
    return dimensions;
  }
  const denied = denyGa4Names([...metrics, ...dimensions]);
  if (denied !== null) {
    return denied;
  }
  const limit = readInt(body["limit"], "limit", 50, 1, 1000);
  if (limit instanceof Response) {
    return limit;
  }
  const offset = readInt(body["offset"], "offset", 0, 0, 1_000_000);
  if (offset instanceof Response) {
    return offset;
  }
  const keepEmpty = body["keep_empty_rows"];
  if (keepEmpty !== undefined && typeof keepEmpty !== "boolean") {
    return invalidRequest("keep_empty_rows must be a boolean.");
  }
  const currency = body["currency_code"];
  if (currency !== undefined && (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))) {
    return invalidRequest("currency_code must be a 3-letter ISO code.");
  }
  const reportBody: Record<string, unknown> = {
    dateRanges: ranges,
    metrics: metrics.map((name) => ({ name })),
    dimensions: dimensions.map((name) => ({ name })),
    limit,
    offset,
    keepEmptyRows: keepEmpty === true,
    returnPropertyQuota: true,
  };
  if (typeof currency === "string") {
    reportBody["currencyCode"] = currency;
  }
  const token = await readAccess(ctx.grant, ctx.env, "ga4");
  if (token instanceof Response) {
    return token;
  }
  const got = await googleObject(
    "ga4",
    token,
    `${DATA_ORIGIN}/v1beta/properties/${propertyId}:runReport`,
    { method: "POST", body: reportBody },
  );
  switch (got.kind) {
    case "response":
      return got.response;
    case "record":
      return json(
        {
          ...got.record,
          property_id: propertyId,
          cited: {
            property_id: `properties/${propertyId}`,
            date_ranges: ranges,
            metrics,
            dimensions,
            limit,
            offset,
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
