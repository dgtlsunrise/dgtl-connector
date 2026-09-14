import { createHash } from "node:crypto";
import type { Envelope } from "../envelope.js";

/** Two minutes: long enough for agent list-think-list loops, short enough if a write lands outside this process. */
export const DEFAULT_METADATA_CACHE_TTL_MS = 120_000;

/** Fifteen minutes: GA4 Data API dimension/metric catalogs change rarely. */
export const DEFAULT_GA4_METADATA_CACHE_TTL_MS = 900_000;

const MAX_ENTRIES = 256;
const FINGERPRINT_LEN = 16;

export type MetadataCachePlatform = "ga4" | "gsc" | "gtm" | "gbp" | "shopify" | "klaviyo";

export type CacheIdentityInput = {
  env: NodeJS.ProcessEnv;
  pluginDataDir: string;
};

export type MetadataCacheStats = {
  hits: number;
  misses: number;
  stores: number;
  busts: number;
};

type Entry = {
  envelope: Envelope;
  expiresAt: number;
};

/**
 * Stable list/metadata tools only. Reports, mutates, whoami, license, and
 * Ads/Meta/TikTok/MC stamp-or-paid hops are intentionally absent.
 */
export const METADATA_CACHE_TOOLS: ReadonlySet<string> = new Set([
  "ga4_list_accounts",
  "ga4_list_account_summaries",
  "ga4_list_properties",
  "ga4_get_property",
  "ga4_list_data_streams",
  "ga4_list_key_events",
  "ga4_get_metadata",
  "ga4_list_google_ads_links",
  "ga4_list_mp_secrets",
  "ga4_get_attribution_settings",
  "gsc_list_sites",
  "gsc_get_site",
  "gsc_list_sitemaps",
  "gsc_get_sitemap",
  "gtm_list_accounts",
  "gtm_list_containers",
  "gtm_get_container",
  "gtm_list_workspaces",
  "gtm_list_tags",
  "gtm_list_triggers",
  "gtm_list_variables",
  "gtm_get_live_container_version",
  "gtm_list_clients",
  "gtm_list_environments",
  "gbp_list_accounts",
  "gbp_list_locations",
  "gbp_get_location",
  "shopify_get_shop",
  "shopify_list_products",
  "shopify_list_locations",
  "shopify_list_inventory_levels",
  "shopify_list_publications",
  "shopify_list_catalogs",
  "shopify_list_product_feeds",
  "klaviyo_get_account",
  "klaviyo_list_lists",
  "klaviyo_list_segments",
  "klaviyo_list_flows",
  "klaviyo_get_flow",
  "klaviyo_list_campaigns",
  "klaviyo_list_metrics",
  "klaviyo_list_catalog_items",
  "klaviyo_list_catalog_categories",
  "klaviyo_list_catalog_variants",
]);

function firstEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = env[k];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

function fingerprint(material: string): string {
  return createHash("sha256").update(material).digest("hex").slice(0, FINGERPRINT_LEN);
}

function assertNever(x: never): never {
  throw new Error(`unexpected metadata-cache platform ${String(x)}`);
}

function parseTtlMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

export function metadataCacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseTtlMs(env.DGTL_METADATA_CACHE_TTL_MS, DEFAULT_METADATA_CACHE_TTL_MS);
}

export function ga4MetadataCacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseTtlMs(env.DGTL_GA4_METADATA_CACHE_TTL_MS, DEFAULT_GA4_METADATA_CACHE_TTL_MS);
}

export function cachePlatformForTool(toolName: string): MetadataCachePlatform | undefined {
  if (!METADATA_CACHE_TOOLS.has(toolName)) return undefined;
  if (toolName.startsWith("ga4_")) return "ga4";
  if (toolName.startsWith("gsc_")) return "gsc";
  if (toolName.startsWith("gtm_")) return "gtm";
  if (toolName.startsWith("gbp_")) return "gbp";
  if (toolName.startsWith("shopify_")) return "shopify";
  if (toolName.startsWith("klaviyo_")) return "klaviyo";
  return undefined;
}

/**
 * Live write tools bust the matching platform prefix. List/get members of
 * write families (GA4 Admin reads) must not bust.
 */
export function writeBustPlatform(family: string, toolName: string): MetadataCachePlatform | undefined {
  const isRead = toolName.includes("_list_") || toolName.includes("_get_");
  switch (family) {
    case "ga4_write":
      return isRead ? undefined : "ga4";
    case "gsc_write":
      return isRead ? undefined : "gsc";
    case "gtm_write":
      return isRead ? undefined : "gtm";
    case "shopify_write":
      return isRead ? undefined : "shopify";
    case "klaviyo_write":
      return isRead ? undefined : "klaviyo";
    default:
      return undefined;
  }
}

export function isLiveWriteSuccess(env: Envelope): boolean {
  if (!env.ok) return false;
  const data = env.data;
  if (data && typeof data === "object" && !Array.isArray(data) && "dry_run" in data) {
    return (data as { dry_run?: unknown }).dry_run === false;
  }
  return true;
}

export function stableJson(value: unknown): string {
  if (value === undefined) return "";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

export function metadataCacheKey(opts: {
  platform: MetadataCachePlatform;
  identity: string;
  tool: string;
  args: Record<string, unknown>;
}): string {
  const argsHash = fingerprint(stableJson(opts.args));
  return `${opts.platform}:${opts.identity}:${opts.tool}:${argsHash}`;
}

export function cacheIdentity(platform: MetadataCachePlatform, input: CacheIdentityInput): string {
  switch (platform) {
    case "ga4":
    case "gsc":
    case "gtm":
      return googleIdentity(input);
    case "gbp":
      return gbpIdentity(input);
    case "shopify":
      return shopifyIdentity(input);
    case "klaviyo":
      return klaviyoIdentity(input);
    default:
      return assertNever(platform);
  }
}

function googleIdentity(input: CacheIdentityInput): string {
  const email = firstEnv(input.env, ["GOOGLE_ACCOUNT_EMAIL", "DGTL_GOOGLE_ACCOUNT_EMAIL"]);
  if (email) return fingerprint(`google-email:${email.toLowerCase()}`);
  const token = firstEnv(input.env, [
    "GOOGLE_ACCESS_TOKEN",
    "DGTL_GOOGLE_ACCESS_TOKEN",
    "MCP_GOOGLE_ACCESS_TOKEN",
    "GOOGLE_OAUTH_ACCESS_TOKEN",
  ]);
  if (token) return fingerprint(`google-token:${token}`);
  return fingerprint(`google-dir:${input.pluginDataDir}`);
}

function gbpIdentity(input: CacheIdentityInput): string {
  const email = firstEnv(input.env, ["GOOGLE_ACCOUNT_EMAIL", "DGTL_GOOGLE_ACCOUNT_EMAIL"]);
  const token = firstEnv(input.env, ["GOOGLE_GBP_ACCESS_TOKEN", "DGTL_GOOGLE_GBP_ACCESS_TOKEN"]);
  if (email && token) return fingerprint(`gbp-email-token:${email.toLowerCase()}:${token}`);
  if (token) return fingerprint(`gbp-token:${token}`);
  if (email) return fingerprint(`gbp-email:${email.toLowerCase()}`);
  return fingerprint(`gbp-dir:${input.pluginDataDir}`);
}

function shopifyIdentity(input: CacheIdentityInput): string {
  const store = firstEnv(input.env, ["SHOPIFY_STORE", "DGTL_SHOPIFY_STORE"]) ?? "";
  const token = firstEnv(input.env, ["SHOPIFY_ACCESS_TOKEN", "DGTL_SHOPIFY_ACCESS_TOKEN"]);
  if (store || token) {
    return fingerprint(`shopify:${store.toLowerCase()}:${token ?? ""}`);
  }
  return fingerprint(`shopify-dir:${input.pluginDataDir}`);
}

function klaviyoIdentity(input: CacheIdentityInput): string {
  const key = firstEnv(input.env, ["KLAVIYO_API_KEY", "DGTL_KLAVIYO_API_KEY", "KLAVIYO_PRIVATE_KEY"]);
  if (key) return fingerprint(`klaviyo-key:${key}`);
  return fingerprint(`klaviyo-dir:${input.pluginDataDir}`);
}

type CatalogEntry = {
  raw: unknown;
  expiresAt: number;
};

export class MetadataCache {
  private readonly store = new Map<string, Entry>();
  private readonly catalogs = new Map<string, CatalogEntry>();
  readonly stats: MetadataCacheStats = { hits: 0, misses: 0, stores: 0, busts: 0 };

  constructor(
    private readonly opts: {
      ttlMs: number;
      catalogTtlMs: number;
      now: () => number;
    },
  ) {}

  get enabled(): boolean {
    return this.opts.ttlMs > 0;
  }

  get catalogEnabled(): boolean {
    return this.opts.catalogTtlMs > 0;
  }

  get size(): number {
    return this.store.size;
  }

  get(key: string): Envelope | undefined {
    if (!this.enabled) {
      this.stats.misses += 1;
      return undefined;
    }
    const hit = this.store.get(key);
    if (!hit) {
      this.stats.misses += 1;
      return undefined;
    }
    if (hit.expiresAt <= this.opts.now()) {
      this.store.delete(key);
      this.stats.misses += 1;
      return undefined;
    }
    this.stats.hits += 1;
    return structuredClone(hit.envelope);
  }

  set(key: string, envelope: Envelope, ttlMs?: number): void {
    const ttl = ttlMs ?? this.opts.ttlMs;
    if (ttl <= 0) return;
    this.evictExpired();
    if (this.store.size >= MAX_ENTRIES && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, {
      envelope: structuredClone(envelope),
      expiresAt: this.opts.now() + ttl,
    });
    this.stats.stores += 1;
  }

  getCatalog(key: string): unknown | undefined {
    if (!this.catalogEnabled) return undefined;
    const hit = this.catalogs.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.opts.now()) {
      this.catalogs.delete(key);
      return undefined;
    }
    return structuredClone(hit.raw);
  }

  setCatalog(key: string, raw: unknown): void {
    if (!this.catalogEnabled) return;
    this.catalogs.set(key, {
      raw: structuredClone(raw),
      expiresAt: this.opts.now() + this.opts.catalogTtlMs,
    });
  }

  bustPrefix(prefix: string): number {
    let n = 0;
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        n += 1;
      }
    }
    for (const key of [...this.catalogs.keys()]) {
      if (key.startsWith(prefix)) {
        this.catalogs.delete(key);
        n += 1;
      }
    }
    this.stats.busts += n;
    return n;
  }

  clear(): void {
    this.store.clear();
    this.catalogs.clear();
  }

  private evictExpired(): void {
    const now = this.opts.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(key);
    }
  }
}

export function lookupMetadataCache(
  cache: MetadataCache,
  toolName: string,
  args: Record<string, unknown>,
  identityInput: CacheIdentityInput,
): Envelope | undefined {
  const platform = cachePlatformForTool(toolName);
  if (!platform || !cache.enabled) return undefined;
  const identity = cacheIdentity(platform, identityInput);
  return cache.get(metadataCacheKey({ platform, identity, tool: toolName, args }));
}

export function storeMetadataCache(
  cache: MetadataCache,
  toolName: string,
  args: Record<string, unknown>,
  envelope: Envelope,
  identityInput: CacheIdentityInput,
): void {
  if (!envelope.ok) return;
  const platform = cachePlatformForTool(toolName);
  if (!platform || !cache.enabled) return;
  const identity = cacheIdentity(platform, identityInput);
  cache.set(metadataCacheKey({ platform, identity, tool: toolName, args }), envelope);
}

function ga4CatalogKey(identity: string, propertyId: string): string {
  return `ga4:${identity}:catalog:${propertyId}`;
}

export function lookupGa4MetadataCatalog(
  cache: MetadataCache,
  propertyId: string,
  identityInput: CacheIdentityInput,
): Record<string, unknown> | undefined {
  if (!cache.catalogEnabled) return undefined;
  const identity = cacheIdentity("ga4", identityInput);
  const raw = cache.getCatalog(ga4CatalogKey(identity, propertyId));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return raw as Record<string, unknown>;
}

export function storeGa4MetadataCatalog(
  cache: MetadataCache,
  propertyId: string,
  raw: Record<string, unknown>,
  identityInput: CacheIdentityInput,
): void {
  if (!cache.catalogEnabled) return;
  const identity = cacheIdentity("ga4", identityInput);
  cache.setCatalog(ga4CatalogKey(identity, propertyId), raw);
}

export function bustMetadataCacheAfterWrite(
  cache: MetadataCache,
  family: string,
  toolName: string,
  envelope: Envelope,
  identityInput: CacheIdentityInput,
): void {
  const platform = writeBustPlatform(family, toolName);
  if (!platform || !isLiveWriteSuccess(envelope)) return;
  const identity = cacheIdentity(platform, identityInput);
  cache.bustPrefix(`${platform}:${identity}:`);
}
