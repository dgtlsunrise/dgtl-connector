/**
 * Merchant-held Shopify credentials (local free lane).
 * Never Polar-gated. Never stamp-hop. Tokens stay under PLUGIN_DATA.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";

export const SHOPIFY_STORE_FILE = "shopify-oauth.json";

/** Admin API version pin — document in TOOLS.md / skill. */
export const SHOPIFY_API_VERSION = "2026-04";

export const SHOPIFY_READ_SCOPES = [
  "read_products",
  "read_orders",
  "read_inventory",
  "read_locations",
] as const;

export const SHOPIFY_WRITE_SCOPES = ["write_inventory"] as const;

export type ShopifyCredentials = {
  /** Normalized host e.g. example.myshopify.com (no scheme/path). */
  storeHost: string;
  accessToken: string;
  scopes?: string[];
  source: "host-injected" | "file" | "client_credentials";
};

export type ShopifyStored = {
  store?: string;
  access_token?: string;
  scopes?: string[];
  /** ms epoch; used when token came from client_credentials. */
  expiry?: number;
  client_id?: string;
  /** Never log. Optional companion to refresh via client_credentials. */
  client_secret?: string;
};

function firstEnv(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = env[k];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

/** Accept "mystore", "mystore.myshopify.com", or https://mystore.myshopify.com/. */
export function normalizeShopifyStore(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.split("/")[0] ?? s;
  s = s.split("?")[0] ?? s;
  if (!s.includes(".")) {
    s = `${s}.myshopify.com`;
  }
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) {
    throw new Error(
      `SHOPIFY_STORE must be a *.myshopify.com shop domain (got ${raw.trim().slice(0, 80)})`,
    );
  }
  return s;
}

export function shopifyStorePath(pluginDataDir: string): string {
  return join(pluginDataDir, SHOPIFY_STORE_FILE);
}

export function readShopifyStore(pluginDataDir: string): ShopifyStored | null {
  const p = shopifyStorePath(pluginDataDir);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as ShopifyStored;
    if (!raw.access_token && !raw.client_id) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeShopifyStore(pluginDataDir: string, tokens: ShopifyStored): void {
  mkdirSync(pluginDataDir, { recursive: true });
  const p = shopifyStorePath(pluginDataDir);
  writeFileSync(p, `${JSON.stringify(tokens, null, 2)}\n`, { encoding: "utf8" });
  try {
    chmodSync(p, 0o600);
    chmodSync(dirname(p), 0o700);
  } catch {
    // Windows / some hosts cannot chmod.
  }
}

export function clearShopifyStore(pluginDataDir: string): void {
  const p = shopifyStorePath(pluginDataDir);
  if (existsSync(p)) writeFileSync(p, "{}\n");
}

function parseScopeList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

/**
 * Resolve merchant credentials: env first, then PLUGIN_DATA/shopify-oauth.json.
 * Optional client_credentials refresh when client_id/secret present and token missing/expired.
 */
export async function resolveShopifyCredentials(opts: {
  env?: NodeJS.ProcessEnv;
  pluginDataDir: string;
  fetchImpl?: typeof fetch;
}): Promise<ShopifyCredentials | null> {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? fetch;

  const envStore = firstEnv(env, ["SHOPIFY_STORE", "DGTL_SHOPIFY_STORE"]);
  const envToken = firstEnv(env, ["SHOPIFY_ACCESS_TOKEN", "DGTL_SHOPIFY_ACCESS_TOKEN"]);
  const envScopes = parseScopeList(firstEnv(env, ["SHOPIFY_GRANTED_SCOPES", "DGTL_SHOPIFY_SCOPES"]));
  const envClientId = firstEnv(env, ["SHOPIFY_CLIENT_ID", "DGTL_SHOPIFY_CLIENT_ID"]);
  const envClientSecret = firstEnv(env, ["SHOPIFY_CLIENT_SECRET", "DGTL_SHOPIFY_CLIENT_SECRET"]);

  if (envStore && envToken) {
    try {
      return {
        storeHost: normalizeShopifyStore(envStore),
        accessToken: envToken,
        scopes: envScopes,
        source: "host-injected",
      };
    } catch {
      return null;
    }
  }

  const stored = readShopifyStore(opts.pluginDataDir);
  const storeRaw = envStore || stored?.store;
  if (!storeRaw) return null;

  let storeHost: string;
  try {
    storeHost = normalizeShopifyStore(storeRaw);
  } catch {
    return null;
  }

  const now = Date.now();
  const fileToken = stored?.access_token?.trim();
  const fileExpiry = stored?.expiry;
  const tokenFresh =
    fileToken && (fileExpiry === undefined || fileExpiry - 60_000 > now) ? fileToken : undefined;

  if (tokenFresh) {
    return {
      storeHost,
      accessToken: tokenFresh,
      scopes: stored?.scopes ?? envScopes,
      source: "file",
    };
  }

  // client_credentials when access token missing/expired
  const clientId = envClientId || stored?.client_id?.trim();
  const clientSecret = envClientSecret || stored?.client_secret?.trim();
  if (clientId && clientSecret) {
    const tok = await fetchClientCredentialsToken({
      storeHost,
      clientId,
      clientSecret,
      fetchImpl,
    });
    if (!tok) return null;
    writeShopifyStore(opts.pluginDataDir, {
      store: storeHost,
      access_token: tok.access_token,
      expiry: Date.now() + (tok.expires_in ?? 86399) * 1000,
      scopes: tok.scope?.split(/[,\s]+/).filter(Boolean) ?? stored?.scopes,
      client_id: clientId,
      // Keep secret in store only if it was already there; prefer env.
      client_secret: stored?.client_secret,
    });
    return {
      storeHost,
      accessToken: tok.access_token,
      scopes: tok.scope?.split(/[,\s]+/).filter(Boolean),
      source: "client_credentials",
    };
  }

  // Stale file token without refresh path — still try it (Admin may accept until revoke).
  if (fileToken) {
    return {
      storeHost,
      accessToken: fileToken,
      scopes: stored?.scopes ?? envScopes,
      source: "file",
    };
  }

  return null;
}

async function fetchClientCredentialsToken(opts: {
  storeHost: string;
  clientId: string;
  clientSecret: string;
  fetchImpl: typeof fetch;
}): Promise<{ access_token: string; expires_in?: number; scope?: string } | null> {
  const url = `https://${opts.storeHost}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  });
  try {
    const res = await opts.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        "user-agent": "dgtl-connector/0.1.0",
      },
      body: body.toString(),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!json.access_token) return null;
    return {
      access_token: json.access_token,
      expires_in: json.expires_in,
      scope: json.scope,
    };
  } catch {
    return null;
  }
}

/**
 * True when detectable scopes omit a required Admin scope.
 * Undetectable (empty) → do not fail closed (Admin 403 still maps SHOPIFY_SCOPE_MISSING).
 * `write_X` satisfies `read_X` (Shopify write grants typically include the read).
 */
export function missingShopifyScope(scopes: string[] | undefined, needed: string): boolean {
  if (!scopes || scopes.length === 0) return false;
  const set = new Set(scopes.map((s) => s.trim().toLowerCase()));
  const want = needed.trim().toLowerCase();
  if (set.has(want)) return false;
  if (want.startsWith("read_")) {
    const writeEquiv = `write_${want.slice("read_".length)}`;
    if (set.has(writeEquiv)) return false;
  }
  return true;
}

/** @deprecated use missingShopifyScope */
export function missingShopifyReadScope(
  scopes: string[] | undefined,
  needed: (typeof SHOPIFY_READ_SCOPES)[number],
): boolean {
  return missingShopifyScope(scopes, needed);
}
