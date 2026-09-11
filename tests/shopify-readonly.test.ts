import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { dispatch } from "../src/tools/dispatch.js";
import { TOOLS } from "../src/tools/registry.js";
import * as S from "../src/tools/schemas.js";
import {
  normalizeShopifyStore,
  resolveShopifyCredentials,
  SHOPIFY_STORE_FILE,
  writeShopifyStore,
} from "../src/shopify/auth.js";
import { assertReadOnlyDocument } from "../src/shopify/http.js";
import { ALLOWED_OPERATIONS, DOC_BY_OP, OP_SHOP } from "../src/shopify/queries.js";
import { helpText } from "../src/auth/login-cli.js";
import {
  applyWriteEnvLocal,
  parseDotEnvLocal,
  WRITE_ENV_LOCAL_KEYS,
} from "../src/auth/write-env-local.js";
import { CONSENT_W_GTM, SCOPE } from "../src/google/scopes.js";
import { buildGoogleAuthUrl, generatePkce } from "../src/auth/pkce.js";
import { createAppContext } from "../src/context.js";
import {
  installNetworkGuard,
  ROOT,
  testEnv,
} from "./helpers.js";

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
  calls: { method: string; host: string; path: string; headers: Record<string, string>; body: string }[];
} {
  const calls: { method: string; host: string; path: string; headers: Record<string, string>; body: string }[] =
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
    calls.push({ method, host: url.hostname, path: url.pathname, headers, body });

    if (url.pathname.endsWith("/oauth/access_token") && method === "POST") {
      return new Response(
        JSON.stringify({
          access_token: "shpat_client_credentials_fixture",
          expires_in: 86399,
          scope: "read_products,read_orders",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (!url.hostname.endsWith(".myshopify.com") || !url.pathname.includes("/admin/api/")) {
      throw new Error(`NETWORK_FORBIDDEN ${url.href}`);
    }
    if (method !== "POST") {
      return new Response(JSON.stringify({ errors: "method not allowed" }), { status: 405 });
    }

    const parsed = body ? (JSON.parse(body) as { operationName?: string; query?: string }) : {};
    const op = parsed.operationName ?? "";
    if (/\bmutation\b/i.test(parsed.query ?? "")) {
      return new Response(JSON.stringify({ errors: [{ message: "mutation refused by fixture" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    let fixture: unknown;
    switch (op) {
      case "Shop":
        fixture = loadShopFixture("shop.json");
        break;
      case "Products":
        fixture = loadShopFixture("products.list.json");
        break;
      case "Product":
        fixture = loadShopFixture("product.get.json");
        break;
      case "Orders":
        fixture = loadShopFixture("orders.list.json");
        break;
      case "Order":
        fixture = loadShopFixture("order.get.json");
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

const SHOPIFY_TOOLS = [
  "shopify_get_shop",
  "shopify_list_products",
  "shopify_get_product",
  "shopify_list_orders",
  "shopify_get_order",
] as const;

describe("Shopify read-only slice (local merchant credentials)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("registers five readonly tools; no write tools", () => {
    for (const name of SHOPIFY_TOOLS) {
      const t = TOOLS.find((x) => x.name === name);
      assert.ok(t, name);
      assert.equal(t!.family, "shopify");
      assert.equal(t!.annotations.readOnlyHint, true);
      assert.equal(t!.annotations.destructiveHint, false);
    }
    assert.equal(
      TOOLS.filter((t) => t.name.startsWith("shopify_") && !t.annotations.readOnlyHint).length,
      0,
    );
  });

  it("schemas require product_id / order_id; closed order enums", () => {
    assert.equal(S.shopifyGetProduct.safeParse({}).success, false);
    assert.equal(S.shopifyGetProduct.safeParse({ product_id: "1001" }).success, true);
    assert.equal(S.shopifyGetOrder.safeParse({ order_id: "5001" }).success, true);
    assert.equal(
      S.shopifyListOrders.safeParse({ status: "bogus" }).success,
      false,
    );
    assert.equal(S.shopifyListOrders.safeParse({ status: "open", financial_status: "paid" }).success, true);
  });

  it("normalizeShopifyStore accepts short name and full host", () => {
    assert.equal(normalizeShopifyStore("Fixture-Store"), "fixture-store.myshopify.com");
    assert.equal(normalizeShopifyStore("https://Fixture-Store.myshopify.com/admin"), "fixture-store.myshopify.com");
    assert.throws(() => normalizeShopifyStore("evil.com"));
  });

  it("allowlisted GraphQL ops only; mutation documents refused", () => {
    assert.ok(ALLOWED_OPERATIONS.has(OP_SHOP));
    assertReadOnlyDocument(OP_SHOP, DOC_BY_OP[OP_SHOP]!);
    assert.throws(() =>
      assertReadOnlyDocument(OP_SHOP, "mutation Kill { productDelete(input: {id: \"x\"}) { deletedProductId } }"),
    );
    assert.throws(() => assertReadOnlyDocument("productCreate", "query productCreate { shop { id } }"));
  });

  it("SHOPIFY_NOT_CONNECTED with zero HTTP when credentials missing", async () => {
    const { fetchImpl, calls } = createShopifyFetch();
    const dir = mkdtempSync(join(tmpdir(), "dgtl-shopify-empty-"));
    try {
      const ctx = shopifyCtx(
        testEnv({
          GOOGLE_ACCESS_TOKEN: "",
          PLUGIN_DATA: dir,
          SHOPIFY_STORE: "",
          SHOPIFY_ACCESS_TOKEN: "",
          DGTL_SHOPIFY_STORE: "",
          DGTL_SHOPIFY_ACCESS_TOKEN: "",
        }),
        fetchImpl,
      );
      delete ctx.env.SHOPIFY_STORE;
      delete ctx.env.SHOPIFY_ACCESS_TOKEN;
      delete ctx.env.DGTL_SHOPIFY_STORE;
      delete ctx.env.DGTL_SHOPIFY_ACCESS_TOKEN;
      const env = await dispatch(ctx, "shopify_list_products", {});
      assert.equal(env.ok, false);
      assert.equal(env.error_code, "SHOPIFY_NOT_CONNECTED");
      assert.equal(calls.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("get_shop / list / get product+order with fixtures; token redacted from body dumps", async () => {
    const { fetchImpl, calls } = createShopifyFetch();
    const secret = "shpat_test_token_DO_NOT_LEAK";
    const ctx = shopifyCtx(testEnv({
        SHOPIFY_STORE: "fixture-store.myshopify.com",
        SHOPIFY_ACCESS_TOKEN: secret,
        SHOPIFY_GRANTED_SCOPES: "read_products,read_orders",
      }), fetchImpl);

    const shop = await dispatch(ctx, "shopify_get_shop", {});
    assert.equal(shop.ok, true);
    const shopData = shop.data as { shop: { name: string }; cited: { store: string } };
    assert.equal(shopData.shop.name, "Fixture Store");
    assert.equal(shopData.cited.store, "fixture-store.myshopify.com");

    const products = await dispatch(ctx, "shopify_list_products", { page_size: 10 });
    assert.equal(products.ok, true);
    assert.equal(products.page?.row_count, 2);
    assert.equal(products.page?.next_page_token, "cursor-products-2");

    const product = await dispatch(ctx, "shopify_get_product", { product_id: "1001" });
    assert.equal(product.ok, true);
    assert.equal((product.data as { product: { handle: string } }).product.handle, "blue-widget");

    const orders = await dispatch(ctx, "shopify_list_orders", { status: "open", financial_status: "paid" });
    assert.equal(orders.ok, true);
    assert.equal(orders.page?.row_count, 1);

    const order = await dispatch(ctx, "shopify_get_order", {
      order_id: "gid://shopify/Order/5001",
    });
    assert.equal(order.ok, true);
    assert.equal((order.data as { order: { name: string } }).order.name, "#1001");

    assert.ok(calls.length >= 5);
    for (const c of calls) {
      assert.ok(c.path.includes("/admin/api/2026-04/graphql.json"));
      assert.equal(c.method, "POST");
      assert.ok(!JSON.stringify(c.body).includes(secret));
      // header value present for auth but tests assert name only in HttpCall audit path
      assert.ok(c.headers["x-shopify-access-token"]);
    }
    // No Polar / gateway required
    assert.equal(ctx.license.ok, false);
  });

  it("SHOPIFY_SCOPE_MISSING when detectable scopes omit read_orders", async () => {
    const { fetchImpl, calls } = createShopifyFetch();
    const ctx = shopifyCtx(testEnv({
        SHOPIFY_STORE: "fixture-store",
        SHOPIFY_ACCESS_TOKEN: "shpat_x",
        SHOPIFY_GRANTED_SCOPES: "read_products",
      }), fetchImpl);
    const env = await dispatch(ctx, "shopify_list_orders", {});
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "SHOPIFY_SCOPE_MISSING");
    assert.equal(calls.length, 0);
  });

  it("file store mode 0600 + resolveShopifyCredentials", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-shopify-"));
    try {
      writeShopifyStore(dir, {
        store: "fixture-store.myshopify.com",
        access_token: "shpat_file_token",
        scopes: ["read_products", "read_orders"],
      });
      const p = join(dir, SHOPIFY_STORE_FILE);
      assert.ok(existsSync(p));
      const mode = statSync(p).mode & 0o777;
      if (process.platform === "linux") assert.equal(mode, 0o600);
      const creds = await resolveShopifyCredentials({
        env: {},
        pluginDataDir: dir,
        fetchImpl: async () => {
          throw new Error("no network");
        },
      });
      assert.ok(creds);
      assert.equal(creds!.accessToken, "shpat_file_token");
      assert.equal(creds!.storeHost, "fixture-store.myshopify.com");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("client_credentials refresh when only client id/secret + store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-shopify-cc-"));
    const { fetchImpl, calls } = createShopifyFetch();
    try {
      writeShopifyStore(dir, {
        store: "fixture-store.myshopify.com",
        client_id: "client-id-fixture",
        client_secret: "client-secret-fixture",
      });
      const creds = await resolveShopifyCredentials({
        env: {},
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.ok(creds);
      assert.equal(creds!.source, "client_credentials");
      assert.equal(creds!.accessToken, "shpat_client_credentials_fixture");
      assert.ok(calls.some((c) => c.path.endsWith("/oauth/access_token")));
      const stored = JSON.parse(readFileSync(join(dir, SHOPIFY_STORE_FILE), "utf8")) as {
        access_token?: string;
      };
      assert.equal(stored.access_token, "shpat_client_credentials_fixture");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("invalid financial_status fails closed without HTTP", async () => {
    const { fetchImpl, calls } = createShopifyFetch();
    const ctx = shopifyCtx(testEnv({
        SHOPIFY_STORE: "fixture-store",
        SHOPIFY_ACCESS_TOKEN: "shpat_x",
      }), fetchImpl);
    // bypass zod by calling handler with cast — dispatch uses registry schema? check dispatch
    // dispatch does NOT parse zod — handlers validate. Pass via handler path:
    const env = await dispatch(ctx, "shopify_list_orders", {
      financial_status: "not_a_real_status",
    });
    // zod not applied in dispatch — handler buildOrderQuery throws INVALID_ARGUMENT
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(calls.length, 0);
  });
});

describe("Consent W auth login-write CLI", () => {
  it("helpText documents login-write; does not enable writes by default", () => {
    const h = helpText();
    assert.ok(h.includes("auth login-write"));
    assert.ok(h.includes("google-oauth-write.json"));
    assert.ok(h.includes("Does not turn on DGTL_WRITES_ENABLED") || h.includes("DGTL_WRITES_ENABLED"));
    assert.ok(h.includes(".env.write.local") || h.includes("GOOGLE_OAUTH_WRITE_CLIENT_ID"));
    assert.ok(h.includes("SHOPIFY_STORE") || h.includes("Shopify"));
  });

  it("Consent W auth URL uses CONSENT_W_GTM only — never Consent A scopes", () => {
    const pkce = generatePkce();
    const url = buildGoogleAuthUrl({
      clientId: "write-client.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:9876/callback",
      challenge: pkce.challenge,
      state: pkce.state,
      scopes: CONSENT_W_GTM,
    });
    assert.ok(url.includes(encodeURIComponent(SCOPE.tagmanagerEditContainers)) || url.includes(SCOPE.tagmanagerEditContainers));
    assert.ok(url.includes("tagmanager.publish") || url.includes(encodeURIComponent(SCOPE.tagmanagerPublish)));
    assert.ok(!url.includes("analytics.readonly"));
    assert.ok(!url.includes("webmasters.readonly"));
    assert.ok(!url.includes("adwords"));
  });
});


describe("Consent W .env.write.local loader", () => {
  it("parseDotEnvLocal ignores comments and strips quotes", () => {
    const m = parseDotEnvLocal(
      '# comment\nGOOGLE_OAUTH_WRITE_CLIENT_ID="cid.apps.googleusercontent.com"\nGOOGLE_OAUTH_WRITE_CLIENT_SECRET=sekrit\nGOOGLE_OAUTH_CLIENT_SECRET=should-ignore\n',
    );
    assert.equal(m.GOOGLE_OAUTH_WRITE_CLIENT_ID, "cid.apps.googleusercontent.com");
    assert.equal(m.GOOGLE_OAUTH_WRITE_CLIENT_SECRET, "sekrit");
    assert.equal(m.GOOGLE_OAUTH_CLIENT_SECRET, "should-ignore"); // parsed raw; apply filters
  });

  it("applyWriteEnvLocal fills only unset WRITE keys; never Consent A; existing env wins", () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-write-env-"));
    try {
      writeFileSync(
        join(dir, ".env.write.local"),
        [
          "GOOGLE_OAUTH_WRITE_CLIENT_ID=from-file-client",
          "GOOGLE_OAUTH_WRITE_CLIENT_SECRET=from-file-secret",
          "GOOGLE_OAUTH_CLIENT_ID=consent-a-leak",
          "GOOGLE_OAUTH_CLIENT_SECRET=consent-a-secret-leak",
          "",
        ].join("\n"),
        { mode: 0o600 },
      );
      const filled = applyWriteEnvLocal(dir, {
        GOOGLE_OAUTH_WRITE_CLIENT_ID: "",
        PATH: "/usr/bin",
      });
      assert.equal(filled.GOOGLE_OAUTH_WRITE_CLIENT_ID, "from-file-client");
      assert.equal(filled.GOOGLE_OAUTH_WRITE_CLIENT_SECRET, "from-file-secret");
      assert.equal(filled.GOOGLE_OAUTH_CLIENT_ID, undefined);
      assert.equal(filled.GOOGLE_OAUTH_CLIENT_SECRET, undefined);

      const wins = applyWriteEnvLocal(dir, {
        GOOGLE_OAUTH_WRITE_CLIENT_ID: "already-set",
        GOOGLE_OAUTH_WRITE_CLIENT_SECRET: "already-secret",
      });
      assert.equal(wins.GOOGLE_OAUTH_WRITE_CLIENT_ID, "already-set");
      assert.equal(wins.GOOGLE_OAUTH_WRITE_CLIENT_SECRET, "already-secret");
      assert.ok(WRITE_ENV_LOCAL_KEYS.includes("GOOGLE_OAUTH_WRITE_CLIENT_ID"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadFlags writesEnabled stays false by default (login-write does not flip it)", async () => {
    const { loadFlags } = await import("../src/flags.js");
    assert.equal(loadFlags({}).writesEnabled, false);
    assert.equal(loadFlags({ GOOGLE_OAUTH_WRITE_CLIENT_ID: "x" }).writesEnabled, false);
  });
});

