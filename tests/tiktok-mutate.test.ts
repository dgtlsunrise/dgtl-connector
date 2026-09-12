import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadFlags } from "../src/flags.js";
import { harnessUserMessageContainsTikTokConfirm } from "../src/tiktok/tiktok-write.js";
import * as S from "../src/tools/schemas.js";
import { dispatch } from "../src/tools/dispatch.js";
import { LICENSE_GATED_TOOLS, TOOLS } from "../src/tools/registry.js";
import { installNetworkGuard, makeCtx, signLicense, testEnv, TEST_TOKEN } from "./helpers.js";

function tiktokLicenseEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const jwt = signLicense({
    sub: "user_test",
    features: ["tiktok"],
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "jti-tiktok-mutate-test",
  });
  return testEnv({
    DGTL_LICENSE_JWT: jwt,
    TIKTOK_ACCESS_TOKEN: "tiktok-user-token-fixture",
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    DGTL_GATEWAY_URL: "https://stamp.test",
    ...extra,
  });
}

describe("Wave 8 tiktok_update_campaign (dry_run + confirm + dual gate)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("DGTL_TIKTOK_MUTATE_ENABLED defaults on; explicit false opts out", () => {
    assert.equal(loadFlags({}).tiktokMutateEnabled, true);
    assert.equal(loadFlags({ DGTL_TIKTOK_MUTATE_ENABLED: "false" }).tiktokMutateEnabled, false);
    assert.equal(loadFlags({ TIKTOK_MUTATE_ENABLED: "false" }).tiktokMutateEnabled, false);
    assert.equal(loadFlags({ DGTL_TIKTOK_MUTATE_ENABLED: "true" }).tiktokMutateEnabled, true);
  });

  it("tool registered destructive; schema dry_run default true; Polar gated", () => {
    const t = TOOLS.find((x) => x.name === "tiktok_update_campaign");
    assert.ok(t);
    assert.equal(t!.family, "tiktok");
    assert.equal(t!.group, "tiktok-write");
    assert.equal(t!.annotations.destructiveHint, true);
    assert.equal(t!.annotations.readOnlyHint, false);
    assert.ok(LICENSE_GATED_TOOLS.includes("tiktok_update_campaign"));
    const parsed = S.tiktokUpdateCampaign.parse({
      advertiser_id: "1234567890",
      campaign_id: "987654321",
      status: "DISABLE",
    });
    assert.equal(parsed.dry_run, true);
    const liveMissing = S.tiktokUpdateCampaign.safeParse({
      advertiser_id: "1234567890",
      campaign_id: "987654321",
      status: "ENABLE",
      dry_run: false,
    });
    assert.equal(liveMissing.success, false);
    const invent = S.tiktokUpdateCampaign.safeParse({
      advertiser_id: "1234567890",
      campaign_id: "1",
      status: "DISABLE",
      budget: 50,
    });
    assert.equal(invent.success, false);
  });

  it("flag off → TIKTOK_MUTATE_NOT_ENABLED with zero gateway mutate HTTP", async () => {
    let hops = 0;
    const ctx = makeCtx({}, tiktokLicenseEnv({ DGTL_TIKTOK_MUTATE_ENABLED: "false" }));
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/tiktok/")) hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "tiktok_update_campaign", {
      advertiser_id: "1234567890",
      campaign_id: "987654321",
      status: "PAUSED",
      dry_run: false,
      confirm_phrase: "pause advertiser 1234567890 campaign 987654321",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "TIKTOK_MUTATE_NOT_ENABLED");
    assert.equal(hops, 0);
  });

  it("flag on + dry_run proposes DISABLE for PAUSED with zero mutate hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, tiktokLicenseEnv());
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/tiktok/tiktok_update_")) hops += 1;
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "tiktok_update_campaign", {
      advertiser_id: "1234567890",
      campaign_id: "987654321",
      status: "PAUSED",
    });
    assert.equal(env.ok, true);
    const data = env.data as { dry_run?: boolean; proposed?: { status?: string } };
    assert.equal(data.dry_run, true);
    assert.equal(data.proposed?.status, "DISABLE");
    assert.equal(hops, 0);
  });

  it("live without confirm_phrase containing advertiser + campaign fails before hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, tiktokLicenseEnv());
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/tiktok/tiktok_update_")) hops += 1;
      if (url.includes("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "tiktok_update_campaign", {
      advertiser_id: "1234567890",
      campaign_id: "987654321",
      status: "DISABLE",
      dry_run: false,
      confirm_phrase: "pause it please",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(hops, 0);
  });

  it("live with confirm hops POST /v1/tiktok/tiktok_update_campaign", async () => {
    const seen: string[] = [];
    const ctx = makeCtx({}, tiktokLicenseEnv());
    ctx.fetchImpl = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/health")) {
        return new Response(
          JSON.stringify({ ok: true, tiktok_mutate_enabled: true }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      seen.push(url);
      const body = typeof init?.body === "string" ? init.body : "";
      assert.ok(body.includes("1234567890"));
      assert.ok(body.includes("987654321"));
      assert.ok(body.includes("DISABLE"));
      assert.ok(!body.includes("secret"));
      return new Response(
        JSON.stringify({ ok: true, tool: "tiktok_update_campaign", data: { campaign_ids: ["987654321"] }, api: "tiktok" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const env = await dispatch(ctx, "tiktok_update_campaign", {
      advertiser_id: "1234567890",
      campaign_id: "987654321",
      status: "PAUSED",
      dry_run: false,
      confirm_phrase: "disable advertiser 1234567890 campaign 987654321",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal(seen.length, 1);
    assert.ok(seen[0]!.endsWith("/v1/tiktok/tiktok_update_campaign"));
  });

  it("harness helper requires both ids in the user message this turn", () => {
    assert.equal(
      harnessUserMessageContainsTikTokConfirm({
        userMessageThisTurn: "pause 1234567890 / 987654321",
        advertiserId: "1234567890",
        campaignId: "987654321",
      }),
      true,
    );
    assert.equal(
      harnessUserMessageContainsTikTokConfirm({
        userMessageThisTurn: "pause 1234567890",
        advertiserId: "1234567890",
        campaignId: "987654321",
      }),
      false,
    );
  });
});
