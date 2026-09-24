import { bytesToBase64Url } from "./bytes";

declare const tokenBrand: unique symbol;

export type Token = string & { readonly [tokenBrand]: "dgtl_muse" };

export type SealedRefreshToken = {
  readonly alg: "A256GCM";
  readonly iv: string;
  readonly ct: string;
};

export type SealedSecret = SealedRefreshToken;

export type GoogleLink = {
  readonly sub: string;
  readonly email: string;
  readonly scopes: readonly string[];
  readonly refresh_token: SealedRefreshToken;
  readonly linked_at: string;
};

export type ShopifyLink = {
  readonly shop: string;
  readonly access_token: SealedSecret;
  readonly linked_at: string;
};

export type KlaviyoLink = {
  readonly api_key: SealedSecret;
  readonly account_id: string | null;
  readonly linked_at: string;
};

type GrantFields = {
  readonly v: 1;
  readonly grant_id: string;
  readonly created_at: string;
  readonly google: GoogleLink | null;
  readonly shopify: ShopifyLink | null;
  readonly klaviyo: KlaviyoLink | null;
};

export type ActiveGrant = GrantFields & { readonly status: "active" };
export type RevokedGrant = GrantFields & { readonly status: "revoked" };
export type Grant = ActiveGrant | RevokedGrant;

export type AuthResult =
  | { readonly kind: "grant"; readonly grant: ActiveGrant; readonly key: string }
  | { readonly kind: "unauthorized" };

const TOKEN_PREFIX = "dgtl_muse_";
const TOKEN_BODY = /^[A-Za-z0-9_-]{43}$/;
const BEARER = /^Bearer ([A-Za-z0-9_-]+)$/i;

export function parseToken(value: string): Token | null {
  if (!value.startsWith(TOKEN_PREFIX)) {
    return null;
  }
  const body = value.slice(TOKEN_PREFIX.length);
  if (!TOKEN_BODY.test(body)) {
    return null;
  }
  return value as Token;
}

export async function mintBearerToken(): Promise<{ token: Token; key: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = parseToken(`${TOKEN_PREFIX}${bytesToBase64Url(bytes)}`);
  if (token === null) {
    throw new Error("minted token did not match dgtl_muse_ format");
  }
  return { token, key: await tokenKey(token) };
}

export async function tokenKey(token: Token): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function tokenFromAuthorization(authorization: string | null): Token | null {
  if (authorization === null) {
    return null;
  }
  const raw = BEARER.exec(authorization)?.[1];
  if (raw === undefined) {
    return null;
  }
  return parseToken(raw);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

function parseScopes(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const scopes: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      return null;
    }
    scopes.push(item);
  }
  return scopes;
}

const SHOP_DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?\.myshopify\.com$/;
const SHOPIFY_ACCESS_TOKEN = /^[^\s]{1,4096}$/;
const KLAVIYO_API_KEY = /^pk_[A-Za-z0-9_-]{8,240}$/;

export function parseShopDomain(value: string): string | null {
  const shop = value.trim().toLowerCase();
  if (!SHOP_DOMAIN.test(shop)) {
    return null;
  }
  return shop;
}

export function parseShopifyAccessToken(value: string): string | null {
  if (!SHOPIFY_ACCESS_TOKEN.test(value)) {
    return null;
  }
  return value;
}

export function parseKlaviyoApiKey(value: string): string | null {
  if (!KLAVIYO_API_KEY.test(value)) {
    return null;
  }
  return value;
}

function parseSealed(value: unknown): SealedSecret | undefined {
  if (!isRecord(value) || value["alg"] !== "A256GCM") {
    return undefined;
  }
  const iv = nonEmptyString(value["iv"]);
  const ct = nonEmptyString(value["ct"]);
  if (iv === null || ct === null) {
    return undefined;
  }
  return { alg: "A256GCM", iv, ct };
}

function parseGoogle(value: unknown): GoogleLink | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const sub = nonEmptyString(value["sub"]);
  const email = nonEmptyString(value["email"]);
  const linkedAt = nonEmptyString(value["linked_at"]);
  const scopes = parseScopes(value["scopes"]);
  const refresh = parseSealed(value["refresh_token"]);
  if (sub === null || email === null || linkedAt === null || scopes === null || refresh === undefined) {
    return undefined;
  }
  return {
    sub,
    email,
    scopes,
    refresh_token: refresh,
    linked_at: linkedAt,
  };
}

function parseShopify(value: unknown): ShopifyLink | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const shop = nonEmptyString(value["shop"]);
  const accessToken = parseSealed(value["access_token"]);
  const linkedAt = nonEmptyString(value["linked_at"]);
  if (shop === null || shop !== parseShopDomain(shop) || accessToken === undefined || linkedAt === null) {
    return undefined;
  }
  return {
    shop,
    access_token: accessToken,
    linked_at: linkedAt,
  };
}

function parseAccountId(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return nonEmptyString(value) ?? undefined;
}

function parseKlaviyo(value: unknown): KlaviyoLink | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const apiKey = parseSealed(value["api_key"]);
  const accountId = parseAccountId(value["account_id"]);
  const linkedAt = nonEmptyString(value["linked_at"]);
  if (apiKey === undefined || accountId === undefined || linkedAt === null) {
    return undefined;
  }
  return {
    api_key: apiKey,
    account_id: accountId,
    linked_at: linkedAt,
  };
}

function parseGrant(raw: string): Grant | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  const grantId = nonEmptyString(value["grant_id"]);
  const createdAt = nonEmptyString(value["created_at"]);
  const status = value["status"];
  const google = parseGoogle(value["google"]);
  const shopify = parseShopify(value["shopify"]);
  const klaviyo = parseKlaviyo(value["klaviyo"]);
  if (
    value["v"] !== 1 ||
    grantId === null ||
    createdAt === null ||
    (status !== "active" && status !== "revoked") ||
    google === undefined ||
    shopify === undefined ||
    klaviyo === undefined
  ) {
    return null;
  }
  return {
    v: 1,
    grant_id: grantId,
    created_at: createdAt,
    status,
    google,
    shopify,
    klaviyo,
  };
}

export async function authenticate(
  authorization: string | null,
  tokens: KVNamespace,
): Promise<AuthResult> {
  const token = tokenFromAuthorization(authorization);
  if (token === null) {
    return { kind: "unauthorized" };
  }

  const key = await tokenKey(token);
  const record = await tokens.get(key, "text");
  if (record === null) {
    return { kind: "unauthorized" };
  }

  const grant = parseGrant(record);
  if (grant === null) {
    return { kind: "unauthorized" };
  }

  switch (grant.status) {
    case "active":
      return { kind: "grant", grant, key };
    case "revoked":
      return { kind: "unauthorized" };
    default: {
      const unexpected: never = grant;
      return unexpected;
    }
  }
}
