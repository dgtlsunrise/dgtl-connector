declare const tokenBrand: unique symbol;

export type Token = string & { readonly [tokenBrand]: "dgtl_muse" };

type GrantFields = {
  readonly v: 1;
  readonly grant_id: string;
  readonly created_at: string;
  readonly google: null;
};

export type ActiveGrant = GrantFields & { readonly status: "active" };
export type RevokedGrant = GrantFields & { readonly status: "revoked" };
export type Grant = ActiveGrant | RevokedGrant;

export type AuthResult =
  | { readonly kind: "grant"; readonly grant: ActiveGrant }
  | { readonly kind: "unauthorized" };

const TOKEN_PREFIX = "dgtl_muse_";
const TOKEN_BODY = /^[A-Za-z0-9_-]{43}$/;
const BEARER = /^Bearer ([A-Za-z0-9_-]+)$/;

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

function isGrant(value: unknown): value is Grant {
  if (!isRecord(value)) {
    return false;
  }
  const grantId = value["grant_id"];
  const createdAt = value["created_at"];
  const status = value["status"];
  return (
    value["v"] === 1 &&
    typeof grantId === "string" &&
    grantId.length > 0 &&
    typeof createdAt === "string" &&
    createdAt.length > 0 &&
    (status === "active" || status === "revoked") &&
    value["google"] === null
  );
}

function parseGrant(raw: string): Grant | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isGrant(value)) {
    return null;
  }
  return {
    v: value.v,
    grant_id: value.grant_id,
    created_at: value.created_at,
    status: value.status,
    google: null,
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
