import { MSG, ToolError } from "./errors.js";

/** Values that mean "guess" and are never accepted as a resource id. */
const FORBIDDEN = new Set([
  "",
  "default",
  "first",
  "0",
  "index0",
  "index-0",
  "[0]",
  "none",
  "null",
  "undefined",
]);

/**
 * Required resource id. Never default, never first-of-list, never index 0.
 * This is the isolation boundary — skills are not.
 */
export function requireId(value: unknown, field: string): string {
  if (value === undefined || value === null) {
    throw new ToolError( "RESOURCE_REQUIRED", MSG.RESOURCE_REQUIRED, {
      resource_id: field,
      hint: `Pass ${field}. Listing tools exist so you can pick; this tool will not use index 0.`,
    });
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new ToolError("RESOURCE_REQUIRED", MSG.RESOURCE_REQUIRED, {
      resource_id: field,
    });
  }
  const trimmed = String(value).trim();
  if (FORBIDDEN.has(trimmed.toLowerCase())) {
    throw new ToolError("RESOURCE_REQUIRED", MSG.RESOURCE_REQUIRED, {
      resource_id: field,
      hint: `"${trimmed}" is not a resource id. Name the real GA4 property, GSC site, or GTM id.`,
    });
  }
  return trimmed;
}

export function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireId(value, field);
}

/** Numeric ids this plugin must never target (live customer lock). */
const LOCKED_GA4_NUMERIC_IDS = new Set(["2859537899"]);

export function assertGa4NumericIdAllowed(id: string, field: string): void {
  if (LOCKED_GA4_NUMERIC_IDS.has(id)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `${field} is not allowed for this plugin. Use a disposable DGTL property (fixtures preferred).`,
      { resource_id: field },
    );
  }
}

export function normalizeGa4Account(raw: string): { id: string; name: string } {
  const trimmed = raw.trim();
  const id = trimmed.startsWith("accounts/")
    ? trimmed.slice("accounts/".length)
    : trimmed;
  if (!/^[0-9]+$/.test(id)) {
    throw new ToolError("INVALID_ARGUMENT", `account_id must be numeric or accounts/{id}, got ${trimmed}`, {
      resource_id: trimmed,
    });
  }
  assertGa4NumericIdAllowed(id, "account_id");
  return { id, name: `accounts/${id}` };
}

/** Merchant Center account id — digits or accounts/{id}. Never guess. */
export function normalizeMerchantId(raw: string): { id: string; name: string } {
  const trimmed = raw.trim();
  const id = trimmed.startsWith("accounts/") ? trimmed.slice("accounts/".length) : trimmed;
  if (!/^[0-9]+$/.test(id)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `merchant_id must be numeric or accounts/{id}, got ${trimmed}`,
      { resource_id: trimmed },
    );
  }
  return { id, name: `accounts/${id}` };
}

/**
 * Merchant API product id: `{contentLanguage}~{feedLabel}~{offerId}`
 * or full `accounts/{merchant}/products/{productId}`.
 */
export function normalizeMcProductId(raw: string): string {
  const trimmed = raw.trim();
  const full = trimmed.match(/^accounts\/[0-9]+\/products\/(.+)$/);
  const id = full?.[1] ?? trimmed;
  if (!id || FORBIDDEN.has(id.toLowerCase())) {
    throw new ToolError("RESOURCE_REQUIRED", MSG.RESOURCE_REQUIRED, {
      resource_id: "product_id",
      hint: "Pass product_id as contentLanguage~feedLabel~offerId (e.g. en~US~SKU123) from mc_list_products.",
    });
  }
  if (!id.includes("~") || id.includes("/") || id.includes("..")) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "product_id must be contentLanguage~feedLabel~offerId (or accounts/{merchant}/products/…). Do not pass a bare SKU.",
      { resource_id: trimmed },
    );
  }
  return id;
}

/**
 * Merchant API data source — digits, dataSources/{id}, or
 * accounts/{merchant}/dataSources/{id}. Never guess. Full names must match merchant_id.
 */
export function normalizeMcDataSource(
  raw: string,
  merchantId: string,
): { id: string; name: string } {
  const trimmed = raw.trim();
  const full = trimmed.match(/^accounts\/([0-9]+)\/dataSources\/([0-9]+)$/);
  let id = trimmed;
  if (full?.[1] && full[2]) {
    if (full[1] !== merchantId) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        `data_source account ${full[1]} does not match merchant_id ${merchantId}. Never guess merchant_id.`,
        { resource_id: trimmed },
      );
    }
    id = full[2];
  } else if (trimmed.startsWith("dataSources/")) {
    id = trimmed.slice("dataSources/".length);
  }
  if (!/^[0-9]+$/.test(id)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "data_source must be digits, dataSources/{id}, or accounts/{merchant}/dataSources/{id}. ProductInput writes require an API data source (not a processed Product).",
      { resource_id: trimmed },
    );
  }
  return { id, name: `accounts/${merchantId}/dataSources/${id}` };
}

/** GBP account — digits, accounts/{id}, or accounts/- (Google wildcard). Never guess. */
export function normalizeGbpAccount(raw: string): { id: string; name: string } {
  const trimmed = raw.trim();
  if (trimmed === "-" || trimmed === "accounts/-") {
    return { id: "-", name: "accounts/-" };
  }
  const id = trimmed.startsWith("accounts/") ? trimmed.slice("accounts/".length) : trimmed;
  if (!/^[0-9]+$/.test(id)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `account_name must be accounts/{id}, digits, or accounts/- (wildcard), got ${trimmed}`,
      { resource_id: trimmed },
    );
  }
  return { id, name: `accounts/${id}` };
}

/** GBP location — digits or locations/{id}. Never accounts/{id}/locations/{id} on get. */
export function normalizeGbpLocation(raw: string): { id: string; name: string } {
  const trimmed = raw.trim();
  const nested = trimmed.match(/^accounts\/[^/]+\/locations\/([^/]+)$/);
  const id = nested?.[1]
    ? nested[1]
    : trimmed.startsWith("locations/")
      ? trimmed.slice("locations/".length)
      : trimmed;
  if (!/^[0-9]+$/.test(id)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `location_name must be locations/{id} or digits, got ${trimmed}`,
      { resource_id: trimmed },
    );
  }
  return { id, name: `locations/${id}` };
}

export function normalizeGa4Property(raw: string): { id: string; name: string } {
  const trimmed = raw.trim();
  const id = trimmed.startsWith("properties/")
    ? trimmed.slice("properties/".length)
    : trimmed;
  if (!/^[0-9]+$/.test(id)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `property_id must be properties/{numeric} (with or without prefix).`,
      { resource_id: trimmed },
    );
  }
  assertGa4NumericIdAllowed(id, "property_id");
  return { id, name: `properties/${id}` };
}

/** Child under a GA4 property: ads link, data stream, key event, or MP secret. */
export function normalizeGa4ChildId(
  raw: string,
  field: string,
  collection: "googleAdsLinks" | "dataStreams" | "keyEvents" | "measurementProtocolSecrets",
  propertyName: string,
): { id: string; name: string } {
  const trimmed = raw.trim();
  const prefix = `${propertyName}/${collection}/`;
  const id = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
  if (!id || FORBIDDEN.has(id.toLowerCase()) || id.includes("/") || id.includes("..")) {
    throw new ToolError("INVALID_ARGUMENT", `${field} must be the child id or ${prefix}{id}.`, {
      resource_id: trimmed,
    });
  }
  return { id, name: `${prefix}${id}` };
}

export function normalizeGtmAccount(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("accounts/") ? trimmed.slice("accounts/".length) : trimmed;
}

export function normalizeGtmContainer(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/containers\/([^/]+)$/);
  if (m?.[1]) return m[1];
  return trimmed;
}

export function encodeSiteUrl(siteUrl: string): string {
  return encodeURIComponent(siteUrl);
}

export function asInt(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new ToolError("INVALID_ARGUMENT", `Expected integer, got ${String(value)}`);
  }
  if (n < min || n > max) {
    throw new ToolError("INVALID_ARGUMENT", `Value ${n} out of range ${min}–${max}`);
  }
  return n;
}
