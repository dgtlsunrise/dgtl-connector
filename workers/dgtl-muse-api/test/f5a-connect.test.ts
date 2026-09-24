import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { openRefreshToken } from "../src/seal";
import { MemoryKv, TEST_ENC_KEY, envWithKv, issuedToken } from "./support";

const ORIGIN = "https://muse-api.dgtlsunrise.com";
const SHOP = "sunrise-demo.myshopify.com";
const SHOPIFY_TOKEN = "shpat_test_not_a_real_token_0001";
const KLAVIYO_KEY = "pk_test_not_a_real_key_0001";

afterEach(() => {
  vi.unstubAllGlobals();
});

function forbidFetch(): void {
  vi.stubGlobal("fetch", () => {
    throw new Error("connect must not call out");
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("expected a JSON object");
  }
  return body as Record<string, unknown>;
}

function keysOf(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      keysOf(item, found);
    }
    return found;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      found.push(key);
      keysOf(child, found);
    }
  }
  return found;
}

function assertPublic(body: unknown, sealed: readonly string[]): void {
  const text = JSON.stringify(body);
  expect(text).not.toContain(SHOPIFY_TOKEN);
  expect(text).not.toContain(KLAVIYO_KEY);
  for (const secret of sealed) {
    expect(text).not.toContain(secret);
  }
  const keys = keysOf(body);
  expect(keys).not.toContain("access_token");
  expect(keys).not.toContain("api_key");
  expect(keys).not.toContain("ct");
  expect(keys).not.toContain("iv");
  expect(keys).not.toContain("alg");
}

function authed(pathname: string, method: string, token: string, body?: unknown): Request {
  const headers = new Headers({ authorization: `Bearer ${token}` });
  if (body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return new Request(`${ORIGIN}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedGrant(raw?: string): Promise<{ token: string; hash: string; kv: MemoryKv }> {
  const issued = await issuedToken();
  const kv = new MemoryKv();
  kv.records.set(issued.hash, {
    value: raw ?? JSON.stringify(issued.grant),
    expiresAtMs: null,
  });
  return { token: issued.token, hash: issued.hash, kv };
}

function storedGrant(kv: MemoryKv, hash: string): Record<string, unknown> {
  const raw = kv.entries().get(hash);
  if (raw === undefined) {
    throw new Error("missing grant");
  }
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("grant is not an object");
  }
  return parsed as Record<string, unknown>;
}

describe("shopify and klaviyo connect", () => {
  it("links, reports status, and unlinks without returning secrets", async () => {
    forbidFetch();
    const { token, hash, kv } = await seedGrant();
    const env = envWithKv(kv);

    const before = await worker.fetch(authed("/v1/connect", "GET", token), env);
    expect(before.status).toBe(200);
    const beforeBody = await readJson(before);
    expect(beforeBody).toEqual({ shopify: null, klaviyo: null });
    assertPublic(beforeBody, []);

    const badShop = await worker.fetch(
      authed("/v1/connect/shopify", "POST", token, {
        shop: "https://sunrise-demo.myshopify.com/admin",
        access_token: SHOPIFY_TOKEN,
      }),
      env,
    );
    expect(badShop.status).toBe(400);
    const badShopBody = await readJson(badShop);
    expect(badShopBody).toEqual({ error: "invalid_shop" });
    assertPublic(badShopBody, []);
    expect(storedGrant(kv, hash)["shopify"]).toBeNull();

    const linkedShop = await worker.fetch(
      authed("/v1/connect/shopify", "POST", token, {
        shop: "Sunrise-Demo.myshopify.com",
        access_token: SHOPIFY_TOKEN,
      }),
      env,
    );
    expect(linkedShop.status).toBe(200);
    const linkedShopBody = await readJson(linkedShop);
    expect(linkedShopBody).toEqual({ connected: true, shop: SHOP });
    const shopRecord = storedGrant(kv, hash)["shopify"];
    if (shopRecord === null || typeof shopRecord !== "object" || Array.isArray(shopRecord)) {
      throw new Error("shopify link missing");
    }
    const sealedShop = shopRecord as { access_token?: { iv?: string; ct?: string } };
    const shopCt = sealedShop.access_token?.ct;
    const shopIv = sealedShop.access_token?.iv;
    if (shopCt === undefined || shopIv === undefined) {
      throw new Error("shopify seal missing");
    }
    expect(JSON.stringify(storedGrant(kv, hash))).not.toContain(SHOPIFY_TOKEN);
    expect(await openRefreshToken({ alg: "A256GCM", iv: shopIv, ct: shopCt }, TEST_ENC_KEY)).toBe(
      SHOPIFY_TOKEN,
    );
    assertPublic(linkedShopBody, [shopCt, shopIv]);

    const afterShop = await worker.fetch(authed("/v1/connect", "GET", token), env);
    expect(afterShop.status).toBe(200);
    const afterShopBody = await readJson(afterShop);
    expect(afterShopBody).toEqual({ shopify: "linked", klaviyo: null });
    assertPublic(afterShopBody, [shopCt, shopIv]);

    const badKey = await worker.fetch(
      authed("/v1/connect/klaviyo", "POST", token, { api_key: "sk_not_a_private_key" }),
      env,
    );
    expect(badKey.status).toBe(400);
    expect(await readJson(badKey)).toEqual({ error: "invalid_klaviyo_credential" });
    expect(storedGrant(kv, hash)["klaviyo"]).toBeNull();

    const linkedKey = await worker.fetch(
      authed("/v1/connect/klaviyo", "POST", token, { api_key: KLAVIYO_KEY }),
      env,
    );
    expect(linkedKey.status).toBe(200);
    const linkedKeyBody = await readJson(linkedKey);
    expect(linkedKeyBody).toEqual({ connected: true });
    const keyRecord = storedGrant(kv, hash)["klaviyo"];
    if (keyRecord === null || typeof keyRecord !== "object" || Array.isArray(keyRecord)) {
      throw new Error("klaviyo link missing");
    }
    const sealedKey = keyRecord as {
      account_id?: unknown;
      api_key?: { iv?: string; ct?: string };
    };
    expect(sealedKey.account_id).toBeNull();
    const keyCt = sealedKey.api_key?.ct;
    const keyIv = sealedKey.api_key?.iv;
    if (keyCt === undefined || keyIv === undefined) {
      throw new Error("klaviyo seal missing");
    }
    expect(JSON.stringify(storedGrant(kv, hash))).not.toContain(KLAVIYO_KEY);
    expect(await openRefreshToken({ alg: "A256GCM", iv: keyIv, ct: keyCt }, TEST_ENC_KEY)).toBe(
      KLAVIYO_KEY,
    );
    assertPublic(linkedKeyBody, [shopCt, shopIv, keyCt, keyIv]);

    const both = await worker.fetch(authed("/v1/connect", "GET", token), env);
    const bothBody = await readJson(both);
    expect(bothBody).toEqual({ shopify: "linked", klaviyo: "linked" });
    assertPublic(bothBody, [shopCt, shopIv, keyCt, keyIv]);

    const dropShop = await worker.fetch(authed("/v1/connect/shopify", "DELETE", token), env);
    expect(dropShop.status).toBe(200);
    const dropShopBody = await readJson(dropShop);
    expect(dropShopBody).toEqual({ connected: false });
    assertPublic(dropShopBody, [shopCt, shopIv, keyCt, keyIv]);
    expect(storedGrant(kv, hash)["shopify"]).toBeNull();
    expect(storedGrant(kv, hash)["klaviyo"]).not.toBeNull();

    const shopGone = await worker.fetch(authed("/v1/connect", "GET", token), env);
    expect(await readJson(shopGone)).toEqual({ shopify: null, klaviyo: "linked" });

    const dropKey = await worker.fetch(authed("/v1/connect/klaviyo", "DELETE", token), env);
    expect(dropKey.status).toBe(200);
    expect(await readJson(dropKey)).toEqual({ connected: false });
    const again = await worker.fetch(authed("/v1/connect/klaviyo", "DELETE", token), env);
    expect(again.status).toBe(200);
    expect(await readJson(again)).toEqual({ connected: false });
    expect(await readJson(await worker.fetch(authed("/v1/connect", "GET", token), env))).toEqual({
      shopify: null,
      klaviyo: null,
    });
  });

  it("rejects an empty Shopify token and a non-myshopify host", async () => {
    forbidFetch();
    const { token, hash, kv } = await seedGrant();
    const env = envWithKv(kv);
    const emptyToken = await worker.fetch(
      authed("/v1/connect/shopify", "POST", token, {
        shop: SHOP,
        access_token: "",
      }),
      env,
    );
    expect(emptyToken.status).toBe(400);
    expect(await readJson(emptyToken)).toEqual({ error: "invalid_shopify_credential" });
    const otherHost = await worker.fetch(
      authed("/v1/connect/shopify", "POST", token, {
        shop: "sunrise-demo.example.com",
        access_token: SHOPIFY_TOKEN,
      }),
      env,
    );
    expect(otherHost.status).toBe(400);
    expect(await readJson(otherHost)).toEqual({ error: "invalid_shop" });
    expect(storedGrant(kv, hash)["shopify"]).toBeNull();
    expect(JSON.stringify(storedGrant(kv, hash))).not.toContain(SHOPIFY_TOKEN);
  });

  it("keeps an existing Google link and reads older grants that omit the new fields", async () => {
    forbidFetch();
    const issued = await issuedToken();
    const legacy = {
      v: 1,
      grant_id: issued.grant.grant_id,
      created_at: issued.grant.created_at,
      status: "active",
      google: {
        sub: "1001",
        email: "ada@example.com",
        scopes: ["openid"],
        refresh_token: { alg: "A256GCM", iv: "aXY", ct: "Y3Q" },
        linked_at: "2026-09-24T00:00:00.000Z",
      },
    };
    const kv = new MemoryKv();
    kv.records.set(issued.hash, { value: JSON.stringify(legacy), expiresAtMs: null });
    const env = envWithKv(kv);
    const status = await worker.fetch(authed("/v1/connect", "GET", issued.token), env);
    expect(await readJson(status)).toEqual({ shopify: null, klaviyo: null });

    const linked = await worker.fetch(
      authed("/v1/connect/shopify", "POST", issued.token, {
        shop: SHOP,
        access_token: SHOPIFY_TOKEN,
      }),
      env,
    );
    expect(linked.status).toBe(200);
    const grant = storedGrant(kv, issued.hash);
    expect(grant["google"]).toEqual(legacy.google);
    expect(grant["klaviyo"]).toBeNull();
  });
});
