import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AccessToken, AccessTokenSource } from "./types.js";
import { refreshAccessToken } from "./pkce.js";
import { parseScopeList } from "./host-injected.js";

export type StoredTokens = {
  access_token: string;
  refresh_token?: string;
  expiry: number;
  scopes?: string[];
  token_type?: string;
  email?: string;
};

const FILE = "google-oauth.json";

export function tokenPath(pluginDataDir: string): string {
  return join(pluginDataDir, FILE);
}

export function readStore(pluginDataDir: string): StoredTokens | null {
  const p = tokenPath(pluginDataDir);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as StoredTokens;
    if (!raw.access_token && !raw.refresh_token) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeStore(pluginDataDir: string, tokens: StoredTokens): void {
  mkdirSync(pluginDataDir, { recursive: true });
  const p = tokenPath(pluginDataDir);
  writeFileSync(p, `${JSON.stringify(tokens, null, 2)}\n`, { encoding: "utf8" });
  try {
    chmodSync(p, 0o600);
    chmodSync(dirname(p), 0o700);
  } catch {
    // Windows / some hosts cannot chmod; file still written.
  }
}

export function clearStore(pluginDataDir: string): void {
  const p = tokenPath(pluginDataDir);
  if (existsSync(p)) {
    writeFileSync(p, "{}\n");
  }
}

export class PkceTokenSource implements AccessTokenSource {
  readonly name = "pkce";

  constructor(
    private readonly pluginDataDir: string,
    private readonly clientId: string | undefined,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async getAccessToken(): Promise<AccessToken | null> {
    const stored = readStore(this.pluginDataDir);
    if (!stored) return null;
    const now = Date.now();
    if (stored.access_token && stored.expiry - 60_000 > now) {
      return {
        accessToken: stored.access_token,
        expiresIn: Math.max(0, Math.floor((stored.expiry - now) / 1000)),
        scopes: stored.scopes,
        email: stored.email,
        source: "pkce",
      };
    }
    if (!stored.refresh_token || !this.clientId) {
      if (stored.access_token) {
        return {
          accessToken: stored.access_token,
          scopes: stored.scopes,
          email: stored.email,
          source: "pkce",
        };
      }
      return null;
    }
    const refreshed = await refreshAccessToken(
      { clientId: this.clientId, refreshToken: stored.refresh_token },
      this.fetchImpl,
    );
    const next: StoredTokens = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? stored.refresh_token,
      expiry: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
      scopes: parseScopeList(refreshed.scope) ?? stored.scopes,
      token_type: refreshed.token_type,
      email: stored.email,
    };
    writeStore(this.pluginDataDir, next);
    return {
      accessToken: next.access_token,
      expiresIn: refreshed.expires_in,
      scopes: next.scopes,
      email: next.email,
      source: "pkce",
    };
  }
}
