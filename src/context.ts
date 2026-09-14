import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthPort } from "./auth/port.js";
import type { AccessTokenSource } from "./auth/types.js";
import { loadFlags, type Flags } from "./flags.js";
import { GBP_HOSTS } from "./google/scopes.js";
import { GoogleHttp } from "./http/google.js";
import { GoogleGa4AdminHttp } from "./http/google-ga4-admin.js";
import { GoogleGscWriteHttp } from "./http/google-gsc-write.js";
import { GoogleMcWriteHttp } from "./http/google-mc-write.js";
import { GoogleWriteHttp } from "./http/google-write.js";
import type { HttpCall } from "./http/calls.js";
import { ga4MetadataCacheTtlMs, MetadataCache, metadataCacheTtlMs } from "./http/metadata-cache.js";
import { GatewayHealthCache, gatewayHealthTtlMs } from "./gateway/client.js";
import { loadLicenseToken, verifyLicenseJwt, type LicenseStatus } from "./license/verify.js";

export type AppContext = {
  pluginRoot: string;
  pluginDataDir: string;
  /** Free Google (CONSENT_A). Ads/MC/GBP/Meta/TikTok must not read this. */
  auth: AccessTokenSource;
  /** GTM writes — legacy W store, then Free Google when GTM write scopes are present. */
  authWrite: AccessTokenSource;
  /** Consent C Google Ads — GOOGLE_ADS_ACCESS_TOKEN / google-oauth-ads.json */
  authAds: AccessTokenSource;
  /** Consent MC Merchant API — GOOGLE_MC_ACCESS_TOKEN / google-oauth-mc.json */
  authMc: AccessTokenSource;
  /** Consent B GBP — GOOGLE_GBP_ACCESS_TOKEN / google-oauth-gbp.json */
  authGbp: AccessTokenSource;
  /** Meta user — META_ACCESS_TOKEN / meta-oauth.json */
  authMeta: AccessTokenSource;
  /** TikTok user — TIKTOK_ACCESS_TOKEN / tiktok-oauth.json */
  authTiktok: AccessTokenSource;
  /** GA4 Admin writes — legacy G store, then Free Google when analytics.edit is present. */
  authGa4Admin: AccessTokenSource;
  /** GSC writes — legacy S store, then Free Google when webmasters write is present. */
  authGscWrite: AccessTokenSource;
  http: GoogleHttp;
  /** GTM mutate client — authWrite, not Ads/MC/GBP. */
  httpWrite: GoogleWriteHttp;
  /** GA4 Admin mutate client — authGa4Admin. */
  httpGa4Admin: GoogleGa4AdminHttp;
  /** GSC sitemap mutate client — authGscWrite. */
  httpGscWrite: GoogleGscWriteHttp;
  /** Consent MC Merchant API read client — never wired to ctx.auth / Consent A. GET-only. */
  httpMc: GoogleHttp;
  /** Consent MC ProductInput / API data-source writes — same AuthPort as reads. */
  httpMcWrite: GoogleMcWriteHttp;
  /** Consent B GBP client — never wired to ctx.auth / Consent A. GET-only hosts. */
  httpGbp: GoogleHttp;
  fetchImpl: typeof fetch;
  flags: Flags;
  license: LicenseStatus;
  calls: HttpCall[];
  /** In-process list/metadata envelope cache. Per context; never disk. */
  metadataCache: MetadataCache;
  /** Short-TTL GET /v1/health result. Per context; never disk. */
  gatewayHealthCache: GatewayHealthCache;
  now: () => Date;
  env: NodeJS.ProcessEnv;
};

export function detectPluginRoot(fromMetaUrl: string): string {
  // dist/index.js or src/index.ts → parent is plugin root
  const here = dirname(fileURLToPath(fromMetaUrl));
  return process.env.PLUGIN_ROOT || process.env.GROK_PLUGIN_ROOT || join(here, "..");
}

export function detectPluginData(pluginRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.PLUGIN_DATA ||
    env.GROK_PLUGIN_DATA ||
    env.CLAUDE_PLUGIN_DATA ||
    join(homedir(), ".dgtl-connector")
  );
}

export function createAppContext(opts: {
  pluginRoot: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  auth?: AccessTokenSource;
  authWrite?: AccessTokenSource;
  authAds?: AccessTokenSource;
  authMc?: AccessTokenSource;
  authGbp?: AccessTokenSource;
  authMeta?: AccessTokenSource;
  authTiktok?: AccessTokenSource;
  authGa4Admin?: AccessTokenSource;
  authGscWrite?: AccessTokenSource;
}): AppContext {
  const env = opts.env ?? process.env;
  const pluginDataDir = detectPluginData(opts.pluginRoot, env);
  const calls: HttpCall[] = [];
  const fetchImpl = opts.fetchImpl ?? fetch;
  const auth = opts.auth ?? AuthPort.fromEnv({ env, pluginDataDir, fetchImpl });
  const authWrite = opts.authWrite ?? AuthPort.writeFromEnv({ env, pluginDataDir, fetchImpl });
  const authAds = opts.authAds ?? AuthPort.adsFromEnv({ env, pluginDataDir, fetchImpl });
  const authMc = opts.authMc ?? AuthPort.mcFromEnv({ env, pluginDataDir, fetchImpl });
  const authGbp = opts.authGbp ?? AuthPort.gbpFromEnv({ env, pluginDataDir, fetchImpl });
  const authMeta = opts.authMeta ?? AuthPort.metaFromEnv({ env, pluginDataDir });
  const authTiktok = opts.authTiktok ?? AuthPort.tiktokFromEnv({ env, pluginDataDir });
  const authGa4Admin = opts.authGa4Admin ?? AuthPort.ga4AdminFromEnv({ env, pluginDataDir, fetchImpl });
  const authGscWrite = opts.authGscWrite ?? AuthPort.gscWriteFromEnv({ env, pluginDataDir, fetchImpl });
  const http = new GoogleHttp({ tokenSource: auth, fetchImpl, calls });
  const httpWrite = new GoogleWriteHttp({ tokenSource: authWrite, fetchImpl, calls });
  const httpGa4Admin = new GoogleGa4AdminHttp({ tokenSource: authGa4Admin, fetchImpl, calls });
  const httpGscWrite = new GoogleGscWriteHttp({ tokenSource: authGscWrite, fetchImpl, calls });
  const httpMc = new GoogleHttp({
    tokenSource: authMc,
    fetchImpl,
    calls,
    allowedHosts: new Set(["merchantapi.googleapis.com"]),
  });
  const httpMcWrite = new GoogleMcWriteHttp({ tokenSource: authMc, fetchImpl, calls });
  const httpGbp = new GoogleHttp({
    tokenSource: authGbp,
    fetchImpl,
    calls,
    allowedHosts: GBP_HOSTS,
  });
  const license = verifyLicenseJwt(loadLicenseToken(env, pluginDataDir));
  const now = opts.now ?? (() => new Date());
  const metadataCache = new MetadataCache({
    ttlMs: metadataCacheTtlMs(env),
    catalogTtlMs: ga4MetadataCacheTtlMs(env),
    now: () => now().getTime(),
  });
  const gatewayHealthCache = new GatewayHealthCache({
    ttlMs: gatewayHealthTtlMs(env),
    now: () => now().getTime(),
  });
  return {
    pluginRoot: opts.pluginRoot,
    pluginDataDir,
    auth,
    authWrite,
    authAds,
    authMc,
    authGbp,
    authMeta,
    authTiktok,
    authGa4Admin,
    authGscWrite,
    http,
    httpWrite,
    httpGa4Admin,
    httpGscWrite,
    httpMc,
    httpMcWrite,
    httpGbp,
    fetchImpl,
    flags: loadFlags(env),
    license,
    calls,
    metadataCache,
    gatewayHealthCache,
    now,
    env,
  };
}
