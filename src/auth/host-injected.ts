import type { AccessToken, AccessTokenSource } from "./types.js";

const TOKEN_KEYS = [
  "GOOGLE_ACCESS_TOKEN",
  "DGTL_GOOGLE_ACCESS_TOKEN",
  "MCP_GOOGLE_ACCESS_TOKEN",
  "GOOGLE_OAUTH_ACCESS_TOKEN",
];

const SCOPE_KEYS = ["GOOGLE_GRANTED_SCOPES", "DGTL_GOOGLE_SCOPES", "GOOGLE_OAUTH_SCOPES"];

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

export class HostInjectedTokenSource implements AccessTokenSource {
  readonly name = "host-injected";

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async getAccessToken(): Promise<AccessToken | null> {
    const accessToken = firstEnv(this.env, TOKEN_KEYS);
    if (!accessToken) return null;
    const expiresRaw = this.env.GOOGLE_ACCESS_TOKEN_EXPIRES_IN;
    const expiresIn = expiresRaw ? Number(expiresRaw) : undefined;
    return {
      accessToken,
      expiresIn: Number.isFinite(expiresIn) ? expiresIn : undefined,
      scopes: parseScopeList(firstEnv(this.env, SCOPE_KEYS)),
      email: this.env.GOOGLE_ACCOUNT_EMAIL?.trim() || undefined,
      source: "host-injected",
    };
  }
}
