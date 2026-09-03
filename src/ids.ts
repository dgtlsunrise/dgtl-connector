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
  return { id, name: `accounts/${id}` };
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
  return { id, name: `properties/${id}` };
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
