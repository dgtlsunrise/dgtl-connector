import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import { loadFlags } from "../src/flags.js";
import {
  harnessUserMessageContainsMetaConfirm,
  assertAdsManagementWhenDetectable,
} from "../src/meta/meta-write.js";
import * as S from "../src/tools/schemas.js";
import { dispatch } from "../src/tools/dispatch.js";
import { TOOLS } from "../src/tools/registry.js";
import {
  installNetworkGuard,
  makeCtx,
  ROOT,
  signLicense,
  testEnv,
  TEST_TOKEN,
} from "./helpers.js";

function metaLicenseEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const jwt = signLicense({
    sub: "user_test",
    features: ["ads", "meta"],
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "jti-meta-mutate-test",
  });
  return testEnv({
    DGTL_LICENSE_JWT: jwt,
    META_ACCESS_TOKEN: "meta-user-token-fixture",
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    DGTL_GATEWAY_URL: "https://stamp.test",
    ...extra,
  });
}

describe("Slice 4 meta_update_* status (fail closed)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("DGTL_META_MUTATE_ENABLED defaults off", () => {
    assert.equal(loadFlags({}).metaMutateEnabled, false);
    assert.equal(loadFlags({ DGTL_META_MUTATE_ENABLED: "false" }).metaMutateEnabled, false);
    assert.equal(loadFlags({ DGTL_META_MUTATE_ENABLED: "true" }).metaMutateEnabled, true);
    assert.equal(loadFlags({ META_MUTATE_ENABLED: "1" }).metaMutateEnabled, true);
  });

  for (const name of [
    "meta_update_campaign",
    "meta_update_adset",
    "meta_update_ad",
  ] as const) {
    it(`tool ${name} registered with destructiveHint; schema dry_run default true`, () => {
      const t = TOOLS.find((x) => x.name === name);
      assert.ok(t);
      assert.equal(t!.annotations.destructiveHint, true);
      assert.equal(t!.annotations.readOnlyHint, false);
      const schema =
        name === "meta_update_campaign"
          ? S.metaUpdateCampaign
          : name === "meta_update_adset"
            ? S.metaUpdateAdset
            : S.metaUpdateAd;
      const idKey =
        name === "meta_update_campaign"
          ? "campaign_id"
          : name === "meta_update_adset"
            ? "adset_id"
            : "ad_id";
      const parsed = schema.parse({
        ad_account_id: "111222333",
        [idKey]: "12033001",
        status: "PAUSED",
      });
      assert.equal(parsed.dry_run, true);
      const liveMissing = schema.safeParse({
        ad_account_id: "111222333",
        [idKey]: "12033001",
        status: "ACTIVE",
        dry_run: false,
      });
      assert.equal(liveMissing.success, false);
    });
  }

  it("flag off → META_MUTATE_NOT_ENABLED with zero gateway mutate HTTP", async () => {
    let gatewayPosts = 0;
    const ctx = makeCtx({}, metaLicenseEnv({ DGTL_META_MUTATE_ENABLED: "false" }));
    const orig = ctx.fetchImpl;
    ctx.fetchImpl = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/meta/")) gatewayPosts += 1;
      return orig(input, init);
    }) as typeof fetch;

    const env = await dispatch(ctx, "meta_update_campaign", {
      ad_account_id: "111222333",
      campaign_id: "12033001",
      status: "PAUSED",
      dry_run: false,
      confirm_phrase: "pause act_111222333 campaign 12033001",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "META_MUTATE_NOT_ENABLED");
    assert.equal(gatewayPosts, 0);
  });

  it("flag off even on dry_run → META_MUTATE_NOT_ENABLED, zero HTTP", async () => {
    let calls = 0;
    const ctx = makeCtx({}, metaLicenseEnv());
    ctx.fetchImpl = (async () => {
      calls += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_update_adset", {
      ad_account_id: "111222333",
      adset_id: "55",
      status: "ACTIVE",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "META_MUTATE_NOT_ENABLED");
    assert.equal(calls, 0);
  });

  it("flag on + dry_run proposes with zero mutate hop", async () => {
    let hops = 0;
    const ctx = makeCtx(
      {},
      metaLicenseEnv({ DGTL_META_MUTATE_ENABLED: "true", DGTL_GATEWAY_URL: "https://stamp.test" }),
    );
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/meta/meta_update_")) hops += 1;
      if (url.includes("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_update_campaign", {
      ad_account_id: "111222333",
      campaign_id: "12033001",
      status: "PAUSED",
    });
    assert.equal(env.ok, true);
    assert.equal((env.data as { dry_run?: boolean })?.dry_run, true);
    assert.equal(hops, 0);
  });

  it("live without confirm_phrase containing act_ + object id fails before hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, metaLicenseEnv({ DGTL_META_MUTATE_ENABLED: "true" }));
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/meta/meta_update_")) hops += 1;
      if (url.includes("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_update_ad", {
      ad_account_id: "111222333",
      ad_id: "99",
      status: "PAUSED",
      dry_run: false,
      confirm_phrase: "pause it please",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(hops, 0);
  });

  it("flag on + live confirm posts closed hop body (mock gateway)", async () => {
    let seenUrl = "";
    let seenBody: Record<string, unknown> | null = null;
    const ctx = makeCtx({}, metaLicenseEnv({ DGTL_META_MUTATE_ENABLED: "true" }));
    ctx.fetchImpl = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/meta/meta_update_campaign")) {
        seenUrl = url;
        seenBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            ok: true,
            tool: "meta_update_campaign",
            data: { success: true },
            api: "meta",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;

    const env = await dispatch(ctx, "meta_update_campaign", {
      ad_account_id: "111222333",
      campaign_id: "12033001",
      status: "ACTIVE",
      dry_run: false,
      confirm_phrase: "enable act_111222333 campaign 12033001",
    });
    assert.equal(env.ok, true);
    assert.ok(seenUrl.includes("/v1/meta/meta_update_campaign"));
    assert.ok(seenBody);
    assert.equal(seenBody!.tool, "meta_update_campaign");
    const params = seenBody!.params as Record<string, unknown>;
    assert.equal(params.campaign_id, "12033001");
    assert.equal(params.status, "ACTIVE");
    assert.equal(params.ad_account_id, "111222333");
    assert.ok(!("daily_budget" in params));
    assert.ok(!("name" in params));
  });

  it("detectable scopes without ads_management → META_SCOPE_MISSING, zero hop", async () => {
    let hops = 0;
    const ctx = makeCtx(
      {},
      metaLicenseEnv({
        DGTL_META_MUTATE_ENABLED: "true",
        META_GRANTED_SCOPES: "ads_read public_profile",
      }),
    );
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/meta/meta_update_")) hops += 1;
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_update_campaign", {
      ad_account_id: "111222333",
      campaign_id: "12033001",
      status: "PAUSED",
      dry_run: false,
      confirm_phrase: "pause act_111222333 campaign 12033001",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "META_SCOPE_MISSING");
    assert.equal(hops, 0);
    assert.equal(assertAdsManagementWhenDetectable(["ads_read"]).ok, false);
    assert.equal(assertAdsManagementWhenDetectable(["ads_read", "ads_management"]).ok, true);
    assert.equal(assertAdsManagementWhenDetectable([]).ok, true);
  });

  it("harness helper requires act_ + object id in user message", () => {
    assert.equal(
      harnessUserMessageContainsMetaConfirm({
        userMessageThisTurn: "pause act_111222333 campaign 12033001",
        adAccountId: "111222333",
        objectId: "12033001",
      }),
      true,
    );
    assert.equal(
      harnessUserMessageContainsMetaConfirm({
        userMessageThisTurn: "pause campaign 12033001",
        adAccountId: "111222333",
        objectId: "12033001",
      }),
      false,
    );
  });

  it("catalog gated_tools lists META_MUTATE_NOT_ENABLED", () => {
    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8"));
    for (const name of ["meta_update_campaign", "meta_update_adset", "meta_update_ad"]) {
      const g = catalog.gated_tools.find((x: { name: string }) => x.name === name);
      assert.ok(g, name);
      assert.equal(g.fail, "META_MUTATE_NOT_ENABLED");
      assert.equal(g.flag, "meta.mutate.enabled");
    }
  });
});
