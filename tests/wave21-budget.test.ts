import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  assertClickViewSingleDay,
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
  type AdsLastClickRow,
  type CurrentBudget,
  type Ga4MtaRow,
} from "../src/budget/mta-ltv.js";
import { ToolError } from "../src/errors.js";
import { dispatch } from "../src/tools/dispatch.js";
import { CONSENT_A_TOOLS, LICENSE_GATED_TOOLS, TOOLS } from "../src/tools/registry.js";
import * as S from "../src/tools/schemas.js";
import {
  installNetworkGuard,
  makeCtx,
  reportArgs,
  ROOT,
  signLicense,
  testEnv,
  TEST_TOKEN,
} from "./helpers.js";

const GATEWAY = "https://stamp.test";
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
  ga4_rows: Ga4MtaRow[];
  ads_last_click_rows: AdsLastClickRow[];
  current_budgets: CurrentBudget[];
  expected: {
    gads_share: number;
    tiktok_share: number;
    gads_dollars: number;
    tiktok_dollars: number;
  };
};

function hopFetch(onHop: (url: string, body: Record<string, unknown>) => Response | void): typeof fetch {
  return (async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/v1/health")) {
      return new Response(JSON.stringify({ ok: true, tiktok_mutate_enabled: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const override = onHop(url, body);
    if (override) return override;
    return new Response(
      JSON.stringify({
        ok: true,
        tool: "hop",
        data: { results: [] },
        page: { truncated: false, row_count: 0 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

describe("wave21 mta ltv budget", () => {
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
      comment: string;
      tools: Array<{ name: string; path_template: string }>;
    };
    assert.match(hops.comment, /tiktok_update_campaign_budget/);
    assert.match(hops.comment, /allocate_budgets/);
    const hop = hops.tools.find((x) => x.name === "tiktok_update_campaign_budget");
    assert.ok(hop);
    assert.match(hop!.path_template, /campaign\/update/);
  });

  it("closed Wave 21 recipes compile SELECT-only GAQL matching fixtures", () => {
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
    assert.throws(
      () => assertClickViewSingleDay({ recipe: "click_view", date_range: { start_date: "2026-09-01", end_date: "2026-09-12" } }),
      (err: unknown) => err instanceof ToolError && err.error_code === "INVALID_ARGUMENT",
    );
    assert.doesNotThrow(() =>
      assertClickViewSingleDay({
        recipe: "click_view",
        date_range: { start_date: "2026-09-12", end_date: "2026-09-12" },
      }),
    );
  });

  it("gads_describe_recipes lists Wave 21 recipes when licensed", async () => {
    const ctx = makeCtx({}, licensedEnv());
    const env = await dispatch(ctx, "gads_describe_recipes", {});
    assert.equal(env.ok, true);
    const recipes = (env.data as { recipes: Array<{ recipe: string }> }).recipes.map((r) => r.recipe);
    for (const recipe of WAVE21_GADS_RECIPES) assert.ok(recipes.includes(recipe), recipe);
  });

  it("gads_search hops recipe name for click_view without GAQL", async () => {
    let hopBody: Record<string, unknown> | undefined;
    const ctx = makeCtx(
      {},
      licensedEnv({
        DGTL_GATEWAY_URL: GATEWAY,
        GOOGLE_ADS_ACCESS_TOKEN: ADS_TOKEN,
      }),
    );
    ctx.fetchImpl = hopFetch((url, body) => {
      if (url.includes("/v1/gads/")) hopBody = body;
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

  it("unknown recipe and multi-day click_view fail closed without hop", async () => {
    const captures: string[] = [];
    const ctx = makeCtx(
      {},
      licensedEnv({
        DGTL_GATEWAY_URL: GATEWAY,
        GOOGLE_ADS_ACCESS_TOKEN: ADS_TOKEN,
      }),
    );
    ctx.fetchImpl = hopFetch((url) => {
      captures.push(url);
    });
    const unknown = await dispatch(ctx, "gads_search", {
      customer_id: "123",
      recipe: "raw_gaql_please",
    });
    assert.equal(unknown.error_code, "INVALID_ARGUMENT");
    const multi = await dispatch(ctx, "gads_search", {
      customer_id: "123",
      recipe: "click_view",
      date_range: { start_date: "2026-09-01", end_date: "2026-09-12" },
    });
    assert.equal(multi.error_code, "INVALID_ARGUMENT");
    assert.match(String(multi.message ?? multi.hint), /single-day|click_view/i);
    assert.ok(!captures.some((u) => u.includes("/v1/gads/")));
  });

  it("ga4_run_report refuses gclid", async () => {
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
    const meta = loadJson("fixtures/budget/mta-ltv.metadata.json") as { api_names: string[] };
    assert.ok(!meta.api_names.includes("userLifetimeValue"));
    assert.ok(!meta.api_names.includes("gclid"));
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

  it("tiktok_update_campaign_budget schema dry_run default; live needs confirm", () => {
    const t = TOOLS.find((x) => x.name === "tiktok_update_campaign_budget");
    assert.ok(t);
    assert.equal(t!.group, "tiktok-write");
    assert.equal(t!.annotations.destructiveHint, true);
    const parsed = S.tiktokUpdateCampaignBudget.parse({
      advertiser_id: "1234567890",
      campaign_id: "987654321",
      budget: 25,
    });
    assert.equal(parsed.dry_run, true);
    const liveMissing = S.tiktokUpdateCampaignBudget.safeParse({
      advertiser_id: "1234567890",
      campaign_id: "987654321",
      budget: 25,
      dry_run: false,
    });
    assert.equal(liveMissing.success, false);
  });

  it("tiktok_update_campaign_budget dry_run proposes without hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, tiktokLicenseEnv());
    ctx.fetchImpl = hopFetch((url) => {
      if (url.includes("/v1/tiktok/tiktok_update_")) hops += 1;
    });
    const env = await dispatch(ctx, "tiktok_update_campaign_budget", {
      advertiser_id: "1234567890",
      campaign_id: "987654321",
      budget: 25,
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal((env.data as { dry_run?: boolean }).dry_run, true);
    assert.equal(hops, 0);
  });

  it("tiktok_update_campaign_budget live without confirm fails before hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, tiktokLicenseEnv());
    ctx.fetchImpl = hopFetch((url) => {
      if (url.includes("/v1/tiktok/tiktok_update_")) hops += 1;
    });
    const env = await dispatch(ctx, "tiktok_update_campaign_budget", {
      advertiser_id: "1234567890",
      campaign_id: "987654321",
      budget: 25,
      dry_run: false,
    });
    assert.equal(env.ok, false);
    assert.equal(hops, 0);
  });

  it("tiktok_update_campaign_budget live confirm hops campaign update", async () => {
    let seenUrl = "";
    let hopBody: Record<string, unknown> | undefined;
    const ctx = makeCtx({}, tiktokLicenseEnv());
    ctx.fetchImpl = hopFetch((url, body) => {
      if (url.includes("/v1/tiktok/")) {
        seenUrl = url;
        hopBody = body;
      }
    });
    const env = await dispatch(ctx, "tiktok_update_campaign_budget", {
      advertiser_id: "1234567890",
      campaign_id: "987654321",
      budget: 25,
      dry_run: false,
      confirm_phrase: "update 1234567890 987654321",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.ok(seenUrl.endsWith("/v1/tiktok/tiktok_update_campaign_budget"));
    assert.equal((hopBody?.params as { budget?: number } | undefined)?.budget, 25);
    assert.equal((hopBody?.params as { budget_mode?: string } | undefined)?.budget_mode, "BUDGET_MODE_DAY");
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
    assert.ok(skill.includes("one platform per confirm"));
    assert.ok(skill.includes("dry_run"));
    assert.match(skill, /Never Axos/);
  });

  it("sibling stamp hop-catalog tiktok budget row matches when checkout is present", () => {
    const stamp = process.env.DGTL_STAMP_ROOT?.trim() || "/workspace/dgtl-planning/services/stamp";
    if (!existsSync(join(stamp, "src/gateway/hop-catalog.json"))) return;
    const plugin = JSON.parse(readFileSync(join(ROOT, "src/gateway/hop-catalog.json"), "utf8")) as {
      tools: Array<{ name: string; path_template: string; method: string }>;
    };
    const remote = JSON.parse(readFileSync(join(stamp, "src/gateway/hop-catalog.json"), "utf8")) as {
      tools: Array<{ name: string; path_template: string; method: string }>;
    };
    const a = plugin.tools.find((t) => t.name === "tiktok_update_campaign_budget");
    const b = remote.tools.find((t) => t.name === "tiktok_update_campaign_budget");
    assert.ok(a);
    assert.deepEqual(a, b);
  });
});
