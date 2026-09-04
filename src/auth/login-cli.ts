import { createServer } from "node:http";
import { buildGoogleAuthUrl, exchangeAuthorizationCode, generatePkce } from "./pkce.js";
import { writeStore, STORE_FILE } from "./store.js";
import { CONSENT_A, CONSENT_C_GOOGLE } from "../google/scopes.js";
import { postMetaExchange } from "../gateway/meta-exchange.js";
import { loadLicenseToken, verifyLicenseJwt, hasFeature } from "../license/verify.js";
import { MSG } from "../errors.js";

/**
 * Installed-app PKCE for one Google consent lane.
 * Tokens land in PLUGIN_DATA under storeFile. Refresh token is never printed.
 */
export async function runGooglePkceLogin(opts: {
  clientId: string;
  clientSecret?: string;
  /** False for Consent C — never reuse GOOGLE_OAUTH_CLIENT_SECRET. */
  allowConsentASecretFallback?: boolean;
  pluginDataDir: string;
  fetchImpl: typeof fetch;
  scopes: readonly string[];
  storeFile: string;
  /** stderr label, e.g. "Consent A" / "Consent C (Ads)" */
  laneLabel: string;
}): Promise<number> {
  const pkce = generatePkce();
  let redirectUri = "";
  const server = createServer();
  const done = new Promise<number>((resolve, reject) => {
    server.on("error", reject);
    server.on("request", async (req, res) => {
      try {
        const u = new URL(req.url ?? "/", "http://127.0.0.1");
        if (u.pathname !== "/callback") {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        const err = u.searchParams.get("error");
        const code = u.searchParams.get("code");
        const state = u.searchParams.get("state");
        if (err) {
          res.end("Authorization failed. You can close this tab.");
          process.stderr.write(`auth error: ${err}\n`);
          server.close(() => resolve(1));
          return;
        }
        if (!code || state !== pkce.state) {
          res.statusCode = 400;
          res.end("state mismatch");
          server.close(() => resolve(1));
          return;
        }
        const tokens = await exchangeAuthorizationCode(
          {
            clientId: opts.clientId,
            code,
            verifier: pkce.verifier,
            redirectUri,
            clientSecret: opts.clientSecret,
            allowConsentASecretFallback: opts.allowConsentASecretFallback !== false,
          },
          opts.fetchImpl,
        );
        writeStore(
          opts.pluginDataDir,
          {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expiry: Date.now() + (tokens.expires_in ?? 3600) * 1000,
            scopes: tokens.scope?.split(/\s+/).filter(Boolean),
            token_type: tokens.token_type,
          },
          opts.storeFile,
        );
        res.end(
          `DGTL marketing: ${opts.laneLabel} authorization saved on this computer. You can close this tab.`,
        );
        process.stderr.write(
          `Authorization saved to PLUGIN_DATA/${opts.storeFile} (${opts.laneLabel}; refresh token not logged).\n`,
        );
        server.close(() => resolve(0));
      } catch (e) {
        res.statusCode = 500;
        res.end("token exchange failed");
        process.stderr.write(`token exchange failed: ${e instanceof Error ? e.message : String(e)}\n`);
        server.close(() => resolve(1));
      }
    });
    const redirectPortRaw = process.env.GOOGLE_OAUTH_REDIRECT_PORT;
    const redirectPort =
      redirectPortRaw !== undefined && redirectPortRaw !== ""
        ? Number.parseInt(redirectPortRaw, 10)
        : 0;
    const listenPort = Number.isInteger(redirectPort) && redirectPort >= 0 ? redirectPort : 0;
    server.listen(listenPort, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("failed to bind loopback"));
        return;
      }
      redirectUri = `http://127.0.0.1:${addr.port}/callback`;
      const url = buildGoogleAuthUrl({
        clientId: opts.clientId,
        redirectUri,
        challenge: pkce.challenge,
        state: pkce.state,
        scopes: opts.scopes,
      });
      process.stderr.write(
        `Open this URL in a browser (installed-app PKCE; ${opts.laneLabel}; not a Gmail Connect card):\n`,
      );
      process.stderr.write(`${url}\n`);
    });
  });
  return await done;
}

/**
 * Installed-app PKCE fallback. Documented advanced path — not a Connect card.
 * Tokens land in PLUGIN_DATA. Refresh token is never printed.
 */
export async function runAuthLogin(opts: {
  clientId: string;
  pluginDataDir: string;
  fetchImpl: typeof fetch;
}): Promise<number> {
  return runGooglePkceLogin({
    clientId: opts.clientId,
    pluginDataDir: opts.pluginDataDir,
    fetchImpl: opts.fetchImpl,
    scopes: CONSENT_A,
    storeFile: STORE_FILE.a,
    laneLabel: "Consent A",
    allowConsentASecretFallback: true,
  });
}

/**
 * Consent C Google Ads PKCE — separate client ids; never adds adwords to Consent A.
 * Writes PLUGIN_DATA/google-oauth-ads.json only. Fail-closed without GOOGLE_OAUTH_ADS_CLIENT_ID.
 * Tools still need DGTL_GATEWAY_URL + license (no developer-token in this binary).
 */
export async function runAuthLoginAds(opts: {
  clientId: string;
  clientSecret?: string;
  pluginDataDir: string;
  fetchImpl: typeof fetch;
}): Promise<number> {
  return runGooglePkceLogin({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    allowConsentASecretFallback: false,
    pluginDataDir: opts.pluginDataDir,
    fetchImpl: opts.fetchImpl,
    scopes: CONSENT_C_GOOGLE,
    storeFile: STORE_FILE.ads,
    laneLabel: "Consent C (Ads)",
  });
}

/**
 * Parse `auth login-meta --code <value>` / `--code=<value>` from argv after the subcommand.
 * Returns null when --code is missing or empty.
 */
export function parseLoginMetaCode(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--code") {
      const v = argv[i + 1];
      if (typeof v === "string" && v.trim() && !v.startsWith("-")) return v.trim();
      return null;
    }
    if (a.startsWith("--code=")) {
      const v = a.slice("--code=".length).trim();
      return v || null;
    }
  }
  return null;
}

/**
 * Redeem hosted Login one-time grant code via Worker POST /v1/meta/exchange.
 * Long-lived token is written to PLUGIN_DATA/meta-oauth.json; Worker stores nothing.
 * Fail-closed without gateway URL / license / code. Never prints the Meta token.
 * Loopback Meta Login without hosted redirect is not v1 default (PR-3b Noel-gated).
 */
export async function runAuthLoginMeta(opts: {
  grantCode: string;
  pluginDataDir: string;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
}): Promise<number> {
  const code = opts.grantCode.trim();
  if (!code) {
    process.stderr.write(
      "usage: dgtl-marketing-mcp auth login-meta --code <one-time-grant-code>\n" +
        "Host-injected META_ACCESS_TOKEN also works (no exchange). Support never collects Meta tokens.\n",
    );
    return 1;
  }

  const licenseJwt = loadLicenseToken(opts.env, opts.pluginDataDir);
  const license = verifyLicenseJwt(licenseJwt);
  if (!hasFeature(license, "meta")) {
    process.stderr.write(`${MSG.LICENSE_REQUIRED}\n`);
    process.stderr.write(
      "hint: Meta exchange needs a valid DGTL license JWT with features including meta.\n",
    );
    return 1;
  }

  const result = await postMetaExchange({
    env: opts.env,
    pluginDataDir: opts.pluginDataDir,
    fetchImpl: opts.fetchImpl,
    request: { grant_code: code },
  });

  if (!result.ok) {
    process.stderr.write(`${result.message}\n`);
    if (result.hint) process.stderr.write(`hint: ${result.hint}\n`);
    return 1;
  }

  writeStore(
    opts.pluginDataDir,
    {
      access_token: result.access_token,
      expiry: Date.now() + result.expires_in * 1000,
      token_type: result.token_type,
      scopes: ["ads_read"],
    },
    STORE_FILE.meta,
  );
  // Never print the Meta token.
  process.stderr.write(
    "Meta authorization saved to PLUGIN_DATA/meta-oauth.json (token not logged). Worker stores nothing.\n",
  );
  return 0;
}

export function helpText(): string {
  return `dgtl-marketing-mcp — local stdio MCP for GA4, Search Console, Tag Manager

USAGE
  dgtl-marketing-mcp              Start MCP on stdio (hosts spawn this)
  dgtl-marketing-mcp --help       Show this help and exit 0
  dgtl-marketing-mcp --version    Print version
  dgtl-marketing-mcp auth login       Installed-app PKCE (Consent A)
  dgtl-marketing-mcp auth login-ads   Consent C Ads PKCE (separate client; adwords)
  dgtl-marketing-mcp auth login-meta --code <grant>  Redeem hosted Meta Login code
  dgtl-marketing-mcp auth status      Show whether token sources are configured
  dgtl-marketing-mcp auth logout      Delete PLUGIN_DATA/google-oauth.json (A only)
  dgtl-marketing-mcp auth logout-ads  Delete PLUGIN_DATA/google-oauth-ads.json
  dgtl-marketing-mcp auth logout-meta Delete PLUGIN_DATA/meta-oauth.json

AUTH (stdio is Manual — there is no Gmail-style Connect card)
  1. Host-injected: set GOOGLE_ACCESS_TOKEN (and optional GOOGLE_GRANTED_SCOPES)
  2. PKCE fallback: set GOOGLE_OAUTH_CLIENT_ID (public Desktop client, no secret)
     then run auth login. Tokens stay in PLUGIN_DATA/google-oauth.json (Consent A).

Consent W (writes) and Consent C (Ads/Meta) use separate stores and env tokens:
  GOOGLE_WRITE_ACCESS_TOKEN / google-oauth-write.json
  GOOGLE_ADS_ACCESS_TOKEN / google-oauth-ads.json  (or auth login-ads)
  META_ACCESS_TOKEN / meta-oauth.json              (or auth login-meta --code)
  They never reuse Consent A AuthPort. Do not add adwords to Consent A.

Consent C Ads: set GOOGLE_OAUTH_ADS_CLIENT_ID (separate Desktop client) then
  auth login-ads. Fail-closed without that client id. Paid tools still need
  DGTL_GATEWAY_URL + license JWT — this binary never ships a developer-token.

Meta: prefer host-injected META_ACCESS_TOKEN. Otherwise redeem a hosted Login
  one-time grant code: auth login-meta --code <code> → POST /v1/meta/exchange.
  Exchange returns the long-lived token to the plugin; Worker stores nothing.
  Requires DGTL_GATEWAY_URL + license with meta. Support never collects Meta tokens.
  Hosted Login UI (PR-3b) is Noel-gated — do not deploy a Meta demo hostname here.

Paid Google Ads / Meta tools are listed and return LICENSE_REQUIRED until a
DGTL license JWT is present. This binary never ships a developer-token.
`;
}
