import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createAppContext } from "../src/context.js";
import { okEnvelope } from "../src/envelope.js";
import {
  DEFAULT_GA4_METADATA_CACHE_TTL_MS,
  DEFAULT_METADATA_CACHE_TTL_MS,
  METADATA_CACHE_TOOLS,
  MetadataCache,
  cacheIdentity,
  cachePlatformForTool,
  ga4MetadataCacheTtlMs,
  isLiveWriteSuccess,
  metadataCacheKey,
  metadataCacheTtlMs,
  stableJson,
  writeBustPlatform,
} from "../src/http/metadata-cache.js";
import {
  DEFAULT_GATEWAY_HEALTH_TTL_MS,
  gatewayHealthTtlMs,
  probeGatewayReachable,
} from "../src/gateway/client.js";
import { loadFlags } from "../src/flags.js";
import { dispatch } from "../src/tools/dispatch.js";
import { DOCTOR_ENV_NAMES } from "../src/auth/doctor.js";
import {
  ALL_SCOPES,
  ROOT,
  createFixtureFetch,
  installNetworkGuard,
  makeCtx,
  reportArgs,
  signLicense,
  testEnv,
  TEST_TOKEN,
} from "./helpers.js";

const PROP = "properties/111111111";
const SITE = "https://www.example.com/";
const FEED = "https://www.example.com/sitemap.xml";
const ACCOUNT_ID = "W18aCc";
const KLAVIYO_KEY = "pk_fixture_wave18_not_a_live_key";
const SHOPIFY_FIX = join(ROOT, "fixtures/shopify");
const KLAVIYO_FIX = join(ROOT, "fixtures/klaviyo");

function loadJson(dir: string, name: string): unknown {
  return JSON.parse(readFileSync(join(dir, name), "utf8"));
}

function createShopifyFetch(): { fetchImpl: typeof fetch; calls: { op: string }[] } {
  const calls: { op: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (!url.hostname.endsWith(".myshopify.com")) throw new Error(`NETWORK_FORBIDDEN ${url.href}`);
    const body = typeof init?.body === "string" ? init.body : "";
    const parsed = body ? (JSON.parse(body) as { operationName?: string }) : {};
    const op = parsed.operationName ?? "";
    calls.push({ op });
    const fixtures: Record<string, string> = {
      Shop: "shop.json",
      Products: "products.list.json",
      Locations: "locations.list.json",
      InventoryAdjust: "inventory.adjust.json",
      ProductSet: "product.set.json",
    };
    const file = fixtures[op];
    if (!file) {
      return new Response(JSON.stringify({ errors: [{ message: `unknown op ${op}` }] }), { status: 200 });
    }
    return new Response(JSON.stringify(loadJson(SHOPIFY_FIX, file)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

function createKlaviyoFetch(): { fetchImpl: typeof fetch; calls: { method: string; path: string }[] } {
  const calls: { method: string; path: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path: url.pathname });
    if (url.hostname !== "a.klaviyo.com") throw new Error(`NETWORK_FORBIDDEN ${url.href}`);
    if (method === "GET" && url.pathname === "/api/lists") {
      return new Response(JSON.stringify(loadJson(KLAVIYO_FIX, "lists.list.json")), { status: 200 });
    }
    if (method === "GET" && url.pathname === "/api/accounts") {
      return new Response(JSON.stringify(loadJson(KLAVIYO_FIX, "account.get.json")), { status: 200 });
    }
    if (method === "POST" && url.pathname === "/api/campaigns") {
      return new Response(JSON.stringify(loadJson(KLAVIYO_FIX, "campaign.create.json")), { status: 201 });
    }
    return new Response(JSON.stringify({ errors: [{ detail: `unexpected ${method} ${url.pathname}` }] }), {
      status: 404,
    });
  };
  return { fetchImpl, calls };
}

function shopifyCtx(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch) {
  return createAppContext({
    pluginRoot: ROOT,
    env,
    fetchImpl,
    now: () => new Date("2026-09-02T12:00:00Z"),
  });
}

function googleHttpGets(ctx: ReturnType<typeof makeCtx>, needle: string): number {
  return ctx.calls.filter((c) => c.method === "GET" && c.path.includes(needle)).length;
}

describe("metadata cache (list/metadata TTL + bust-on-write)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("TTL defaults: lists 120s, GA4 catalog 15m, health 45s; 0 disables", () => {
    assert.equal(DEFAULT_METADATA_CACHE_TTL_MS, 120_000);
    assert.equal(DEFAULT_GA4_METADATA_CACHE_TTL_MS, 900_000);
    assert.equal(DEFAULT_GATEWAY_HEALTH_TTL_MS, 45_000);
    assert.equal(metadataCacheTtlMs({}), 120_000);
    assert.equal(ga4MetadataCacheTtlMs({}), 900_000);
    assert.equal(gatewayHealthTtlMs({}), 45_000);
    assert.equal(metadataCacheTtlMs({ DGTL_METADATA_CACHE_TTL_MS: "0" }), 0);
    assert.equal(ga4MetadataCacheTtlMs({ DGTL_GA4_METADATA_CACHE_TTL_MS: "0" }), 0);
    assert.equal(gatewayHealthTtlMs({ DGTL_GATEWAY_HEALTH_TTL_MS: "0" }), 0);
    assert.ok((DOCTOR_ENV_NAMES as readonly string[]).includes("DGTL_METADATA_CACHE_TTL_MS"));
    assert.ok((DOCTOR_ENV_NAMES as readonly string[]).includes("DGTL_GA4_METADATA_CACHE_TTL_MS"));
    assert.ok((DOCTOR_ENV_NAMES as readonly string[]).includes("DGTL_GATEWAY_HEALTH_TTL_MS"));
  });

  it("allowlist covers Free Google + local-free lists and skips reports/whoami/paid hops", () => {
    assert.equal(cachePlatformForTool("ga4_list_accounts"), "ga4");
    assert.equal(cachePlatformForTool("ga4_get_metadata"), "ga4");
    assert.equal(cachePlatformForTool("gsc_list_sites"), "gsc");
    assert.equal(cachePlatformForTool("gtm_list_workspaces"), "gtm");
    assert.equal(cachePlatformForTool("gbp_list_locations"), "gbp");
    assert.equal(cachePlatformForTool("shopify_list_products"), "shopify");
    assert.equal(cachePlatformForTool("klaviyo_list_lists"), "klaviyo");
    assert.equal(cachePlatformForTool("ga4_run_report"), undefined);
    assert.equal(cachePlatformForTool("gsc_query_search_analytics"), undefined);
    assert.equal(cachePlatformForTool("google_whoami"), undefined);
    assert.equal(cachePlatformForTool("shopify_list_orders"), undefined);
    assert.equal(cachePlatformForTool("klaviyo_list_profiles"), undefined);
    assert.equal(cachePlatformForTool("gads_list_accessible_customers"), undefined);
    assert.equal(cachePlatformForTool("meta_list_ad_accounts"), undefined);
    assert.equal(cachePlatformForTool("mc_list_accounts"), undefined);
    assert.equal(cachePlatformForTool("tiktok_list_advertisers"), undefined);
    assert.ok(!METADATA_CACHE_TOOLS.has("ga4_run_report"));
  });

  it("write bust is family-based and ignores dry_run / list reads in write families", () => {
    assert.equal(writeBustPlatform("ga4_write", "ga4_create_data_stream"), "ga4");
    assert.equal(writeBustPlatform("ga4_write", "ga4_list_google_ads_links"), undefined);
    assert.equal(writeBustPlatform("ga4_write", "ga4_get_attribution_settings"), undefined);
    assert.equal(writeBustPlatform("gtm_write", "gtm_publish_container"), "gtm");
    assert.equal(writeBustPlatform("gsc_write", "gsc_submit_sitemap"), "gsc");
    assert.equal(writeBustPlatform("shopify_write", "shopify_product_set"), "shopify");
    assert.equal(writeBustPlatform("klaviyo_write", "klaviyo_create_campaign"), "klaviyo");
    assert.equal(writeBustPlatform("gads", "gads_create_search_campaign"), undefined);
    assert.equal(isLiveWriteSuccess(okEnvelope("x", { data: { dry_run: true } })), false);
    assert.equal(isLiveWriteSuccess(okEnvelope("x", { data: { dry_run: false } })), true);
  });

  it("keys differ by args and identity; never embed tokens", () => {
    const a = metadataCacheKey({
      platform: "ga4",
      identity: "abc",
      tool: "ga4_list_accounts",
      args: {},
    });
    const b = metadataCacheKey({
      platform: "ga4",
      identity: "abc",
      tool: "ga4_list_accounts",
      args: { page_size: 10 },
    });
    assert.notEqual(a, b);
    assert.equal(stableJson({ page_size: 10, z: undefined }), '{"page_size":10}');
    const id = cacheIdentity("ga4", {
      env: { GOOGLE_ACCESS_TOKEN: "secret-token-value-must-not-leak" },
      pluginDataDir: "/tmp/x",
    });
    assert.ok(!id.includes("secret"));
    assert.ok(!a.includes("secret"));
  });

  it("Map get/set expires and bustPrefix removes matching keys", () => {
    let now = 1_000;
    const cache = new MetadataCache({ ttlMs: 100, catalogTtlMs: 100, now: () => now });
    cache.set("ga4:id:ga4_list_accounts:aa", okEnvelope("ga4_list_accounts", { data: { n: 1 } }));
    cache.set("gtm:id:gtm_list_accounts:bb", okEnvelope("gtm_list_accounts", { data: { n: 2 } }));
    assert.equal((cache.get("ga4:id:ga4_list_accounts:aa")?.data as { n: number }).n, 1);
    now = 1_200;
    assert.equal(cache.get("ga4:id:ga4_list_accounts:aa"), undefined);
    assert.equal(cache.bustPrefix("gtm:id:"), 1);
    assert.equal(cache.get("gtm:id:gtm_list_accounts:bb"), undefined);
  });

  it("second identical GA4 list within TTL does not call HTTP", async () => {
    const ctx = makeCtx();
    const first = await dispatch(ctx, "ga4_list_accounts", {});
    assert.equal(first.ok, true);
    const afterFirst = ctx.calls.length;
    assert.ok(afterFirst >= 1);
    const second = await dispatch(ctx, "ga4_list_accounts", {});
    assert.equal(second.ok, true);
    assert.deepEqual(second.data, first.data);
    assert.equal(ctx.calls.length, afterFirst);
    assert.equal(ctx.metadataCache.stats.hits, 1);
    assert.equal(googleHttpGets(ctx, "/accounts"), 1);
  });

  it("ga4_get_metadata catalog is keyed by property_id; filters reuse HTTP; reports do not cache", async () => {
    const ctx = makeCtx();
    const meta1 = await dispatch(ctx, "ga4_get_metadata", { property_id: PROP, query: "session" });
    assert.equal(meta1.ok, true);
    assert.equal(googleHttpGets(ctx, "/metadata"), 1);
    const meta2 = await dispatch(ctx, "ga4_get_metadata", { property_id: PROP, kind: "metric" });
    assert.equal(meta2.ok, true);
    assert.equal(googleHttpGets(ctx, "/metadata"), 1, "same property_id must reuse the Data API catalog");
    const other = await dispatch(ctx, "ga4_get_metadata", { property_id: "properties/222222222" });
    assert.equal(other.ok, true);
    assert.equal(googleHttpGets(ctx, "/metadata"), 2);

    const report1 = await dispatch(ctx, "ga4_run_report", reportArgs());
    const reportCalls = ctx.calls.filter((c) => c.path.includes(":runReport")).length;
    const report2 = await dispatch(ctx, "ga4_run_report", reportArgs());
    assert.equal(report1.ok, true);
    assert.equal(report2.ok, true);
    assert.equal(ctx.calls.filter((c) => c.path.includes(":runReport")).length, reportCalls + 1);
  });

  it("different args miss; TTL 0 disables; expiry misses", async () => {
    const ctx = makeCtx();
    await dispatch(ctx, "gtm_list_accounts", {});
    const first = ctx.calls.filter((c) => c.path.endsWith("/accounts") && c.host.includes("tagmanager")).length;
    await dispatch(ctx, "gtm_list_accounts", { page_size: 10 });
    const afterDiff = ctx.calls.filter((c) => c.path.endsWith("/accounts") && c.host.includes("tagmanager")).length;
    assert.equal(afterDiff, first + 1);

    const disabled = makeCtx({}, testEnv({ DGTL_METADATA_CACHE_TTL_MS: "0" }));
    await dispatch(disabled, "gsc_list_sites", {});
    await dispatch(disabled, "gsc_list_sites", {});
    assert.equal(
      disabled.calls.filter((c) => c.path.endsWith("/sites")).length,
      2,
    );
    assert.equal(disabled.metadataCache.enabled, false);

    let t = Date.parse("2026-09-02T12:00:00Z");
    const timed = createAppContext({
      pluginRoot: ROOT,
      env: testEnv({ DGTL_METADATA_CACHE_TTL_MS: "1000" }),
      fetchImpl: createFixtureFetch().fetchImpl,
      now: () => new Date(t),
    });
    await dispatch(timed, "gsc_list_sites", {});
    const sitesBefore = timed.calls.filter((c) => c.path.endsWith("/sites")).length;
    t += 5_000;
    await dispatch(timed, "gsc_list_sites", {});
    assert.equal(timed.calls.filter((c) => c.path.endsWith("/sites")).length, sitesBefore + 1);
  });

  it("live GA4 write busts GA4 list cache; dry_run does not", async () => {
    const ctx = makeCtx(
      {},
      testEnv({
        DGTL_WRITES_ENABLED: "true",
        GOOGLE_GA4_ADMIN_ACCESS_TOKEN: "ga4-admin-test-token",
        GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
        GOOGLE_GRANTED_SCOPES: ALL_SCOPES,
      }),
    );
    await dispatch(ctx, "ga4_list_data_streams", { property_id: PROP });
    const afterList = googleHttpGets(ctx, "/dataStreams");
    await dispatch(ctx, "ga4_list_data_streams", { property_id: PROP });
    assert.equal(googleHttpGets(ctx, "/dataStreams"), afterList);

    const dry = await dispatch(ctx, "ga4_create_data_stream", {
      property_id: PROP,
      display_name: "Web",
      default_uri: "https://example.com",
    });
    assert.equal((dry.data as { dry_run: boolean }).dry_run, true);
    await dispatch(ctx, "ga4_list_data_streams", { property_id: PROP });
    assert.equal(googleHttpGets(ctx, "/dataStreams"), afterList, "dry_run must not bust");

    const live = await dispatch(ctx, "ga4_create_data_stream", {
      property_id: PROP,
      display_name: "Web",
      default_uri: "https://example.com",
      dry_run: false,
      confirm_phrase: PROP,
    });
    assert.equal(live.ok, true, JSON.stringify(live));
    assert.equal((live.data as { dry_run: boolean }).dry_run, false);
    await dispatch(ctx, "ga4_list_data_streams", { property_id: PROP });
    assert.equal(googleHttpGets(ctx, "/dataStreams"), afterList + 1);

    await dispatch(ctx, "ga4_get_metadata", { property_id: PROP });
    const metaGets = googleHttpGets(ctx, "/metadata");
    await dispatch(ctx, "ga4_create_custom_dimension", {
      property_id: PROP,
      parameter_name: "shop_brand",
      display_name: "Shop brand",
      scope: "EVENT",
      dry_run: false,
      confirm_phrase: PROP,
    });
    await dispatch(ctx, "ga4_get_metadata", { property_id: PROP, kind: "dimension" });
    assert.equal(googleHttpGets(ctx, "/metadata"), metaGets + 1, "live GA4 write must bust catalog");
  });

  it("live GA4 write busts catalog even when list TTL is 0", async () => {
    const ctx = makeCtx(
      {},
      testEnv({
        DGTL_METADATA_CACHE_TTL_MS: "0",
        DGTL_WRITES_ENABLED: "true",
        GOOGLE_GA4_ADMIN_ACCESS_TOKEN: "ga4-admin-test-token",
        GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
        GOOGLE_GRANTED_SCOPES: ALL_SCOPES,
      }),
    );
    assert.equal(ctx.metadataCache.enabled, false);
    assert.equal(ctx.metadataCache.catalogEnabled, true);
    await dispatch(ctx, "ga4_get_metadata", { property_id: PROP });
    assert.equal(googleHttpGets(ctx, "/metadata"), 1);
    await dispatch(ctx, "ga4_get_metadata", { property_id: PROP, kind: "metric" });
    assert.equal(googleHttpGets(ctx, "/metadata"), 1);
    const live = await dispatch(ctx, "ga4_create_custom_dimension", {
      property_id: PROP,
      parameter_name: "shop_brand",
      display_name: "Shop brand",
      scope: "EVENT",
      dry_run: false,
      confirm_phrase: PROP,
    });
    assert.equal(live.ok, true, JSON.stringify(live));
    await dispatch(ctx, "ga4_get_metadata", { property_id: PROP });
    assert.equal(googleHttpGets(ctx, "/metadata"), 2);
  });

  it("live GTM write busts GTM lists; GSC sitemap write busts GSC lists", async () => {
    const gtm = makeCtx(
      {},
      testEnv({
        DGTL_WRITES_ENABLED: "true",
        GOOGLE_WRITE_ACCESS_TOKEN: "write-test-token",
        GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
      }),
    );
    await dispatch(gtm, "gtm_list_tags", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
    });
    const tagGets = gtm.calls.filter((c) => c.path.endsWith("/tags")).length;
    await dispatch(gtm, "gtm_list_tags", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
    });
    assert.equal(gtm.calls.filter((c) => c.path.endsWith("/tags")).length, tagGets);

    const created = await dispatch(gtm, "gtm_create_trigger", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      name: "All Pages",
      type: "pageview",
      dry_run: false,
      confirm_phrase: "Please create trigger on GTM-XXXX000",
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    await dispatch(gtm, "gtm_list_tags", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
    });
    assert.equal(gtm.calls.filter((c) => c.path.endsWith("/tags")).length, tagGets + 1);

    const gsc = makeCtx(
      {},
      testEnv({
        DGTL_WRITES_ENABLED: "true",
        GOOGLE_GSC_WRITE_ACCESS_TOKEN: "gsc-write-test-token",
        GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
      }),
    );
    await dispatch(gsc, "gsc_list_sitemaps", { site_url: SITE });
    const sitemapGets = gsc.calls.filter((c) => c.method === "GET" && c.path.endsWith("/sitemaps")).length;
    await dispatch(gsc, "gsc_list_sitemaps", { site_url: SITE });
    assert.equal(gsc.calls.filter((c) => c.method === "GET" && c.path.endsWith("/sitemaps")).length, sitemapGets);

    const submitted = await dispatch(gsc, "gsc_submit_sitemap", {
      site_url: SITE,
      feedpath: FEED,
      dry_run: false,
      confirm_phrase: `please apply ${SITE}`,
    });
    assert.equal(submitted.ok, true, JSON.stringify(submitted));
    await dispatch(gsc, "gsc_list_sitemaps", { site_url: SITE });
    assert.equal(
      gsc.calls.filter((c) => c.method === "GET" && c.path.endsWith("/sitemaps")).length,
      sitemapGets + 1,
    );
  });

  it("Shopify list hits cache; inventory write busts; orders stay uncached", async () => {
    const { fetchImpl, calls } = createShopifyFetch();
    const ctx = shopifyCtx(
      testEnv({
        SHOPIFY_STORE: "fixture-store.myshopify.com",
        SHOPIFY_ACCESS_TOKEN: "shpat_write_fixture",
        SHOPIFY_GRANTED_SCOPES:
          "read_products,read_orders,read_inventory,read_locations,write_inventory,write_products",
        DGTL_WRITES_ENABLED: "true",
      }),
      fetchImpl,
    );

    const products1 = await dispatch(ctx, "shopify_list_products", { page_size: 10 });
    assert.equal(products1.ok, true, JSON.stringify(products1));
    const productOps = calls.filter((c) => c.op === "Products").length;
    const products2 = await dispatch(ctx, "shopify_list_products", { page_size: 10 });
    assert.equal(products2.ok, true);
    assert.equal(calls.filter((c) => c.op === "Products").length, productOps);
    assert.equal(cachePlatformForTool("shopify_list_orders"), undefined);

    const live = await dispatch(ctx, "shopify_adjust_inventory", {
      inventory_item_id: "3001",
      location_id: "1",
      delta: -1,
      dry_run: false,
      confirm_phrase: "adjust inventory on fixture-store.myshopify.com",
    });
    assert.equal(live.ok, true, JSON.stringify(live));
    await dispatch(ctx, "shopify_list_products", { page_size: 10 });
    assert.equal(calls.filter((c) => c.op === "Products").length, productOps + 1);
  });

  it("Klaviyo list hits cache; confirm-gated write busts", async () => {
    const { fetchImpl, calls } = createKlaviyoFetch();
    const ctx = createAppContext({
      pluginRoot: ROOT,
      env: testEnv({ KLAVIYO_API_KEY: KLAVIYO_KEY, DGTL_WRITES_ENABLED: "true" }),
      fetchImpl,
      now: () => new Date("2026-09-13T12:00:00Z"),
    });
    const first = await dispatch(ctx, "klaviyo_list_lists", {});
    assert.equal(first.ok, true, JSON.stringify(first));
    const listGets = calls.filter((c) => c.method === "GET" && c.path === "/api/lists").length;
    const second = await dispatch(ctx, "klaviyo_list_lists", {});
    assert.equal(second.ok, true);
    assert.equal(calls.filter((c) => c.method === "GET" && c.path === "/api/lists").length, listGets);

    const created = await dispatch(ctx, "klaviyo_create_campaign", {
      name: "Wave 18 draft",
      included_list_ids: ["X1List"],
      subject: "September note",
      from_email: "hello@example.com",
      from_label: "Example Brand",
      dry_run: false,
      confirm_phrase: `create draft on ${ACCOUNT_ID}`,
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    await dispatch(ctx, "klaviyo_list_lists", {});
    assert.equal(calls.filter((c) => c.method === "GET" && c.path === "/api/lists").length, listGets + 1);
  });

  it("second GET /v1/health within TTL is skipped; dual-gate flags stay cached", async () => {
    let healthGets = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/v1/health")) {
        healthGets += 1;
        return new Response(
          JSON.stringify({ ok: true, meta_capi_enabled: true, tiktok_events_enabled: false }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`NETWORK_FORBIDDEN ${url}`);
    };
    let t = Date.parse("2026-09-02T12:00:00Z");
    const ctx = createAppContext({
      pluginRoot: ROOT,
      env: testEnv({ DGTL_GATEWAY_URL: "https://stamp.test.dgtl" }),
      fetchImpl,
      now: () => new Date(t),
    });
    const first = await probeGatewayReachable(ctx);
    const second = await probeGatewayReachable(ctx);
    assert.equal(first.reachable, true);
    assert.equal(first.meta_capi_enabled, true);
    assert.equal(second.tiktok_events_enabled, false);
    assert.equal(healthGets, 1);
    t += 60_000;
    const third = await probeGatewayReachable(ctx);
    assert.equal(third.reachable, true);
    assert.equal(healthGets, 2);
    assert.equal(loadFlags(ctx.env).writesEnabled, false);
  });

  it("two Ads hops on one context share one GET /v1/health", async () => {
    let healthGets = 0;
    let hops = 0;
    const jwt = signLicense({
      sub: "health-cache",
      exp: Math.floor(Date.now() / 1000) + 86400,
      features: ["ads"],
      jti: "health-cache-1",
    });
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/v1/health")) {
        healthGets += 1;
        return new Response(JSON.stringify({ ok: true, ads_mutate_enabled: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/gads/")) {
        hops += 1;
        return new Response(
          JSON.stringify({
            ok: true,
            tool: "gads_list_accessible_customers",
            data: { resourceNames: ["customers/123"] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`NETWORK_FORBIDDEN ${url}`);
    };
    const ctx = createAppContext({
      pluginRoot: ROOT,
      env: testEnv({
        DGTL_LICENSE_JWT: jwt,
        DGTL_GATEWAY_URL: "https://stamp.test.dgtl",
        GOOGLE_ADS_ACCESS_TOKEN: "ads-user-token",
      }),
      fetchImpl,
      now: () => new Date("2026-09-02T12:00:00Z"),
    });
    const first = await dispatch(ctx, "gads_list_accessible_customers", {});
    const second = await dispatch(ctx, "gads_list_accessible_customers", {});
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(healthGets, 1, "second hop must reuse the health probe");
    assert.equal(hops, 2);
  });

  it("google_whoami is never cached", async () => {
    const ctx = makeCtx();
    const first = await dispatch(ctx, "google_whoami", {});
    const n = ctx.calls.length;
    const second = await dispatch(ctx, "google_whoami", {});
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.ok(ctx.calls.length > n);
  });
});
