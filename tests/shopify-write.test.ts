import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { dispatch } from "../src/tools/dispatch.js";
import { LOCAL_FREE_TOOLS, TOOLS } from "../src/tools/registry.js";
import * as S from "../src/tools/schemas.js";
import { assertMutationDocument, assertReadOnlyDocument } from "../src/shopify/http.js";
import { MUTATION_DOC_BY_OP, OP_INVENTORY_ADJUST, OP_SHOP } from "../src/shopify/queries.js";
import { createAppContext } from "../src/context.js";
import { installNetworkGuard, ROOT, testEnv } from "./helpers.js";

function shopifyCtx(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch) {
  return createAppContext({
    pluginRoot: ROOT,
    env,
    fetchImpl,
    now: () => new Date("2026-09-02T12:00:00Z"),
  });
}

const FIX = join(ROOT, "fixtures/shopify");

function loadShopFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIX, name), "utf8"));
}

function createShopifyFetch(): {
  fetchImpl: typeof fetch;
  calls: { method: string; host: string; path: string; body: string; headers: Record<string, string> }[];
} {
  const calls: { method: string; host: string; path: string; body: string; headers: Record<string, string> }[] =
    [];
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
    calls.push({ method, host: url.hostname, path: url.pathname, body, headers });

    if (!url.hostname.endsWith(".myshopify.com") || !url.pathname.includes("/admin/api/")) {
      throw new Error(`NETWORK_FORBIDDEN ${url.href}`);
    }

    const parsed = body ? (JSON.parse(body) as { operationName?: string; query?: string }) : {};
    const op = parsed.operationName ?? "";
    let fixture: unknown;
    switch (op) {
      case "InventoryAdjust":
        fixture = loadShopFixture("inventory.adjust.json");
        break;
      case "Shop":
        fixture = loadShopFixture("shop.json");
        break;
      default:
        return new Response(JSON.stringify({ errors: [{ message: `unknown op ${op}` }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
    }
    return new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

const WRITE_CREDS = {
  SHOPIFY_STORE: "fixture-store.myshopify.com",
  SHOPIFY_ACCESS_TOKEN: "shpat_write_fixture",
  SHOPIFY_GRANTED_SCOPES: "read_products,read_orders,read_inventory,read_locations,write_inventory",
};

describe("Shopify confirm-gated inventory write (Wave 7)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("shopify_adjust_inventory is local-free write family; not Polar", () => {
    const t = TOOLS.find((x) => x.name === "shopify_adjust_inventory");
    assert.ok(t);
    assert.equal(t!.family, "shopify_write");
    assert.equal(t!.annotations.readOnlyHint, false);
    assert.ok(LOCAL_FREE_TOOLS.includes("shopify_adjust_inventory"));
  });

  it("schema dry_run defaults true; confirm_phrase required when dry_run=false", () => {
    const parsed = S.shopifyAdjustInventory.parse({
      inventory_item_id: "3001",
      location_id: "1",
      delta: -1,
    });
    assert.equal(parsed.dry_run, true);
    const liveMissing = S.shopifyAdjustInventory.safeParse({
      inventory_item_id: "3001",
      location_id: "1",
      delta: -1,
      dry_run: false,
    });
    assert.equal(liveMissing.success, false);
    const liveOk = S.shopifyAdjustInventory.safeParse({
      inventory_item_id: "3001",
      location_id: "1",
      delta: -1,
      dry_run: false,
      confirm_phrase: "adjust fixture-store.myshopify.com",
    });
    assert.equal(liveOk.success, true);
  });

  it("read client refuses mutation documents; write allowlist is InventoryAdjust only", () => {
    assertReadOnlyDocument(OP_SHOP, "query Shop { shop { id } }");
    assert.throws(() =>
      assertReadOnlyDocument(OP_SHOP, MUTATION_DOC_BY_OP[OP_INVENTORY_ADJUST]!),
    );
    assertMutationDocument(OP_INVENTORY_ADJUST, MUTATION_DOC_BY_OP[OP_INVENTORY_ADJUST]!);
    assert.throws(() =>
      assertMutationDocument("productDelete", "mutation productDelete { shop { id } }"),
    );
  });

  it("flag off → WRITE_NOT_ENABLED with zero HTTP", async () => {
    const { fetchImpl, calls } = createShopifyFetch();
    const ctx = shopifyCtx(
      testEnv({
        ...WRITE_CREDS,
        DGTL_WRITES_ENABLED: "false",
      }),
      fetchImpl,
    );
    const env = await dispatch(ctx, "shopify_adjust_inventory", {
      inventory_item_id: "3001",
      location_id: "1",
      delta: -1,
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "WRITE_NOT_ENABLED");
    assert.equal(calls.length, 0);
  });

  it("flag on without credentials → SHOPIFY_NOT_CONNECTED, zero HTTP", async () => {
    const { fetchImpl, calls } = createShopifyFetch();
    const ctx = shopifyCtx(
      testEnv({
        DGTL_WRITES_ENABLED: "true",
        GOOGLE_ACCESS_TOKEN: "",
        SHOPIFY_STORE: "",
        SHOPIFY_ACCESS_TOKEN: "",
      }),
      fetchImpl,
    );
    delete ctx.env.SHOPIFY_STORE;
    delete ctx.env.SHOPIFY_ACCESS_TOKEN;
    delete ctx.env.DGTL_SHOPIFY_STORE;
    delete ctx.env.DGTL_SHOPIFY_ACCESS_TOKEN;
    const env = await dispatch(ctx, "shopify_adjust_inventory", {
      inventory_item_id: "3001",
      location_id: "1",
      delta: -1,
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "SHOPIFY_NOT_CONNECTED");
    assert.equal(calls.length, 0);
  });

  it("flag on without write_inventory → SHOPIFY_SCOPE_MISSING, zero HTTP", async () => {
    const { fetchImpl, calls } = createShopifyFetch();
    const ctx = shopifyCtx(
      testEnv({
        DGTL_WRITES_ENABLED: "true",
        SHOPIFY_STORE: "fixture-store.myshopify.com",
        SHOPIFY_ACCESS_TOKEN: "shpat_x",
        SHOPIFY_GRANTED_SCOPES: "read_products,read_orders,read_inventory,read_locations",
      }),
      fetchImpl,
    );
    const env = await dispatch(ctx, "shopify_adjust_inventory", {
      inventory_item_id: "3001",
      location_id: "1",
      delta: -1,
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "SHOPIFY_SCOPE_MISSING");
    assert.equal(calls.length, 0);
  });

  it("dry_run returns shop domain + proposed with zero mutation HTTP", async () => {
    const { fetchImpl, calls } = createShopifyFetch();
    const ctx = shopifyCtx(testEnv({ ...WRITE_CREDS, DGTL_WRITES_ENABLED: "true" }), fetchImpl);
    const env = await dispatch(ctx, "shopify_adjust_inventory", {
      inventory_item_id: "3001",
      location_id: "1",
      delta: -1,
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    const data = env.data as {
      dry_run: boolean;
      shop_domain: string;
      proposed: { changes: Array<{ delta: number }> };
    };
    assert.equal(data.dry_run, true);
    assert.equal(data.shop_domain, "fixture-store.myshopify.com");
    assert.equal(data.proposed.changes[0]?.delta, -1);
    assert.equal(calls.length, 0);
  });

  it("live without shop domain in confirm_phrase → INVALID_ARGUMENT, no mutation HTTP", async () => {
    const { fetchImpl, calls } = createShopifyFetch();
    const ctx = shopifyCtx(testEnv({ ...WRITE_CREDS, DGTL_WRITES_ENABLED: "true" }), fetchImpl);
    const env = await dispatch(ctx, "shopify_adjust_inventory", {
      inventory_item_id: "3001",
      location_id: "1",
      delta: -1,
      dry_run: false,
      confirm_phrase: "yes do it",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(calls.length, 0);
  });

  it("live with shop-domain confirm posts InventoryAdjust mutation", async () => {
    const { fetchImpl, calls } = createShopifyFetch();
    const ctx = shopifyCtx(testEnv({ ...WRITE_CREDS, DGTL_WRITES_ENABLED: "true" }), fetchImpl);
    const env = await dispatch(ctx, "shopify_adjust_inventory", {
      inventory_item_id: "3001",
      location_id: "1",
      delta: -1,
      dry_run: false,
      confirm_phrase: "adjust inventory on fixture-store.myshopify.com",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.path.includes("/admin/api/2026-04/graphql.json"));
    const body = JSON.parse(calls[0]!.body) as { operationName: string; query: string };
    assert.equal(body.operationName, "InventoryAdjust");
    assert.ok(/\bmutation\b/i.test(body.query));
    const data = env.data as { dry_run: boolean; adjustment: { reason: string } };
    assert.equal(data.dry_run, false);
    assert.equal(data.adjustment.reason, "correction");
    assert.equal(ctx.license.ok, false);
  });

  it("join skill exists and forbids invented SKUs / stamp vault", () => {
    const skill = readFileSync(join(ROOT, "skills/shopify-ads-mc-join/SKILL.md"), "utf8");
    assert.ok(skill.includes("name: shopify-ads-mc-join"));
    assert.ok(/offerId/.test(skill));
    assert.ok(/shopify_list_inventory_levels/.test(skill));
    assert.ok(/mc_list_products/.test(skill));
    assert.ok(/Do not invent/i.test(skill) || /Never invent/i.test(skill));
    assert.ok(/vault/i.test(skill));
    assert.ok(!/axos/i.test(skill));
  });
});
