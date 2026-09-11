import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { dispatch } from "../src/tools/dispatch.js";
import { TOOLS } from "../src/tools/registry.js";
import * as S from "../src/tools/schemas.js";
import { DEFAULT_MAX_META_BUDGET_CENTS } from "../src/meta/meta-write.js";
import {
  installNetworkGuard,
  makeCtx,
  signLicense,
  testEnv,
  TEST_TOKEN,
} from "./helpers.js";

function metaLicenseEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const jwt = signLicense({
    sub: "user_test",
    features: ["ads", "meta"],
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "jti-meta-create-test",
  });
  return testEnv({
    DGTL_LICENSE_JWT: jwt,
    META_ACCESS_TOKEN: "meta-user-token-fixture",
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    DGTL_GATEWAY_URL: "https://stamp.test",
    ...extra,
  });
}

describe("Meta CREATE speedrun plugin tools", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  for (const name of ["meta_create_campaign", "meta_create_adset", "meta_create_ad"] as const) {
    it(`${name} registered destructive and dry_run defaults true`, () => {
      const tool = TOOLS.find((x) => x.name === name);
      assert.ok(tool);
      assert.equal(tool!.annotations.destructiveHint, true);
      assert.equal(tool!.annotations.readOnlyHint, false);
    });
  }

  it("schemas are strict, confirm-gated, and default dry_run", () => {
    const camp = S.metaCreateCampaign.parse({
      ad_account_id: "111222333",
      name: "Traffic",
      objective: "OUTCOME_TRAFFIC",
    });
    assert.equal(camp.dry_run, true);
    const liveMissing = S.metaCreateCampaign.safeParse({
      ad_account_id: "111222333",
      name: "Traffic",
      objective: "OUTCOME_TRAFFIC",
      dry_run: false,
    });
    assert.equal(liveMissing.success, false);
    const invented = S.metaCreateAd.safeParse({
      ad_account_id: "111222333",
      adset_id: "998877",
      name: "Ad",
      creative_id: "444555",
      object_story_spec: { page_id: "1" },
    });
    assert.equal(invented.success, false);
  });

  it("dry-run campaign defaults PAUSED and sends zero HTTP", async () => {
    let calls = 0;
    const ctx = makeCtx({}, metaLicenseEnv());
    ctx.fetchImpl = (async () => {
      calls += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_create_campaign", {
      ad_account_id: "111222333",
      name: "Traffic",
      objective: "OUTCOME_TRAFFIC",
    });
    assert.equal(env.ok, true);
    const data = env.data as { dry_run?: boolean; proposed?: { status?: string; act?: string } };
    assert.equal(data.dry_run, true);
    assert.equal(data.proposed?.status, "PAUSED");
    assert.equal(data.proposed?.act, "act_111222333");
    assert.equal(calls, 0);
  });

  it("adset spend cap fails before gateway", async () => {
    let calls = 0;
    const ctx = makeCtx({}, metaLicenseEnv());
    ctx.fetchImpl = (async () => {
      calls += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_create_adset", {
      ad_account_id: "111222333",
      campaign_id: "12033001",
      name: "Too much",
      daily_budget: String(DEFAULT_MAX_META_BUDGET_CENTS + 1),
      countries: ["US"],
      dry_run: false,
      confirm_phrase: "create on act_111222333 campaign 12033001",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "SPEND_CAP_EXCEEDED");
    assert.equal(calls, 0);
  });

  it("live ad requires act_ + adset_id + creative_id in confirm", async () => {
    let calls = 0;
    const ctx = makeCtx({}, metaLicenseEnv());
    ctx.fetchImpl = (async () => {
      calls += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_create_ad", {
      ad_account_id: "111222333",
      adset_id: "998877",
      name: "Ad",
      creative_id: "444555",
      dry_run: false,
      confirm_phrase: "create on act_111222333 adset 998877",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(calls, 0);
  });

  it("detectable missing ads_management returns META_SCOPE_MISSING, zero create hop", async () => {
    let createHops = 0;
    const ctx = makeCtx(
      {},
      metaLicenseEnv({ META_GRANTED_SCOPES: "ads_read public_profile" }),
    );
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/meta/meta_create_")) createHops += 1;
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_create_campaign", {
      ad_account_id: "111222333",
      name: "Traffic",
      objective: "OUTCOME_TRAFFIC",
      dry_run: false,
      confirm_phrase: "create on act_111222333",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "META_SCOPE_MISSING");
    assert.equal(createHops, 0);
  });

  it("live ad posts creative_id-only closed params", async () => {
    let seen: Record<string, unknown> | null = null;
    const ctx = makeCtx(
      {},
      metaLicenseEnv({ META_GRANTED_SCOPES: "ads_read ads_management" }),
    );
    ctx.fetchImpl = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/meta/meta_create_ad")) {
        seen = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ ok: true, tool: "meta_create_ad", data: { id: "777888" }, api: "meta" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_create_ad", {
      ad_account_id: "111222333",
      adset_id: "998877",
      name: "Ad",
      creative_id: "444555",
      dry_run: false,
      confirm_phrase: "create on act_111222333 adset 998877 creative 444555",
    });
    assert.equal(env.ok, true);
    const params = seen!.params as Record<string, unknown>;
    assert.deepEqual(params, {
      ad_account_id: "111222333",
      name: "Ad",
      status: "PAUSED",
      adset_id: "998877",
      creative_id: "444555",
    });
    assert.ok(!("creative" in params));
    assert.ok(!("object_story_spec" in params));
  });

  it("catalog lists all create tools behind Meta mutate gate", async () => {
    const catalog = JSON.parse(
      await import("node:fs").then(({ readFileSync }) =>
        readFileSync(new URL("../schemas/v1/catalog.json", import.meta.url), "utf8"),
      ),
    ) as { gated_tools: Array<{ name: string; fail: string }> };
    for (const name of ["meta_create_campaign", "meta_create_adset", "meta_create_ad"]) {
      const g = catalog.gated_tools.find((x) => x.name === name);
      assert.ok(g, name);
      assert.equal(g!.fail, "META_MUTATE_NOT_ENABLED");
    }
  });
});
