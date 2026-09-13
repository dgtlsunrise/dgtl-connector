import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  destinationWriteTool,
  isShopifyKlaviyoCompoundId,
  mapCatalogFanOut,
} from "../src/catalog/fan-out.js";
import { ToolError } from "../src/errors.js";
import { TOOLS } from "../src/tools/registry.js";
import { ROOT } from "./helpers.js";

const FIX = JSON.parse(
  readFileSync(join(ROOT, "fixtures/catalog/fan-out.three-products.json"), "utf8"),
) as {
  merchant_id: string;
  data_source: string;
  ad_account_id: string;
  meta_catalog_id: string;
  tiktok_advertiser_id: string;
  tiktok_catalog_id: string;
  products: Array<{
    id: string;
    title: string;
    handle?: string;
    sku?: string;
    description?: string;
    vendor?: string;
    product_type?: string;
    gtin?: string;
    image?: string;
    link?: string;
    price?: string;
    currency?: string;
    availability?: string;
  }>;
};

describe("Wave 19 catalog fan-out mapping", () => {
  it("registers catalog-fan-out skill and no mega upsert-all tool", () => {
    const skill = readFileSync(join(ROOT, "skills/catalog-fan-out/SKILL.md"), "utf8");
    assert.ok(skill.includes("name: catalog-fan-out"));
    assert.ok(skill.includes("mc_upsert_product_input"));
    assert.ok(skill.includes("meta_catalog_items_batch"));
    assert.ok(skill.includes("tiktok_upload_catalog_products"));
    assert.ok(skill.includes("klaviyo_upsert_catalog_items"));
    assert.ok(skill.includes("each destination"));
    assert.ok(skill.includes("$shopify:::"));
    assert.ok(skill.includes("Refuse unnamed"));
    assert.equal(
      TOOLS.some((t) => /upsert_all|fan_out_live|catalog_upsert_all/i.test(t.name)),
      false,
    );
  });

  it("destinationWriteTool is exhaustive and names existing closed tools", () => {
    assert.equal(destinationWriteTool("google"), "mc_upsert_product_input");
    assert.equal(destinationWriteTool("meta"), "meta_catalog_items_batch");
    assert.equal(destinationWriteTool("tiktok"), "tiktok_upload_catalog_products");
    assert.equal(destinationWriteTool("klaviyo"), "klaviyo_upsert_catalog_items");
    for (const name of [
      "mc_upsert_product_input",
      "meta_catalog_items_batch",
      "tiktok_upload_catalog_products",
      "klaviyo_upsert_catalog_items",
    ]) {
      assert.ok(TOOLS.some((t) => t.name === name), name);
    }
  });

  it("three-product story: Google omits missing GTIN and missing image; valid row stays", () => {
    const mapped = mapCatalogFanOut({
      products: FIX.products,
      destinations: {
        google: { merchant_id: FIX.merchant_id, data_source: FIX.data_source },
        meta: { ad_account_id: FIX.ad_account_id, catalog_id: FIX.meta_catalog_id },
        tiktok: { advertiser_id: FIX.tiktok_advertiser_id, catalog_id: FIX.tiktok_catalog_id },
        klaviyo: true,
      },
    });

    assert.deepEqual(
      mapped.google.items.map((row) => row.offer_id),
      ["MUG-OK-1"],
    );
    assert.equal(mapped.google.items[0]?.merchant_id, "5473821");
    assert.equal(mapped.google.items[0]?.gtin, "0789152123456");
    assert.equal(mapped.google.items[0]?.image_link, "https://cdn.example.com/sunrise-mug.jpg");
    assert.ok(!mapped.google.items.some((row) => row.offer_id === "TOTE-NO-GTIN"));
    assert.ok(!mapped.google.items.some((row) => row.offer_id === "BEANIE-NO-IMG"));
    assert.deepEqual(
      mapped.google.omitted.map((row) => `${row.sku}:${row.reason}`).sort(),
      ["BEANIE-NO-IMG:missing_image", "TOTE-NO-GTIN:missing_gtin"],
    );

    assert.deepEqual(
      mapped.meta.items.map((row) => row.retailer_id).sort(),
      ["MUG-OK-1", "TOTE-NO-GTIN"],
    );
    assert.ok(mapped.meta.omitted.some((row) => row.sku === "BEANIE-NO-IMG" && row.reason === "missing_image"));

    assert.deepEqual(
      mapped.tiktok.items.map((row) => row.sku_id).sort(),
      ["MUG-OK-1", "TOTE-NO-GTIN"],
    );
    assert.ok(mapped.tiktok.omitted.some((row) => row.sku === "BEANIE-NO-IMG" && row.reason === "missing_image"));

    assert.deepEqual(
      mapped.klaviyo.items.map((row) => row.external_id).sort(),
      ["BEANIE-NO-IMG", "MUG-OK-1", "TOTE-NO-GTIN"],
    );
    assert.equal(
      mapped.klaviyo.items.some((row) => isShopifyKlaviyoCompoundId(row.external_id)),
      false,
    );
    assert.equal(mapped.invented_shopify_klaviyo_ids, false);
    const blob = JSON.stringify(mapped);
    assert.equal(blob.includes("$shopify:::"), false);
  });

  it("isolation: refuse unnamed merchant_id", () => {
    for (const merchant_id of [undefined, "", "default", "first", "0"]) {
      assert.throws(
        () =>
          mapCatalogFanOut({
            products: FIX.products,
            destinations: { google: { merchant_id } },
          }),
        (err: unknown) => err instanceof ToolError && err.error_code === "RESOURCE_REQUIRED",
      );
    }
  });

  it("refuses invented $shopify:::$default::: ids", () => {
    assert.throws(
      () =>
        mapCatalogFanOut({
          products: [
            {
              id: "$shopify:::$default:::9003",
              title: "Bad",
              sku: "X",
              link: "https://example.com/p",
              image: "https://example.com/i.jpg",
              price: "1.00",
              gtin: "012345678905",
            },
          ],
          destinations: { klaviyo: true },
        }),
      (err: unknown) => err instanceof ToolError && err.error_code === "UNSUPPORTED_OPERATION",
    );
  });
});
