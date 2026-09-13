/**
 * Closed GTM Client.type strings for sGTM (Wave 13).
 * Official Client.type is an undocumented free string; these are attested
 * built-in type ids from GTM container exports / compiled sGTM clients.
 * See docs/ops/GTM-CLIENTS-SPIKE.md.
 */
export const GTM_CLIENT_TYPES = ["gaawp", "googtag", "gclidw", "flc", "ua", "mp"] as const;
export type GtmClientType = (typeof GTM_CLIENT_TYPES)[number];

const CLIENT_TYPE_SET = new Set<string>(GTM_CLIENT_TYPES);

export function isGtmClientType(value: unknown): value is GtmClientType {
  return typeof value === "string" && CLIENT_TYPE_SET.has(value);
}

export function gtmClientTypeError(got: unknown): string {
  const shown = typeof got === "string" && got ? got : String(got);
  return `Unknown GTM client type ${JSON.stringify(shown)}. Closed enum: ${GTM_CLIENT_TYPES.join(", ")}. Tag types (html, gaawc, gaawe) are not clients. Custom cvt_* templates are not in this wave.`;
}

/**
 * Closed Container.usageContext values tooled in Wave 13.
 * Official UsageContext also has usageContextUnspecified / androidSdk5 / iosSdk5
 * — those are not in this enum (clear error). web/android/ios/amp are locked
 * existing contexts; server is the sGTM path.
 */
export const GTM_USAGE_CONTEXTS = ["web", "android", "ios", "amp", "server"] as const;
export type GtmUsageContext = (typeof GTM_USAGE_CONTEXTS)[number];

const USAGE_SET = new Set<string>(GTM_USAGE_CONTEXTS);

export function isGtmUsageContext(value: unknown): value is GtmUsageContext {
  return typeof value === "string" && USAGE_SET.has(value);
}

export function gtmUsageContextError(got: unknown): string {
  const shown = typeof got === "string" && got ? got : String(got);
  return `Unknown GTM usageContext ${JSON.stringify(shown)}. Closed enum: ${GTM_USAGE_CONTEXTS.join(", ")} (server = sGTM; web/android/ios/amp are locked existing contexts).`;
}

/** Parameter keys that must never land in GTM clients (Wave 20 stamp ingest). */
const INGEST_KEY_RE =
  /^(x-?dgtl-?ingest-?key|dgtl[_-]?ingest(?:[_-]?key)?|ingest[_-]?key|funded[_-]?key|apply[_-]?key|stamp[_-]?ingest)$/i;

export function isDeniedGtmIngestParamKey(key: string): boolean {
  return INGEST_KEY_RE.test(key.trim());
}
