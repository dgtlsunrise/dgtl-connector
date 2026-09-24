import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { sealRefreshToken } from "../src/seal";
import { TEST_ENC_KEY, envWithGrant, issuedToken } from "./support";

const ORIGIN = "https://muse-api.dgtlsunrise.com";
const SHOP = "sunrise-demo.myshopify.com";
const SHOPIFY_TOKEN = "shpat_test_not_a_real_token_0001";
const SHOP_URL = `https://${SHOP}/admin/api/2026-04/shop.json`;

afterEach(() => {
  vi.unstubAllGlobals();
});

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("expected a JSON object");
  }
  return body as Record<string, unknown>;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

type SeenCall = {
  readonly url: string;
  readonly tokenHeader: string | null;
};

function forbidFetch(): void {
  vi.stubGlobal("fetch", () => {
    throw new Error("shopify read must not call out");
  });
}

function mockShopify(
  status: number,
  body: unknown,
  link?: string,
): SeenCall[] {
  const seen: SeenCall[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: requestUrl(input),
      tokenHeader: headers.get("x-shopify-access-token"),
    });
    const responseHeaders = new Headers({ "content-type": "application/json" });
    if (link !== undefined) {
      responseHeaders.set("link", link);
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: responseHeaders }),
    );
  });
  return seen;
}

async function linkedEnv(accessToken: string | null) {
  const { token, hash, grant } = await issuedToken();
  const sealed =
    accessToken === null ? null : await sealRefreshToken(accessToken, TEST_ENC_KEY);
  if (accessToken !== null && sealed === null) {
    throw new Error("seal failed");
  }
  const shopify =
    sealed === null
      ? {
          shop: SHOP,
          access_token: { alg: "A256GCM" as const, iv: "aaaaaaaaaaaa", ct: "ciphertext-not-a-token" },
          linked_at: "2026-09-24T00:00:00.000Z",
        }
      : {
          shop: SHOP,
          access_token: sealed,
          linked_at: "2026-09-24T00:00:00.000Z",
        };
  return {
    token,
    sealed: shopify.access_token,
    env: envWithGrant(hash, { ...grant, shopify }),
  };
}

function authed(path: string, token: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

function assertNoSecret(body: unknown, sealed: { iv: string; ct: string }): void {
  const text = JSON.stringify(body);
  expect(text).not.toContain(SHOPIFY_TOKEN);
  expect(text).not.toContain(sealed.iv);
  expect(text).not.toContain(sealed.ct);
  expect(text).not.toContain("access_token");
}

describe("shopify reads", () => {
  it("fails closed when Shopify is not linked and does not call Shopify", async () => {
    forbidFetch();
    const { token, hash, grant } = await issuedToken();
    const env = envWithGrant(hash, grant);
    const shop = await worker.fetch(authed("/v1/shopify/shop", token), env);
    const products = await worker.fetch(authed("/v1/shopify/products", token), env);
    expect(shop.status).toBe(403);
    expect(products.status).toBe(403);
    expect(await readJson(shop)).toEqual({ error: "shopify_not_linked" });
    expect(await readJson(products)).toEqual({ error: "shopify_not_linked" });
  });

  it("returns the shop from Admin REST 2026-04 without the token", async () => {
    const calls = mockShopify(200, {
      shop: { name: "Sunrise Demo", myshopify_domain: SHOP, id: 42 },
    });
    const { token, sealed, env } = await linkedEnv(SHOPIFY_TOKEN);
    const response = await worker.fetch(authed("/v1/shopify/shop", token), env);
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body).toEqual({
      shop: { name: "Sunrise Demo", myshopify_domain: SHOP, id: 42 },
    });
    assertNoSecret(body, sealed);
    expect(calls).toEqual([{ url: SHOP_URL, tokenHeader: SHOPIFY_TOKEN }]);
  });

  it("lists products with tip page bounds and a page_info cursor", async () => {
    const calls = mockShopify(
      200,
      { products: [{ id: 7, title: "Lamp" }] },
      `<https://${SHOP}/admin/api/2026-04/products.json?limit=10&page_info=cursor-next>; rel="next"`,
    );
    const { token, sealed, env } = await linkedEnv(SHOPIFY_TOKEN);
    const response = await worker.fetch(
      authed("/v1/shopify/products?page_size=10&page_token=cursor-1", token),
      env,
    );
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body).toEqual({
      products: [{ id: 7, title: "Lamp" }],
      next_page_token: "cursor-next",
    });
    assertNoSecret(body, sealed);
    expect(calls).toEqual([
      {
        url: `https://${SHOP}/admin/api/2026-04/products.json?limit=10&page_info=cursor-1`,
        tokenHeader: SHOPIFY_TOKEN,
      },
    ]);
  });

  it("defaults product page size to 25 and rejects a size outside 1 to 50 before calling Shopify", async () => {
    const calls = mockShopify(200, { products: [] });
    const { token, env } = await linkedEnv(SHOPIFY_TOKEN);
    const listed = await worker.fetch(authed("/v1/shopify/products", token), env);
    expect(listed.status).toBe(200);
    expect(await readJson(listed)).toEqual({ products: [] });
    expect(calls).toEqual([
      {
        url: `https://${SHOP}/admin/api/2026-04/products.json?limit=25`,
        tokenHeader: SHOPIFY_TOKEN,
      },
    ]);

    forbidFetch();
    const rejected = await worker.fetch(authed("/v1/shopify/products?page_size=51", token), env);
    expect(rejected.status).toBe(400);
    expect(await readJson(rejected)).toEqual({
      error: "invalid_request",
      message: "page_size must be an integer from 1 to 50.",
    });
  });

  it("maps Shopify 401, 403, and 429 without the upstream body", async () => {
    const { token, sealed, env } = await linkedEnv(SHOPIFY_TOKEN);
    const cases = [
      { status: 401, error: "shopify_unauthorized" },
      { status: 403, error: "shopify_forbidden" },
      { status: 429, error: "shopify_rate_limited" },
    ] as const;
    for (const item of cases) {
      mockShopify(item.status, { error: SHOPIFY_TOKEN, access_token: SHOPIFY_TOKEN, ct: sealed.ct });
      const response = await worker.fetch(authed("/v1/shopify/shop", token), env);
      expect(response.status, item.error).toBe(item.status);
      const body = await readJson(response);
      expect(body, item.error).toEqual({ error: item.error });
      assertNoSecret(body, sealed);
    }
  });

  it("returns grant_unreadable when the sealed token cannot be opened", async () => {
    forbidFetch();
    const { token, sealed, env } = await linkedEnv(null);
    const response = await worker.fetch(authed("/v1/shopify/shop", token), env);
    expect(response.status).toBe(500);
    const body = await readJson(response);
    expect(body).toEqual({ error: "grant_unreadable" });
    assertNoSecret(body, sealed);
  });
});
