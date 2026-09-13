import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { loadFlags } from "../src/flags.js";
import { hashTikTokUserField } from "../src/tiktok/tiktok-wave17.js";
import * as S from "../src/tools/schemas.js";
import { dispatch } from "../src/tools/dispatch.js";
import { TIKTOK_EVENTS_TOOL_NAMES, TIKTOK_MUTATE_TOOL_NAMES, TOOLS } from "../src/tools/registry.js";
import {
  installNetworkGuard,
  makeCtx,
  ROOT,
  signLicense,
  testEnv,
  TEST_TOKEN,
} from "./helpers.js";

const ADVERTISER = "1234567890";
const CATALOG_ID = "7000000001";
const PIXEL_CODE = "C0DGTLSUNRISE01";

function tiktokLicenseEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const jwt = signLicense({
    sub: "user_test",
    features: ["tiktok"],
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "jti-wave17-tiktok",
  });
  return testEnv({
    DGTL_LICENSE_JWT: jwt,
    TIKTOK_ACCESS_TOKEN: "tiktok-user-token-fixture",
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    DGTL_GATEWAY_URL: "https://stamp.test",
    ...extra,
  });
}

const PRODUCT = {
  sku_id: "sku-sunrise-tee",
  title: "Sunrise Tee",
  availability: "IN_STOCK" as const,
  condition: "NEW" as const,
  price: "29.00",
  currency: "USD",
  landing_page_url: "https://shop.dgtlsunrise.com/tee",
  image_url: "https://cdn.dgtlsunrise.com/tee.jpg",
  brand: "DGTL Sunrise",
};

const EVENT = {
  event_name: "CompletePayment" as const,
  event_id: "evt-wave17-001",
  event_time: 1_746_000_000,
  event_source_url: "https://shop.dgtlsunrise.com/checkout",
  email: "User@Example.COM",
  content_id: "sku-sunrise-tee",
  value: 29,
  currency: "USD",
};

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

describe("Wave 17 TikTok catalog + Events API (plugin)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("named tools are registered (no tiktok_mutate envelope)", () => {
    for (const name of [
      "tiktok_list_catalogs",
      "tiktok_create_catalog",
      "tiktok_upload_catalog_products",
      "tiktok_bind_catalog_eventsource",
      "tiktok_list_pixels",
      "tiktok_track_events",
      "tiktok_create_campaign",
    ]) {
      const t = TOOLS.find((x) => x.name === name);
      assert.ok(t, name);
      assert.equal(t!.family, "tiktok");
    }
    assert.equal(TOOLS.find((t) => t.name === "tiktok_list_catalogs")!.group, "tiktok");
    assert.equal(TOOLS.find((t) => t.name === "tiktok_list_pixels")!.annotations.readOnlyHint, true);
    assert.equal(TOOLS.find((t) => t.name === "tiktok_track_events")!.group, "tiktok-events");
    assert.equal(TOOLS.find((t) => t.name === "tiktok_track_events")!.annotations.destructiveHint, true);
    assert.equal(TOOLS.find((t) => t.name === "tiktok_create_campaign")!.group, "tiktok-write");
    assert.ok(TIKTOK_MUTATE_TOOL_NAMES.includes("tiktok_upload_catalog_products"));
    assert.ok(TIKTOK_MUTATE_TOOL_NAMES.includes("tiktok_track_events"));
    assert.ok(TIKTOK_MUTATE_TOOL_NAMES.includes("tiktok_create_campaign"));
    assert.deepEqual(TIKTOK_EVENTS_TOOL_NAMES, ["tiktok_track_events"]);
    assert.equal(TOOLS.some((t) => t.name === "tiktok_mutate"), false);
    assert.equal(TOOLS.some((t) => t.name.startsWith("klaviyo_")), false);
  });

  it("catalog gated_tools + fixtures exist", () => {
    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8"));
    assert.equal(
      catalog.gated_tools.find((x: { name: string }) => x.name === "tiktok_upload_catalog_products").fail,
      "TIKTOK_MUTATE_NOT_ENABLED",
    );
    assert.equal(
      catalog.gated_tools.find((x: { name: string }) => x.name === "tiktok_create_catalog").fail,
      "TIKTOK_MUTATE_NOT_ENABLED",
    );
    assert.equal(
      catalog.gated_tools.find((x: { name: string }) => x.name === "tiktok_create_campaign").fail,
      "TIKTOK_MUTATE_NOT_ENABLED",
    );
    assert.equal(
      catalog.gated_tools.find((x: { name: string }) => x.name === "tiktok_track_events").fail,
      "TIKTOK_EVENTS_NOT_ENABLED",
    );
    assert.equal(
      catalog.gated_tools.find((x: { name: string }) => x.name === "tiktok_list_catalogs").fail,
      "LICENSE_REQUIRED",
    );
    const listed = JSON.parse(readFileSync(join(ROOT, "fixtures/tiktok/catalog.list.json"), "utf8"));
    const created = JSON.parse(readFileSync(join(ROOT, "fixtures/tiktok/catalog.create.json"), "utf8"));
    const uploaded = JSON.parse(readFileSync(join(ROOT, "fixtures/tiktok/catalog.products.upload.json"), "utf8"));
    const bound = JSON.parse(readFileSync(join(ROOT, "fixtures/tiktok/catalog.eventsource.bind.json"), "utf8"));
    const pixels = JSON.parse(readFileSync(join(ROOT, "fixtures/tiktok/pixel.list.json"), "utf8"));
    const events = JSON.parse(readFileSync(join(ROOT, "fixtures/tiktok/events.track.json"), "utf8"));
    const campaign = JSON.parse(readFileSync(join(ROOT, "fixtures/tiktok/campaign.create.json"), "utf8"));
    assert.equal(listed.list[0].catalog_id, CATALOG_ID);
    assert.equal(created.catalog_id, CATALOG_ID);
    assert.equal(uploaded.sku_ids[0], "sku-sunrise-tee");
    assert.equal(bound.pixel_code, PIXEL_CODE);
    assert.equal(pixels.pixels[0].pixel_code, PIXEL_CODE);
    assert.equal(events.events_received, 1);
    assert.equal(campaign.operation_status, "DISABLE");
  });

  it("DGTL_TIKTOK_EVENTS_ENABLED defaults on; explicit false opts out", () => {
    assert.equal(loadFlags({}).tiktokEventsEnabled, true);
    assert.equal(loadFlags({ DGTL_TIKTOK_EVENTS_ENABLED: "false" }).tiktokEventsEnabled, false);
    assert.equal(loadFlags({ TIKTOK_EVENTS_ENABLED: "false" }).tiktokEventsEnabled, false);
    assert.equal(loadFlags({ DGTL_TIKTOK_EVENTS_ENABLED: "true" }).tiktokEventsEnabled, true);
  });

  it("schemas default dry_run true and require confirm live", () => {
    assert.equal(
      S.tiktokUploadCatalogProducts.parse({
        advertiser_id: ADVERTISER,
        catalog_id: CATALOG_ID,
        products: [PRODUCT],
      }).dry_run,
      true,
    );
    assert.equal(
      S.tiktokTrackEvents.parse({
        advertiser_id: ADVERTISER,
        pixel_code: PIXEL_CODE,
        events: [EVENT],
      }).dry_run,
      true,
    );
    assert.equal(
      S.tiktokCreateCampaign.parse({
        advertiser_id: ADVERTISER,
        campaign_name: "Sunrise Traffic",
        objective_type: "TRAFFIC",
      }).dry_run,
      true,
    );
    assert.equal(
      S.tiktokUploadCatalogProducts.safeParse({
        advertiser_id: ADVERTISER,
        catalog_id: CATALOG_ID,
        products: [PRODUCT],
        dry_run: false,
      }).success,
      false,
    );
    assert.equal(
      S.tiktokTrackEvents.safeParse({
        advertiser_id: ADVERTISER,
        pixel_code: PIXEL_CODE,
        events: [{ event_name: "CompletePayment" }],
      }).success,
      false,
    );
    assert.equal(
      S.tiktokTrackEvents.safeParse({
        advertiser_id: ADVERTISER,
        pixel_code: PIXEL_CODE,
        events: [{ event_name: "NotARealEvent", event_id: "x" }],
      }).success,
      false,
    );
  });

  it("catalog mutate flag off → TIKTOK_MUTATE_NOT_ENABLED zero hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, tiktokLicenseEnv({ DGTL_TIKTOK_MUTATE_ENABLED: "false" }));
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const upload = await dispatch(ctx, "tiktok_upload_catalog_products", {
      advertiser_id: ADVERTISER,
      catalog_id: CATALOG_ID,
      products: [PRODUCT],
    });
    assert.equal(upload.ok, false);
    assert.equal(upload.error_code, "TIKTOK_MUTATE_NOT_ENABLED");
    const created = await dispatch(ctx, "tiktok_create_catalog", {
      advertiser_id: ADVERTISER,
      name: "Sunrise Commerce",
    });
    assert.equal(created.ok, false);
    assert.equal(created.error_code, "TIKTOK_MUTATE_NOT_ENABLED");
    const campaign = await dispatch(ctx, "tiktok_create_campaign", {
      advertiser_id: ADVERTISER,
      campaign_name: "Sunrise Traffic",
      objective_type: "TRAFFIC",
    });
    assert.equal(campaign.ok, false);
    assert.equal(campaign.error_code, "TIKTOK_MUTATE_NOT_ENABLED");
    assert.equal(hops, 0);
  });

  it("Events flag off → TIKTOK_EVENTS_NOT_ENABLED even when mutate is on", async () => {
    let hops = 0;
    const ctx = makeCtx(
      {},
      tiktokLicenseEnv({ DGTL_TIKTOK_EVENTS_ENABLED: "false", DGTL_TIKTOK_MUTATE_ENABLED: "true" }),
    );
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "tiktok_track_events", {
      advertiser_id: ADVERTISER,
      pixel_code: PIXEL_CODE,
      events: [EVENT],
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "TIKTOK_EVENTS_NOT_ENABLED");
    assert.equal(hops, 0);
  });

  it("ads+meta JWT is not enough — LICENSE_REQUIRED, zero HTTP", async () => {
    const jwt = signLicense({
      sub: "user_test",
      features: ["ads", "meta"],
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: "jti-ads-meta-not-tiktok-w17",
    });
    let hops = 0;
    const ctx = makeCtx({}, testEnv({ DGTL_LICENSE_JWT: jwt, DGTL_GATEWAY_URL: "https://stamp.test" }));
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "tiktok_track_events", {
      advertiser_id: ADVERTISER,
      pixel_code: PIXEL_CODE,
      events: [EVENT],
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "LICENSE_REQUIRED");
    assert.equal(hops, 0);
  });

  it("upload dry_run includes https image + sku_id, zero hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, tiktokLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "tiktok_upload_catalog_products", {
      advertiser_id: ADVERTISER,
      catalog_id: CATALOG_ID,
      products: [PRODUCT],
    });
    assert.equal(env.ok, true);
    const data = env.data as {
      dry_run?: boolean;
      proposed?: { products?: Array<{ image_url?: string; sku_id?: string }> };
    };
    assert.equal(data.dry_run, true);
    assert.equal(data.proposed?.products?.[0]?.image_url, PRODUCT.image_url);
    assert.equal(data.proposed?.products?.[0]?.sku_id, "sku-sunrise-tee");
    assert.equal(hops, 0);
  });

  it("http image_url is refused (zero hop)", async () => {
    let hops = 0;
    const ctx = makeCtx({}, tiktokLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "tiktok_upload_catalog_products", {
      advertiser_id: ADVERTISER,
      catalog_id: CATALOG_ID,
      products: [{ ...PRODUCT, image_url: "http://cdn.example.com/tee.jpg" }],
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(hops, 0);
  });

  it("create campaign defaults DISABLE and spend-caps over 100000", async () => {
    let hops = 0;
    const ctx = makeCtx({}, tiktokLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const dry = await dispatch(ctx, "tiktok_create_campaign", {
      advertiser_id: ADVERTISER,
      campaign_name: "Sunrise Traffic",
      objective_type: "TRAFFIC",
    });
    assert.equal(dry.ok, true);
    const proposed = (dry.data as { proposed?: { operation_status?: string; budget_mode?: string } }).proposed;
    assert.equal(proposed?.operation_status, "DISABLE");
    assert.equal(proposed?.budget_mode, "BUDGET_MODE_INFINITE");
    const paused = await dispatch(ctx, "tiktok_create_campaign", {
      advertiser_id: ADVERTISER,
      campaign_name: "Sunrise Traffic",
      objective_type: "TRAFFIC",
      status: "PAUSED",
      budget: 50,
    });
    assert.equal((paused.data as { proposed?: { operation_status?: string; budget_mode?: string } }).proposed?.operation_status, "DISABLE");
    assert.equal((paused.data as { proposed?: { budget_mode?: string } }).proposed?.budget_mode, "BUDGET_MODE_DAY");
    const cap = await dispatch(ctx, "tiktok_create_campaign", {
      advertiser_id: ADVERTISER,
      campaign_name: "Sunrise Traffic",
      objective_type: "TRAFFIC",
      budget: 100_001,
    });
    assert.equal(cap.ok, false);
    assert.equal(cap.error_code, "SPEND_CAP_EXCEEDED");
    assert.equal(hops, 0);
  });

  it("live catalog confirm must include advertiser_id AND catalog_id", async () => {
    let hops = 0;
    const ctx = makeCtx({}, tiktokLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const missing = await dispatch(ctx, "tiktok_upload_catalog_products", {
      advertiser_id: ADVERTISER,
      catalog_id: CATALOG_ID,
      products: [PRODUCT],
      dry_run: false,
      confirm_phrase: `${ADVERTISER} only`,
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.error_code, "INVALID_ARGUMENT");
    assert.equal(hops, 0);
  });

  it("Events hashes email before hop; content_id matches sku_id", async () => {
    let hops = 0;
    let seenBody: Record<string, unknown> | undefined;
    const hashed = sha256("user@example.com");
    const ctx = makeCtx({}, tiktokLicenseEnv());
    ctx.fetchImpl = (async (input, init) => {
      hops += 1;
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/v1/health")) {
        return new Response(JSON.stringify({ ok: true, service: "stamp", tiktok_events_enabled: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/tiktok/tiktok_track_events") && init?.body && typeof init.body === "string") {
        seenBody = JSON.parse(init.body) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            ok: true,
            tool: "tiktok_track_events",
            data: JSON.parse(readFileSync(join(ROOT, "fixtures/tiktok/events.track.json"), "utf8")),
            api: "tiktok",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`UNMAPPED ${url}`);
    }) as typeof fetch;

    const created = await dispatch(ctx, "tiktok_create_catalog", {
      advertiser_id: ADVERTISER,
      name: "Sunrise Commerce",
    });
    assert.equal(created.ok, true);
    assert.equal((created.data as { dry_run?: boolean }).dry_run, true);

    const dry = await dispatch(ctx, "tiktok_track_events", {
      advertiser_id: ADVERTISER,
      pixel_code: PIXEL_CODE,
      events: [EVENT],
    });
    assert.equal(dry.ok, true);
    const dryJson = JSON.stringify(dry);
    assert.equal(dryJson.includes("User@Example.COM"), false);
    assert.equal(dryJson.includes("user@example.com"), false);
    const proposed = (dry.data as { proposed?: { events?: Array<{ email?: string; content_id?: string }> } }).proposed;
    assert.equal(proposed?.events?.[0]?.email, hashed);
    assert.equal(proposed?.events?.[0]?.content_id, "sku-sunrise-tee");
    assert.equal(hashTikTokUserField("email", "User@Example.COM"), hashed);

    const live = await dispatch(ctx, "tiktok_track_events", {
      advertiser_id: ADVERTISER,
      pixel_code: PIXEL_CODE,
      events: [EVENT],
      dry_run: false,
      confirm_phrase: `${ADVERTISER} ${PIXEL_CODE}`,
    });
    assert.equal(live.ok, true, JSON.stringify(live));
    const params = seenBody?.params as { events?: Array<{ email?: string; content_id?: string; event_id?: string }> };
    assert.equal(params?.events?.[0]?.email, hashed);
    assert.equal(params?.events?.[0]?.event_id, "evt-wave17-001");
    assert.equal(params?.events?.[0]?.content_id, "sku-sunrise-tee");
    assert.equal(JSON.stringify(seenBody).includes("User@Example.COM"), false);
    assert.ok(hops >= 2);
  });

  it("live Events fail-closed when Worker TIKTOK_EVENTS_ENABLED is missing or false", async () => {
    for (const health of [{ ok: true, service: "stamp" }, { ok: true, service: "stamp", tiktok_events_enabled: false }]) {
      let hops = 0;
      const ctx = makeCtx({}, tiktokLicenseEnv());
      ctx.fetchImpl = (async (input) => {
        hops += 1;
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith("/v1/health")) {
          return new Response(JSON.stringify(health), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`Events must not hop when Worker flag is fail-closed: ${url}`);
      }) as typeof fetch;
      const env = await dispatch(ctx, "tiktok_track_events", {
        advertiser_id: ADVERTISER,
        pixel_code: PIXEL_CODE,
        events: [EVENT],
        dry_run: false,
        confirm_phrase: `${ADVERTISER} ${PIXEL_CODE}`,
      });
      assert.equal(env.ok, false, JSON.stringify(health));
      assert.equal(env.error_code, "TIKTOK_EVENTS_NOT_ENABLED", JSON.stringify(health));
      assert.equal(hops, 1, JSON.stringify(health));
    }
  });

  it("live catalog upload hops named tool + image_url", async () => {
    let seenUrl = "";
    let seenBody: Record<string, unknown> | undefined;
    const ctx = makeCtx({}, tiktokLicenseEnv());
    ctx.fetchImpl = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/v1/health")) {
        return new Response(JSON.stringify({ ok: true, service: "stamp" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/tiktok/tiktok_upload_catalog_products")) {
        seenUrl = url;
        if (init?.body && typeof init.body === "string") seenBody = JSON.parse(init.body) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            ok: true,
            tool: "tiktok_upload_catalog_products",
            data: JSON.parse(readFileSync(join(ROOT, "fixtures/tiktok/catalog.products.upload.json"), "utf8")),
            api: "tiktok",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`UNMAPPED ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "tiktok_upload_catalog_products", {
      advertiser_id: ADVERTISER,
      catalog_id: CATALOG_ID,
      products: [PRODUCT],
      dry_run: false,
      confirm_phrase: `${ADVERTISER} ${CATALOG_ID}`,
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.ok(seenUrl.includes("/v1/tiktok/tiktok_upload_catalog_products"));
    const params = seenBody?.params as { catalog_id?: string; products?: Array<{ image_url?: string; sku_id?: string }> };
    assert.equal(params?.catalog_id, CATALOG_ID);
    assert.equal(params?.products?.[0]?.image_url, PRODUCT.image_url);
    assert.equal(params?.products?.[0]?.sku_id, "sku-sunrise-tee");
  });

  it("list catalogs / pixels are read hops (no mutate flag)", async () => {
    let seen: string[] = [];
    const ctx = makeCtx({}, tiktokLicenseEnv({ DGTL_TIKTOK_MUTATE_ENABLED: "false" }));
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/v1/health")) {
        return new Response(JSON.stringify({ ok: true, service: "stamp" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      seen.push(url);
      if (url.includes("/v1/tiktok/tiktok_list_catalogs")) {
        return new Response(
          JSON.stringify({
            ok: true,
            tool: "tiktok_list_catalogs",
            data: JSON.parse(readFileSync(join(ROOT, "fixtures/tiktok/catalog.list.json"), "utf8")),
            api: "tiktok",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/v1/tiktok/tiktok_list_pixels")) {
        return new Response(
          JSON.stringify({
            ok: true,
            tool: "tiktok_list_pixels",
            data: JSON.parse(readFileSync(join(ROOT, "fixtures/tiktok/pixel.list.json"), "utf8")),
            api: "tiktok",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`UNMAPPED ${url}`);
    }) as typeof fetch;
    const catalogs = await dispatch(ctx, "tiktok_list_catalogs", { advertiser_id: ADVERTISER });
    assert.equal(catalogs.ok, true, JSON.stringify(catalogs));
    const pixels = await dispatch(ctx, "tiktok_list_pixels", { advertiser_id: ADVERTISER });
    assert.equal(pixels.ok, true, JSON.stringify(pixels));
    assert.ok(seen.some((u) => u.includes("/v1/tiktok/tiktok_list_catalogs")));
    assert.ok(seen.some((u) => u.includes("/v1/tiktok/tiktok_list_pixels")));
  });

  it("bind requires pixel_code XOR app_id; live create campaign hops named tool", async () => {
    let seenUrl = "";
    const ctx = makeCtx({}, tiktokLicenseEnv());
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/v1/health")) {
        return new Response(JSON.stringify({ ok: true, service: "stamp" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/tiktok/tiktok_create_campaign")) {
        seenUrl = url;
        return new Response(
          JSON.stringify({
            ok: true,
            tool: "tiktok_create_campaign",
            data: JSON.parse(readFileSync(join(ROOT, "fixtures/tiktok/campaign.create.json"), "utf8")),
            api: "tiktok",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`UNMAPPED ${url}`);
    }) as typeof fetch;
    const both = await dispatch(ctx, "tiktok_bind_catalog_eventsource", {
      advertiser_id: ADVERTISER,
      catalog_id: CATALOG_ID,
      pixel_code: PIXEL_CODE,
      app_id: "111",
    });
    assert.equal(both.ok, false);
    assert.equal(both.error_code, "INVALID_ARGUMENT");
    const live = await dispatch(ctx, "tiktok_create_campaign", {
      advertiser_id: ADVERTISER,
      campaign_name: "Sunrise Traffic",
      objective_type: "TRAFFIC",
      dry_run: false,
      confirm_phrase: `create on ${ADVERTISER}`,
    });
    assert.equal(live.ok, true, JSON.stringify(live));
    assert.ok(seenUrl.includes("/v1/tiktok/tiktok_create_campaign"));
  });
});
