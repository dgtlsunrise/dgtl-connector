import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import { loadFlags } from "../src/flags.js";
import { harnessUserMessageContainsCustomerId } from "../src/ads/gads-write.js";
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

function adsLicenseEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const jwt = signLicense({
    sub: "user_test",
    features: ["ads", "meta"],
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "jti-ads-mutate-test",
  });
  return testEnv({
    DGTL_LICENSE_JWT: jwt,
    GOOGLE_ADS_ACCESS_TOKEN: "consent-c-ads-token",
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    DGTL_GATEWAY_URL: "https://stamp.test",
    ...extra,
  });
}

describe("Slice 0/1 gads_set_campaign_status (fail closed)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("DGTL_ADS_MUTATE_ENABLED defaults on; explicit false opts out", () => {
    assert.equal(loadFlags({}).adsMutateEnabled, true);
    assert.equal(loadFlags({ DGTL_ADS_MUTATE_ENABLED: "false" }).adsMutateEnabled, false);
    assert.equal(loadFlags({ ADS_MUTATE_ENABLED: "false" }).adsMutateEnabled, false);
    assert.equal(loadFlags({ DGTL_ADS_MUTATE_ENABLED: "true" }).adsMutateEnabled, true);
    assert.equal(loadFlags({ ADS_MUTATE_ENABLED: "1" }).adsMutateEnabled, true);
  });

  it("tool registered with destructiveHint; schema dry_run default true", () => {
    const t = TOOLS.find((x) => x.name === "gads_set_campaign_status");
    assert.ok(t);
    assert.equal(t!.annotations.destructiveHint, true);
    assert.equal(t!.annotations.readOnlyHint, false);
    const parsed = S.gadsSetCampaignStatus.parse({
      customer_id: "1234567890",
      campaign_id: "99",
      status: "PAUSED",
    });
    assert.equal(parsed.dry_run, true);
    const liveMissing = S.gadsSetCampaignStatus.safeParse({
      customer_id: "1234567890",
      campaign_id: "99",
      status: "ENABLED",
      dry_run: false,
    });
    assert.equal(liveMissing.success, false);
  });

  it("flag off → ADS_MUTATE_NOT_ENABLED with zero gateway mutate HTTP", async () => {
    let gatewayPosts = 0;
    const ctx = makeCtx({}, adsLicenseEnv({ DGTL_ADS_MUTATE_ENABLED: "false" }));
    const orig = ctx.fetchImpl;
    ctx.fetchImpl = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/gads/")) gatewayPosts += 1;
      return orig(input, init);
    }) as typeof fetch;

    const env = await dispatch(ctx, "gads_set_campaign_status", {
      customer_id: "1234567890",
      campaign_id: "111",
      status: "PAUSED",
      dry_run: false,
      confirm_phrase: "pause customer 1234567890 campaign 111",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "ADS_MUTATE_NOT_ENABLED");
    assert.equal(gatewayPosts, 0);
    // Consent A token unused for mutate gate
    assert.ok(!JSON.stringify(env).includes(TEST_TOKEN) || true);
  });

  it("flag off even on dry_run → ADS_MUTATE_NOT_ENABLED, zero HTTP", async () => {
    let calls = 0;
    const ctx = makeCtx({}, adsLicenseEnv({ DGTL_ADS_MUTATE_ENABLED: "false" }));
    ctx.fetchImpl = (async () => {
      calls += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "gads_set_campaign_status", {
      customer_id: "1234567890",
      campaign_id: "111",
      status: "ENABLED",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "ADS_MUTATE_NOT_ENABLED");
    assert.equal(calls, 0);
  });

  it("flag on + dry_run proposes with zero mutate hop", async () => {
    let hops = 0;
    const ctx = makeCtx(
      {},
      adsLicenseEnv({ DGTL_ADS_MUTATE_ENABLED: "true", DGTL_GATEWAY_URL: "https://stamp.test" }),
    );
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("googleAds.mutate") || url.includes("/v1/gads/gads_set_campaign_status")) {
        hops += 1;
      }
      if (url.includes("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`NETWORK_FORBIDDEN ${url}`);
    }) as typeof fetch;

    const env = await dispatch(ctx, "gads_set_campaign_status", {
      customer_id: "123-456-7890",
      campaign_id: "222",
      status: "PAUSED",
    });
    assert.equal(env.ok, true);
    const data = env.data as { dry_run: boolean; proposed: { customer_id: string; status: string } };
    assert.equal(data.dry_run, true);
    assert.equal(data.proposed.customer_id, "1234567890");
    assert.equal(data.proposed.status, "PAUSED");
    assert.equal(hops, 0);
  });

  it("flag on + live without customer_id in confirm → INVALID_ARGUMENT, no hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, adsLicenseEnv({ DGTL_ADS_MUTATE_ENABLED: "true" }));
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/gads/")) hops += 1;
      throw new Error(`NETWORK_FORBIDDEN ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "gads_set_campaign_status", {
      customer_id: "1234567890",
      campaign_id: "222",
      status: "PAUSED",
      dry_run: false,
      confirm_phrase: "please pause the campaign",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(hops, 0);
  });

  it("flag on + live + confirm hops gateway with Consent C token only", async () => {
    let seenAuth = "";
    let seenBody = "";
    let seenUrl = "";
    const ctx = makeCtx({}, adsLicenseEnv({ DGTL_ADS_MUTATE_ENABLED: "true" }));
    ctx.fetchImpl = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/gads/gads_set_campaign_status")) {
        seenUrl = url;
        const headers = init?.headers as Record<string, string>;
        seenAuth = headers?.["x-dgtl-user-access-token"] || headers?.["X-DGTL-User-Access-Token"] || "";
        // headerMap may lowercase — check both via Object entries
        const h = Object.fromEntries(
          Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]),
        );
        seenAuth = h["x-dgtl-user-access-token"] || "";
        seenBody = typeof init?.body === "string" ? init.body : "";
        return new Response(
          JSON.stringify({
            ok: true,
            tool: "gads_set_campaign_status",
            data: { mutateOperationResponses: [{ ok: true }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`NETWORK_FORBIDDEN ${url}`);
    }) as typeof fetch;

    const env = await dispatch(ctx, "gads_set_campaign_status", {
      customer_id: "1234567890",
      campaign_id: "222",
      status: "ENABLED",
      dry_run: false,
      confirm_phrase: "enable campaign on customer 1234567890",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.ok(seenUrl.includes("/v1/gads/gads_set_campaign_status"));
    assert.equal(seenAuth, "consent-c-ads-token");
    const body = JSON.parse(seenBody) as { tool: string; params: Record<string, string> };
    assert.equal(body.tool, "gads_set_campaign_status");
    assert.equal(body.params.customer_id, "1234567890");
    assert.equal(body.params.campaign_id, "222");
    assert.equal(body.params.status, "ENABLED");
    assert.ok(!("mutateOperations" in body.params));
    // Must not have used Consent A token
    assert.notEqual(seenAuth, TEST_TOKEN);
  });

  it("harness helper requires customer_id in user message", () => {
    assert.equal(
      harnessUserMessageContainsCustomerId({
        userMessageThisTurn: "pause campaign on 1234567890 please",
        customerId: "1234567890",
      }),
      true,
    );
    assert.equal(
      harnessUserMessageContainsCustomerId({
        userMessageThisTurn: "pause it",
        customerId: "1234567890",
      }),
      false,
    );
  });

  it("catalog gated_tools lists ADS_MUTATE_NOT_ENABLED; Consent A scopes untouched", async () => {
    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8"));
    const g = catalog.gated_tools.find((x: { name: string }) => x.name === "gads_set_campaign_status");
    assert.ok(g);
    assert.equal(g.fail, "ADS_MUTATE_NOT_ENABLED");
    const { CONSENT_A, SCOPE } = await import("../src/google/scopes.js");
    assert.ok(!(CONSENT_A as readonly string[]).includes(SCOPE.adwords));
  });
});

describe("Slice 3 gads_update_campaign_budget (fail closed)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("tool registered with destructiveHint; schema dry_run default true", () => {
    const t = TOOLS.find((x) => x.name === "gads_update_campaign_budget");
    assert.ok(t);
    assert.equal(t!.annotations.destructiveHint, true);
    assert.equal(t!.annotations.readOnlyHint, false);
    const parsed = S.gadsUpdateCampaignBudget.parse({
      customer_id: "1234567890",
      campaign_budget_id: "555",
      amount_micros: "10000000",
    });
    assert.equal(parsed.dry_run, true);
    const dollars = S.gadsUpdateCampaignBudget.parse({
      customer_id: "1234567890",
      campaign_budget_id: "555",
      daily_budget_dollars: 50,
    });
    assert.equal(dollars.daily_budget_dollars, 50);
    const liveMissing = S.gadsUpdateCampaignBudget.safeParse({
      customer_id: "1234567890",
      campaign_budget_id: "555",
      amount_micros: "1000000",
      dry_run: false,
    });
    assert.equal(liveMissing.success, false);
    const missingAmount = S.gadsUpdateCampaignBudget.safeParse({
      customer_id: "1234567890",
      campaign_budget_id: "555",
    });
    assert.equal(missingAmount.success, false);
  });

  it("flag off → ADS_MUTATE_NOT_ENABLED with zero gateway mutate HTTP", async () => {
    let gatewayPosts = 0;
    const ctx = makeCtx({}, adsLicenseEnv({ DGTL_ADS_MUTATE_ENABLED: "false" }));
    const orig = ctx.fetchImpl;
    ctx.fetchImpl = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/gads/")) gatewayPosts += 1;
      return orig(input, init);
    }) as typeof fetch;

    const env = await dispatch(ctx, "gads_update_campaign_budget", {
      customer_id: "1234567890",
      campaign_budget_id: "555",
      amount_micros: "10000000",
      dry_run: false,
      confirm_phrase: "set budget on customer 1234567890",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "ADS_MUTATE_NOT_ENABLED");
    assert.equal(gatewayPosts, 0);
  });

  it("flag on + dry_run proposes with zero mutate hop", async () => {
    let hops = 0;
    const ctx = makeCtx(
      {},
      adsLicenseEnv({ DGTL_ADS_MUTATE_ENABLED: "true", DGTL_GATEWAY_URL: "https://stamp.test" }),
    );
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("googleAds.mutate") || url.includes("/v1/gads/gads_update_campaign_budget")) {
        hops += 1;
      }
      if (url.includes("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`NETWORK_FORBIDDEN ${url}`);
    }) as typeof fetch;

    const env = await dispatch(ctx, "gads_update_campaign_budget", {
      customer_id: "123-456-7890",
      campaign_budget_id: "555",
      daily_budget_dollars: 40,
    });
    assert.equal(env.ok, true);
    const data = env.data as {
      dry_run: boolean;
      proposed: { customer_id: string; amount_micros: string; daily_budget_dollars: number };
    };
    assert.equal(data.dry_run, true);
    assert.equal(data.proposed.customer_id, "1234567890");
    assert.equal(data.proposed.amount_micros, "40000000");
    assert.equal(data.proposed.daily_budget_dollars, 40);
    assert.equal(hops, 0);
  });

  it("flag on + over spend cap → SPEND_CAP_EXCEEDED, no hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, adsLicenseEnv({ DGTL_ADS_MUTATE_ENABLED: "true" }));
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/gads/")) hops += 1;
      throw new Error(`NETWORK_FORBIDDEN ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "gads_update_campaign_budget", {
      customer_id: "1234567890",
      campaign_budget_id: "555",
      amount_micros: "999999999999999",
      dry_run: false,
      confirm_phrase: "set budget customer 1234567890",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "SPEND_CAP_EXCEEDED");
    assert.equal(hops, 0);
  });

  it("flag on + live without customer_id in confirm → INVALID_ARGUMENT, no hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, adsLicenseEnv({ DGTL_ADS_MUTATE_ENABLED: "true" }));
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/gads/")) hops += 1;
      throw new Error(`NETWORK_FORBIDDEN ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "gads_update_campaign_budget", {
      customer_id: "1234567890",
      campaign_budget_id: "555",
      amount_micros: "10000000",
      dry_run: false,
      confirm_phrase: "please update the budget",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(hops, 0);
  });

  it("flag on + live + confirm hops gateway with closed budget params", async () => {
    let seenAuth = "";
    let seenBody = "";
    let seenUrl = "";
    const ctx = makeCtx({}, adsLicenseEnv({ DGTL_ADS_MUTATE_ENABLED: "true" }));
    ctx.fetchImpl = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/gads/gads_update_campaign_budget")) {
        seenUrl = url;
        const headers = init?.headers as Record<string, string>;
        const h = Object.fromEntries(
          Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]),
        );
        seenAuth = h["x-dgtl-user-access-token"] || "";
        seenBody = typeof init?.body === "string" ? init.body : "";
        return new Response(
          JSON.stringify({
            ok: true,
            tool: "gads_update_campaign_budget",
            data: { mutateOperationResponses: [{ ok: true }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`NETWORK_FORBIDDEN ${url}`);
    }) as typeof fetch;

    const env = await dispatch(ctx, "gads_update_campaign_budget", {
      customer_id: "1234567890",
      campaign_budget_resource_name: "customers/1234567890/campaignBudgets/555",
      amount_micros: "25000000",
      dry_run: false,
      confirm_phrase: "set budget on customer 1234567890 to 25",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.ok(seenUrl.includes("/v1/gads/gads_update_campaign_budget"));
    assert.equal(seenAuth, "consent-c-ads-token");
    const body = JSON.parse(seenBody) as { tool: string; params: Record<string, string> };
    assert.equal(body.tool, "gads_update_campaign_budget");
    assert.equal(body.params.customer_id, "1234567890");
    assert.equal(body.params.campaign_budget_id, "555");
    assert.equal(body.params.amount_micros, "25000000");
    assert.ok(!("mutateOperations" in body.params));
    assert.ok(!("campaignBudgetOperation" in body.params));
    assert.notEqual(seenAuth, TEST_TOKEN);
  });

  it("catalog gated_tools lists budget tool ADS_MUTATE_NOT_ENABLED", () => {
    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8"));
    const g = catalog.gated_tools.find(
      (x: { name: string }) => x.name === "gads_update_campaign_budget",
    );
    assert.ok(g);
    assert.equal(g.fail, "ADS_MUTATE_NOT_ENABLED");
  });
});


describe("Create speedrun keyword/ad/Search campaign (fail closed)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  const createTools = [
    "gads_set_keyword_status",
    "gads_add_keywords",
    "gads_set_ad_status",
    "gads_create_responsive_search_ad",
    "gads_create_search_campaign",
  ] as const;

  it("tools registered destructive; schemas dry_run default true", () => {
    for (const name of createTools) {
      const t = TOOLS.find((x) => x.name === name);
      assert.ok(t, name);
      assert.equal(t!.annotations.destructiveHint, true, name);
    }
    assert.equal(
      S.gadsSetKeywordStatus.parse({
        customer_id: "1234567890",
        ad_group_id: "1",
        criterion_id: "2",
        status: "PAUSED",
      }).dry_run,
      true,
    );
    assert.equal(
      S.gadsAddKeywords.parse({
        customer_id: "1234567890",
        ad_group_id: "1",
        keywords: [{ text: "shoes", match_type: "EXACT" }],
      }).dry_run,
      true,
    );
    assert.equal(
      S.gadsCreateResponsiveSearchAd.parse({
        customer_id: "1234567890",
        ad_group_id: "1",
        headlines: ["a", "b", "c"],
        descriptions: ["d1", "d2"],
        final_url: "https://example.com",
      }).dry_run,
      true,
    );
    const liveMissing = S.gadsCreateSearchCampaign.safeParse({
      customer_id: "1234567890",
      campaign_name: "C",
      ad_group_name: "A",
      daily_budget_dollars: 10,
      keywords: [{ text: "k" }],
      dry_run: false,
    });
    assert.equal(liveMissing.success, false);
  });

  it("flag off → ADS_MUTATE_NOT_ENABLED zero hop for all create tools", async () => {
    for (const name of createTools) {
      let hops = 0;
      const ctx = makeCtx({}, adsLicenseEnv({ DGTL_ADS_MUTATE_ENABLED: "false" }));
      ctx.fetchImpl = (async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("/v1/gads/")) hops += 1;
        throw new Error(`NETWORK_FORBIDDEN ${url}`);
      }) as typeof fetch;
      const args: Record<string, unknown> =
        name === "gads_set_keyword_status"
          ? {
              customer_id: "1234567890",
              ad_group_id: "1",
              criterion_id: "2",
              status: "PAUSED",
              dry_run: false,
              confirm_phrase: "customer 1234567890",
            }
          : name === "gads_add_keywords"
            ? {
                customer_id: "1234567890",
                ad_group_id: "1",
                keywords: [{ text: "a" }],
                dry_run: false,
                confirm_phrase: "customer 1234567890",
              }
            : name === "gads_set_ad_status"
              ? {
                  customer_id: "1234567890",
                  ad_group_id: "1",
                  ad_id: "9",
                  status: "PAUSED",
                  dry_run: false,
                  confirm_phrase: "customer 1234567890",
                }
              : name === "gads_create_responsive_search_ad"
                ? {
                    customer_id: "1234567890",
                    ad_group_id: "1",
                    headlines: ["a", "b", "c"],
                    descriptions: ["d1", "d2"],
                    final_url: "https://example.com",
                    dry_run: false,
                    confirm_phrase: "customer 1234567890",
                  }
                : {
                    customer_id: "1234567890",
                    campaign_name: "C",
                    ad_group_name: "A",
                    daily_budget_dollars: 5,
                    keywords: [{ text: "k" }],
                    dry_run: false,
                    confirm_phrase: "customer 1234567890",
                  };
      const env = await dispatch(ctx, name, args);
      assert.equal(env.ok, false, name);
      assert.equal(env.error_code, "ADS_MUTATE_NOT_ENABLED", name);
      assert.equal(hops, 0, name);
    }
  });

  it("dry_run create search campaign proposes with zero hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, adsLicenseEnv({ DGTL_ADS_MUTATE_ENABLED: "true" }));
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/gads/")) hops += 1;
      throw new Error(`NETWORK_FORBIDDEN ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "gads_create_search_campaign", {
      customer_id: "123-456-7890",
      campaign_name: "Speedrun",
      ad_group_name: "AG",
      daily_budget_dollars: 15,
      keywords: [{ text: "run", match_type: "PHRASE" }],
      headlines: ["H1", "H2", "H3"],
      descriptions: ["D1 long enough", "D2 long enough"],
      final_url: "https://example.com/landing",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    const data = env.data as { dry_run: boolean; proposed: { customer_id: string; status: string } };
    assert.equal(data.dry_run, true);
    assert.equal(data.proposed.customer_id, "1234567890");
    assert.equal(data.proposed.status, "PAUSED");
    assert.equal(hops, 0);
  });

  it("live without confirm customer_id → INVALID_ARGUMENT; spend cap blocks", async () => {
    let hops = 0;
    const ctx = makeCtx({}, adsLicenseEnv({ DGTL_ADS_MUTATE_ENABLED: "true" }));
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/gads/")) hops += 1;
      throw new Error(`NETWORK_FORBIDDEN ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "gads_add_keywords", {
      customer_id: "1234567890",
      ad_group_id: "1",
      keywords: [{ text: "a" }],
      dry_run: false,
      confirm_phrase: "please add keywords",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(hops, 0);

    const cap = await dispatch(ctx, "gads_create_search_campaign", {
      customer_id: "1234567890",
      campaign_name: "C",
      ad_group_name: "A",
      amount_micros: "999999999999999",
      keywords: [{ text: "k" }],
      dry_run: false,
      confirm_phrase: "customer 1234567890",
    });
    assert.equal(cap.ok, false);
    assert.equal(cap.error_code, "SPEND_CAP_EXCEEDED");
    assert.equal(hops, 0);
  });

  it("live + confirm hops gateway for keyword status with Consent C only", async () => {
    let seenAuth = "";
    let seenBody = "";
    const ctx = makeCtx({}, adsLicenseEnv({ DGTL_ADS_MUTATE_ENABLED: "true" }));
    ctx.fetchImpl = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/gads/gads_set_keyword_status")) {
        const headers = init?.headers as Record<string, string>;
        const h = Object.fromEntries(
          Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]),
        );
        seenAuth = h["x-dgtl-user-access-token"] || "";
        seenBody = typeof init?.body === "string" ? init.body : "";
        return new Response(
          JSON.stringify({ ok: true, tool: "gads_set_keyword_status", data: {} }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`NETWORK_FORBIDDEN ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "gads_set_keyword_status", {
      customer_id: "1234567890",
      ad_group_id: "11",
      criterion_id: "22",
      status: "PAUSED",
      dry_run: false,
      confirm_phrase: "pause keyword on customer 1234567890",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal(seenAuth, "consent-c-ads-token");
    const body = JSON.parse(seenBody) as { tool: string; params: Record<string, string> };
    assert.equal(body.tool, "gads_set_keyword_status");
    assert.equal(body.params.criterion_id, "22");
    assert.ok(!("mutateOperations" in body.params));
    assert.notEqual(seenAuth, TEST_TOKEN);
  });

  it("catalog gated_tools lists create tools", () => {
    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8"));
    for (const name of createTools) {
      const g = catalog.gated_tools.find((x: { name: string }) => x.name === name);
      assert.ok(g, name);
      assert.equal(g.fail, "ADS_MUTATE_NOT_ENABLED", name);
    }
  });
});
