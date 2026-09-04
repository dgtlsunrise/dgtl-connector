import type { AccessToken, AccessTokenSource } from "./types.js";
import { STORE_FILE } from "./types.js";
import {
  HostInjectedAdsTokenSource,
  HostInjectedMetaTokenSource,
  HostInjectedTokenSource,
  HostInjectedWriteTokenSource,
} from "./host-injected.js";
import { FileTokenSource, PkceTokenSource } from "./store.js";

/**
 * AuthPort: host-injected token first, installed-app PKCE fallback.
 * Consent A only — never reads WRITE / ADS / META envs or stores.
 * Never a confidential client secret.
 */
export class AuthPort implements AccessTokenSource {
  readonly name: string;
  private readonly sources: AccessTokenSource[];

  constructor(sources: AccessTokenSource[], name = "authport") {
    this.sources = sources;
    this.name = name;
  }

  /** Consent A — GOOGLE_ACCESS_TOKEN / google-oauth.json */
  static fromEnv(opts: {
    env?: NodeJS.ProcessEnv;
    pluginDataDir: string;
    fetchImpl: typeof fetch;
  }): AuthPort {
    const env = opts.env ?? process.env;
    return new AuthPort(
      [
        new HostInjectedTokenSource(env),
        new PkceTokenSource(opts.pluginDataDir, env.GOOGLE_OAUTH_CLIENT_ID, opts.fetchImpl, {
          storeFile: STORE_FILE.a,
          clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        }),
      ],
      "authport-a",
    );
  }

  /** Consent W — GOOGLE_WRITE_ACCESS_TOKEN / google-oauth-write.json */
  static writeFromEnv(opts: {
    env?: NodeJS.ProcessEnv;
    pluginDataDir: string;
    fetchImpl: typeof fetch;
  }): AuthPort {
    const env = opts.env ?? process.env;
    return new AuthPort(
      [
        new HostInjectedWriteTokenSource(env),
        new PkceTokenSource(opts.pluginDataDir, env.GOOGLE_OAUTH_WRITE_CLIENT_ID, opts.fetchImpl, {
          storeFile: STORE_FILE.w,
          clientSecret: env.GOOGLE_OAUTH_WRITE_CLIENT_SECRET,
        }),
      ],
      "authport-w",
    );
  }

  /** Consent C Google Ads — GOOGLE_ADS_ACCESS_TOKEN / google-oauth-ads.json */
  static adsFromEnv(opts: {
    env?: NodeJS.ProcessEnv;
    pluginDataDir: string;
    fetchImpl: typeof fetch;
  }): AuthPort {
    const env = opts.env ?? process.env;
    return new AuthPort(
      [
        new HostInjectedAdsTokenSource(env),
        new PkceTokenSource(opts.pluginDataDir, env.GOOGLE_OAUTH_ADS_CLIENT_ID, opts.fetchImpl, {
          storeFile: STORE_FILE.ads,
          clientSecret: env.GOOGLE_OAUTH_ADS_CLIENT_SECRET,
        }),
      ],
      "authport-ads",
    );
  }

  /** Meta user — META_ACCESS_TOKEN / meta-oauth.json (no Google refresh). */
  static metaFromEnv(opts: {
    env?: NodeJS.ProcessEnv;
    pluginDataDir: string;
  }): AuthPort {
    const env = opts.env ?? process.env;
    return new AuthPort(
      [new HostInjectedMetaTokenSource(env), new FileTokenSource(opts.pluginDataDir, STORE_FILE.meta)],
      "authport-meta",
    );
  }

  async getAccessToken(): Promise<AccessToken | null> {
    for (const src of this.sources) {
      const tok = await src.getAccessToken();
      if (tok?.accessToken) return tok;
    }
    return null;
  }
}
