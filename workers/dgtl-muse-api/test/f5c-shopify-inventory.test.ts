import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { sealRefreshToken } from "../src/seal";
import { MemoryKv, TEST_ENC_KEY, envWithGrant, envWithKv, issuedToken } from "./support";

const ORIGIN = "https://muse-api.dgtlsunrise.com";
const PREVIEW_PATH = "/v1/writes/preview";
const CONFIRM_PATH = "/v1/writes/confirm";
const SHOP = "sunrise-demo.myshopify.com";
const SHOPIFY_TOKEN = "shpat_test_not_a_real_token_0001";
const ITEM_GID = "gid://shopify/InventoryItem/808950810";
const LOCATION_GID = "gid://shopify/Location/655441491";
const RESULT_ITEM = "gid://shopify/InventoryItem/999";
const RESULT_LOCATION = "gid://shopify/Location/888";
const GRAPHQL_URL = `https://${SHOP}/admin/api/2026-04/graphql.json`;

const PREVIEW_BODY = {
  kind: "shopify_inventory_adjust",
  inventory_item_id: "808950810",
  location_id: "655441491",
  delta: -3,
  reason: "shrinkage",
  quantity_name: "on_hand",
};

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

function post(path: string, body: unknown, token?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== undefined) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function forbidFetch(): void {
  vi.stubGlobal("fetch", () => {
    throw new Error("shopify write must not call out");
  });
}

type SeenCall = {
  readonly url: string;
  readonly method: string;
  readonly tokenHeader: string | null;
  readonly body: unknown;
};

function mockShopify(status: number, body: unknown): SeenCall[] {
  const seen: SeenCall[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const raw = init?.body;
    seen.push({
      url: requestUrl(input),
      method: init?.method ?? "GET",
      tokenHeader: headers.get("x-shopify-access-token"),
      body: typeof raw === "string" ? JSON.parse(raw) : raw,
    });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return seen;
}

async function linkedKv(accessToken: string | null) {
  const kv = new MemoryKv();
  const issued = await issuedToken();
  const sealed =
    accessToken === null
      ? { alg: "A256GCM" as const, iv: "aaaaaaaaaaaa", ct: "ciphertext-not-a-token" }
      : await sealRefreshToken(accessToken, TEST_ENC_KEY);
  if (sealed === null) {
    throw new Error("seal failed");
  }
  const grant = {
    ...issued.grant,
    shopify: {
      shop: SHOP,
      access_token: sealed,
      linked_at: "2026-09-24T00:00:00.000Z",
    },
  };
  kv.records.set(issued.hash, { value: JSON.stringify(grant), expiresAtMs: null });
  return { token: issued.token, kv, sealed, grant };
}

function assertNoSecret(
  body: unknown,
  sealed: { iv: string; ct: string },
): void {
  const text = JSON.stringify(body);
  expect(text).not.toContain(SHOPIFY_TOKEN);
  expect(text).not.toContain(sealed.iv);
  expect(text).not.toContain(sealed.ct);
  expect(text).not.toContain("access_token");
}

describe("shopify inventory adjust", () => {
  it("fails closed when Shopify is not linked and does not call Shopify", async () => {
    forbidFetch();
    const { token, hash, grant } = await issuedToken();
    const response = await worker.fetch(post(PREVIEW_PATH, PREVIEW_BODY, token), envWithGrant(hash, grant));
    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({ error: "shopify_not_linked" });
  });

  it("previews without a mutate, refuses a phrase that misses the gids, then confirms", async () => {
    forbidFetch();
    const { token, kv, sealed, grant } = await linkedKv(SHOPIFY_TOKEN);
    const preview = await worker.fetch(post(PREVIEW_PATH, PREVIEW_BODY, token), envWithKv(kv));
    expect(preview.status).toBe(200);
    const previewBody = await readJson(preview);
    expect(previewBody).toMatchObject({
      status: "preview",
      confirm_required: true,
      kind: "shopify_inventory_adjust",
      resource_ids: [ITEM_GID, LOCATION_GID],
      summary: `Would adjust inventory item ${ITEM_GID} at ${LOCATION_GID} by -3 on ${SHOP}. Not executed.`,
    });
    assertNoSecret(previewBody, sealed);
    const previewId = previewBody["preview_id"];
    if (typeof previewId !== "string") {
      throw new Error("missing preview_id");
    }
    const storedRaw = kv.entries().get(`preview:${previewId}`);
    expect(JSON.parse(storedRaw ?? "null")).toEqual({
      kind: "shopify_inventory_adjust",
      grant_id: grant.grant_id,
      shop: SHOP,
      inventory_item_id: ITEM_GID,
      location_id: LOCATION_GID,
      delta: -3,
      reason: "shrinkage",
      quantity_name: "on_hand",
      resource_ids: [ITEM_GID, LOCATION_GID],
      summary: previewBody["summary"],
      expires_at: previewBody["expires_at"],
    });
    assertNoSecret(storedRaw, sealed);

    const refused = await worker.fetch(
      post(CONFIRM_PATH, { preview_id: previewId, confirm_phrase: "adjust 808950810 at 655441491" }, token),
      envWithKv(kv),
    );
    expect(refused.status).toBe(400);
    expect(await readJson(refused)).toEqual({ error: "confirm_refused", confirm_required: true });
    expect(kv.entries().has(`preview:${previewId}`)).toBe(true);

    const calls = mockShopify(200, {
      data: {
        inventoryAdjustQuantities: {
          userErrors: [],
          inventoryAdjustmentGroup: {
            changes: [
              {
                item: { id: RESULT_ITEM, sku: "LAMP" },
                location: { id: RESULT_LOCATION, name: "Main" },
              },
            ],
          },
        },
      },
    });
    const confirmed = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: `adjust ${ITEM_GID} at ${LOCATION_GID}` },
        token,
      ),
      envWithKv(kv),
    );
    expect(confirmed.status).toBe(200);
    const confirmedBody = await readJson(confirmed);
    expect(confirmedBody).toEqual({
      status: "confirmed",
      preview_id: previewId,
      kind: "shopify_inventory_adjust",
      executed: true,
      inventory_item_id: RESULT_ITEM,
      location_id: RESULT_LOCATION,
    });
    assertNoSecret(confirmedBody, sealed);
    expect(kv.entries().has(`preview:${previewId}`)).toBe(false);
    expect(calls).toEqual([
      {
        url: GRAPHQL_URL,
        method: "POST",
        tokenHeader: SHOPIFY_TOKEN,
        body: {
          query: expect.stringContaining("inventoryAdjustQuantities(input: $input)"),
          operationName: "InventoryAdjust",
          variables: {
            input: {
              reason: "shrinkage",
              name: "on_hand",
              changes: [{ inventoryItemId: ITEM_GID, locationId: LOCATION_GID, delta: -3 }],
            },
          },
        },
      },
    ]);
  });

  it("stores tip defaults for reason and quantity name and does not call Shopify", async () => {
    forbidFetch();
    const { token, kv, sealed } = await linkedKv(SHOPIFY_TOKEN);
    const response = await worker.fetch(
      post(
        PREVIEW_PATH,
        {
          kind: "shopify_inventory_adjust",
          inventory_item_id: ITEM_GID,
          location_id: LOCATION_GID,
          delta: 4,
        },
        token,
      ),
      envWithKv(kv),
    );
    expect(response.status).toBe(200);
    const body = await readJson(response);
    const previewId = body["preview_id"];
    const storedRaw = kv.entries().get(`preview:${previewId}`);
    expect(JSON.parse(storedRaw ?? "null")).toMatchObject({
      reason: "correction",
      quantity_name: "available",
      delta: 4,
      shop: SHOP,
    });
    assertNoSecret(body, sealed);
    assertNoSecret(storedRaw, sealed);
  });

  it("maps Shopify 401, 403, and 429 without the upstream body and keeps the preview", async () => {
    const { token, kv, sealed } = await linkedKv(SHOPIFY_TOKEN);
    forbidFetch();
    const preview = await worker.fetch(post(PREVIEW_PATH, PREVIEW_BODY, token), envWithKv(kv));
    const previewBody = await readJson(preview);
    const previewId = previewBody["preview_id"];
    if (typeof previewId !== "string") {
      throw new Error("missing preview_id");
    }
    const cases = [
      { status: 401, error: "shopify_unauthorized" },
      { status: 403, error: "shopify_forbidden" },
      { status: 429, error: "shopify_rate_limited" },
    ] as const;
    for (const item of cases) {
      mockShopify(item.status, {
        error: SHOPIFY_TOKEN,
        access_token: SHOPIFY_TOKEN,
        ct: sealed.ct,
      });
      const response = await worker.fetch(
        post(
          CONFIRM_PATH,
          { preview_id: previewId, confirm_phrase: `${ITEM_GID} ${LOCATION_GID}` },
          token,
        ),
        envWithKv(kv),
      );
      expect(response.status, item.error).toBe(item.status);
      const body = await readJson(response);
      expect(body, item.error).toEqual({ error: item.error });
      assertNoSecret(body, sealed);
      expect(kv.entries().has(`preview:${previewId}`)).toBe(true);
    }
  });
});
