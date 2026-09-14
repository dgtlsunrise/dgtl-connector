import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createAppContext } from "../src/context.js";
import { buildCatalogItemsJobs } from "../src/klaviyo/klaviyo-write.js";
import { dispatch } from "../src/tools/dispatch.js";
import { installNetworkGuard, ROOT, testEnv } from "./helpers.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIX = join(ROOT, "fixtures/klaviyo");
const ACCOUNT_ID = "W18aCc";
const FIXTURE_KEY = "pk_fixture_wave18_not_a_live_key";

function loadFix(name: string): unknown {
  return JSON.parse(readFileSync(join(FIX, name), "utf8"));
}

function createKlaviyoFetch(): {
  fetchImpl: typeof fetch;
  calls: { method: string; path: string; body: string; headers: Record<string, string> }[];
} {
  const calls: { method: string; path: string; body: string; headers: Record<string, string> }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    const raw = init?.headers;
    if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw as Record<string, string>)) {
        headers[k.toLowerCase()] = String(v);
      }
    }
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ method, path: url.pathname, body, headers });
    if (url.hostname !== "a.klaviyo.com") throw new Error(`NETWORK_FORBIDDEN ${url.href}`);
    if (url.pathname.includes("campaign-send-jobs") || url.pathname.includes("oauth")) {
      return new Response(JSON.stringify({ errors: [{ detail: "out of wave" }] }), { status: 404 });
    }
    if (method === "GET" && url.pathname === "/api/accounts") {
      return new Response(JSON.stringify(loadFix("account.get.json")), { status: 200 });
    }
    if (method === "GET" && url.pathname === "/api/catalog-items") {
      return new Response(JSON.stringify(loadFix("catalog.items.list.json")), { status: 200 });
    }
    if (method === "GET" && url.pathname === "/api/catalog-categories") {
      return new Response(JSON.stringify(loadFix("catalog.categories.list.json")), { status: 200 });
    }
    if (method === "GET" && url.pathname === "/api/catalog-variants") {
      return new Response(JSON.stringify(loadFix("catalog.variants.list.json")), { status: 200 });
    }
    if (method === "GET" && url.pathname === "/api/reviews") {
      return new Response(JSON.stringify(loadFix("reviews.list.json")), { status: 200 });
    }
    if (method === "GET" && url.pathname.startsWith("/api/reviews/")) {
      return new Response(JSON.stringify(loadFix("review.get.json")), { status: 200 });
    }
    if (method === "POST" && url.pathname === "/api/catalog-item-bulk-create-jobs") {
      return new Response(JSON.stringify(loadFix("catalog.items.bulk-create.json")), { status: 202 });
    }
    if (method === "POST" && url.pathname === "/api/catalog-item-bulk-update-jobs") {
      return new Response(JSON.stringify(loadFix("catalog.items.bulk-update.json")), { status: 202 });
    }
    return new Response(JSON.stringify({ errors: [{ detail: "unexpected" }] }), { status: 404 });
  };
  return { fetchImpl, calls };
}

function ctx(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch) {
  return createAppContext({
    pluginRoot: ROOT,
    env,
    fetchImpl,
    now: () => new Date("2026-09-13T12:00:00Z"),
  });
}

const ITEM = {
  external_id: "MUG-OK-1",
  title: "Sunrise Mug",
  url: "https://dgtl-fixture.myshopify.com/products/sunrise-mug",
  image_full_url: "https://cdn.example.com/sunrise-mug.jpg",
  price: 16,
};

describe("Wave 19 Klaviyo catalog and reviews", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("KLAVIYO_NOT_CONNECTED on catalog and reviews without a key", async () => {
    const { fetchImpl, calls } = createKlaviyoFetch();
    const env = await dispatch(ctx(testEnv({ GOOGLE_ACCESS_TOKEN: "t" }), fetchImpl), "klaviyo_list_catalog_items", {});
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "KLAVIYO_NOT_CONNECTED");
    const reviews = await dispatch(ctx(testEnv({ GOOGLE_ACCESS_TOKEN: "t" }), fetchImpl), "klaviyo_list_reviews", {});
    assert.equal(reviews.error_code, "KLAVIYO_NOT_CONNECTED");
    assert.equal(calls.length, 0);
  });

  it("lists catalog and reviews fixtures; strips review email and author", async () => {
    const { fetchImpl, calls } = createKlaviyoFetch();
    const c = ctx(testEnv({ KLAVIYO_API_KEY: FIXTURE_KEY, GOOGLE_ACCESS_TOKEN: "t" }), fetchImpl);
    const items = await dispatch(c, "klaviyo_list_catalog_items", {});
    assert.equal(items.ok, true);
    const listed = (items.data as { catalog_items: Array<{ id?: string }> }).catalog_items;
    assert.equal(listed[0]?.id, "$custom:::$default:::MUG-OK-1");

    const cats = await dispatch(c, "klaviyo_list_catalog_categories", {});
    assert.equal(cats.ok, true);
    const vars = await dispatch(c, "klaviyo_list_catalog_variants", {});
    assert.equal(vars.ok, true);
    const reviews = await dispatch(c, "klaviyo_list_reviews", {});
    assert.equal(reviews.ok, true);
    const row = (reviews.data as { reviews: Array<{ attributes?: Record<string, unknown> }> }).reviews[0];
    assert.equal(row?.attributes?.email, undefined);
    assert.equal(row?.attributes?.author, undefined);
    assert.equal(row?.attributes?.rating, 5);

    const one = await dispatch(c, "klaviyo_get_review", { review_id: "01JWAVE19REVIEWTEST01" });
    assert.equal(one.ok, true);
    const got = (one.data as { review?: { attributes?: Record<string, unknown> } }).review;
    assert.equal(got?.attributes?.email, undefined);
    assert.equal(got?.attributes?.author, undefined);

    assert.ok(calls.every((call) => call.path.startsWith("/api/")));
    assert.ok(!JSON.stringify([items, cats, vars, reviews, one]).includes(FIXTURE_KEY));
  });

  it("writesEnabled false + pk_ dry-run GETs account only for catalog upsert", async () => {
    const off = createKlaviyoFetch();
    const dry = await dispatch(
      ctx(testEnv({ KLAVIYO_API_KEY: FIXTURE_KEY, DGTL_WRITES_ENABLED: "false" }), off.fetchImpl),
      "klaviyo_upsert_catalog_items",
      { items: [ITEM] },
    );
    assert.equal(dry.ok, true, JSON.stringify(dry));
    const data = dry.data as { dry_run?: boolean; invented_shopify_ids?: boolean };
    assert.equal(data.dry_run, true);
    assert.equal(data.invented_shopify_ids, false);
    assert.notEqual(dry.error_code, "WRITE_NOT_ENABLED");
    assert.deepEqual(
      off.calls.map((call) => `${call.method} ${call.path}`),
      ["GET /api/accounts"],
    );
  });

  it("live catalog create confirms account id and posts bulk-create only", async () => {
    const { fetchImpl, calls } = createKlaviyoFetch();
    const env = await dispatch(
      ctx(testEnv({ KLAVIYO_API_KEY: FIXTURE_KEY, DGTL_WRITES_ENABLED: "true" }), fetchImpl),
      "klaviyo_upsert_catalog_items",
      { items: [ITEM], dry_run: false, confirm_phrase: `upsert catalog on ${ACCOUNT_ID}` },
    );
    assert.equal(env.ok, true);
    assert.ok(calls.some((c) => c.method === "POST" && c.path === "/api/catalog-item-bulk-create-jobs"));
    assert.equal(calls.some((c) => c.path.includes("send-job")), false);
    const posted = JSON.parse(calls.find((c) => c.method === "POST")!.body) as {
      data: { type: string; attributes: { items: { data: Array<{ attributes: { integration_type: string } }> } } };
    };
    assert.equal(posted.data.type, "catalog-item-bulk-create-job");
    assert.equal(posted.data.attributes.items.data[0]?.attributes.integration_type, "$custom");
    const data = env.data as { invented_shopify_ids?: boolean };
    assert.equal(data.invented_shopify_ids, false);
    assert.equal(JSON.stringify(posted).includes("$shopify:::"), false);
  });

  it("builders refuse invented shopify compound ids; update job uses custom id", () => {
    assert.throws(() =>
      buildCatalogItemsJobs({
        items: [{ ...ITEM, external_id: "$shopify:::$default:::MUG" }],
      }),
    );
    assert.throws(() =>
      buildCatalogItemsJobs({
        items: [{ ...ITEM, catalog_item_id: "$shopify:::$default:::MUG-OK-1" }],
      }),
    );
    const update = buildCatalogItemsJobs({
      items: [{ ...ITEM, catalog_item_id: "$custom:::$default:::MUG-OK-1" }],
    });
    assert.equal(update.create, undefined);
    assert.ok(update.update);
    const body = update.update as {
      data: { type: string; attributes: { items: { data: Array<{ id: string }> } } };
    };
    assert.equal(body.data.type, "catalog-item-bulk-update-job");
    assert.equal(body.data.attributes.items.data[0]?.id, "$custom:::$default:::MUG-OK-1");
  });
});
