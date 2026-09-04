import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import { buildGoogleAuthUrl, generatePkce } from "../src/auth/pkce.js";
import { AuthPort } from "../src/auth/port.js";
import { STORE_FILE, readStore, writeStore, tokenPath } from "../src/auth/store.js";
import { CONSENT_A, CONSENT_C_GOOGLE, SCOPE } from "../src/google/scopes.js";
import { dispatch } from "../src/tools/dispatch.js";
import { installNetworkGuard, makeCtx, signLicense, testEnv, TEST_TOKEN } from "./helpers.js";

describe("Consent C token stores separate from AuthPort A (fail closed)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("CONSENT_C_GOOGLE is adwords only and not in CONSENT_A / default auth URL", () => {
    assert.deepEqual([...CONSENT_C_GOOGLE], [SCOPE.adwords]);
    assert.ok(!(CONSENT_A as readonly string[]).includes(SCOPE.adwords));

    const pkce = generatePkce();
    const url = buildGoogleAuthUrl({
      clientId: "example-public-client-id.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:8732/callback",
      challenge: pkce.challenge,
      state: pkce.state,
    });
    assert.ok(!url.includes("adwords"));
    assert.ok(!url.includes(SCOPE.adwords));
    const granted = new URL(url).searchParams.get("scope")?.split(/\s+/) ?? [];
    assert.deepEqual(granted, [...CONSENT_A]);
  });

  it("store files are google-oauth-ads.json and meta-oauth.json; writes do not touch A", () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-consent-c-"));
    try {
      assert.equal(STORE_FILE.ads, "google-oauth-ads.json");
      assert.equal(STORE_FILE.meta, "meta-oauth.json");
      assert.equal(tokenPath(dir, STORE_FILE.ads), join(dir, "google-oauth-ads.json"));
      assert.equal(tokenPath(dir, STORE_FILE.meta), join(dir, "meta-oauth.json"));

      writeStore(dir, { access_token: "a-token", expiry: Date.now() + 3_600_000 }, STORE_FILE.a);
      writeStore(dir, { access_token: "ads-token", expiry: Date.now() + 3_600_000 }, STORE_FILE.ads);
      writeStore(dir, { access_token: "meta-token", expiry: Date.now() + 3_600_000 }, STORE_FILE.meta);

      assert.equal(readStore(dir, STORE_FILE.a)?.access_token, "a-token");
      assert.equal(readStore(dir, STORE_FILE.ads)?.access_token, "ads-token");
      assert.equal(readStore(dir, STORE_FILE.meta)?.access_token, "meta-token");
      assert.ok(!readFileSync(join(dir, "google-oauth.json"), "utf8").includes("ads-token"));
      assert.ok(!readFileSync(join(dir, "google-oauth-ads.json"), "utf8").includes("a-token"));
      assert.ok(existsSync(join(dir, "meta-oauth.json")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("AuthPort A ignores ADS/META tokens; ads/meta ports ignore Consent A", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-c-ports-"));
    try {
      const fetchImpl = (async () => {
        throw new Error("NETWORK_FORBIDDEN");
      }) as typeof fetch;

      const a = AuthPort.fromEnv({
        env: {
          GOOGLE_ADS_ACCESS_TOKEN: "ads-only",
          META_ACCESS_TOKEN: "meta-only",
          GOOGLE_WRITE_ACCESS_TOKEN: "write-only",
        },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal(await a.getAccessToken(), null);

      const ads = AuthPort.adsFromEnv({
        env: { GOOGLE_ACCESS_TOKEN: "consent-a", META_ACCESS_TOKEN: "meta-only" },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal(await ads.getAccessToken(), null);

      const ads2 = AuthPort.adsFromEnv({
        env: { GOOGLE_ADS_ACCESS_TOKEN: "ads-only" },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal((await ads2.getAccessToken())?.accessToken, "ads-only");

      const meta = AuthPort.metaFromEnv({
        env: { GOOGLE_ACCESS_TOKEN: "consent-a", GOOGLE_ADS_ACCESS_TOKEN: "ads-only" },
        pluginDataDir: dir,
      });
      assert.equal(await meta.getAccessToken(), null);

      const meta2 = AuthPort.metaFromEnv({
        env: { META_ACCESS_TOKEN: "meta-only" },
        pluginDataDir: dir,
      });
      assert.equal((await meta2.getAccessToken())?.accessToken, "meta-only");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("licensed Ads with only Consent A token + URL unset → GATEWAY_UNAVAILABLE; never uses ctx.auth", async () => {
    const jwt = signLicense({
      sub: "test-user",
      exp: Math.floor(Date.now() / 1000) + 86400,
      features: ["ads"],
      jti: "ads-a-only",
    });
    const ctx = makeCtx({}, testEnv({ DGTL_LICENSE_JWT: jwt, GOOGLE_ACCESS_TOKEN: TEST_TOKEN }));
    let authCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "gads_list_accessible_customers", {});
    assert.equal(env.error_code, "GATEWAY_UNAVAILABLE");
    assert.equal(authCalls, 0, "gads must not call ctx.auth");
    assert.equal(ctx.calls.length, 0);
  });

  it("licensed Ads with GOOGLE_ADS_ACCESS_TOKEN + URL unset → GATEWAY_UNAVAILABLE; never uses ctx.auth", async () => {
    const jwt = signLicense({
      sub: "test-user",
      exp: Math.floor(Date.now() / 1000) + 86400,
      features: ["ads"],
      jti: "ads-c-tok",
    });
    const ctx = makeCtx(
      {},
      testEnv({
        DGTL_LICENSE_JWT: jwt,
        GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
        GOOGLE_ADS_ACCESS_TOKEN: "ads-user-token",
      }),
    );
    let authCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "gads_search", { customer_id: "123", recipe: "campaigns" });
    assert.equal(env.error_code, "GATEWAY_UNAVAILABLE");
    assert.ok(env.hint?.toLowerCase().includes("gateway") || env.message?.toLowerCase().includes("gateway"));
    assert.equal(authCalls, 0);
    assert.ok(ctx.calls.every((c) => !c.hasDeveloperToken));
    assert.equal(ctx.calls.length, 0);
  });

  it("licensed Meta with only Consent A token + URL unset → GATEWAY_UNAVAILABLE; never uses ctx.auth", async () => {
    const jwt = signLicense({
      sub: "test-user",
      exp: Math.floor(Date.now() / 1000) + 86400,
      features: ["meta"],
      jti: "meta-a-only",
    });
    const ctx = makeCtx({}, testEnv({ DGTL_LICENSE_JWT: jwt, GOOGLE_ACCESS_TOKEN: TEST_TOKEN }));
    let authCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "meta_list_ad_accounts", {});
    assert.equal(env.error_code, "GATEWAY_UNAVAILABLE");
    assert.equal(authCalls, 0);
    assert.equal(ctx.calls.length, 0);
  });

  it("licensed Meta with META_ACCESS_TOKEN + URL unset → GATEWAY_UNAVAILABLE; never uses ctx.auth", async () => {
    const jwt = signLicense({
      sub: "test-user",
      exp: Math.floor(Date.now() / 1000) + 86400,
      features: ["meta"],
      jti: "meta-c-tok",
    });
    const ctx = makeCtx(
      {},
      testEnv({
        DGTL_LICENSE_JWT: jwt,
        GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
        META_ACCESS_TOKEN: "meta-user-token",
      }),
    );
    let authCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "meta_insights", { ad_account_id: "act_1" });
    assert.equal(env.error_code, "GATEWAY_UNAVAILABLE");
    assert.ok(env.hint?.toLowerCase().includes("gateway") || env.message?.toLowerCase().includes("gateway"));
    assert.equal(authCalls, 0);
    assert.equal(ctx.calls.length, 0);
  });

  it("no license still LICENSE_REQUIRED before Consent C check", async () => {
    const ctx = makeCtx(
      {},
      testEnv({
        GOOGLE_ADS_ACCESS_TOKEN: "ads-user-token",
        META_ACCESS_TOKEN: "meta-user-token",
        DGTL_LICENSE_JWT: "",
      }),
    );
    const ads = await dispatch(ctx, "gads_list_accessible_customers", {});
    assert.equal(ads.error_code, "LICENSE_REQUIRED");
    const meta = await dispatch(ctx, "meta_list_ad_accounts", {});
    assert.equal(meta.error_code, "LICENSE_REQUIRED");
  });
});
