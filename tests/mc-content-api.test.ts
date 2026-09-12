import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { AuthPort } from "../src/auth/port.js";
import { STORE_FILE, writeStore } from "../src/auth/store.js";
import { CONSENT_A, CONSENT_MC, SCOPE } from "../src/google/scopes.js";
import { buildGoogleAuthUrl, generatePkce } from "../src/auth/pkce.js";
import { helpText } from "../src/auth/login-cli.js";
import { dispatch } from "../src/tools/dispatch.js";
import { LICENSE_GATED_TOOLS, LOCAL_FREE_TOOLS, TOOLS } from "../src/tools/registry.js";
import {
  installNetworkGuard,
  makeCtx,
  signLicense,
  testEnv,
  TEST_TOKEN,
} from "./helpers.js";

const MC_READ = [
  "mc_list_accounts",
  "mc_list_products",
  "mc_get_product",
  "mc_list_product_statuses",
  "mc_list_account_issues",
  "mc_list_data_sources",
] as const;

function adsLicenseEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const jwt = signLicense({
    sub: "user_test",
    features: ["ads", "meta"],
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "jti-wave4-mc",
  });
  return testEnv({
    DGTL_LICENSE_JWT: jwt,
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    GOOGLE_MC_ACCESS_TOKEN: "mc-user-token-fixture",
    GOOGLE_MC_GRANTED_SCOPES: SCOPE.content,
    ...extra,
  });
}

describe("Wave 4 Merchant Center Content API (Merchant API)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("MC tools are registered readonly and Polar-gated (not Consent A, not stamp)", () => {
    for (const name of MC_READ) {
      const t = TOOLS.find((x) => x.name === name);
      assert.ok(t, name);
      assert.equal(t!.family, "mc", name);
      assert.equal(t!.group, "mc", name);
      assert.equal(t!.annotations.readOnlyHint, true, name);
      assert.equal(t!.annotations.destructiveHint, false, name);
      assert.ok(LICENSE_GATED_TOOLS.includes(name), name);
      assert.ok(!LOCAL_FREE_TOOLS.includes(name), name);
    }
    assert.ok(!TOOLS.some((t) => t.name === "mc_mutate"));
    assert.ok(!TOOLS.some((t) => t.name === "mc_insert_product"));
  });

  it("CONSENT_MC is content only and never on Consent A / default auth URL", () => {
    assert.deepEqual([...CONSENT_MC], [SCOPE.content]);
    assert.ok(!(CONSENT_A as readonly string[]).includes(SCOPE.content));
    const pkce = generatePkce();
    const aUrl = buildGoogleAuthUrl({
      clientId: "a-client.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:9876/callback",
      challenge: pkce.challenge,
      state: pkce.state,
    });
    const granted = new URL(aUrl).searchParams.get("scope")?.split(/\s+/) ?? [];
    assert.deepEqual(granted, [...CONSENT_A]);
    assert.ok(!granted.includes(SCOPE.content));
    assert.ok(!aUrl.includes("auth/content"));

    const mcUrl = buildGoogleAuthUrl({
      clientId: "mc-client.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:9876/callback",
      challenge: pkce.challenge,
      state: pkce.state,
      scopes: CONSENT_MC,
    });
    assert.deepEqual(new URL(mcUrl).searchParams.get("scope")?.split(/\s+/), [SCOPE.content]);
    assert.ok(!new URL(mcUrl).searchParams.get("scope")?.includes("analytics.readonly"));
  });

  it("helpText documents login-mc and never-Consent-A", () => {
    const h = helpText();
    assert.ok(h.includes("auth login-mc"));
    assert.ok(h.includes("auth logout-mc"));
    assert.ok(h.includes("GOOGLE_MC_ACCESS_TOKEN") || h.includes("google-oauth-mc.json"));
    assert.ok(h.includes("Do not add adwords or content to Consent A") || h.includes("content"));
    assert.ok(h.includes("no stamp") || h.includes("Direct Merchant API"));
  });

  it("AuthPort A ignores MC token; MC port ignores Consent A", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-mc-ports-"));
    try {
      const fetchImpl = (async () => {
        throw new Error("NETWORK_FORBIDDEN");
      }) as typeof fetch;
      const a = AuthPort.fromEnv({
        env: { GOOGLE_MC_ACCESS_TOKEN: "mc-only", GOOGLE_ADS_ACCESS_TOKEN: "ads-only" },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal(await a.getAccessToken(), null);

      const mc = AuthPort.mcFromEnv({
        env: { GOOGLE_ACCESS_TOKEN: "consent-a", GOOGLE_ADS_ACCESS_TOKEN: "ads-only" },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal(await mc.getAccessToken(), null);

      const mc2 = AuthPort.mcFromEnv({
        env: { GOOGLE_MC_ACCESS_TOKEN: "mc-only" },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal((await mc2.getAccessToken())?.accessToken, "mc-only");

      writeStore(dir, { access_token: "a-token", expiry: Date.now() + 3_600_000 }, STORE_FILE.a);
      writeStore(dir, { access_token: "mc-file", expiry: Date.now() + 3_600_000 }, STORE_FILE.mc);
      assert.ok(!readFileSync(join(dir, "google-oauth.json"), "utf8").includes("mc-file"));
      assert.ok(!readFileSync(join(dir, "google-oauth-mc.json"), "utf8").includes("a-token"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no license → LICENSE_REQUIRED; never uses Consent A; zero Merchant API hop", async () => {
    const ctx = makeCtx({}, testEnv({ DGTL_LICENSE_JWT: "", GOOGLE_ACCESS_TOKEN: TEST_TOKEN }));
    let authCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "mc_list_products", { merchant_id: "123456789" });
    assert.equal(env.error_code, "LICENSE_REQUIRED");
    assert.equal(authCalls, 0);
    assert.equal(ctx.calls.length, 0);
    assert.ok(ctx.httpMc !== ctx.http);
  });

  it("licensed + Consent A only → MC_NOT_CONNECTED; never uses ctx.auth; no gateway required", async () => {
    const ctx = makeCtx(
      {},
      adsLicenseEnv({ GOOGLE_MC_ACCESS_TOKEN: "", GOOGLE_MC_GRANTED_SCOPES: "" }),
    );
    let authCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "mc_list_accounts", {});
    assert.equal(env.error_code, "MC_NOT_CONNECTED");
    assert.equal(authCalls, 0);
    assert.equal(ctx.calls.length, 0);
    assert.ok(env.hint?.includes("Consent MC") || env.message?.includes("Consent MC") || env.hint?.includes("login-mc"));
  });

  it("MC token without content scope → MC_SCOPE_MISSING zero hop", async () => {
    const ctx = makeCtx(
      {},
      adsLicenseEnv({ GOOGLE_MC_GRANTED_SCOPES: "openid email" }),
    );
    const env = await dispatch(ctx, "mc_list_products", { merchant_id: "123456789" });
    assert.equal(env.error_code, "MC_SCOPE_MISSING");
    assert.equal(env.missing_scope, SCOPE.content);
    assert.equal(ctx.calls.length, 0);
  });

  it("mc_list_products without merchant_id → RESOURCE_REQUIRED zero hop", async () => {
    const ctx = makeCtx({}, adsLicenseEnv());
    const env = await dispatch(ctx, "mc_list_products", {});
    assert.equal(env.error_code, "RESOURCE_REQUIRED");
    assert.equal(ctx.calls.length, 0);
  });

  it("mc_get_product rejects bare SKU", async () => {
    const ctx = makeCtx({}, adsLicenseEnv());
    const env = await dispatch(ctx, "mc_get_product", {
      merchant_id: "123456789",
      product_id: "SKU12345",
    });
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(ctx.calls.length, 0);
  });

  it("mc_list_accounts hops Merchant API accounts.list (not stamp, not Consent A host)", async () => {
    const ctx = makeCtx({}, adsLicenseEnv());
    const env = await dispatch(ctx, "mc_list_accounts", {});
    assert.equal(env.ok, true);
    const data = env.data as { accounts?: unknown[] };
    assert.equal(data.accounts?.length, 1);
    assert.equal(ctx.calls.length, 1);
    assert.equal(ctx.calls[0]?.host, "merchantapi.googleapis.com");
    assert.equal(ctx.calls[0]?.path, "/accounts/v1/accounts");
    assert.equal(ctx.calls[0]?.method, "GET");
    assert.equal(ctx.calls[0]?.hasDeveloperToken, false);
  });

  it("mc_list_products + get + statuses read fixtures", async () => {
    const ctx = makeCtx({}, adsLicenseEnv());
    const list = await dispatch(ctx, "mc_list_products", { merchant_id: "123456789" });
    assert.equal(list.ok, true);
    const products = (list.data as { products?: unknown[] }).products ?? [];
    assert.equal(products.length, 2);
    assert.equal(list.resource?.id, "123456789");

    const get = await dispatch(ctx, "mc_get_product", {
      merchant_id: "accounts/123456789",
      product_id: "en~US~SKU12345",
    });
    assert.equal(get.ok, true);
    assert.equal(get.resource?.type, "mc_product");
    const getData = get.data as { offerId?: string; productStatus?: unknown };
    assert.equal(getData.offerId, "SKU12345");
    assert.ok(getData.productStatus);

    const statuses = await dispatch(ctx, "mc_list_product_statuses", { merchant_id: "123456789" });
    assert.equal(statuses.ok, true);
    const rows = (statuses.data as { product_statuses?: Array<Record<string, unknown>> }).product_statuses ?? [];
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.shopping_ads_ready, true);
    assert.equal(rows[1]?.shopping_ads_ready, false);
    const issues = rows[1]?.item_level_issues as unknown[];
    assert.equal(issues.length, 1);

    const hops = ctx.calls.filter((c) => c.host === "merchantapi.googleapis.com");
    assert.ok(hops.length >= 3);
    assert.ok(hops.every((c) => c.method === "GET"));
    assert.ok(hops.every((c) => !c.hasDeveloperToken));
    assert.ok(hops.some((c) => c.path === "/products/v1/accounts/123456789/products"));
    assert.ok(hops.some((c) => c.path === "/products/v1/accounts/123456789/products/en~US~SKU12345"));
  });

  it("mc_list_account_issues + mc_list_data_sources read feed issues", async () => {
    const ctx = makeCtx({}, adsLicenseEnv());
    const issues = await dispatch(ctx, "mc_list_account_issues", { merchant_id: "123456789" });
    assert.equal(issues.ok, true);
    const accountIssues = (issues.data as { account_issues?: unknown[] }).account_issues ?? [];
    assert.equal(accountIssues.length, 2);

    const feeds = await dispatch(ctx, "mc_list_data_sources", { merchant_id: "123456789" });
    assert.equal(feeds.ok, true);
    const sources = (feeds.data as { data_sources?: unknown[] }).data_sources ?? [];
    assert.equal(sources.length, 2);

    assert.ok(ctx.calls.some((c) => c.path === "/accounts/v1/accounts/123456789/issues"));
    assert.ok(ctx.calls.some((c) => c.path === "/datasources/v1/accounts/123456789/dataSources"));
    assert.ok(ctx.calls.every((c) => c.method === "GET"));
  });

  it("empty products list is ok:true not auth failure", async () => {
    const ctx = makeCtx({ emptyList: true }, adsLicenseEnv());
    const env = await dispatch(ctx, "mc_list_products", { merchant_id: "123456789" });
    assert.equal(env.ok, true);
    assert.equal((env.data as { products?: unknown[] }).products?.length, 0);
    assert.ok(env.hint);
  });

  it("MC hop does not require DGTL_GATEWAY_URL (direct Google, not stamp)", async () => {
    const ctx = makeCtx({}, adsLicenseEnv({ DGTL_GATEWAY_URL: "" }));
    const env = await dispatch(ctx, "mc_list_products", { merchant_id: "123456789" });
    assert.equal(env.ok, true);
    assert.notEqual(env.error_code, "GATEWAY_UNAVAILABLE");
  });

  it("mcProjectNotRegistered 401 maps to ACCESS_NOT_CONFIGURED not REAUTH_REQUIRED", async () => {
    const ctx = makeCtx({ mcProjectNotRegistered: true }, adsLicenseEnv());
    const env = await dispatch(ctx, "mc_list_accounts", {});
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "ACCESS_NOT_CONFIGURED");
    assert.equal(env.google_status, 401);
    assert.notEqual(env.error_code, "REAUTH_REQUIRED");
    assert.ok(String(env.hint ?? "").toLowerCase().includes("register") || String(env.message ?? "").toLowerCase().includes("not configured"));
  });

  it("PKCE MC store: 401 triggers one refresh then still maps registration error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-mc-reauth-"));
    try {
      writeStore(
        dir,
        {
          access_token: "mc-stale-access",
          refresh_token: "mc-refresh-fixture",
          expiry: Date.now() + 3_600_000,
          scopes: [SCOPE.content],
          token_type: "Bearer",
        },
        STORE_FILE.mc,
      );
      const jwt = signLicense({
        sub: "user_test",
        features: ["ads", "meta"],
        exp: Math.floor(Date.now() / 1000) + 3600,
        jti: "jti-mc-401-refresh",
      });
      const envVars = testEnv({
        DGTL_LICENSE_JWT: jwt,
        GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
        GOOGLE_MC_ACCESS_TOKEN: "",
        GOOGLE_MC_GRANTED_SCOPES: "",
        GOOGLE_OAUTH_MC_CLIENT_ID: "mc-client.apps.googleusercontent.com",
        GOOGLE_OAUTH_MC_CLIENT_SECRET: "mc-secret-fixture",
        PLUGIN_DATA: dir,
      });
      const ctx = makeCtx({ mcProjectNotRegistered: true }, envVars);
      const env = await dispatch(ctx, "mc_list_accounts", {});
      assert.equal(env.ok, false);
      assert.equal(env.error_code, "ACCESS_NOT_CONFIGURED");
      // First hop 401 → invalidate → PKCE refresh (oauth2 /token via fetchImpl) → retry merchantapi
      const merchantCalls = ctx.calls.filter((c) => c.host === "merchantapi.googleapis.com");
      assert.ok(merchantCalls.length >= 2, `expected merchant retry, got ${merchantCalls.length}`);
      const { readStore } = await import("../src/auth/store.js");
      const after = readStore(dir, STORE_FILE.mc);
      assert.equal(after?.access_token, "test-refreshed-access-token");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

});
