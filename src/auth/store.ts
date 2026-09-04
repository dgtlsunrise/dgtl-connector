import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AccessToken, AccessTokenSource } from "./types.js";
import { STORE_FILE } from "./types.js";
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

export { STORE_FILE };

export function tokenPath(pluginDataDir: string, file: string = STORE_FILE.a): string {
  return join(pluginDataDir, file);
}

export function readStore(pluginDataDir: string, file: string = STORE_FILE.a): StoredTokens | null {
  const p = tokenPath(pluginDataDir, file);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as StoredTokens;
    if (!raw.access_token && !raw.refresh_token) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeStore(pluginDataDir: string, tokens: StoredTokens, file: string = STORE_FILE.a): void {
  mkdirSync(pluginDataDir, { recursive: true });
  const p = tokenPath(pluginDataDir, file);
  writeFileSync(p, `${JSON.stringify(tokens, null, 2)}\n`, { encoding: "utf8" });
  try {
    chmodSync(p, 0o600);
    chmodSync(dirname(p), 0o700);
  } catch {
    // Windows / some hosts cannot chmod; file still written.
  }
}

export function clearStore(pluginDataDir: string, file: string = STORE_FILE.a): void {
  const p = tokenPath(pluginDataDir, file);
  if (existsSync(p)) {
    writeFileSync(p, "{}\n");
  }
}

export type PkceTokenSourceOpts = {
  /** PLUGIN_DATA filename. Defaults to Consent A. */
  storeFile?: string;
  /** Optional client secret for Desktop /token (never logged). */
  clientSecret?: string;
};

/**
 * File-backed Google OAuth token source for one consent lane.
 * Writes only to `storeFile` — never to Consent A when configured for W/C.
 */
export class PkceTokenSource implements AccessTokenSource {
  readonly name: string;
  private readonly storeFile: string;
  private readonly clientSecret: string | undefined;

  constructor(
    private readonly pluginDataDir: string,
    private readonly clientId: string | undefined,
    private readonly fetchImpl: typeof fetch,
    opts: PkceTokenSourceOpts = {},
  ) {
    this.storeFile = opts.storeFile ?? STORE_FILE.a;
    this.clientSecret = opts.clientSecret;
    this.name =
      this.storeFile === STORE_FILE.w
        ? "pkce-write"
        : this.storeFile === STORE_FILE.ads
          ? "pkce-ads"
          : "pkce";
  }

  async getAccessToken(): Promise<AccessToken | null> {
    const stored = readStore(this.pluginDataDir, this.storeFile);
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
      {
        clientId: this.clientId,
        refreshToken: stored.refresh_token,
        clientSecret: this.clientSecret,
        // Consent W/C must never reuse GOOGLE_OAUTH_CLIENT_SECRET (Consent A).
        allowConsentASecretFallback: this.storeFile === STORE_FILE.a,
      },
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
    writeStore(this.pluginDataDir, next, this.storeFile);
    return {
      accessToken: next.access_token,
      expiresIn: refreshed.expires_in,
      scopes: next.scopes,
      email: next.email,
      source: "pkce",
    };
  }
}

/**
 * Meta (and similar) file store — access token only, no Google refresh.
 * Reads/writes `meta-oauth.json` only.
 */
export class FileTokenSource implements AccessTokenSource {
  readonly name: string;

  constructor(
    private readonly pluginDataDir: string,
    private readonly storeFile: string,
  ) {
    this.name = `file:${storeFile}`;
  }

  async getAccessToken(): Promise<AccessToken | null> {
    const stored = readStore(this.pluginDataDir, this.storeFile);
    if (!stored?.access_token) return null;
    const now = Date.now();
    const expiresIn =
      stored.expiry && stored.expiry > now
        ? Math.max(0, Math.floor((stored.expiry - now) / 1000))
        : undefined;
    return {
      accessToken: stored.access_token,
      expiresIn,
      scopes: stored.scopes,
      email: stored.email,
      source: "pkce",
    };
  }
}
