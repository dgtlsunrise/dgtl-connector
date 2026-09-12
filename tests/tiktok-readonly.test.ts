import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadFlags } from "../src/flags.js";
import { dispatch } from "../src/tools/dispatch.js";
import { CONSENT_A_TOOLS, LICENSE_GATED_TOOLS, LOCAL_FREE_TOOLS, TOOLS } from "../src/tools/registry.js";
import { installNetworkGuard, makeCtx, signLicense, testEnv, TEST_TOKEN } from "./helpers.js";

function tiktokLicenseEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const jwt = signLicense({
    sub: "user_test",
    features: ["tiktok"],
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "jti-tiktok-read-test",
  });
  return testEnv({
    DGTL_LICENSE_JWT: jwt,
    TIKTOK_ACCESS_TOKEN: "tiktok-user-token-fixture",
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    DGTL_GATEWAY_URL: "https://stamp.test",
    ...extra,
  });
}

describe("Wave 8 TikTok read tools (stamp hop, Polar tiktok)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("read tools registered — family tiktok, LICENSE_GATED, not Consent A, not LOCAL_FREE", () => {
    for (const name of ["tiktok_list_advertisers", "tiktok_list_campaigns", "tiktok_insights"]) {
      const t = TOOLS.find((x) => x.name === name);
      assert.ok(t, name);
      assert.equal(t!.family, "tiktok");
      assert.equal(t!.group, "tiktok");
      assert.equal(t!.annotations.readOnlyHint, true);
      assert.ok(LICENSE_GATED_TOOLS.includes(name), name);
      assert.ok(!CONSENT_A_TOOLS.includes(name), name);
      assert.ok(!LOCAL_FREE_TOOLS.includes(name), name);
    }
    assert.equal(CONSENT_A_TOOLS.length, 24);
  });

  it("ads+meta JWT is not enough — LICENSE_REQUIRED, zero HTTP", async () => {
    const jwt = signLicense({
      sub: "user_test",
      features: ["ads", "meta"],
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: "jti-ads-meta-not-tiktok",
    });
    let calls = 0;
    const ctx = makeCtx({}, testEnv({ DGTL_LICENSE_JWT: jwt, DGTL_GATEWAY_URL: "https://stamp.test" }));
    ctx.fetchImpl = (async () => {
      calls += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "tiktok_list_advertisers", {});
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "LICENSE_REQUIRED");
    assert.equal(calls, 0);
  });

  it("tiktok JWT without gateway → GATEWAY_UNAVAILABLE", async () => {
    const ctx = makeCtx({}, tiktokLicenseEnv({ DGTL_GATEWAY_URL: "" }));
    ctx.flags = loadFlags({ ...ctx.env, DGTL_GATEWAY_URL: "" });
    const env = await dispatch(ctx, "tiktok_list_campaigns", { advertiser_id: "1234567890" });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "GATEWAY_UNAVAILABLE");
  });

  it("tiktok JWT + gateway without token → TIKTOK_NOT_CONNECTED; health only", async () => {
    let hops = 0;
    let health = 0;
    const ctx = makeCtx({}, tiktokLicenseEnv({ TIKTOK_ACCESS_TOKEN: "" }));
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/health")) {
        health += 1;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/tiktok/")) hops += 1;
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "tiktok_list_advertisers", {});
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "TIKTOK_NOT_CONNECTED");
    assert.equal(hops, 0);
    assert.equal(health, 1);
  });

  it("insights missing dates → INVALID_ARGUMENT, zero hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, tiktokLicenseEnv());
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/tiktok/")) hops += 1;
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "tiktok_insights", { advertiser_id: "1234567890" });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(hops, 0);
  });

  it("read hop POSTs /v1/tiktok/{tool} with user token, never app secret", async () => {
    const seen: { url: string; headers: Headers; body: string }[] = [];
    const ctx = makeCtx({}, tiktokLicenseEnv());
    ctx.fetchImpl = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      seen.push({
        url,
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : "",
      });
      return new Response(
        JSON.stringify({
          ok: true,
          tool: "tiktok_list_advertisers",
          data: { list: [{ advertiser_id: "1234567890" }] },
          page: { truncated: false, row_count: 1 },
          api: "tiktok",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const env = await dispatch(ctx, "tiktok_list_advertisers", {});
    assert.equal(env.ok, true);
    assert.equal(seen.length, 1);
    assert.ok(seen[0]!.url.endsWith("/v1/tiktok/tiktok_list_advertisers"));
    assert.equal(seen[0]!.headers.get("X-DGTL-User-Access-Token"), "tiktok-user-token-fixture");
    assert.ok(!seen[0]!.body.includes("secret"));
    assert.ok(!seen[0]!.body.includes("app_id"));
  });
});
