import { bytesToBase64Url } from "./bytes";

declare const tokenBrand: unique symbol;

export type Token = string & { readonly [tokenBrand]: "dgtl_muse" };

export type SealedRefreshToken = {
  readonly alg: "A256GCM";
  readonly iv: string;
  readonly ct: string;
};

export type GoogleLink = {
  readonly sub: string;
  readonly email: string;
  readonly scopes: readonly string[];
  readonly refresh_token: SealedRefreshToken;
  readonly linked_at: string;
};

type GrantFields = {
  readonly v: 1;
  readonly grant_id: string;
  readonly created_at: string;
  readonly google: GoogleLink | null;
};

export type ActiveGrant = GrantFields & { readonly status: "active" };
export type RevokedGrant = GrantFields & { readonly status: "revoked" };
export type Grant = ActiveGrant | RevokedGrant;

export type AuthResult =
  | { readonly kind: "grant"; readonly grant: ActiveGrant }
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
  const refresh = value["refresh_token"];
  if (sub === null || email === null || linkedAt === null || scopes === null || !isRecord(refresh)) {
    return undefined;
  }
  if (refresh["alg"] !== "A256GCM") {
    return undefined;
  }
  const iv = nonEmptyString(refresh["iv"]);
  const ct = nonEmptyString(refresh["ct"]);
  if (iv === null || ct === null) {
    return undefined;
  }
  return {
    sub,
    email,
    scopes,
    refresh_token: { alg: "A256GCM", iv, ct },
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
  if (
    value["v"] !== 1 ||
    grantId === null ||
    createdAt === null ||
    (status !== "active" && status !== "revoked") ||
    google === undefined
  ) {
    return null;
  }
  return {
    v: 1,
    grant_id: grantId,
    created_at: createdAt,
    status,
    google,
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

  const record = await tokens.get(await tokenKey(token), "text");
  if (record === null) {
    return { kind: "unauthorized" };
  }

  const grant = parseGrant(record);
  if (grant === null) {
    return { kind: "unauthorized" };
  }

  switch (grant.status) {
    case "active":
      return { kind: "grant", grant };
    case "revoked":
      return { kind: "unauthorized" };
    default: {
      const unexpected: never = grant;
      return unexpected;
    }
  }
}
