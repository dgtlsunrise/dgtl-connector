import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  assertSelectOnlyGaql,
  compileGadsRecipe,
  WAVE21_GADS_RECIPES,
} from "../src/ads/recipes-gaql.js";
import { GADS_RECIPE_NAMES } from "../src/ads/recipes-schema.js";
import {
  assertLtvFromMetadata,
  assertMetadataNames,
  assertNoGa4Gclid,
  assertOnePlatformPerConfirm,
  nextPlatformAfterConfirm,
  PLATFORM_BUDGET_TOOLS,
  proposeMtaLtvBudgets,
} from "../src/budget/mta-ltv.js";
import { createAppContext } from "../src/context.js";
import { ToolError } from "../src/errors.js";
import { dispatch } from "../src/tools/dispatch.js";
import { CONSENT_A_TOOLS, LICENSE_GATED_TOOLS, TOOLS } from "../src/tools/registry.js";
import {
  installNetworkGuard,
  makeCtx,
  reportArgs,
  ROOT,
  signLicense,
  testEnv,
  TEST_TOKEN,
} from "./helpers.js";

const GATEWAY = "https://gateway.test.dgtl";
const ADS_TOKEN = "consent-c-ads-user-token";

function licensedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const jwt = signLicense({
    sub: "w21-user",
    exp: Math.floor(Date.now() / 1000) + 86400,
    features: ["ads", "meta", "tiktok"],
    jti: "w21-jti",
  });
  return testEnv({
    DGTL_LICENSE_JWT: jwt,
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    ...extra,
  });
}

function tiktokLicenseEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return licensedEnv({
    TIKTOK_ACCESS_TOKEN: "tiktok-user-token-fixture",
    DGTL_GATEWAY_URL: GATEWAY,
    ...extra,
  });
}

function loadJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as Record<string, unknown>;
}

const PROPOSAL_FIX = loadJson("fixtures/budget/mta-ltv.proposal.json") as {
  property_id: string;
  ga4_attribution_model: string;
  pool_daily_budget_dollars: number;
  ga4_rows: Array<{ campaign_id: string; key_events: number; sessions: number }>;
  ads_last_click_rows: Array<{ campaign_id: string; conversions: number }>;
  current_budgets: Array<{
    platform: "gads" | "meta" | "tiktok";
    campaign_id: string;
    customer_id?: string;
    campaign_budget_id?: string;
    advertiser_id?: string;
    current_daily_budget_dollars: number;
  }>;
  expected: {
    winner: null;
    used_ltv: boolean;
    gads_share: number;
    tiktok_share: number;
    gads_dollars: number;
    tiktok_dollars: number;
    sequence: string[];
    gads_tool: string;
    tiktok_tool: string;
    note_contains: string;
  };
};

describe("Wave 21 MTA / LTV → budget", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("Consent A kernel stays 26; no allocate_budgets mega tool", () => {
    assert.equal(CONSENT_A_TOOLS.length, 26);
    assert.equal(
      TOOLS.some((t) => /allocate_budget|apply_all_budget|fan_out_budget/i.test(t.name)),
      false,
    );
    assert.ok(LICENSE_GATED_TOOLS.includes("gads_search"));
    assert.ok(LICENSE_GATED_TOOLS.includes("gads_update_campaign_budget"));
    assert.ok(LICENSE_GATED_TOOLS.includes("tiktok_update_campaign_budget"));
    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8")) as {
      gated_tools: Array<{ name: string; fail: string }>;
    };
    const gated = catalog.gated_tools.find((x) => x.name === "tiktok_update_campaign_budget");
    assert.ok(gated);
    assert.equal(gated!.fail, "TIKTOK_MUTATE_NOT_ENABLED");
    const hops = JSON.parse(readFileSync(join(ROOT, "src/gateway/hop-catalog.json"), "utf8")) as {
      tools: Array<{ name: string; path_template: string }>;
    };
    const hop = hops.tools.find((x) => x.name === "tiktok_update_campaign_budget");
    assert.ok(hop);
    assert.match(hop!.path_template, /campaign\/update/);
  });

  it("closed Wave 21 recipes are in describe + compiler; no raw GAQL", () => {
    for (const recipe of WAVE21_GADS_RECIPES) {
      assert.ok(GADS_RECIPE_NAMES.has(recipe), recipe);
      const compiled = compileGadsRecipe(recipe);
      assertSelectOnlyGaql(compiled.gaql);
      const fix = loadJson(`fixtures/ads/recipes.${recipe}.json`);
      assert.equal(fix.recipe, recipe);
      assert.equal(fix.gaql, compiled.gaql);
      assert.deepEqual(fix.select, compiled.select);
      assert.equal(fix.from, compiled.from);
    }
    assert.throws(
      () => compileGadsRecipe("SELECT campaign.id FROM campaign"),
      (err: unknown) => err instanceof ToolError && err.error_code === "INVALID_ARGUMENT",
    );
  });

  it("gads_describe_recipes lists Wave 21 recipes when licensed", async () => {
    const ctx = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv(),
      fetchImpl: async () => {
        throw new Error("no fetch");
      },
    });
    const env = await dispatch(ctx, "gads_describe_recipes", {});
    assert.equal(env.ok, true);
    const recipes = (env.data as { recipes: Array<{ recipe: string }> }).recipes.map((r) => r.recipe);
    for (const recipe of WAVE21_GADS_RECIPES) assert.ok(recipes.includes(recipe), recipe);
  });

  it("gads_search hops recipe name for click_view (no GAQL on the wire)", async () => {
    let hopBody: Record<string, unknown> | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      hopBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          ok: true,
          tool: "gads_search",
          data: { results: [] },
          page: { truncated: false, row_count: 0 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const ctx = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({
        DGTL_GATEWAY_URL: GATEWAY,
        GOOGLE_ADS_ACCESS_TOKEN: ADS_TOKEN,
      }),
      fetchImpl,
    });
    const env = await dispatch(ctx, "gads_search", {
      customer_id: "123-456-7890",
      recipe: "click_view",
      date_range: { start_date: "2026-09-12", end_date: "2026-09-12" },
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal(hopBody?.recipe, "click_view");
    assert.equal(JSON.stringify(hopBody).includes("SELECT "), false);
    const cited = (env.data as { cited?: { recipe?: string; customer_id?: string } }).cited;
    assert.equal(cited?.recipe, "click_view");
    assert.equal(cited?.customer_id, "1234567890");
  });

  it("unknown recipe still fails closed without hop", async () => {
    const captures: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      captures.push(String(input));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const ctx = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({
        DGTL_GATEWAY_URL: GATEWAY,
        GOOGLE_ADS_ACCESS_TOKEN: ADS_TOKEN,
      }),
      fetchImpl,
    });
    const env = await dispatch(ctx, "gads_search", {
      customer_id: "123",
      recipe: "raw_gaql_please",
    });
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.ok(!captures.some((u) => u.includes("/v1/gads/")));
  });

  it("ga4_run_report refuses gclid (not a GA4 dimension)", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "ga4_run_report", {
      ...reportArgs(),
      dimensions: ["gclid"],
    });
    assert.equal(env.error_code, "UNSUPPORTED_DIMENSION");
    assert.match(String(env.hint), /click_view/i);
    assert.equal(ctx.calls.length, 0);
  });

  it("refuses missing metadata names and invented userLifetimeValue", () => {
    const meta = loadJson("fixtures/budget/mta-ltv.metadata.json") as {
      api_names: string[];
    };
    assert.throws(
      () => assertMetadataNames(["sessions", "userLifetimeValue"], meta.api_names),
      (err: unknown) => err instanceof ToolError && err.error_code === "INVALID_ARGUMENT",
    );
    assert.throws(
      () => assertLtvFromMetadata(["userLifetimeValue"], meta.api_names),
      (err: unknown) =>
        err instanceof ToolError &&
        err.error_code === "INVALID_ARGUMENT" &&
        String((err as ToolError).message).includes("userLifetimeValue"),
    );
    assert.doesNotThrow(() => assertMetadataNames(["sessions", "keyEvents"], meta.api_names));
    assert.throws(
      () => assertNoGa4Gclid(["gclid"]),
      (err: unknown) => err instanceof ToolError && err.error_code === "UNSUPPORTED_DIMENSION",
    );
  });

  it("proposal weights GA4 DDA key events, not Ads last-click as sole truth", () => {
    const proposed = proposeMtaLtvBudgets({
      property_id: PROPOSAL_FIX.property_id,
      metadata_metric_names: ["sessions", "keyEvents"],
      requested_metrics: ["sessions", "keyEvents"],
      ga4_attribution_model: PROPOSAL_FIX.ga4_attribution_model,
      ga4_rows: PROPOSAL_FIX.ga4_rows,
      ads_last_click_rows: PROPOSAL_FIX.ads_last_click_rows,
      current_budgets: PROPOSAL_FIX.current_budgets,
      pool_daily_budget_dollars: PROPOSAL_FIX.pool_daily_budget_dollars,
    });
    assert.equal(proposed.winner, null);
    assert.equal(proposed.used_ltv, false);
    assert.match(proposed.note, /not sole truth/i);
    assert.deepEqual(proposed.sequence, ["gads", "tiktok"]);
    const gads = proposed.proposals.find((p) => p.platform === "gads");
    const tiktok = proposed.proposals.find((p) => p.platform === "tiktok");
    assert.ok(gads && tiktok);
    assert.equal(gads.tool, PLATFORM_BUDGET_TOOLS.gads);
    assert.equal(tiktok.tool, PLATFORM_BUDGET_TOOLS.tiktok);
    assert.equal(gads.share, PROPOSAL_FIX.expected.gads_share);
    assert.equal(tiktok.share, PROPOSAL_FIX.expected.tiktok_share);
    assert.equal(gads.proposed_daily_budget_dollars, PROPOSAL_FIX.expected.gads_dollars);
    assert.equal(tiktok.proposed_daily_budget_dollars, PROPOSAL_FIX.expected.tiktok_dollars);
    assert.equal(gads.dry_run, true);
    assert.equal(tiktok.args.dry_run, true);
    assert.equal(gads.ads_last_click_conversions, 1);
    assert.equal(tiktok.ads_last_click_conversions, 20);
    assert.ok(gads.proposed_daily_budget_dollars > tiktok.proposed_daily_budget_dollars);
  });

  it("one-platform-per-confirm sequence; LTV invent refuses on propose", () => {
    assert.equal(assertOnePlatformPerConfirm(["gads"]), "gads");
    assert.throws(
      () => assertOnePlatformPerConfirm(["gads", "tiktok"]),
      (err: unknown) => err instanceof ToolError && err.error_code === "INVALID_ARGUMENT",
    );
    const proposed = proposeMtaLtvBudgets({
      property_id: PROPOSAL_FIX.property_id,
      metadata_metric_names: ["sessions", "keyEvents"],
      ga4_rows: PROPOSAL_FIX.ga4_rows,
      current_budgets: PROPOSAL_FIX.current_budgets,
      pool_daily_budget_dollars: 50,
    });
    assert.deepEqual(nextPlatformAfterConfirm(proposed, []), {
      platform: "gads",
      tool: "gads_update_campaign_budget",
    });
    assert.deepEqual(nextPlatformAfterConfirm(proposed, ["gads"]), {
      platform: "tiktok",
      tool: "tiktok_update_campaign_budget",
    });
    assert.deepEqual(nextPlatformAfterConfirm(proposed, ["gads", "tiktok"]), { done: true });
    assert.throws(
      () => nextPlatformAfterConfirm(proposed, ["tiktok"]),
      (err: unknown) => err instanceof ToolError && err.error_code === "INVALID_ARGUMENT",
    );
    assert.throws(
      () =>
        proposeMtaLtvBudgets({
          property_id: PROPOSAL_FIX.property_id,
          metadata_metric_names: ["sessions", "keyEvents"],
          requested_metrics: ["userLifetimeValue"],
          ga4_rows: PROPOSAL_FIX.ga4_rows,
          current_budgets: PROPOSAL_FIX.current_budgets,
          pool_daily_budget_dollars: 50,
        }),
      (err: unknown) => err instanceof ToolError && String((err as ToolError).message).includes("userLifetimeValue"),
    );
  });

  it("tiktok_update_campaign_budget dry_run + confirm hop", async () => {
    const t = TOOLS.find((x) => x.name === "tiktok_update_campaign_budget");
    assert.ok(t);
    assert.equal(t!.group, "tiktok-write");
    assert.equal(t!.annotations.destructiveHint, true);

    const dry = await dispatch(
      createAppContext({
        pluginRoot: ROOT,
        env: tiktokLicenseEnv(),
        fetchImpl: async () => {
          throw new Error("no fetch");
        },
      }),
      "tiktok_update_campaign_budget",
      { advertiser_id: "1234567890", campaign_id: "987654321", budget: 25 },
    );
    assert.equal(dry.ok, true, JSON.stringify(dry));
    assert.equal((dry.data as { dry_run?: boolean }).dry_run, true);

    const liveNoConfirm = await dispatch(
      createAppContext({
        pluginRoot: ROOT,
        env: tiktokLicenseEnv(),
        fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      }),
      "tiktok_update_campaign_budget",
      {
        advertiser_id: "1234567890",
        campaign_id: "987654321",
        budget: 25,
        dry_run: false,
      },
    );
    assert.equal(liveNoConfirm.ok, false);

    let seenUrl = "";
    let hopBody: Record<string, unknown> | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/health")) {
        return new Response(JSON.stringify({ ok: true, tiktok_mutate_enabled: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      seenUrl = url;
      hopBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          ok: true,
          tool: "tiktok_update_campaign_budget",
          data: { campaign_ids: ["987654321"] },
          api: "tiktok",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const live = await dispatch(
      createAppContext({
        pluginRoot: ROOT,
        env: tiktokLicenseEnv(),
        fetchImpl,
      }),
      "tiktok_update_campaign_budget",
      {
        advertiser_id: "1234567890",
        campaign_id: "987654321",
        budget: 25,
        dry_run: false,
        confirm_phrase: "update 1234567890 987654321",
      },
    );
    assert.equal(live.ok, true, JSON.stringify(live));
    assert.ok(seenUrl.endsWith("/v1/tiktok/tiktok_update_campaign_budget"));
    assert.equal((hopBody?.params as { budget?: number } | undefined)?.budget, 25);
  });

  it("skill documents DDA vs last-click, dry_run, one-platform confirm", () => {
    const skill = readFileSync(join(ROOT, "skills/mta-ltv-budget/SKILL.md"), "utf8");
    assert.ok(skill.includes("name: mta-ltv-budget"));
    assert.ok(skill.includes("allocate_budgets"));
    assert.ok(skill.includes("userLifetimeValue"));
    assert.ok(skill.includes("gclid is not a GA4 dimension"));
    assert.ok(skill.includes("gads_update_campaign_budget"));
    assert.ok(skill.includes("meta_update_adset"));
    assert.ok(skill.includes("tiktok_update_campaign_budget"));
    assert.ok(skill.includes("click_view"));
    assert.ok(skill.includes("one platform"));
    assert.ok(skill.includes("dry_run"));
    assert.ok(!/axos/i.test(skill));
  });
});
