import { createServer } from "node:http";
import { buildGoogleAuthUrl, exchangeAuthorizationCode, generatePkce } from "./pkce.js";
import { writeStore, STORE_FILE } from "./store.js";
import { CONSENT_A, CONSENT_B, CONSENT_C_GOOGLE, CONSENT_MC, CONSENT_W_GTM } from "../google/scopes.js";
import { postMetaExchange } from "../gateway/meta-exchange.js";
import { postLicenseRedeem } from "../gateway/license-redeem.js";
import {
  loadLicenseToken,
  verifyLicenseJwt,
  hasFeature,
  writeLicenseToken,
} from "../license/verify.js";
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

/**
 * Consent W GTM write PKCE — separate client; never merges write scopes into Consent A.
 * Writes PLUGIN_DATA/google-oauth-write.json only. Fail-closed without GOOGLE_OAUTH_WRITE_CLIENT_ID.
 * Does NOT enable DGTL_WRITES_ENABLED — flag stays default false until Noel opts in locally.
 */
export async function runAuthLoginWrite(opts: {
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
    scopes: CONSENT_W_GTM,
    storeFile: STORE_FILE.w,
    laneLabel: "Consent W (GTM writes)",
  });
}

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
 * Consent MC Merchant API PKCE — separate client; never adds content to Consent A.
 * Writes PLUGIN_DATA/google-oauth-mc.json only. Fail-closed without GOOGLE_OAUTH_MC_CLIENT_ID.
 * Wave 4 tools are GET-only even though Google's content scope is read/write.
 */
export async function runAuthLoginMc(opts: {
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
    scopes: CONSENT_MC,
    storeFile: STORE_FILE.mc,
    laneLabel: "Consent MC (Merchant Center)",
  });
}

/**
 * Consent B GBP PKCE — separate client; never adds business.manage to Consent A.
 * Writes PLUGIN_DATA/google-oauth-gbp.json only. Fail-closed without GOOGLE_OAUTH_GBP_CLIENT_ID.
 * Wave 5 tools are GET-only even though Google's business.manage scope is read/write.
 * Does NOT enable DGTL_GBP_ENABLED — flag stays default false until Noel opts in (quota).
 */
export async function runAuthLoginGbp(opts: {
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
    scopes: CONSENT_B,
    storeFile: STORE_FILE.gbp,
    laneLabel: "Consent B (GBP)",
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
      "usage: dgtl-connector-mcp auth login-meta --code <one-time-grant-code>\n" +
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

/**
 * Parse `auth redeem --code <value>` / `--checkout-id <value>` (also `=` forms).
 * Returns null when neither/both/empty.
 */
export function parseRedeemArgs(
  argv: string[],
): { code: string } | { checkout_id: string } | null {
  let code: string | null = null;
  let checkoutId: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--code") {
      const v = argv[i + 1];
      if (typeof v === "string" && v.trim() && !v.startsWith("-")) code = v.trim();
      else return null;
      i++;
      continue;
    }
    if (a.startsWith("--code=")) {
      const v = a.slice("--code=".length).trim();
      if (!v) return null;
      code = v;
      continue;
    }
    if (a === "--checkout-id") {
      const v = argv[i + 1];
      if (typeof v === "string" && v.trim() && !v.startsWith("-")) checkoutId = v.trim();
      else return null;
      i++;
      continue;
    }
    if (a.startsWith("--checkout-id=")) {
      const v = a.slice("--checkout-id=".length).trim();
      if (!v) return null;
      checkoutId = v;
      continue;
    }
  }
  if (code && !checkoutId) return { code };
  if (checkoutId && !code) return { checkout_id: checkoutId };
  return null;
}

/**
 * Redeem Polar one-time code or checkout_id via Worker POST /v1/license.
 * Writes PLUGIN_DATA/license.jwt. Fail-closed without DGTL_GATEWAY_URL.
 * Never prints the JWT — only ok + kid/exp/features.
 */
export async function runAuthRedeem(opts: {
  code?: string;
  checkoutId?: string;
  pluginDataDir: string;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
}): Promise<number> {
  const code = opts.code?.trim() ?? "";
  const checkoutId = opts.checkoutId?.trim() ?? "";
  if ((code && checkoutId) || (!code && !checkoutId)) {
    process.stderr.write(
      "usage: dgtl-connector-mcp auth redeem --code <one-time-code>\n" +
        "   or: dgtl-connector-mcp auth redeem --checkout-id <uuid|polar_c_*>\n" +
        "Requires DGTL_GATEWAY_URL. Never paste the JWT into chat; redeem writes PLUGIN_DATA/license.jwt.\n",
    );
    return 1;
  }

  const result = await postLicenseRedeem({
    env: opts.env,
    fetchImpl: opts.fetchImpl,
    request: code ? { code } : { checkout_id: checkoutId },
  });

  if (!result.ok) {
    process.stderr.write(`${result.message}\n`);
    if (result.hint) process.stderr.write(`hint: ${result.hint}\n`);
    return 1;
  }

  const verified = verifyLicenseJwt(result.token);
  if (!verified.ok) {
    process.stderr.write(
      `License redeem returned a token that failed local verify (${verified.reason ?? "invalid"}).\n`,
    );
    process.stderr.write(
      "hint: Check DGTL_GATEWAY_URL points at the live stamp Worker and the plugin embeds the mint kid.\n",
    );
    return 1;
  }

  writeLicenseToken(opts.pluginDataDir, result.token);
  // Never print the JWT — ok + kid/exp/features only.
  const features = verified.features.length ? verified.features.join(",") : "(none)";
  const kid = verified.kid ?? "(unknown)";
  const exp = verified.exp ?? result.exp;
  process.stderr.write(
    `ok license redeemed → PLUGIN_DATA/license.jwt (token not logged)\n` +
      `  kid=${kid} exp=${exp ?? "(none)"} features=${features}\n`,
  );
  return 0;
}

export function helpText(): string {
  return `dgtl-connector-mcp — local stdio MCP for GA4, Search Console, Tag Manager

USAGE
  dgtl-connector-mcp              Start MCP on stdio (hosts spawn this)
  dgtl-connector-mcp --help       Show this help and exit 0
  dgtl-connector-mcp --version    Print version
  dgtl-connector-mcp doctor           Human checklist (no secrets); also: auth doctor
  dgtl-connector-mcp auth login       Installed-app PKCE (Consent A)
  dgtl-connector-mcp auth login-ads   Consent C Ads PKCE (separate client; adwords)
  dgtl-connector-mcp auth login-mc    Consent MC Merchant Center PKCE (separate client; content)
  dgtl-connector-mcp auth login-gbp   Consent B GBP PKCE (separate client; business.manage)
  dgtl-connector-mcp auth login-write Consent W GTM write PKCE (separate client; never Consent A)
  dgtl-connector-mcp auth login-meta --code <grant>  Redeem hosted Meta Login code
  dgtl-connector-mcp auth redeem --code|--checkout-id  Redeem Polar license → license.jwt
  dgtl-connector-mcp auth status      Show whether token sources are configured
  dgtl-connector-mcp auth logout      Delete PLUGIN_DATA/google-oauth.json (A only)
  dgtl-connector-mcp auth logout-ads  Delete PLUGIN_DATA/google-oauth-ads.json
  dgtl-connector-mcp auth logout-mc   Delete PLUGIN_DATA/google-oauth-mc.json
  dgtl-connector-mcp auth logout-gbp  Delete PLUGIN_DATA/google-oauth-gbp.json
  dgtl-connector-mcp auth logout-write Delete PLUGIN_DATA/google-oauth-write.json
  dgtl-connector-mcp auth logout-meta Delete PLUGIN_DATA/meta-oauth.json

AUTH (stdio is Manual — there is no Gmail-style Connect card)
  1. Host-injected: set GOOGLE_ACCESS_TOKEN (and optional GOOGLE_GRANTED_SCOPES)
  2. PKCE fallback: set GOOGLE_OAUTH_CLIENT_ID (public Desktop client, no secret)
     then run auth login. Tokens stay in PLUGIN_DATA/google-oauth.json (Consent A).

Consent W (writes), Consent C (Ads/Meta), Consent MC, and Consent B (GBP) use
  separate stores:
  GOOGLE_WRITE_ACCESS_TOKEN / google-oauth-write.json  (or auth login-write)
  GOOGLE_ADS_ACCESS_TOKEN / google-oauth-ads.json  (or auth login-ads)
  GOOGLE_MC_ACCESS_TOKEN / google-oauth-mc.json    (or auth login-mc)
  GOOGLE_GBP_ACCESS_TOKEN / google-oauth-gbp.json  (or auth login-gbp)
  META_ACCESS_TOKEN / meta-oauth.json              (or auth login-meta --code)
  They never reuse Consent A AuthPort. Do not add adwords, content, or
  business.manage to Consent A.

Consent W: set GOOGLE_OAUTH_WRITE_CLIENT_ID (separate Desktop client; or put
  GOOGLE_OAUTH_WRITE_CLIENT_ID/SECRET in gitignored .env.write.local) then
  auth login-write → PLUGIN_DATA/google-oauth-write.json with CONSENT_W_GTM
  (tagmanager.edit.containers + tagmanager.publish). Never reuse
  GOOGLE_OAUTH_CLIENT_SECRET / Consent A. Does not turn on DGTL_WRITES_ENABLED.

Consent C Ads: set GOOGLE_OAUTH_ADS_CLIENT_ID (separate Desktop client) then
  auth login-ads. Fail-closed without that client id. Paid tools still need
  DGTL_GATEWAY_URL + license JWT — this binary never ships a developer-token.

Consent MC (Merchant Center): set GOOGLE_OAUTH_MC_CLIENT_ID (separate Desktop
  client) then auth login-mc → PLUGIN_DATA/google-oauth-mc.json with scope
  content. Never reuse Consent A. Direct Merchant API hop (no stamp — Ads
  developer-token is the wrong secret). Tools are GET-only. Needs Pro (ads)
  license. Live API enablement on that GCP project is a Noel gate.

Consent B (GBP): set GOOGLE_OAUTH_GBP_CLIENT_ID (separate Desktop client) then
  auth login-gbp → PLUGIN_DATA/google-oauth-gbp.json with scope business.manage.
  Never reuse Consent A. Direct GBP hop (no stamp). Tools are GET-only (no
  posts/replies). Flag DGTL_GBP_ENABLED stays default false; login-gbp does not
  flip it. Live quota (Basic API Access) is a Noel gate.

Meta: prefer host-injected META_ACCESS_TOKEN. Otherwise redeem a hosted Login
  one-time grant code: auth login-meta --code <code> → POST /v1/meta/exchange.
  Exchange returns the long-lived token to the plugin; Worker stores nothing.
  Requires DGTL_GATEWAY_URL + license with meta. Support never collects Meta tokens.
  Hosted Login UI (PR-3b) is Noel-gated — do not deploy a Meta demo hostname here.

License: after Polar checkout, run auth redeem --code <code> or
  --checkout-id <uuid|polar_c_*> (stamp accepts both; needs DGTL_GATEWAY_URL
  → POST /v1/license). Writes
  PLUGIN_DATA/license.jwt; never prints the JWT. Or set DGTL_LICENSE_JWT.
  Checkout: https://buy.polar.sh/polar_cl_yZECJ26Ln9mGTQDwBETXCskJRMTwrYAd6thMJO1zHPk
  (site: https://www.dgtlsunrise.com/). Gateway example:
  https://stamp.dgtlsunrise.com (backup: https://dgtl-stamp.noel-4ea.workers.dev)

Shopify (free local): set SHOPIFY_STORE + SHOPIFY_ACCESS_TOKEN (merchant custom
  app; read_products + read_orders + read_inventory + read_locations) or
  PLUGIN_DATA/shopify-oauth.json. Fail closed SHOPIFY_NOT_CONNECTED. No Polar /
  stamp / vault. write_inventory is opt-in + DGTL_WRITES_ENABLED (default off).

Paid Google Ads / Meta tools are listed and return LICENSE_REQUIRED until a
DGTL license JWT is present. This binary never ships a developer-token.

DIAGNOSTICS
  doctor / auth doctor prints node + package versions, whether dist/ exists,
  which known env names are SET (never values), PLUGIN_DATA file existence
  (Consent A/C/W/MC, Meta, Shopify, license.jwt), plugin vs Worker dual-gate
  mutate booleans, and a local license summary (valid/invalid/missing features).
  Never prints tokens, JWT, or gateway URLs. Exits 1 if there is no build or
  no way to auth. Same as \`npm run doctor\`.
`;
}
