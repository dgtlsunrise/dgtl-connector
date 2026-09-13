import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { loadFlags } from "../src/flags.js";
import { hashCapiUserField } from "../src/meta/meta-wave16.js";
import * as S from "../src/tools/schemas.js";
import { dispatch } from "../src/tools/dispatch.js";
import { META_CAPI_TOOL_NAMES, META_MUTATE_TOOL_NAMES, TOOLS } from "../src/tools/registry.js";
import {
  installNetworkGuard,
  makeCtx,
  ROOT,
  signLicense,
  testEnv,
  TEST_TOKEN,
} from "./helpers.js";

const CATALOG_ID = "5566778899";
const PIXEL_ID = "1122334455";
const ACT = "111222333";

function metaLicenseEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const jwt = signLicense({
    sub: "user_test",
    features: ["ads", "meta"],
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "jti-wave16-meta",
  });
  return testEnv({
    DGTL_LICENSE_JWT: jwt,
    META_ACCESS_TOKEN: "meta-user-token-fixture",
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    DGTL_GATEWAY_URL: "https://stamp.test",
    ...extra,
  });
}

const CATALOG_ITEM = {
  method: "UPDATE" as const,
  retailer_id: "sku-sunrise-tee",
  title: "Sunrise Tee",
  availability: "in stock" as const,
  condition: "new" as const,
  price: "29.00 USD",
  link: "https://shop.dgtlsunrise.com/tee",
  image_link: "https://cdn.dgtlsunrise.com/tee.jpg",
  brand: "DGTL Sunrise",
};

const CAPI_EVENT = {
  event_name: "Purchase" as const,
  event_id: "evt-wave16-001",
  event_time: 1_746_000_000,
  action_source: "website" as const,
  event_source_url: "https://shop.dgtlsunrise.com/checkout",
  em: "User@Example.COM",
  event_value: 29,
  currency: "USD",
};

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

describe("Wave 16 Meta catalog + CAPI (plugin)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("named tools are registered (no meta_mutate)", () => {
    for (const name of [
      "meta_catalog_items_batch",
      "meta_get_batch_status",
      "meta_create_catalog",
      "meta_send_capi_events",
    ]) {
      const t = TOOLS.find((x) => x.name === name);
      assert.ok(t, name);
    }
    assert.equal(TOOLS.find((t) => t.name === "meta_catalog_items_batch")!.group, "meta-write");
    assert.equal(TOOLS.find((t) => t.name === "meta_get_batch_status")!.group, "meta");
    assert.equal(TOOLS.find((t) => t.name === "meta_get_batch_status")!.annotations.readOnlyHint, true);
    assert.equal(TOOLS.find((t) => t.name === "meta_send_capi_events")!.group, "meta-capi");
    assert.equal(TOOLS.find((t) => t.name === "meta_send_capi_events")!.annotations.destructiveHint, true);
    assert.ok(META_MUTATE_TOOL_NAMES.includes("meta_catalog_items_batch"));
    assert.ok(META_MUTATE_TOOL_NAMES.includes("meta_send_capi_events"));
    assert.deepEqual(META_CAPI_TOOL_NAMES, ["meta_send_capi_events"]);
    assert.equal(TOOLS.some((t) => t.name === "meta_mutate"), false);
  });

  it("catalog gated_tools + fixtures exist", () => {
    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8"));
    assert.equal(
      catalog.gated_tools.find((x: { name: string }) => x.name === "meta_catalog_items_batch").fail,
      "META_MUTATE_NOT_ENABLED",
    );
    assert.equal(
      catalog.gated_tools.find((x: { name: string }) => x.name === "meta_create_catalog").fail,
      "META_MUTATE_NOT_ENABLED",
    );
    assert.equal(
      catalog.gated_tools.find((x: { name: string }) => x.name === "meta_send_capi_events").fail,
      "META_CAPI_NOT_ENABLED",
    );
    assert.equal(
      catalog.gated_tools.find((x: { name: string }) => x.name === "meta_get_batch_status").fail,
      "LICENSE_REQUIRED",
    );
    const batch = JSON.parse(readFileSync(join(ROOT, "fixtures/meta/catalog.items_batch.json"), "utf8"));
    const status = JSON.parse(readFileSync(join(ROOT, "fixtures/meta/catalog.batch_status.json"), "utf8"));
    const created = JSON.parse(readFileSync(join(ROOT, "fixtures/meta/catalog.create.json"), "utf8"));
    const capi = JSON.parse(readFileSync(join(ROOT, "fixtures/meta/capi.events.json"), "utf8"));
    assert.ok(Array.isArray(batch.handles));
    assert.equal(status.data[0].handle, "AcmeCatalogBatchHandle001");
    assert.equal(created.id, "887766554433");
    assert.equal(capi.events_received, 1);
  });

  it("DGTL_META_CAPI_ENABLED defaults on; explicit false opts out", () => {
    assert.equal(loadFlags({}).metaCapiEnabled, true);
    assert.equal(loadFlags({ DGTL_META_CAPI_ENABLED: "false" }).metaCapiEnabled, false);
    assert.equal(loadFlags({ META_CAPI_ENABLED: "false" }).metaCapiEnabled, false);
    assert.equal(loadFlags({ DGTL_META_CAPI_ENABLED: "true" }).metaCapiEnabled, true);
  });

  it("schemas default dry_run true and require confirm live", () => {
    assert.equal(
      S.metaCatalogItemsBatch.parse({
        ad_account_id: ACT,
        catalog_id: CATALOG_ID,
        items: [CATALOG_ITEM],
      }).dry_run,
      true,
    );
    assert.equal(
      S.metaSendCapiEvents.parse({
        ad_account_id: ACT,
        pixel_id: PIXEL_ID,
        events: [CAPI_EVENT],
      }).dry_run,
      true,
    );
    assert.equal(
      S.metaCatalogItemsBatch.safeParse({
        ad_account_id: ACT,
        catalog_id: CATALOG_ID,
        items: [CATALOG_ITEM],
        dry_run: false,
      }).success,
      false,
    );
    assert.equal(
      S.metaSendCapiEvents.safeParse({
        ad_account_id: ACT,
        pixel_id: PIXEL_ID,
        events: [{ event_name: "Purchase" }],
      }).success,
      false,
    );
    assert.equal(
      S.metaSendCapiEvents.safeParse({
        ad_account_id: ACT,
        pixel_id: PIXEL_ID,
        events: [{ event_name: "NotARealEvent", event_id: "x" }],
      }).success,
      false,
    );
  });

  it("catalog mutate flag off → META_MUTATE_NOT_ENABLED zero hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, metaLicenseEnv({ DGTL_META_MUTATE_ENABLED: "false" }));
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const batch = await dispatch(ctx, "meta_catalog_items_batch", {
      ad_account_id: ACT,
      catalog_id: CATALOG_ID,
      items: [CATALOG_ITEM],
    });
    assert.equal(batch.ok, false);
    assert.equal(batch.error_code, "META_MUTATE_NOT_ENABLED");
    const created = await dispatch(ctx, "meta_create_catalog", {
      ad_account_id: ACT,
      name: "Sunrise Commerce",
    });
    assert.equal(created.ok, false);
    assert.equal(created.error_code, "META_MUTATE_NOT_ENABLED");
    assert.equal(hops, 0);
  });

  it("CAPI flag off → META_CAPI_NOT_ENABLED even when mutate is on", async () => {
    let hops = 0;
    const ctx = makeCtx(
      {},
      metaLicenseEnv({ DGTL_META_CAPI_ENABLED: "false", DGTL_META_MUTATE_ENABLED: "true" }),
    );
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_send_capi_events", {
      ad_account_id: ACT,
      pixel_id: PIXEL_ID,
      events: [CAPI_EVENT],
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "META_CAPI_NOT_ENABLED");
    assert.equal(hops, 0);
  });

  it("catalog items_batch dry_run includes act + https image, zero hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, metaLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_catalog_items_batch", {
      ad_account_id: ACT,
      catalog_id: CATALOG_ID,
      items: [CATALOG_ITEM],
    });
    assert.equal(env.ok, true);
    const data = env.data as {
      dry_run?: boolean;
      proposed?: { act?: string; items?: Array<{ image_link?: string }> };
    };
    assert.equal(data.dry_run, true);
    assert.equal(data.proposed?.act, `act_${ACT}`);
    assert.equal(data.proposed?.items?.[0]?.image_link, CATALOG_ITEM.image_link);
    assert.equal(hops, 0);
  });

  it("http image_link is refused (zero hop)", async () => {
    let hops = 0;
    const ctx = makeCtx({}, metaLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_catalog_items_batch", {
      ad_account_id: ACT,
      catalog_id: CATALOG_ID,
      items: [{ ...CATALOG_ITEM, image_link: "http://cdn.example.com/tee.jpg" }],
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(hops, 0);
  });

  it("live catalog confirm must include act_ AND catalog_id", async () => {
    let hops = 0;
    const ctx = makeCtx({}, metaLicenseEnv());
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const missing = await dispatch(ctx, "meta_catalog_items_batch", {
      ad_account_id: ACT,
      catalog_id: CATALOG_ID,
      items: [CATALOG_ITEM],
      dry_run: false,
      confirm_phrase: `act_${ACT} only`,
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.error_code, "INVALID_ARGUMENT");
    assert.equal(hops, 0);
  });

  it("create catalog dry_run + CAPI hashes email before hop", async () => {
    let hops = 0;
    let seenBody: Record<string, unknown> | undefined;
    const hashed = sha256("user@example.com");
    const ctx = makeCtx({}, metaLicenseEnv());
    ctx.fetchImpl = (async (input, init) => {
      hops += 1;
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/v1/health")) {
        return new Response(JSON.stringify({ ok: true, service: "stamp", meta_capi_enabled: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/meta/meta_send_capi_events") && init?.body && typeof init.body === "string") {
        seenBody = JSON.parse(init.body) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            ok: true,
            tool: "meta_send_capi_events",
            data: JSON.parse(readFileSync(join(ROOT, "fixtures/meta/capi.events.json"), "utf8")),
            api: "meta",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`UNMAPPED ${url}`);
    }) as typeof fetch;

    const created = await dispatch(ctx, "meta_create_catalog", {
      ad_account_id: ACT,
      name: "Sunrise Commerce",
    });
    assert.equal(created.ok, true);
    assert.equal((created.data as { dry_run?: boolean }).dry_run, true);

    const dry = await dispatch(ctx, "meta_send_capi_events", {
      ad_account_id: ACT,
      pixel_id: PIXEL_ID,
      events: [CAPI_EVENT],
    });
    assert.equal(dry.ok, true);
    const dryJson = JSON.stringify(dry);
    assert.equal(dryJson.includes("User@Example.COM"), false);
    assert.equal(dryJson.includes("user@example.com"), false);
    const proposed = (dry.data as { proposed?: { events?: Array<{ em?: string }> } }).proposed;
    assert.equal(proposed?.events?.[0]?.em, hashed);
    assert.equal(hashCapiUserField("em", "User@Example.COM"), hashed);

    const live = await dispatch(ctx, "meta_send_capi_events", {
      ad_account_id: ACT,
      pixel_id: PIXEL_ID,
      events: [CAPI_EVENT],
      dry_run: false,
      confirm_phrase: `act_${ACT} ${PIXEL_ID}`,
    });
    assert.equal(live.ok, true, JSON.stringify(live));
    const params = seenBody?.params as { events?: Array<{ em?: string; event_id?: string }> };
    assert.equal(params?.events?.[0]?.em, hashed);
    assert.equal(params?.events?.[0]?.event_id, "evt-wave16-001");
    assert.equal(JSON.stringify(seenBody).includes("User@Example.COM"), false);
    assert.ok(hops >= 2);
  });

  it("live CAPI fail-closed when Worker META_CAPI_ENABLED is missing or false", async () => {
    for (const health of [{ ok: true, service: "stamp" }, { ok: true, service: "stamp", meta_capi_enabled: false }]) {
      let hops = 0;
      const ctx = makeCtx({}, metaLicenseEnv());
      ctx.fetchImpl = (async (input) => {
        hops += 1;
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith("/v1/health")) {
          return new Response(JSON.stringify(health), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`CAPI must not hop when Worker flag is fail-closed: ${url}`);
      }) as typeof fetch;
      const env = await dispatch(ctx, "meta_send_capi_events", {
        ad_account_id: ACT,
        pixel_id: PIXEL_ID,
        events: [CAPI_EVENT],
        dry_run: false,
        confirm_phrase: `act_${ACT} ${PIXEL_ID}`,
      });
      assert.equal(env.ok, false, JSON.stringify(health));
      assert.equal(env.error_code, "META_CAPI_NOT_ENABLED", JSON.stringify(health));
      assert.equal(hops, 1, JSON.stringify(health));
    }
  });

  it("live catalog items_batch hops named tool + image_link", async () => {
    let seenUrl = "";
    let seenBody: Record<string, unknown> | undefined;
    const ctx = makeCtx({}, metaLicenseEnv());
    ctx.fetchImpl = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/v1/health")) {
        return new Response(JSON.stringify({ ok: true, service: "stamp" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/meta/meta_catalog_items_batch")) {
        seenUrl = url;
        if (init?.body && typeof init.body === "string") seenBody = JSON.parse(init.body) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            ok: true,
            tool: "meta_catalog_items_batch",
            data: JSON.parse(readFileSync(join(ROOT, "fixtures/meta/catalog.items_batch.json"), "utf8")),
            api: "meta",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`UNMAPPED ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_catalog_items_batch", {
      ad_account_id: ACT,
      catalog_id: CATALOG_ID,
      items: [CATALOG_ITEM],
      dry_run: false,
      confirm_phrase: `act_${ACT} ${CATALOG_ID}`,
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.ok(seenUrl.includes("/v1/meta/meta_catalog_items_batch"));
    const params = seenBody?.params as { catalog_id?: string; items?: Array<{ image_link?: string }> };
    assert.equal(params?.catalog_id, CATALOG_ID);
    assert.equal(params?.items?.[0]?.image_link, CATALOG_ITEM.image_link);
  });

  it("batch status is a read hop (no mutate flag)", async () => {
    let seenUrl = "";
    const ctx = makeCtx({}, metaLicenseEnv({ DGTL_META_MUTATE_ENABLED: "false" }));
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/v1/health")) {
        return new Response(JSON.stringify({ ok: true, service: "stamp" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/meta/meta_get_batch_status")) {
        seenUrl = url;
        return new Response(
          JSON.stringify({
            ok: true,
            tool: "meta_get_batch_status",
            data: JSON.parse(readFileSync(join(ROOT, "fixtures/meta/catalog.batch_status.json"), "utf8")),
            api: "meta",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`UNMAPPED ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_get_batch_status", {
      catalog_id: CATALOG_ID,
      handle: "AcmeCatalogBatchHandle001",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.ok(seenUrl.includes("/v1/meta/meta_get_batch_status"));
  });

  it("LICENSE_REQUIRED without Polar meta bit (zero hop)", async () => {
    let hops = 0;
    const ctx = makeCtx(
      {},
      testEnv({
        DGTL_GATEWAY_URL: "https://stamp.test",
        META_ACCESS_TOKEN: "meta-user-token-fixture",
      }),
    );
    ctx.fetchImpl = (async () => {
      hops += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_send_capi_events", {
      ad_account_id: ACT,
      pixel_id: PIXEL_ID,
      events: [CAPI_EVENT],
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "LICENSE_REQUIRED");
    assert.equal(hops, 0);
  });
});
