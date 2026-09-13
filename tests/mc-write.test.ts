import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { ToolError } from "../src/errors.js";
import { googleMcWritePathAllowed } from "../src/http/google-mc-write.js";
import { CONSENT_A, CONSENT_MC, SCOPE } from "../src/google/scopes.js";
import * as S from "../src/tools/schemas.js";
import { dispatch } from "../src/tools/dispatch.js";
import {
  CONSENT_A_TOOLS,
  LICENSE_GATED_TOOLS,
  LOCAL_FREE_TOOLS,
  MC_WRITE_TOOL_NAMES,
  TOOLS,
} from "../src/tools/registry.js";
import { installNetworkGuard, makeCtx, ROOT, signLicense, testEnv, TEST_TOKEN } from "./helpers.js";

const MERCHANT = "123456789";
const DATA_SOURCE = "accounts/123456789/dataSources/111";
const WRITE_TOOLS = [
  "mc_create_data_source",
  "mc_upsert_product_input",
  "mc_delete_product_input",
  "mc_fetch_data_source",
] as const;

function adsLicenseEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const jwt = signLicense({
    sub: "user_test",
    features: ["ads", "meta"],
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "jti-wave14-mc-write",
  });
  return testEnv({
    DGTL_LICENSE_JWT: jwt,
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    GOOGLE_MC_ACCESS_TOKEN: "mc-user-token-fixture",
    GOOGLE_MC_GRANTED_SCOPES: SCOPE.content,
    ...extra,
  });
}

function writeEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return adsLicenseEnv({ DGTL_WRITES_ENABLED: "true", ...extra });
}

describe("Wave 14 Merchant API ProductInput writes (Consent MC)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("write tools are registered, Polar-gated, not Consent A", () => {
    assert.deepEqual([...MC_WRITE_TOOL_NAMES].sort(), [...WRITE_TOOLS].sort());
    for (const name of WRITE_TOOLS) {
      const t = TOOLS.find((x) => x.name === name);
      assert.ok(t, name);
      assert.equal(t!.family, "mc", name);
      assert.equal(t!.group, "mc-write", name);
      assert.equal(t!.annotations.readOnlyHint, false, name);
      assert.ok(LICENSE_GATED_TOOLS.includes(name), name);
      assert.ok(!CONSENT_A_TOOLS.includes(name), name);
      assert.ok(!LOCAL_FREE_TOOLS.includes(name), name);
      assert.ok(!/confirm_phrase\s*=/.test(t!.description), name);
    }
    const del = TOOLS.find((t) => t.name === "mc_delete_product_input");
    assert.equal(del?.annotations.destructiveHint, true);
    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8")) as {
      tools: Array<{ name: string }>;
      gated_tools: Array<{ name: string; fail: string }>;
    };
    for (const name of WRITE_TOOLS) {
      assert.ok(!catalog.tools.some((t) => t.name === name), name);
      const g = catalog.gated_tools.find((t) => t.name === name);
      assert.ok(g, name);
      assert.equal(g!.fail, "LICENSE_REQUIRED", name);
    }
  });

  it("Consent A ∩ content is still empty", () => {
    assert.ok(!(CONSENT_A as readonly string[]).includes(SCOPE.content));
    assert.deepEqual([...CONSENT_MC], [SCOPE.content]);
  });

  it("Wave 15+ MC / GSC tools stay unregistered", () => {
    for (const name of [
      "mc_mutate",
      "mc_insert_product",
      "mc_delete_data_source",
      "mc_update_data_source",
      "mc_insert_promotion",
      "mc_insert_product_review",
      "gsc_add_site",
      "gsc_delete_site",
      "gsc_request_indexing",
    ]) {
      assert.ok(!TOOLS.some((t) => t.name === name), name);
    }
  });

  it("schemas default dry_run true; insert requires data_source; live needs confirm", () => {
    const parsed = S.mcUpsertProductInput.parse({
      merchant_id: MERCHANT,
      data_source: DATA_SOURCE,
      offer_id: "SKU12345",
      content_language: "en",
      feed_label: "US",
    });
    assert.equal(parsed.dry_run, true);
    const missingDs = S.mcUpsertProductInput.safeParse({
      merchant_id: MERCHANT,
      offer_id: "SKU12345",
      content_language: "en",
      feed_label: "US",
    });
    assert.equal(missingDs.success, false);
    const liveMissing = S.mcDeleteProductInput.safeParse({
      merchant_id: MERCHANT,
      data_source: DATA_SOURCE,
      product_id: "en~US~SKU12345",
      dry_run: false,
    });
    assert.equal(liveMissing.success, false);
  });

  it("path allowlist is closed (ProductInput + API data source only)", () => {
    assert.equal(googleMcWritePathAllowed("POST", "/datasources/v1/accounts/123456789/dataSources"), true);
    assert.equal(
      googleMcWritePathAllowed("POST", "/datasources/v1/accounts/123456789/dataSources/111:fetch"),
      true,
    );
    assert.equal(
      googleMcWritePathAllowed("POST", "/products/v1/accounts/123456789/productInputs:insert"),
      true,
    );
    assert.equal(
      googleMcWritePathAllowed("PATCH", "/products/v1/accounts/123456789/productInputs/en~US~SKU12345"),
      true,
    );
    assert.equal(
      googleMcWritePathAllowed("DELETE", "/products/v1/accounts/123456789/productInputs/en~US~SKU12345"),
      true,
    );
    assert.equal(googleMcWritePathAllowed("POST", "/products/v1/accounts/123456789/products"), false);
    assert.equal(googleMcWritePathAllowed("DELETE", "/datasources/v1/accounts/123456789/dataSources/111"), false);
    assert.equal(googleMcWritePathAllowed("PATCH", "/datasources/v1/accounts/123456789/dataSources/111"), false);
    assert.equal(googleMcWritePathAllowed("POST", "/accounts/v1/accounts"), false);
  });

  it("read GoogleHttp still refuses Merchant mutate", async () => {
    const ctx = makeCtx({}, writeEnv());
    await assert.rejects(
      () =>
        ctx.httpMc.post(
          "merchantapi.googleapis.com",
          "/products/v1/accounts/123456789/productInputs:insert",
          {},
          { api: "merchantapi.googleapis.com/products/v1", tool: "mc_upsert_product_input" },
        ),
      (err: unknown) => err instanceof ToolError && err.error_code === "UNSUPPORTED_OPERATION",
    );
    assert.equal(ctx.calls.length, 0);
  });

  it("missing merchant_id → RESOURCE_REQUIRED zero hop (never guess)", async () => {
    const ctx = makeCtx({}, writeEnv());
    const env = await dispatch(ctx, "mc_upsert_product_input", {
      data_source: DATA_SOURCE,
      offer_id: "SKU12345",
      content_language: "en",
      feed_label: "US",
    });
    assert.equal(env.error_code, "RESOURCE_REQUIRED");
    assert.ok(String(env.resource_id ?? env.hint ?? env.message).includes("merchant_id"));
    assert.equal(ctx.calls.length, 0);
  });

  it("insert without data_source → RESOURCE_REQUIRED zero hop", async () => {
    const ctx = makeCtx({}, writeEnv());
    const env = await dispatch(ctx, "mc_upsert_product_input", {
      merchant_id: MERCHANT,
      offer_id: "SKU12345",
      content_language: "en",
      feed_label: "US",
    });
    assert.equal(env.error_code, "RESOURCE_REQUIRED");
    assert.ok(String(env.resource_id ?? env.hint ?? env.message).includes("data_source"));
    assert.equal(ctx.calls.length, 0);
  });

  it("no license → LICENSE_REQUIRED; never uses Consent A; zero hop", async () => {
    const ctx = makeCtx({}, testEnv({ DGTL_LICENSE_JWT: "", GOOGLE_ACCESS_TOKEN: TEST_TOKEN }));
    let authCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "mc_upsert_product_input", {
      merchant_id: MERCHANT,
      data_source: DATA_SOURCE,
      offer_id: "SKU1",
      content_language: "en",
      feed_label: "US",
    });
    assert.equal(env.error_code, "LICENSE_REQUIRED");
    assert.equal(authCalls, 0);
    assert.equal(ctx.calls.length, 0);
  });

  it("dry_run create / upsert / delete / fetch is zero HTTP", async () => {
    const cases: Array<{ tool: string; args: Record<string, unknown> }> = [
      {
        tool: "mc_create_data_source",
        args: { merchant_id: MERCHANT, display_name: "API primary (Shopping)" },
      },
      {
        tool: "mc_upsert_product_input",
        args: {
          merchant_id: MERCHANT,
          data_source: DATA_SOURCE,
          offer_id: "SKU12345",
          content_language: "en",
          feed_label: "US",
          title: "Classic Cotton T-Shirt",
          link: "https://example.com/sku12345",
          image_link: "https://example.com/sku12345.jpg",
          availability: "IN_STOCK",
          price_micros: "15990000",
          currency: "USD",
        },
      },
      {
        tool: "mc_delete_product_input",
        args: { merchant_id: MERCHANT, data_source: DATA_SOURCE, product_id: "en~US~SKU12345" },
      },
      {
        tool: "mc_fetch_data_source",
        args: { merchant_id: MERCHANT, data_source: "111" },
      },
    ];
    for (const row of cases) {
      const ctx = makeCtx({}, adsLicenseEnv());
      const env = await dispatch(ctx, row.tool, row.args);
      assert.equal(env.ok, true, JSON.stringify(env));
      assert.equal((env.data as { dry_run: boolean }).dry_run, true);
      assert.equal(ctx.calls.length, 0, row.tool);
    }
  });

  it("live mutate without merchant_id in confirm → INVALID_ARGUMENT", async () => {
    const ctx = makeCtx({}, writeEnv());
    const env = await dispatch(ctx, "mc_upsert_product_input", {
      merchant_id: MERCHANT,
      data_source: DATA_SOURCE,
      offer_id: "SKU12345",
      content_language: "en",
      feed_label: "US",
      dry_run: false,
      confirm_phrase: "yes upload the catalog",
    });
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.ok(String(env.message).includes(MERCHANT));
    assert.equal(ctx.calls.length, 0);
  });

  it("live without writes flag → WRITE_NOT_ENABLED zero hop", async () => {
    const ctx = makeCtx({}, adsLicenseEnv());
    const env = await dispatch(ctx, "mc_create_data_source", {
      merchant_id: MERCHANT,
      display_name: "API primary (Shopping)",
      dry_run: false,
      confirm_phrase: `create on ${MERCHANT}`,
    });
    assert.equal(env.error_code, "WRITE_NOT_ENABLED");
    assert.equal(ctx.calls.length, 0);
  });

  it("live without Consent MC → MC_NOT_CONNECTED; never uses Consent A", async () => {
    const ctx = makeCtx(
      {},
      writeEnv({ GOOGLE_MC_ACCESS_TOKEN: "", GOOGLE_MC_GRANTED_SCOPES: "" }),
    );
    let aCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      aCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "mc_upsert_product_input", {
      merchant_id: MERCHANT,
      data_source: DATA_SOURCE,
      offer_id: "SKU12345",
      content_language: "en",
      feed_label: "US",
      dry_run: false,
      confirm_phrase: `upsert ${MERCHANT}`,
    });
    assert.equal(env.error_code, "MC_NOT_CONNECTED");
    assert.equal(aCalls, 0);
    assert.equal(ctx.calls.length, 0);
  });

  it("live insert hops ProductInput:insert with dataSource query (not processed Product)", async () => {
    const ctx = makeCtx({}, writeEnv());
    const env = await dispatch(ctx, "mc_upsert_product_input", {
      merchant_id: MERCHANT,
      data_source: DATA_SOURCE,
      offer_id: "SKU12345",
      content_language: "en",
      feed_label: "US",
      title: "Classic Cotton T-Shirt",
      link: "https://example.com/sku12345",
      image_link: "https://example.com/sku12345.jpg",
      availability: "IN_STOCK",
      price_micros: 15990000,
      currency: "USD",
      dry_run: false,
      confirm_phrase: `upsert inventory on ${MERCHANT}`,
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal((env.data as { dry_run: boolean }).dry_run, false);
    assert.equal(ctx.calls.length, 1);
    assert.equal(ctx.calls[0]?.host, "merchantapi.googleapis.com");
    assert.equal(ctx.calls[0]?.method, "POST");
    assert.equal(ctx.calls[0]?.path, "/products/v1/accounts/123456789/productInputs:insert");
    const search = decodeURIComponent(String(ctx.calls[0]?.search ?? ""));
    assert.ok(search.includes("dataSource="));
    assert.ok(search.includes("accounts/123456789/dataSources/111"));
    assert.ok(!ctx.calls[0]?.path.endsWith("/products"));
    assert.equal(ctx.calls[0]?.hasDeveloperToken, false);
    const data = env.data as { product_input?: { offerId?: string } };
    assert.equal(data.product_input?.offerId, "SKU12345");
  });

  it("live patch uses update_mask + ProductInput path", async () => {
    const ctx = makeCtx({}, writeEnv());
    const env = await dispatch(ctx, "mc_upsert_product_input", {
      merchant_id: "accounts/123456789",
      data_source: "111",
      product_id: "en~US~SKU12345",
      update_mask: "availability,price",
      availability: "OUT_OF_STOCK",
      price_micros: "12990000",
      currency: "USD",
      dry_run: false,
      confirm_phrase: `patch ${MERCHANT}`,
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal(ctx.calls[0]?.method, "PATCH");
    assert.equal(ctx.calls[0]?.path, "/products/v1/accounts/123456789/productInputs/en~US~SKU12345");
    assert.ok(String(ctx.calls[0]?.search).includes("updateMask="));
    assert.ok(String(ctx.calls[0]?.search).includes("dataSource="));
  });

  it("live create data source + delete + fetch fixtures", async () => {
    const ctx = makeCtx({}, writeEnv());
    const created = await dispatch(ctx, "mc_create_data_source", {
      merchant_id: MERCHANT,
      display_name: "API primary (Shopping)",
      feed_label: "US",
      content_language: "en",
      countries: ["US"],
      dry_run: false,
      confirm_phrase: `create API source ${MERCHANT}`,
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal((created.data as { data_source?: { input?: string } }).data_source?.input, "API");

    const deleted = await dispatch(ctx, "mc_delete_product_input", {
      merchant_id: MERCHANT,
      data_source: DATA_SOURCE,
      product_id: "en~US~SKU12345",
      dry_run: false,
      confirm_phrase: `delete input ${MERCHANT}`,
    });
    assert.equal(deleted.ok, true, JSON.stringify(deleted));
    assert.equal((deleted.data as { deleted?: boolean }).deleted, true);

    const fetched = await dispatch(ctx, "mc_fetch_data_source", {
      merchant_id: MERCHANT,
      data_source: "222",
      dry_run: false,
      confirm_phrase: `fetch ${MERCHANT}`,
    });
    assert.equal(fetched.ok, true, JSON.stringify(fetched));

    const hops = ctx.calls.filter((c) => c.host === "merchantapi.googleapis.com");
    assert.ok(hops.some((c) => c.method === "POST" && c.path === "/datasources/v1/accounts/123456789/dataSources"));
    assert.ok(hops.some((c) => c.method === "DELETE" && c.path.includes("/productInputs/")));
    assert.ok(hops.some((c) => c.method === "POST" && c.path.endsWith(":fetch")));
    assert.ok(hops.every((c) => !c.hasDeveloperToken));
  });

  it("data_source / merchant_id mismatch is INVALID_ARGUMENT zero hop", async () => {
    const ctx = makeCtx({}, writeEnv());
    const env = await dispatch(ctx, "mc_upsert_product_input", {
      merchant_id: MERCHANT,
      data_source: "accounts/999/dataSources/111",
      offer_id: "SKU1",
      content_language: "en",
      feed_label: "US",
    });
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(ctx.calls.length, 0);
  });

  it("fileInput create is refused (API-type only)", async () => {
    const ctx = makeCtx({}, writeEnv());
    const env = await dispatch(ctx, "mc_create_data_source", {
      merchant_id: MERCHANT,
      display_name: "File feed",
      file_name: "products.txt",
    });
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(ctx.calls.length, 0);
  });
});
