import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { ToolError } from "../src/errors.js";
import type { HttpCall } from "../src/http/calls.js";
import { MAX_HTTP_RETRIES } from "../src/http/retry.js";
import { isShopifyGraphqlThrottle, ShopifyHttp } from "../src/shopify/http.js";
import { installNetworkGuard, ROOT } from "./helpers.js";

const SHOP_OK = JSON.parse(readFileSync(join(ROOT, "fixtures/shopify/shop.json"), "utf8")) as {
  data: Record<string, unknown>;
};

const THROTTLED_BODY = {
  errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
};

const SECRET = "shpat_test_token_must_not_leak";

function makeHttp(fetchImpl: typeof fetch, calls: HttpCall[] = []): ShopifyHttp {
  return new ShopifyHttp({
    credentials: {
      storeHost: "example.myshopify.com",
      accessToken: SECRET,
      source: "host-injected",
    },
    fetchImpl,
    calls,
  });
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "retry-after": "0", ...extraHeaders },
  });
}

describe("Shopify GraphQL throttle retry", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("detects THROTTLED GraphQL bodies and ignores other errors", () => {
    assert.equal(isShopifyGraphqlThrottle(THROTTLED_BODY), true);
    assert.equal(
      isShopifyGraphqlThrottle({ errors: [{ message: "Exceeded query rate limit" }] }),
      true,
    );
    assert.equal(
      isShopifyGraphqlThrottle({ errors: [{ message: "Product does not exist", extensions: { code: "NOT_FOUND" } }] }),
      false,
    );
    assert.equal(isShopifyGraphqlThrottle({ data: { shop: {} } }), false);
  });

  it("retries HTTP 200 + GraphQL THROTTLED then succeeds", async () => {
    let hits = 0;
    const calls: HttpCall[] = [];
    const fetchImpl: typeof fetch = async () => {
      hits += 1;
      if (hits === 1) return jsonResponse(THROTTLED_BODY);
      return jsonResponse(SHOP_OK);
    };
    const data = await makeHttp(fetchImpl, calls).graphql({
      operation: "Shop",
      tool: "shopify_get_shop",
    });
    assert.equal(hits, 2);
    assert.equal(calls.length, 2);
    assert.equal((data.shop as { name?: string } | undefined)?.name, "Fixture Store");
    assert.ok(!JSON.stringify(calls).includes(SECRET));
  });

  it("caps GraphQL throttle retries then maps to RATE_LIMITED", async () => {
    let hits = 0;
    const fetchImpl: typeof fetch = async () => {
      hits += 1;
      return jsonResponse(THROTTLED_BODY);
    };
    await assert.rejects(
      () => makeHttp(fetchImpl).graphql({ operation: "Shop", tool: "shopify_get_shop" }),
      (err: unknown) => err instanceof ToolError && err.error_code === "RATE_LIMITED",
    );
    assert.equal(hits, MAX_HTTP_RETRIES + 1);
  });

  it("does not retry non-throttle GraphQL errors", async () => {
    let hits = 0;
    const fetchImpl: typeof fetch = async () => {
      hits += 1;
      return jsonResponse({
        errors: [{ message: "Product does not exist", extensions: { code: "NOT_FOUND" } }],
      });
    };
    await assert.rejects(
      () => makeHttp(fetchImpl).graphql({ operation: "Shop", tool: "shopify_get_shop" }),
      (err: unknown) => err instanceof ToolError && err.error_code === "NOT_FOUND",
    );
    assert.equal(hits, 1);
  });
});
