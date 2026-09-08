import type { AppContext } from "../context.js";
import { HINT_EMPTY_LIST, HINT_EMPTY_ROWS, okEnvelope, pageFromList, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import { asInt, normalizeGa4Account, normalizeGa4Property, requireId } from "../ids.js";
import { denySearchQueryDimensions } from "../tools/denylist.js";
import { capDateRange } from "../tools/dates.js";
import { compileFilterExpression, compileOrderBys } from "../tools/filters.js";
import { APIS, SCOPE } from "./scopes.js";
import { slicePage } from "../tools/dates.js";

const ADMIN = APIS.admin;
const DATA = APIS.data;
const scope = SCOPE.analytics;

function meta(tool: string) {
  return { api: ADMIN, requiredScope: scope, tool };
}
function dataMeta(tool: string) {
  return { api: DATA, requiredScope: scope, tool };
}

type Rec = Record<string, unknown>;

export async function ga4ListAccounts(ctx: AppContext, args: Rec): Promise<Envelope> {
  const pageSize = asInt(args.page_size, 50, 1, 200);
  const raw = (await ctx.http.get(ADMIN, "/v1beta/accounts", {
    pageSize,
    pageToken: typeof args.page_token === "string" ? args.page_token : undefined,
  }, meta("ga4_list_accounts"))) as Rec;
  const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  return okEnvelope("ga4_list_accounts", {
    data: { accounts },
    page: pageFromList(accounts, accounts.length, typeof raw.nextPageToken === "string" ? raw.nextPageToken : undefined),
    ...(accounts.length === 0 ? { hint: HINT_EMPTY_LIST } : {}),
  });
}

export async function ga4ListAccountSummaries(ctx: AppContext, args: Rec): Promise<Envelope> {
  const pageSize = asInt(args.page_size, 50, 1, 200);
  const raw = (await ctx.http.get(ADMIN, "/v1beta/accountSummaries", {
    pageSize,
    pageToken: typeof args.page_token === "string" ? args.page_token : undefined,
  }, meta("ga4_list_account_summaries"))) as Rec;
  const summaries = Array.isArray(raw.accountSummaries) ? raw.accountSummaries : [];
  return okEnvelope("ga4_list_account_summaries", {
    data: { account_summaries: summaries },
    page: pageFromList(
      summaries,
      summaries.length,
      typeof raw.nextPageToken === "string" ? raw.nextPageToken : undefined,
    ),
    ...(summaries.length === 0 ? { hint: HINT_EMPTY_LIST } : {}),
  });
}

export async function ga4ListProperties(ctx: AppContext, args: Rec): Promise<Envelope> {
  const account = normalizeGa4Account(requireId(args.account_id, "account_id"));
  const pageSize = asInt(args.page_size, 50, 1, 200);
  const raw = (await ctx.http.get(ADMIN, "/v1beta/properties", {
    filter: `parent:${account.name}`,
    pageSize,
    pageToken: typeof args.page_token === "string" ? args.page_token : undefined,
  }, meta("ga4_list_properties"))) as Rec;
  const properties = Array.isArray(raw.properties) ? raw.properties : [];
  return okEnvelope("ga4_list_properties", {
    resource: { type: "ga4_account", id: account.name, display_name: account.name },
    data: { properties },
    page: pageFromList(properties, properties.length, typeof raw.nextPageToken === "string" ? raw.nextPageToken : undefined),
    ...(properties.length === 0 ? { hint: HINT_EMPTY_LIST } : {}),
  });
}

export async function ga4GetProperty(ctx: AppContext, args: Rec): Promise<Envelope> {
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  const raw = (await ctx.http.get(ADMIN, `/v1beta/${prop.name}`, undefined, meta("ga4_get_property"))) as Rec;
  return okEnvelope("ga4_get_property", {
    resource: {
      type: "ga4_property",
      id: prop.name,
      display_name: typeof raw.displayName === "string" ? raw.displayName : prop.name,
    },
    data: raw,
  });
}

export async function ga4ListDataStreams(ctx: AppContext, args: Rec): Promise<Envelope> {
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  const pageSize = asInt(args.page_size, 50, 1, 200);
  const raw = (await ctx.http.get(ADMIN, `/v1beta/${prop.name}/dataStreams`, {
    pageSize,
    pageToken: typeof args.page_token === "string" ? args.page_token : undefined,
  }, meta("ga4_list_data_streams"))) as Rec;
  const streams = Array.isArray(raw.dataStreams) ? raw.dataStreams : [];
  return okEnvelope("ga4_list_data_streams", {
    resource: { type: "ga4_property", id: prop.name, display_name: prop.name },
    data: { data_streams: streams },
    page: pageFromList(streams, streams.length, typeof raw.nextPageToken === "string" ? raw.nextPageToken : undefined),
    ...(streams.length === 0 ? { hint: HINT_EMPTY_LIST } : {}),
  });
}

export async function ga4ListKeyEvents(ctx: AppContext, args: Rec): Promise<Envelope> {
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  const pageSize = asInt(args.page_size, 50, 1, 200);
  const raw = (await ctx.http.get(ADMIN, `/v1beta/${prop.name}/keyEvents`, {
    pageSize,
    pageToken: typeof args.page_token === "string" ? args.page_token : undefined,
  }, meta("ga4_list_key_events"))) as Rec;
  const events = Array.isArray(raw.keyEvents)
    ? raw.keyEvents
    : Array.isArray(raw.conversionEvents)
      ? raw.conversionEvents
      : [];
  return okEnvelope("ga4_list_key_events", {
    resource: { type: "ga4_property", id: prop.name, display_name: prop.name },
    data: { key_events: events },
    page: pageFromList(events, events.length, typeof raw.nextPageToken === "string" ? raw.nextPageToken : undefined),
    ...(events.length === 0 ? { hint: HINT_EMPTY_LIST } : {}),
  });
}

function filterMetadataItems(
  items: unknown[],
  query: string | undefined,
  customOnly: boolean,
): unknown[] {
  const q = query?.trim().toLowerCase() ?? "";
  return items.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Rec;
    if (customOnly && row.customDefinition !== true) return false;
    if (!q) return true;
    const hay = [row.apiName, row.uiName, row.description]
      .filter((v) => typeof v === "string")
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

/**
 * Property metadata catalog. Optional query/kind/custom_only filter shrinks the
 * dump so agents search apiNames instead of inventing metrics (Ads-style discovery).
 */
export async function ga4GetMetadata(ctx: AppContext, args: Rec): Promise<Envelope> {
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  const raw = (await ctx.http.get(DATA, `/v1beta/${prop.name}/metadata`, undefined, dataMeta("ga4_get_metadata"))) as Rec;
  const kindRaw = typeof args.kind === "string" ? args.kind.trim().toLowerCase() : "all";
  const kind = kindRaw === "dimension" || kindRaw === "metric" || kindRaw === "all" ? kindRaw : null;
  if (!kind) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      'kind must be "dimension", "metric", or "all"',
      { resource_id: prop.name, hint: "Omit kind to return both dimensions and metrics." },
    );
  }
  const query = typeof args.query === "string" ? args.query : undefined;
  const customOnly = Boolean(args.custom_only);
  const dimsAll = Array.isArray(raw.dimensions) ? raw.dimensions : [];
  const metsAll = Array.isArray(raw.metrics) ? raw.metrics : [];
  const dimensions = kind === "metric" ? [] : filterMetadataItems(dimsAll, query, customOnly);
  const metrics = kind === "dimension" ? [] : filterMetadataItems(metsAll, query, customOnly);
  const filtered = Boolean(query) || customOnly || kind !== "all";
  const empty = dimensions.length === 0 && metrics.length === 0;
  return okEnvelope("ga4_get_metadata", {
    resource: { type: "ga4_property", id: prop.name, display_name: prop.name },
    data: {
      name: raw.name,
      property_id: prop.name,
      kind,
      query: query ?? null,
      custom_only: customOnly,
      filtered,
      dimension_count: dimensions.length,
      metric_count: metrics.length,
      dimensions,
      metrics,
    },
    page: { row_count: dimensions.length + metrics.length, truncated: false },
    ...(empty
      ? {
          hint: filtered
            ? `No dimensions/metrics matched query=${JSON.stringify(query ?? "")} kind=${kind} on ${prop.name}. Broaden query or call without filters; do not invent apiNames.`
            : `Metadata empty for ${prop.name}. Confirm property_id via ga4_list_account_summaries.`,
        }
      : {
          hint: `Cite apiName values from this response for ${prop.name}. Do not invent metric or dimension names.`,
        }),
  });
}

export async function ga4RunReport(ctx: AppContext, args: Rec): Promise<Envelope> {
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  const dateRanges = args.date_ranges;
  if (!Array.isArray(dateRanges) || dateRanges.length < 1 || dateRanges.length > 2) {
    throw new ToolError("INVALID_ARGUMENT", "date_ranges must have 1 or 2 {start_date, end_date} objects");
  }
  const metrics = args.metrics;
  if (!Array.isArray(metrics) || metrics.length < 1 || metrics.length > 10) {
    throw new ToolError("INVALID_ARGUMENT", "metrics must be 1–10 API names");
  }
  const dimensions = Array.isArray(args.dimensions) ? args.dimensions : [];
  if (dimensions.length > 9) {
    throw new ToolError("INVALID_ARGUMENT", "dimensions max is 9");
  }

  denySearchQueryDimensions(dimensions);
  denySearchQueryDimensions(metrics);

  const allowLong = Boolean(args.allow_long_range);
  const now = ctx.now();
  const compiledRanges = dateRanges.map((r, i) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) {
      throw new ToolError("INVALID_ARGUMENT", `date_ranges[${i}] must be an object`);
    }
    const row = r as Rec;
    const start = String(row.start_date ?? "");
    const end = String(row.end_date ?? "");
    if (!start || !end) {
      throw new ToolError("INVALID_ARGUMENT", `date_ranges[${i}] requires start_date and end_date`);
    }
    capDateRange(start, end, now, allowLong);
    return { startDate: start, endDate: end };
  });

  const limit = asInt(args.limit, 50, 1, 1000);
  const offset = asInt(args.offset, 0, 0, 1_000_000);

  const body: Rec = {
    dateRanges: compiledRanges,
    metrics: metrics.map((n) => ({ name: String(n) })),
    dimensions: dimensions.map((n) => ({ name: String(n) })),
    limit,
    offset,
    keepEmptyRows: Boolean(args.keep_empty_rows),
    returnPropertyQuota: true,
  };
  if (args.currency_code) body.currencyCode = String(args.currency_code);
  if (args.dimension_filter) body.dimensionFilter = compileFilterExpression(args.dimension_filter);
  if (args.metric_filter) body.metricFilter = compileFilterExpression(args.metric_filter);
  const orderBys = compileOrderBys(args.order_bys);
  if (orderBys) body.orderBys = orderBys;

  const raw = (await ctx.http.post(
    DATA,
    `/v1beta/${prop.name}:runReport`,
    body,
    dataMeta("ga4_run_report"),
  )) as Rec;

  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  const rowCount = typeof raw.rowCount === "number" ? raw.rowCount : rows.length;
  const truncated = rows.length < rowCount || (typeof raw.rowCount === "number" && offset + rows.length < raw.rowCount);

  const rangeCite = compiledRanges
    .map((r) => `${r.startDate}..${r.endDate}`)
    .join(", ");
  const emptyHint =
    `No rows for ${prop.name} dates=[${rangeCite}] (limit=${limit}, offset=${offset}). ` +
    HINT_EMPTY_ROWS +
    " Confirm timezone via ga4_get_property; resolve apiNames via ga4_get_metadata.";

  return okEnvelope("ga4_run_report", {
    resource: { type: "ga4_property", id: prop.name, display_name: prop.name },
    data: {
      ...raw,
      cited: {
        property_id: prop.name,
        date_ranges: compiledRanges,
        metrics: metrics.map((n) => String(n)),
        dimensions: dimensions.map((n) => String(n)),
        limit,
        offset,
      },
    },
    quota: raw.propertyQuota,
    page: {
      row_count: rowCount,
      truncated,
      ...(truncated ? { next_page_token: String(offset + rows.length) } : {}),
    },
    // Keep success-with-rows hint-free so empty-state tests stay sharp; citations live in data.cited.
    ...(rowCount === 0 ? { hint: emptyHint } : {}),
  });
}

/** Test helper: never used in production paths. Exists so isolation tests can prove we do not export a picker. */
export function assertNoImplicitPick(): void {
  throw new ToolError("RESOURCE_REQUIRED", MSG.RESOURCE_REQUIRED);
}
