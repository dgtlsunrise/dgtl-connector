import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import * as S from "../src/tools/schemas.js";
import { dispatch } from "../src/tools/dispatch.js";
import { META_MUTATE_TOOL_NAMES, TOOLS } from "../src/tools/registry.js";
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
    jti: "jti-wave3-meta",
  });
  return testEnv({
    DGTL_LICENSE_JWT: jwt,
    META_ACCESS_TOKEN: "meta-user-token-fixture",
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    DGTL_GATEWAY_URL: "https://stamp.test",
    ...extra,
  });
}

const WAVE3_MUTATE = [
  "meta_update_adset_targeting",
  "meta_create_custom_audience",
  "meta_create_lookalike_audience",
  "meta_attach_audience",
] as const;

const WAVE3_READ = [
  "meta_list_pixels",
  "meta_get_pixel",
  "meta_list_catalogs",
  "meta_list_catalog_products",
  "meta_list_custom_audiences",
] as const;

describe("Wave 3 Meta named packs (plugin)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("Wave 3 mutate tools are registered destructive", () => {
    for (const name of WAVE3_MUTATE) {
      const t = TOOLS.find((x) => x.name === name);
      assert.ok(t, name);
      assert.equal(t!.group, "meta-write", name);
      assert.equal(t!.annotations.destructiveHint, true, name);
      assert.ok(META_MUTATE_TOOL_NAMES.includes(name), name);
    }
  });

  it("Wave 3 read tools are registered readonly", () => {
    for (const name of WAVE3_READ) {
      const t = TOOLS.find((x) => x.name === name);
      assert.ok(t, name);
      assert.equal(t!.group, "meta", name);
      assert.equal(t!.annotations.readOnlyHint, true, name);
      assert.equal(t!.annotations.destructiveHint, false, name);
    }
  });

  it("catalog gated_tools lists Wave 3 mutate tools", () => {
    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8"));
    for (const name of WAVE3_MUTATE) {
      const g = catalog.gated_tools.find((x: { name: string }) => x.name === name);
      assert.ok(g, name);
      assert.equal(g.fail, "META_MUTATE_NOT_ENABLED", name);
    }
  });

  it("schemas default dry_run true and reject targeting bags", () => {
    assert.equal(
      S.metaUpdateAdsetTargeting.parse({
        ad_account_id: "111222333",
        adset_id: "998877",
        countries: ["US"],
        age_min: 25,
      }).dry_run,
      true,
    );
    assert.equal(
      S.metaCreateCustomAudience.parse({
        ad_account_id: "111222333",
        name: "Visitors",
        pixel_id: "1122334455",
      }).dry_run,
      true,
    );
    const bag = S.metaUpdateAdsetTargeting.safeParse({
      ad_account_id: "111222333",
      adset_id: "998877",
      countries: ["US"],
      targeting: { geo_locations: { countries: ["US"] } },
    });
    assert.equal(bag.success, false);
    const pii = S.metaCreateCustomAudience.safeParse({
      ad_account_id: "111222333",
      name: "Emails",
      pixel_id: "1",
      emails: ["x"],
    });
    assert.equal(pii.success, false);
  });

  it("flag off → META_MUTATE_NOT_ENABLED zero hop for Wave 3 mutate", async () => {
    const samples: Record<string, Record<string, unknown>> = {
      meta_update_adset_targeting: {
        ad_account_id: "111222333",
        adset_id: "998877",
        countries: ["US"],
      },
      meta_create_custom_audience: {
        ad_account_id: "111222333",
        name: "Visitors",
        pixel_id: "1122334455",
      },
      meta_create_lookalike_audience: {
        ad_account_id: "111222333",
        name: "LAL",
        origin_audience_id: "888777",
        country: "US",
      },
      meta_attach_audience: {
        ad_account_id: "111222333",
        adset_id: "998877",
        countries: ["US"],
        custom_audience_ids: ["888777"],
      },
    };
    for (const name of WAVE3_MUTATE) {
      let hops = 0;
      const ctx = makeCtx({}, metaLicenseEnv({ DGTL_META_MUTATE_ENABLED: "false" }));
      ctx.fetchImpl = (async () => {
        hops += 1;
        throw new Error("NETWORK_FORBIDDEN");
      }) as typeof fetch;
      const env = await dispatch(ctx, name, samples[name]!);
      assert.equal(env.ok, false, name);
      assert.equal(env.error_code, "META_MUTATE_NOT_ENABLED", name);
      assert.equal(hops, 0, name);
    }
  });

  it("targeting update dry_run PAUSED-path without hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, metaLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_update_adset_targeting", {
      ad_account_id: "111222333",
      adset_id: "998877",
      countries: ["US"],
      age_min: 25,
      age_max: 54,
      genders: ["MALE"],
      publisher_platforms: ["facebook", "instagram"],
      facebook_positions: ["feed"],
    });
    assert.equal(env.ok, true);
    const data = env.data as { dry_run?: boolean; proposed?: { countries?: string[]; act?: string } };
    assert.equal(data.dry_run, true);
    assert.equal(data.proposed?.act, "act_111222333");
    assert.equal(hops, 0);
  });

  it("create adset targeting packs dry_run includes named args, not targeting JSON", async () => {
    let hops = 0;
    const ctx = makeCtx({}, metaLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_create_adset", {
      ad_account_id: "111222333",
      campaign_id: "12033001",
      name: "US 25-54",
      daily_budget: 5000,
      countries: ["US"],
      age_min: 25,
      genders: ["FEMALE"],
      interest_ids: ["6003139266461"],
    });
    assert.equal(env.ok, true);
    const data = env.data as {
      dry_run?: boolean;
      proposed?: { targeting?: unknown; age_min?: number; countries?: string[] };
    };
    assert.equal(data.dry_run, true);
    assert.equal(data.proposed?.targeting, undefined);
    assert.equal(data.proposed?.age_min, 25);
    assert.deepEqual(data.proposed?.countries, ["US"]);
    assert.equal(hops, 0);
  });

  it("conversion adset without pixel_id → INVALID_ARGUMENT zero hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, metaLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_create_adset", {
      ad_account_id: "111222333",
      campaign_id: "12033001",
      name: "Conv",
      daily_budget: 5000,
      countries: ["US"],
      optimization_goal: "OFFSITE_CONVERSIONS",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(hops, 0);
  });

  it("custom audience dry_run website pixel, lookalike dry_run, attach dry_run", async () => {
    let hops = 0;
    const ctx = makeCtx({}, metaLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const ca = await dispatch(ctx, "meta_create_custom_audience", {
      ad_account_id: "111222333",
      name: "Visitors",
      pixel_id: "1122334455",
      retention_days: 30,
    });
    assert.equal(ca.ok, true);
    assert.equal((ca.data as { dry_run?: boolean }).dry_run, true);

    const lal = await dispatch(ctx, "meta_create_lookalike_audience", {
      ad_account_id: "111222333",
      name: "LAL 1%",
      origin_audience_id: "888777",
      country: "US",
    });
    assert.equal(lal.ok, true);

    const attach = await dispatch(ctx, "meta_attach_audience", {
      ad_account_id: "111222333",
      adset_id: "998877",
      countries: ["US"],
      custom_audience_ids: ["888777"],
    });
    assert.equal(attach.ok, true);
    assert.equal(hops, 0);
  });

  it("live schema requires confirm_phrase", () => {
    const live = S.metaCreateLookalikeAudience.safeParse({
      ad_account_id: "111222333",
      name: "LAL",
      origin_audience_id: "888777",
      country: "US",
      dry_run: false,
    });
    assert.equal(live.success, false);
  });

  it("no meta_mutate tool exists", () => {
    assert.equal(TOOLS.some((t) => t.name === "meta_mutate"), false);
    assert.equal(TOOLS.some((t) => t.name.includes("mutate") && t.name.startsWith("meta_")), false);
  });
});
