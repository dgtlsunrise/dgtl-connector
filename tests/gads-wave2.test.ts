import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import * as S from "../src/tools/schemas.js";
import { dispatch } from "../src/tools/dispatch.js";
import { GADS_MUTATE_TOOL_NAMES, TOOLS } from "../src/tools/registry.js";
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
    jti: "jti-wave2",
  });
  return testEnv({
    DGTL_LICENSE_JWT: jwt,
    GOOGLE_ADS_ACCESS_TOKEN: "consent-c-ads-token",
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    DGTL_GATEWAY_URL: "https://stamp.test",
    ...extra,
  });
}

const WAVE2 = [
  "gads_create_responsive_display_ad",
  "gads_add_shopping_listing_groups",
  "gads_create_video_campaign",
  "gads_create_demand_gen_campaign",
  "gads_create_app_campaign",
  "gads_create_hotel_campaign",
  "gads_create_local_campaign",
  "gads_add_negative_keywords",
  "gads_attach_audience",
  "gads_add_geo_targets",
  "gads_add_languages",
  "gads_add_demographics",
  "gads_set_ad_schedule",
  "gads_set_campaign_bid_strategy",
  "gads_create_shared_budget",
  "gads_create_portfolio_bidding_strategy",
  "gads_create_conversion_action",
  "gads_apply_recommendation",
  "gads_link_merchant_center",
  "gads_unlink_merchant_center",
  "gads_create_experiment",
] as const;

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("Wave 2 named Ads graph tools (plugin)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("all Wave 2 tools are registered destructive and in mutate group", () => {
    for (const name of WAVE2) {
      const t = TOOLS.find((x) => x.name === name);
      assert.ok(t, name);
      assert.equal(t!.group, "gads-write", name);
      assert.equal(t!.annotations.destructiveHint, true, name);
      assert.ok(GADS_MUTATE_TOOL_NAMES.includes(name), name);
    }
  });

  it("catalog gated_tools lists Wave 2 mutate tools", () => {
    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8"));
    for (const name of WAVE2) {
      const g = catalog.gated_tools.find((x: { name: string }) => x.name === name);
      assert.ok(g, name);
      assert.equal(g.fail, "ADS_MUTATE_NOT_ENABLED", name);
    }
  });

  it("schemas default dry_run true", () => {
    assert.equal(
      S.gadsCreateResponsiveDisplayAd.parse({
        customer_id: "1234567890",
        ad_group_id: "1",
        headlines: ["H"],
        long_headline: "Long",
        descriptions: ["D"],
        business_name: "Acme",
        final_url: "https://example.com",
        marketing_image_bytes: PNG,
        square_marketing_image_bytes: PNG,
      }).dry_run,
      true,
    );
    assert.equal(
      S.gadsCreateVideoCampaign.parse({
        customer_id: "1234567890",
        campaign_name: "V",
        daily_budget_dollars: 5,
      }).dry_run,
      true,
    );
  });

  it("flag off → ADS_MUTATE_NOT_ENABLED zero hop for Wave 2 tools", async () => {
    const samples: Record<string, Record<string, unknown>> = {
      gads_create_responsive_display_ad: {
        customer_id: "1234567890",
        ad_group_id: "1",
        headlines: ["H"],
        long_headline: "Long",
        descriptions: ["D"],
        business_name: "Acme",
        final_url: "https://example.com",
        marketing_image_bytes: PNG,
        square_marketing_image_bytes: PNG,
      },
      gads_add_shopping_listing_groups: {
        customer_id: "1234567890",
        campaign_id: "2",
        ad_group_name: "All",
      },
      gads_create_video_campaign: {
        customer_id: "1234567890",
        campaign_name: "V",
        daily_budget_dollars: 5,
      },
      gads_create_demand_gen_campaign: {
        customer_id: "1234567890",
        campaign_name: "DG",
        daily_budget_dollars: 5,
      },
      gads_create_app_campaign: {
        customer_id: "1234567890",
        campaign_name: "App",
        app_id: "com.example.app",
        daily_budget_dollars: 5,
      },
      gads_create_hotel_campaign: {
        customer_id: "1234567890",
        campaign_name: "Hotel",
        hotel_center_id: "99",
        daily_budget_dollars: 5,
      },
      gads_create_local_campaign: {
        customer_id: "1234567890",
        campaign_name: "Local",
        daily_budget_dollars: 5,
      },
      gads_add_negative_keywords: {
        customer_id: "1234567890",
        campaign_id: "2",
        keywords: [{ text: "cheap" }],
      },
      gads_attach_audience: {
        customer_id: "1234567890",
        campaign_id: "2",
        audience_resource_name: "customers/1234567890/audiences/1",
      },
      gads_add_geo_targets: {
        customer_id: "1234567890",
        campaign_id: "2",
        geo_target_constant_ids: ["2840"],
      },
      gads_add_languages: {
        customer_id: "1234567890",
        campaign_id: "2",
        language_constant_ids: ["1000"],
      },
      gads_add_demographics: {
        customer_id: "1234567890",
        ad_group_id: "3",
        genders: ["MALE"],
      },
      gads_set_ad_schedule: {
        customer_id: "1234567890",
        campaign_id: "2",
        schedules: [{ day_of_week: "MONDAY", start_hour: 9, end_hour: 17 }],
      },
      gads_set_campaign_bid_strategy: {
        customer_id: "1234567890",
        campaign_id: "2",
        bid_strategy_type: "MANUAL_CPC",
      },
      gads_create_shared_budget: {
        customer_id: "1234567890",
        name: "Shared",
        daily_budget_dollars: 5,
      },
      gads_create_portfolio_bidding_strategy: {
        customer_id: "1234567890",
        name: "Portfolio",
        bid_strategy_type: "TARGET_CPA",
        target_cpa_micros: "1500000",
      },
      gads_create_conversion_action: {
        customer_id: "1234567890",
        name: "Purchase",
      },
      gads_apply_recommendation: {
        customer_id: "1234567890",
        recommendation_id: "77",
      },
      gads_link_merchant_center: {
        customer_id: "1234567890",
        merchant_center_id: "424242",
      },
      gads_unlink_merchant_center: {
        customer_id: "1234567890",
        product_link_id: "5",
      },
      gads_create_experiment: {
        customer_id: "1234567890",
        campaign_id: "2",
        name: "Exp",
      },
    };
    for (const name of WAVE2) {
      let hops = 0;
      const ctx = makeCtx({}, adsLicenseEnv({ DGTL_ADS_MUTATE_ENABLED: "false" }));
      ctx.fetchImpl = (async () => {
        hops += 1;
        throw new Error("NETWORK_FORBIDDEN");
      }) as typeof fetch;
      const env = await dispatch(ctx, name, samples[name] ?? { customer_id: "1234567890" });
      assert.equal(env.ok, false, name);
      assert.equal(env.error_code, "ADS_MUTATE_NOT_ENABLED", name);
      assert.equal(hops, 0, name);
    }
  });

  it("RDA without images → INVALID_ARGUMENT zero hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, adsLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "gads_create_responsive_display_ad", {
      customer_id: "1234567890",
      ad_group_id: "1",
      headlines: ["H"],
      long_headline: "Long",
      descriptions: ["D"],
      business_name: "Acme",
      final_url: "https://example.com",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.ok(String(env.hint || env.message || "").includes("gads_upload_asset"));
    assert.equal(hops, 0);
  });

  it("RDA dry_run with bytes proposes without hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, adsLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "gads_create_responsive_display_ad", {
      customer_id: "1234567890",
      ad_group_id: "1",
      headlines: ["H"],
      long_headline: "Long",
      descriptions: ["D"],
      business_name: "Acme",
      final_url: "https://example.com",
      marketing_image_bytes: PNG,
      square_marketing_image_bytes: PNG,
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal((env.data as { dry_run?: boolean }).dry_run, true);
    assert.equal(hops, 0);
  });

  it("Video dry_run defaults PAUSED without hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, adsLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "gads_create_video_campaign", {
      customer_id: "1234567890",
      campaign_name: "Video",
      daily_budget_dollars: 10,
      youtube_video_id: "dQw4w9WgXcQ",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    const data = env.data as { dry_run?: boolean; proposed?: { status?: string } };
    assert.equal(data.dry_run, true);
    assert.equal(data.proposed?.status, "PAUSED");
    assert.equal(hops, 0);
  });

  it("Local create is NOT_IMPLEMENTED zero hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, adsLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "gads_create_local_campaign", {
      customer_id: "1234567890",
      campaign_name: "Local",
      daily_budget_dollars: 5,
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "NOT_IMPLEMENTED");
    assert.equal(hops, 0);
  });

  it("negatives dry_run default PAUSED; geo dry_run without hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, adsLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const neg = await dispatch(ctx, "gads_add_negative_keywords", {
      customer_id: "1234567890",
      campaign_id: "2",
      keywords: [{ text: "cheap", match_type: "PHRASE" }],
    });
    assert.equal(neg.ok, true);
    assert.equal((neg.data as { proposed?: { status?: string } }).proposed?.status, "PAUSED");
    const geo = await dispatch(ctx, "gads_add_geo_targets", {
      customer_id: "1234567890",
      campaign_id: "2",
      geo_target_constant_ids: ["2840"],
    });
    assert.equal(geo.ok, true);
    assert.equal(hops, 0);
  });

  it("Hotel without hotel_center_id → INVALID_ARGUMENT zero hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, adsLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "gads_create_hotel_campaign", {
      customer_id: "1234567890",
      campaign_name: "Hotel",
      daily_budget_dollars: 5,
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(hops, 0);
  });

  it("MC link without merchant_center_id → MERCHANT_CENTER_REQUIRED zero hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, adsLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "gads_link_merchant_center", {
      customer_id: "1234567890",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "MERCHANT_CENTER_REQUIRED");
    assert.equal(hops, 0);
  });

  it("live mutate without confirm_phrase fails schema", () => {
    const parsed = S.gadsCreateVideoCampaign.safeParse({
      customer_id: "1234567890",
      campaign_name: "V",
      daily_budget_dollars: 5,
      dry_run: false,
    });
    assert.equal(parsed.success, false);
  });
});
