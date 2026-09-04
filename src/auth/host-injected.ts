import type { AccessToken, AccessTokenSource } from "./types.js";

const TOKEN_KEYS_A = [
  "GOOGLE_ACCESS_TOKEN",
  "DGTL_GOOGLE_ACCESS_TOKEN",
  "MCP_GOOGLE_ACCESS_TOKEN",
  "GOOGLE_OAUTH_ACCESS_TOKEN",
];

const SCOPE_KEYS_A = ["GOOGLE_GRANTED_SCOPES", "DGTL_GOOGLE_SCOPES", "GOOGLE_OAUTH_SCOPES"];

function firstEnv(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = env[k];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

export function parseScopeList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

/** Consent A only — never reads WRITE / ADS / META token envs. */
export class HostInjectedTokenSource implements AccessTokenSource {
  readonly name = "host-injected";

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async getAccessToken(): Promise<AccessToken | null> {
    const accessToken = firstEnv(this.env, TOKEN_KEYS_A);
    if (!accessToken) return null;
    const expiresRaw = this.env.GOOGLE_ACCESS_TOKEN_EXPIRES_IN;
    const expiresIn = expiresRaw ? Number(expiresRaw) : undefined;
    return {
      accessToken,
      expiresIn: Number.isFinite(expiresIn) ? expiresIn : undefined,
      scopes: parseScopeList(firstEnv(this.env, SCOPE_KEYS_A)),
      email: this.env.GOOGLE_ACCOUNT_EMAIL?.trim() || undefined,
      source: "host-injected",
    };
  }
}

/** Consent W host-injected — GOOGLE_WRITE_ACCESS_TOKEN only. */
export class HostInjectedWriteTokenSource implements AccessTokenSource {
  readonly name = "host-injected-write";

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async getAccessToken(): Promise<AccessToken | null> {
    const accessToken = this.env.GOOGLE_WRITE_ACCESS_TOKEN?.trim();
    if (!accessToken) return null;
    const expiresRaw = this.env.GOOGLE_WRITE_ACCESS_TOKEN_EXPIRES_IN;
    const expiresIn = expiresRaw ? Number(expiresRaw) : undefined;
    return {
      accessToken,
      expiresIn: Number.isFinite(expiresIn) ? expiresIn : undefined,
      scopes: parseScopeList(this.env.GOOGLE_WRITE_GRANTED_SCOPES),
      email: this.env.GOOGLE_WRITE_ACCOUNT_EMAIL?.trim() || undefined,
      source: "host-injected",
    };
  }
}

/** Consent C Google Ads host-injected — GOOGLE_ADS_ACCESS_TOKEN only. */
export class HostInjectedAdsTokenSource implements AccessTokenSource {
  readonly name = "host-injected-ads";

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async getAccessToken(): Promise<AccessToken | null> {
    const accessToken = this.env.GOOGLE_ADS_ACCESS_TOKEN?.trim();
    if (!accessToken) return null;
    const expiresRaw = this.env.GOOGLE_ADS_ACCESS_TOKEN_EXPIRES_IN;
    const expiresIn = expiresRaw ? Number(expiresRaw) : undefined;
    return {
      accessToken,
      expiresIn: Number.isFinite(expiresIn) ? expiresIn : undefined,
      scopes: parseScopeList(this.env.GOOGLE_ADS_GRANTED_SCOPES),
      email: this.env.GOOGLE_ADS_ACCOUNT_EMAIL?.trim() || undefined,
      source: "host-injected",
    };
  }
}

/** Meta user host-injected — META_ACCESS_TOKEN only. Never Google A. */
export class HostInjectedMetaTokenSource implements AccessTokenSource {
  readonly name = "host-injected-meta";

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async getAccessToken(): Promise<AccessToken | null> {
    const accessToken = this.env.META_ACCESS_TOKEN?.trim();
    if (!accessToken) return null;
    const expiresRaw = this.env.META_ACCESS_TOKEN_EXPIRES_IN;
    const expiresIn = expiresRaw ? Number(expiresRaw) : undefined;
    return {
      accessToken,
      expiresIn: Number.isFinite(expiresIn) ? expiresIn : undefined,
      scopes: parseScopeList(this.env.META_GRANTED_SCOPES),
      source: "host-injected",
    };
  }
}
