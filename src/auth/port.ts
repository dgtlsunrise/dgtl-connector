import type { AccessToken, AccessTokenSource } from "./types.js";
import { STORE_FILE } from "./types.js";
import { CONSENT_G, CONSENT_S, CONSENT_W_GTM } from "../google/scopes.js";
import {
  HostInjectedAdsTokenSource,
  HostInjectedGa4AdminTokenSource,
  HostInjectedGbpTokenSource,
  HostInjectedGscWriteTokenSource,
  HostInjectedMcTokenSource,
  HostInjectedMetaTokenSource,
  HostInjectedTikTokTokenSource,
  HostInjectedTokenSource,
  HostInjectedWriteTokenSource,
} from "./host-injected.js";
import { FileTokenSource, PkceTokenSource } from "./store.js";

export function tokenHasScopes(token: AccessToken | null, needed: readonly string[]): token is AccessToken {
  if (!token?.accessToken || !token.scopes?.length) return false;
  return needed.every((s) => token.scopes!.includes(s));
}

/** Use an inner source only when the token lists every required scope. */
export class ScopedTokenSource implements AccessTokenSource {
  readonly name: string;

  constructor(
    private readonly inner: AccessTokenSource,
    private readonly requiredScopes: readonly string[],
    name?: string,
  ) {
    this.name = name ?? `${inner.name}-scoped`;
  }

  async getAccessToken(): Promise<AccessToken | null> {
    const tok = await this.inner.getAccessToken();
    return tokenHasScopes(tok, this.requiredScopes) ? tok : null;
  }

  invalidateAccessToken(): void {
    this.inner.invalidateAccessToken?.();
  }
}

/**
 * AuthPort: host-injected token first, installed-app PKCE fallback.
 * Free Google (A) never reads Ads / MC / GBP / Meta / TikTok envs.
 * Write ports try legacy W/G/S first, then A when write scopes are present.
 */
export class AuthPort implements AccessTokenSource {
  readonly name: string;
  private readonly sources: AccessTokenSource[];

  constructor(sources: AccessTokenSource[], name = "authport") {
    this.sources = sources;
    this.name = name;
  }

  /** Free Google — GOOGLE_ACCESS_TOKEN / google-oauth.json */
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

  /** GTM writes — legacy W store, then free Google when GTM write scopes are present. */
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
        ...AuthPort.freeGoogleWhenScoped(opts, env, CONSENT_W_GTM, "w"),
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

  /** Consent MC Merchant API — GOOGLE_MC_ACCESS_TOKEN / google-oauth-mc.json */
  static mcFromEnv(opts: {
    env?: NodeJS.ProcessEnv;
    pluginDataDir: string;
    fetchImpl: typeof fetch;
  }): AuthPort {
    const env = opts.env ?? process.env;
    return new AuthPort(
      [
        new HostInjectedMcTokenSource(env),
        new PkceTokenSource(opts.pluginDataDir, env.GOOGLE_OAUTH_MC_CLIENT_ID, opts.fetchImpl, {
          storeFile: STORE_FILE.mc,
          clientSecret: env.GOOGLE_OAUTH_MC_CLIENT_SECRET,
        }),
      ],
      "authport-mc",
    );
  }

  /** Consent B GBP — GOOGLE_GBP_ACCESS_TOKEN / google-oauth-gbp.json */
  static gbpFromEnv(opts: {
    env?: NodeJS.ProcessEnv;
    pluginDataDir: string;
    fetchImpl: typeof fetch;
  }): AuthPort {
    const env = opts.env ?? process.env;
    return new AuthPort(
      [
        new HostInjectedGbpTokenSource(env),
        new PkceTokenSource(opts.pluginDataDir, env.GOOGLE_OAUTH_GBP_CLIENT_ID, opts.fetchImpl, {
          storeFile: STORE_FILE.gbp,
          clientSecret: env.GOOGLE_OAUTH_GBP_CLIENT_SECRET,
        }),
      ],
      "authport-gbp",
    );
  }

  /** GA4 Admin writes — legacy G store, then free Google when analytics.edit is present. */
  static ga4AdminFromEnv(opts: {
    env?: NodeJS.ProcessEnv;
    pluginDataDir: string;
    fetchImpl: typeof fetch;
  }): AuthPort {
    const env = opts.env ?? process.env;
    return new AuthPort(
      [
        new HostInjectedGa4AdminTokenSource(env),
        new PkceTokenSource(opts.pluginDataDir, env.GOOGLE_OAUTH_GA4_ADMIN_CLIENT_ID, opts.fetchImpl, {
          storeFile: STORE_FILE.ga4Admin,
          clientSecret: env.GOOGLE_OAUTH_GA4_ADMIN_CLIENT_SECRET,
        }),
        ...AuthPort.freeGoogleWhenScoped(opts, env, CONSENT_G, "g"),
      ],
      "authport-ga4-admin",
    );
  }

  /** GSC writes — legacy S store, then free Google when webmasters write is present. */
  static gscWriteFromEnv(opts: {
    env?: NodeJS.ProcessEnv;
    pluginDataDir: string;
    fetchImpl: typeof fetch;
  }): AuthPort {
    const env = opts.env ?? process.env;
    return new AuthPort(
      [
        new HostInjectedGscWriteTokenSource(env),
        new PkceTokenSource(opts.pluginDataDir, env.GOOGLE_OAUTH_GSC_WRITE_CLIENT_ID, opts.fetchImpl, {
          storeFile: STORE_FILE.gscWrite,
          clientSecret: env.GOOGLE_OAUTH_GSC_WRITE_CLIENT_SECRET,
        }),
        ...AuthPort.freeGoogleWhenScoped(opts, env, CONSENT_S, "s"),
      ],
      "authport-gsc-write",
    );
  }

  private static freeGoogleWhenScoped(
    opts: { pluginDataDir: string; fetchImpl: typeof fetch },
    env: NodeJS.ProcessEnv,
    requiredScopes: readonly string[],
    lane: "w" | "g" | "s",
  ): AccessTokenSource[] {
    return [
      new ScopedTokenSource(new HostInjectedTokenSource(env), requiredScopes, `host-injected-a-${lane}`),
      new ScopedTokenSource(
        new PkceTokenSource(opts.pluginDataDir, env.GOOGLE_OAUTH_CLIENT_ID, opts.fetchImpl, {
          storeFile: STORE_FILE.a,
          clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        }),
        requiredScopes,
        `pkce-a-${lane}`,
      ),
    ];
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

  /** TikTok user — TIKTOK_ACCESS_TOKEN / tiktok-oauth.json (no Google refresh). */
  static tiktokFromEnv(opts: {
    env?: NodeJS.ProcessEnv;
    pluginDataDir: string;
  }): AuthPort {
    const env = opts.env ?? process.env;
    return new AuthPort(
      [new HostInjectedTikTokTokenSource(env), new FileTokenSource(opts.pluginDataDir, STORE_FILE.tiktok)],
      "authport-tiktok",
    );
  }

  async getAccessToken(): Promise<AccessToken | null> {
    for (const src of this.sources) {
      const tok = await src.getAccessToken();
      if (tok?.accessToken) return tok;
    }
    return null;
  }

  invalidateAccessToken(): void {
    for (const src of this.sources) {
      src.invalidateAccessToken?.();
    }
  }
}
