import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { dispatch } from "../src/tools/dispatch.js";
import { GA4_ADS_ID_DIMENSIONS } from "../src/google/ga4-ads-id.js";
import { installNetworkGuard, makeCtx, reportArgs } from "./helpers.js";

describe("Wave 11 GA4 Ads-id recipes / conversionSpec spike", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("searchQuery denylist still fires with zero HTTP", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "ga4_run_report", {
      ...reportArgs(),
      recipe: "ads_mta_campaign_ids",
      dimensions: ["searchQuery"],
    });
    assert.equal(env.error_code, "UNSUPPORTED_DIMENSION");
    assert.equal(ctx.calls.length, 0);
  });

  it("Ads keyword text is refused (not an id)", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "ga4_run_report", {
      ...reportArgs(),
      dimensions: ["sessionGoogleAdsKeyword"],
    });
    assert.equal(env.error_code, "UNSUPPORTED_DIMENSION");
    assert.equal(ctx.calls.length, 0);
  });

  it("invented Ads dimension is refused", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "ga4_run_report", {
      ...reportArgs(),
      dimensions: ["googleAdsFooId"],
    });
    assert.equal(env.error_code, "UNSUPPORTED_DIMENSION");
    assert.equal(ctx.calls.length, 0);
  });

  it("ads_mta_keyword_ids recipe documents missing keyword id", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "ga4_run_report", {
      property_id: "properties/111111111",
      date_ranges: [{ start_date: "2026-08-01", end_date: "2026-08-31" }],
      recipe: "ads_mta_keyword_ids",
    });
    assert.equal(env.error_code, "UNSUPPORTED_DIMENSION");
    assert.match(String(env.message), /keyword/i);
    assert.equal(ctx.calls.length, 0);
  });

  it("ads_mta_ids recipe fills closed id dimensions and default metrics", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "ga4_run_report", {
      property_id: "properties/111111111",
      date_ranges: [{ start_date: "2026-08-01", end_date: "2026-08-31" }],
      recipe: "ads_mta_ids",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    const cited = (env.data as { cited: { dimensions: string[]; metrics: string[]; recipe: string } }).cited;
    assert.equal(cited.recipe, "ads_mta_ids");
    assert.ok(cited.dimensions.includes("sessionGoogleAdsCampaignId"));
    assert.ok(cited.dimensions.includes("googleAdsCustomerId"));
    assert.ok(cited.metrics.includes("keyEvents"));
    for (const d of cited.dimensions) {
      assert.ok((GA4_ADS_ID_DIMENSIONS as readonly string[]).includes(d), d);
    }
    assert.ok(ctx.calls.some((c) => c.path.includes(":runReport")));
  });

  it("key_event_names expands to keyEvents:name (no conversionSpec field)", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "ga4_run_report", {
      ...reportArgs(),
      recipe: "ads_mta_campaign_ids",
      key_event_names: ["purchase"],
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    const cited = (env.data as { cited: { metrics: string[] } }).cited;
    assert.ok(cited.metrics.includes("keyEvents:purchase"));
    const bodyCall = ctx.calls.find((c) => c.path.includes(":runReport"));
    assert.ok(bodyCall);
  });
});
