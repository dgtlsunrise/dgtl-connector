import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, pageFromList, HINT_EMPTY_LIST, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import {
  asInt,
  normalizeGa4Account,
  normalizeGa4ChildId,
  normalizeGa4Property,
  requireId,
} from "../ids.js";
import { APIS, SCOPE } from "./scopes.js";

const HINT_FLAG =
  "Set DGTL_WRITES_ENABLED=true to allow local GA4 Admin mutates. Free Google can already hold analytics.edit. Ads/Meta/TikTok stay Pro.";

const HINT_CONSENT =
  "Use Free Google (`auth login` / GOOGLE_ACCESS_TOKEN with analytics.edit) or a legacy GOOGLE_GA4_ADMIN_ACCESS_TOKEN / google-oauth-ga4-admin.json. Do not add adwords, content, or business.manage to Free Google.";

const HOST = APIS.admin;
const ADMIN = APIS.admin;
type Rec = Record<string, unknown>;

const COUNTING_METHODS = new Set(["ONCE_PER_EVENT", "ONCE_PER_SESSION"]);
const DIM_SCOPES = new Set(["EVENT", "USER", "ITEM"]);
const METRIC_UNITS = new Set([
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
]);
const LOOKBACK_ACQ = new Set([
  "ACQUISITION_CONVERSION_EVENT_LOOKBACK_WINDOW_7_DAYS",
  "ACQUISITION_CONVERSION_EVENT_LOOKBACK_WINDOW_30_DAYS",
  "ACQUISITION_CONVERSION_EVENT_LOOKBACK_WINDOW_90_DAYS",
]);
const LOOKBACK_OTHER = new Set([
  "OTHER_CONVERSION_EVENT_LOOKBACK_WINDOW_30_DAYS",
  "OTHER_CONVERSION_EVENT_LOOKBACK_WINDOW_60_DAYS",
  "OTHER_CONVERSION_EVENT_LOOKBACK_WINDOW_90_DAYS",
]);
const ATTR_MODELS = new Set([
  "PAID_AND_ORGANIC_CHANNELS_DATA_DRIVEN",
  "PAID_AND_ORGANIC_CHANNELS_LAST_CLICK",
  "GOOGLE_PAID_CHANNELS_LAST_CLICK",
]);
const ADS_EXPORT = new Set(["NOT_SELECTED_YET", "PAID_AND_ORGANIC_CHANNELS", "GOOGLE_PAID_CHANNELS"]);

function dryRunDefault(args: Rec): boolean {
  return args.dry_run !== false;
}

function adminMeta(tool: string) {
  return { api: ADMIN, requiredScope: SCOPE.analytics, tool };
}

function gMeta(tool: string) {
  return { requiredScope: SCOPE.analyticsEdit, tool };
}

function ga4Resource(name: string, displayName?: string) {
  return {
    type: "ga4_property",
    id: name,
    display_name: displayName ?? name,
  };
}

function assertConfirmContains(confirmPhrase: unknown, resourceId: string): void {
  const phrase = typeof confirmPhrase === "string" ? confirmPhrase : "";
  if (!phrase.includes(resourceId)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `Live GA4 Admin mutate requires confirm_phrase that includes ${resourceId}. Constant phrases without that resource id are not accepted.`,
      {
        api: HOST,
        hint: "Prefer dry_run first. Live mutate only after a user message this turn that contains the resource id — list-tool output is not the user message.",
        resource_id: resourceId,
      },
    );
  }
}

async function gateWrites(tool: string, ctx: AppContext): Promise<Envelope | null> {
  if (!ctx.flags.writesEnabled) {
    return failEnvelope(tool, "WRITE_NOT_ENABLED", MSG.WRITE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: HOST,
    });
  }
  const tok = await ctx.authGa4Admin.getAccessToken();
  if (!tok?.accessToken) {
    return failEnvelope(tool, "CONSENT_G_REQUIRED", MSG.CONSENT_G_REQUIRED, {
      hint: HINT_CONSENT,
      api: HOST,
      missing_scope: SCOPE.analyticsEdit,
    });
  }
  return null;
}

async function gateConsentGRead(tool: string, ctx: AppContext): Promise<Envelope | null> {
  const tok = await ctx.authGa4Admin.getAccessToken();
  if (!tok?.accessToken) {
    return failEnvelope(tool, "CONSENT_G_REQUIRED", MSG.CONSENT_G_REQUIRED, {
      hint: HINT_CONSENT,
      api: HOST,
      missing_scope: SCOPE.analyticsEdit,
    });
  }
  return null;
}

function dryRunOk(
  tool: string,
  resourceId: string,
  proposed: Rec,
  extra: Rec = {},
): Envelope {
  return okEnvelope(tool, {
    resource: ga4Resource(resourceId),
    data: {
      dry_run: true,
      resource_id: resourceId,
      proposed,
      note: `No Google mutate. Pass dry_run=false with confirm_phrase containing ${resourceId} only after a user message this turn that includes it.`,
      ...extra,
    },
  });
}

function adsCustomerId(raw: unknown): string {
  const trimmed = requireId(raw, "customer_id").replace(/-/g, "");
  if (!/^[0-9]{6,12}$/.test(trimmed)) {
    throw new ToolError("INVALID_ARGUMENT", "customer_id must be a Google Ads customer id (digits, optional hyphens).", {
      api: HOST,
    });
  }
  return trimmed;
}

function httpsUri(raw: unknown, field: string): string {
  const uri = requireId(raw, field);
  if (!/^https?:\/\//i.test(uri)) {
    throw new ToolError("INVALID_ARGUMENT", `${field} must be an http(s) URI.`, { api: HOST });
  }
  return uri;
}

function redactSecretFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecretFields);
  if (!value || typeof value !== "object") return value;
  const out: Rec = {};
  for (const [k, v] of Object.entries(value as Rec)) {
    if (k === "secretValue" || k === "secret_value") out[k] = "REDACTED";
    else out[k] = redactSecretFields(v);
  }
  return out;
}

export async function ga4ListGoogleAdsLinks(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "ga4_list_google_ads_links";
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  const pageSize = asInt(args.page_size, 50, 1, 200);
  const raw = (await ctx.http.get(
    ADMIN,
    `/v1beta/${prop.name}/googleAdsLinks`,
    {
      pageSize,
      pageToken: typeof args.page_token === "string" ? args.page_token : undefined,
    },
    adminMeta(tool),
  )) as Rec;
  const links = Array.isArray(raw.googleAdsLinks) ? raw.googleAdsLinks : [];
  return okEnvelope(tool, {
    resource: ga4Resource(prop.name),
    data: { google_ads_links: links, consent: "A" },
    page: pageFromList(links, links.length, typeof raw.nextPageToken === "string" ? raw.nextPageToken : undefined),
    ...(links.length === 0 ? { hint: HINT_EMPTY_LIST } : {}),
  });
}

export async function ga4CreateGoogleAdsLink(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "ga4_create_google_ads_link";
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  const customerId = adsCustomerId(args.customer_id);
  const proposed: Rec = { customerId };
  if (args.ads_personalization_enabled === true || args.ads_personalization_enabled === false) {
    proposed.adsPersonalizationEnabled = args.ads_personalization_enabled;
  }
  if (dryRunDefault(args)) return dryRunOk(tool, prop.name, proposed);
  assertConfirmContains(args.confirm_phrase, prop.name);
  const created = await ctx.httpGa4Admin.post(`/v1beta/${prop.name}/googleAdsLinks`, proposed, gMeta(tool));
  return okEnvelope(tool, {
    resource: ga4Resource(prop.name),
    data: { dry_run: false, google_ads_link: created },
  });
}

export async function ga4DeleteGoogleAdsLink(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "ga4_delete_google_ads_link";
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  const link = normalizeGa4ChildId(requireId(args.ads_link_id, "ads_link_id"), "ads_link_id", "googleAdsLinks", prop.name);
  const proposed = { name: link.name };
  if (dryRunDefault(args)) return dryRunOk(tool, prop.name, proposed);
  assertConfirmContains(args.confirm_phrase, prop.name);
  await ctx.httpGa4Admin.delete(`/v1beta/${link.name}`, gMeta(tool));
  return okEnvelope(tool, {
    resource: ga4Resource(prop.name),
    data: { dry_run: false, deleted: link.name },
  });
}

export async function ga4GetAttributionSettings(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "ga4_get_attribution_settings";
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  // Spike: v1beta has no this RPC. v1alpha GET accepts analytics.readonly (Consent A).
  const raw = await ctx.http.get(ADMIN, `/v1alpha/${prop.name}/attributionSettings`, undefined, adminMeta(tool));
  return okEnvelope(tool, {
    resource: ga4Resource(prop.name),
    data: { attribution_settings: raw, api_version: "v1alpha", consent: "A" },
  });
}

export async function ga4UpdateAttributionSettings(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "ga4_update_attribution_settings";
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  const body: Rec = { name: `${prop.name}/attributionSettings` };
  const mask: string[] = [];
  if (typeof args.reporting_attribution_model === "string") {
    if (!ATTR_MODELS.has(args.reporting_attribution_model)) {
      throw new ToolError("INVALID_ARGUMENT", "reporting_attribution_model is not a closed enum value.", {
        api: HOST,
      });
    }
    body.reportingAttributionModel = args.reporting_attribution_model;
    mask.push("reportingAttributionModel");
  }
  if (typeof args.acquisition_lookback === "string") {
    if (!LOOKBACK_ACQ.has(args.acquisition_lookback)) {
      throw new ToolError("INVALID_ARGUMENT", "acquisition_lookback is not a closed enum value.", { api: HOST });
    }
    body.acquisitionConversionEventLookbackWindow = args.acquisition_lookback;
    mask.push("acquisitionConversionEventLookbackWindow");
  }
  if (typeof args.other_lookback === "string") {
    if (!LOOKBACK_OTHER.has(args.other_lookback)) {
      throw new ToolError("INVALID_ARGUMENT", "other_lookback is not a closed enum value.", { api: HOST });
    }
    body.otherConversionEventLookbackWindow = args.other_lookback;
    mask.push("otherConversionEventLookbackWindow");
  }
  if (typeof args.ads_web_conversion_data_export_scope === "string") {
    if (!ADS_EXPORT.has(args.ads_web_conversion_data_export_scope)) {
      throw new ToolError("INVALID_ARGUMENT", "ads_web_conversion_data_export_scope is not a closed enum value.", {
        api: HOST,
      });
    }
    body.adsWebConversionDataExportScope = args.ads_web_conversion_data_export_scope;
    mask.push("adsWebConversionDataExportScope");
  }
  if (mask.length === 0) {
    throw new ToolError("INVALID_ARGUMENT", "Provide at least one attribution field to patch.", { api: HOST });
  }
  if (dryRunDefault(args)) return dryRunOk(tool, prop.name, { ...body, updateMask: mask.join(",") });
  assertConfirmContains(args.confirm_phrase, prop.name);
  const updated = await ctx.httpGa4Admin.patch(`/v1alpha/${prop.name}/attributionSettings`, body, {
    ...gMeta(tool),
    query: { updateMask: mask.join(",") },
  });
  return okEnvelope(tool, {
    resource: ga4Resource(prop.name),
    data: { dry_run: false, attribution_settings: updated, api_version: "v1alpha" },
  });
}

export async function ga4CreateDataStream(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "ga4_create_data_stream";
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  const displayName = requireId(args.display_name, "display_name");
  const defaultUri = httpsUri(args.default_uri, "default_uri");
  const proposed = {
    type: "WEB_DATA_STREAM",
    displayName,
    webStreamData: { defaultUri },
  };
  if (dryRunDefault(args)) return dryRunOk(tool, prop.name, proposed);
  assertConfirmContains(args.confirm_phrase, prop.name);
  const created = await ctx.httpGa4Admin.post(`/v1beta/${prop.name}/dataStreams`, proposed, gMeta(tool));
  return okEnvelope(tool, {
    resource: ga4Resource(prop.name),
    data: { dry_run: false, data_stream: created },
  });
}

export async function ga4UpdateDataStream(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "ga4_update_data_stream";
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  const stream = normalizeGa4ChildId(requireId(args.stream_id, "stream_id"), "stream_id", "dataStreams", prop.name);
  const body: Rec = { name: stream.name };
  const mask: string[] = [];
  if (typeof args.display_name === "string" && args.display_name.trim()) {
    body.displayName = args.display_name.trim();
    mask.push("displayName");
  }
  if (typeof args.default_uri === "string" && args.default_uri.trim()) {
    body.webStreamData = { defaultUri: httpsUri(args.default_uri, "default_uri") };
    mask.push("webStreamData.defaultUri");
  }
  if (mask.length === 0) {
    throw new ToolError("INVALID_ARGUMENT", "Provide display_name and/or default_uri to patch.", { api: HOST });
  }
  if (dryRunDefault(args)) return dryRunOk(tool, prop.name, { ...body, updateMask: mask.join(",") });
  assertConfirmContains(args.confirm_phrase, prop.name);
  const updated = await ctx.httpGa4Admin.patch(`/v1beta/${stream.name}`, body, {
    ...gMeta(tool),
    query: { updateMask: mask.join(",") },
  });
  return okEnvelope(tool, {
    resource: ga4Resource(prop.name),
    data: { dry_run: false, data_stream: updated },
  });
}

export async function ga4CreateKeyEvent(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "ga4_create_key_event";
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  const eventName = requireId(args.event_name, "event_name");
  const counting =
    typeof args.counting_method === "string" && args.counting_method
      ? args.counting_method
      : "ONCE_PER_EVENT";
  if (!COUNTING_METHODS.has(counting)) {
    throw new ToolError("INVALID_ARGUMENT", "counting_method must be ONCE_PER_EVENT or ONCE_PER_SESSION.", {
      api: HOST,
    });
  }
  const proposed = { eventName, countingMethod: counting };
  if (dryRunDefault(args)) return dryRunOk(tool, prop.name, proposed);
  assertConfirmContains(args.confirm_phrase, prop.name);
  const created = await ctx.httpGa4Admin.post(`/v1beta/${prop.name}/keyEvents`, proposed, gMeta(tool));
  return okEnvelope(tool, {
    resource: ga4Resource(prop.name),
    data: { dry_run: false, key_event: created },
  });
}

export async function ga4UpdateKeyEvent(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "ga4_update_key_event";
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  const ev = normalizeGa4ChildId(requireId(args.key_event_id, "key_event_id"), "key_event_id", "keyEvents", prop.name);
  const counting = requireId(args.counting_method, "counting_method");
  if (!COUNTING_METHODS.has(counting)) {
    throw new ToolError("INVALID_ARGUMENT", "counting_method must be ONCE_PER_EVENT or ONCE_PER_SESSION.", {
      api: HOST,
    });
  }
  const proposed = { name: ev.name, countingMethod: counting };
  if (dryRunDefault(args)) return dryRunOk(tool, prop.name, { ...proposed, updateMask: "countingMethod" });
  assertConfirmContains(args.confirm_phrase, prop.name);
  const updated = await ctx.httpGa4Admin.patch(`/v1beta/${ev.name}`, proposed, {
    ...gMeta(tool),
    query: { updateMask: "countingMethod" },
  });
  return okEnvelope(tool, {
    resource: ga4Resource(prop.name),
    data: { dry_run: false, key_event: updated },
  });
}

export async function ga4CreateCustomDimension(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "ga4_create_custom_dimension";
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  const parameterName = requireId(args.parameter_name, "parameter_name");
  const displayName = requireId(args.display_name, "display_name");
  const scope = requireId(args.scope, "scope");
  if (!DIM_SCOPES.has(scope)) {
    throw new ToolError("INVALID_ARGUMENT", "scope must be EVENT, USER, or ITEM.", { api: HOST });
  }
  const proposed: Rec = { parameterName, displayName, scope };
  if (typeof args.description === "string" && args.description) proposed.description = args.description;
  if (dryRunDefault(args)) return dryRunOk(tool, prop.name, proposed);
  assertConfirmContains(args.confirm_phrase, prop.name);
  const created = await ctx.httpGa4Admin.post(`/v1beta/${prop.name}/customDimensions`, proposed, gMeta(tool));
  return okEnvelope(tool, {
    resource: ga4Resource(prop.name),
    data: { dry_run: false, custom_dimension: created },
  });
}

export async function ga4CreateCustomMetric(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "ga4_create_custom_metric";
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  const parameterName = requireId(args.parameter_name, "parameter_name");
  const displayName = requireId(args.display_name, "display_name");
  const measurementUnit =
    typeof args.measurement_unit === "string" && args.measurement_unit ? args.measurement_unit : "STANDARD";
  if (!METRIC_UNITS.has(measurementUnit)) {
    throw new ToolError("INVALID_ARGUMENT", "measurement_unit is not a closed enum value.", { api: HOST });
  }
  const proposed: Rec = { parameterName, displayName, measurementUnit, scope: "EVENT" };
  if (typeof args.description === "string" && args.description) proposed.description = args.description;
  if (dryRunDefault(args)) return dryRunOk(tool, prop.name, proposed);
  assertConfirmContains(args.confirm_phrase, prop.name);
  const created = await ctx.httpGa4Admin.post(`/v1beta/${prop.name}/customMetrics`, proposed, gMeta(tool));
  return okEnvelope(tool, {
    resource: ga4Resource(prop.name),
    data: { dry_run: false, custom_metric: created },
  });
}

export async function ga4ListMpSecrets(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "ga4_list_mp_secrets";
  const gated = await gateConsentGRead(tool, ctx);
  if (gated) return gated;
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  const stream = normalizeGa4ChildId(requireId(args.stream_id, "stream_id"), "stream_id", "dataStreams", prop.name);
  const pageSize = asInt(args.page_size, 50, 1, 200);
  const raw = (await ctx.httpGa4Admin.get(
    `/v1beta/${stream.name}/measurementProtocolSecrets`,
    {
      pageSize,
      pageToken: typeof args.page_token === "string" ? args.page_token : undefined,
    },
    gMeta(tool),
  )) as Rec;
  const secrets = Array.isArray(raw.measurementProtocolSecrets) ? raw.measurementProtocolSecrets : [];
  return okEnvelope(tool, {
    resource: ga4Resource(prop.name),
    data: {
      measurement_protocol_secrets: redactSecretFields(secrets),
      secret_values_redacted: true,
      consent: "G",
    },
    page: pageFromList(secrets, secrets.length, typeof raw.nextPageToken === "string" ? raw.nextPageToken : undefined),
    ...(secrets.length === 0 ? { hint: HINT_EMPTY_LIST } : {}),
  });
}

export async function ga4CreateMpSecret(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "ga4_create_mp_secret";
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;
  const prop = normalizeGa4Property(requireId(args.property_id, "property_id"));
  const stream = normalizeGa4ChildId(requireId(args.stream_id, "stream_id"), "stream_id", "dataStreams", prop.name);
  const displayName = requireId(args.display_name, "display_name");
  const proposed = { displayName };
  if (dryRunDefault(args)) return dryRunOk(tool, prop.name, proposed, { stream: stream.name });
  assertConfirmContains(args.confirm_phrase, prop.name);
  const created = (await ctx.httpGa4Admin.post(
    `/v1beta/${stream.name}/measurementProtocolSecrets`,
    proposed,
    gMeta(tool),
  )) as Rec;
  return okEnvelope(tool, {
    resource: ga4Resource(prop.name),
    data: {
      dry_run: false,
      measurement_protocol_secret: created,
      note: "secretValue is returned once in data. It is never written to audit/call logs.",
    },
  });
}

export async function ga4CreateProperty(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "ga4_create_property";
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;
  const account = normalizeGa4Account(requireId(args.account_id, "account_id"));
  const displayName = requireId(args.display_name, "display_name");
  const timeZone = requireId(args.time_zone, "time_zone");
  const currencyCode = requireId(args.currency_code, "currency_code").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new ToolError("INVALID_ARGUMENT", "currency_code must be ISO 4217 (three letters).", { api: HOST });
  }
  const proposed: Rec = {
    parent: account.name,
    displayName,
    timeZone,
    currencyCode,
    propertyType: "PROPERTY_TYPE_ORDINARY",
  };
  if (typeof args.industry_category === "string" && args.industry_category) {
    if (!/^[A-Z][A-Z0-9_]+$/.test(args.industry_category)) {
      throw new ToolError("INVALID_ARGUMENT", "industry_category must be a Google IndustryCategory enum token.", {
        api: HOST,
      });
    }
    proposed.industryCategory = args.industry_category;
  }
  if (dryRunDefault(args)) return dryRunOk(tool, account.name, proposed);
  assertConfirmContains(args.confirm_phrase, account.name);
  const created = await ctx.httpGa4Admin.post("/v1beta/properties", proposed, gMeta(tool));
  return okEnvelope(tool, {
    resource: { type: "ga4_account", id: account.name, display_name: account.name },
    data: { dry_run: false, property: created },
  });
}
