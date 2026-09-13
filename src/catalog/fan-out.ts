/**
 * Wave 19 catalog fan-out mapper (skill-backed, not a mega upsert-all tool).
 * Maps Shopify product rows → proposed MC / Meta / TikTok / Klaviyo payloads.
 * Per-network validation: Google omits invalid rows (missing GTIN / missing image).
 * Isolation: unnamed merchant_id is RESOURCE_REQUIRED. Never invent $shopify:::$default::: ids.
 * Live writes still go through each destination's named tool + write grant.
 */
import { MSG, ToolError } from "../errors.js";
import { normalizeMerchantId, requireId } from "../ids.js";

export const SHOPIFY_KLAVIYO_ID_PREFIX = "$shopify:::";
export const CUSTOM_KLAVIYO_ID_PREFIX = "$custom:::$default:::";

export type FanOutNetwork = "google" | "meta" | "tiktok" | "klaviyo";

export type ShopifyFanOutProduct = {
  id: string;
  title: string;
  handle?: string;
  sku?: string;
  description?: string;
  vendor?: string;
  product_type?: string;
  gtin?: string;
  mpn?: string;
  image?: string;
  link?: string;
  price?: string;
  currency?: string;
  availability?: string;
};

export type FanOutOmission = {
  product_id: string;
  sku?: string;
  reason: FanOutOmitReason;
  network: FanOutNetwork;
};

export type FanOutOmitReason =
  | "missing_gtin"
  | "missing_image"
  | "missing_sku"
  | "missing_title"
  | "missing_link"
  | "missing_price"
  | "http_not_https";

export type GoogleFanOutItem = {
  merchant_id: string;
  data_source?: string;
  offer_id: string;
  content_language: string;
  feed_label: string;
  title: string;
  description?: string;
  link: string;
  image_link: string;
  availability: string;
  condition: "NEW";
  price_micros: string;
  currency: string;
  brand?: string;
  gtin?: string;
  mpn?: string;
};

export type MetaFanOutItem = {
  method: "UPDATE";
  retailer_id: string;
  title: string;
  description?: string;
  availability: string;
  condition: "new";
  price: string;
  link: string;
  image_link: string;
  brand?: string;
  product_type?: string;
};

export type TikTokFanOutItem = {
  sku_id: string;
  title: string;
  image_url: string;
  landing_page_url: string;
  price: string;
  currency: string;
  availability: string;
  description?: string;
  brand?: string;
  product_type?: string;
};

export type KlaviyoFanOutItem = {
  external_id: string;
  title: string;
  description: string;
  url: string;
  image_full_url?: string;
  price?: number;
  published: true;
};

export type FanOutDestinations = {
  google?: {
    merchant_id?: string;
    data_source?: string;
    content_language?: string;
    feed_label?: string;
  };
  meta?: {
    ad_account_id?: string;
    catalog_id?: string;
  };
  tiktok?: {
    advertiser_id?: string;
    catalog_id?: string;
  };
  klaviyo?: boolean | Record<string, never>;
};

export type CatalogFanOutResult = {
  google: { items: GoogleFanOutItem[]; omitted: FanOutOmission[] };
  meta: { items: MetaFanOutItem[]; omitted: FanOutOmission[] };
  tiktok: { items: TikTokFanOutItem[]; omitted: FanOutOmission[] };
  klaviyo: { items: KlaviyoFanOutItem[]; omitted: FanOutOmission[] };
  destination_tools: Record<FanOutNetwork, string>;
  invented_shopify_klaviyo_ids: false;
};

const FORBIDDEN_SKU = new Set(["", "default", "first", "0", "none", "null", "undefined"]);

export function isShopifyKlaviyoCompoundId(raw: string): boolean {
  return raw.trim().toLowerCase().startsWith(SHOPIFY_KLAVIYO_ID_PREFIX);
}

export function assertNotInventedShopifyKlaviyoId(raw: string, field: string): void {
  if (isShopifyKlaviyoCompoundId(raw)) {
    throw new ToolError(
      "UNSUPPORTED_OPERATION",
      "Do not invent or pass $shopify:::$default::: catalog ids. Copy a real Klaviyo $custom:::$default::: id from klaviyo_list_catalog_items, or upsert with external_id only.",
      { api: "klaviyo", resource_id: field },
    );
  }
}

export function destinationWriteTool(network: FanOutNetwork): string {
  switch (network) {
    case "google":
      return "mc_upsert_product_input";
    case "meta":
      return "meta_catalog_items_batch";
    case "tiktok":
      return "tiktok_upload_catalog_products";
    case "klaviyo":
      return "klaviyo_upsert_catalog_items";
    default: {
      const _never: never = network;
      throw new ToolError("UNSUPPORTED_OPERATION", `Unhandled fan-out network: ${String(_never)}`);
    }
  }
}

function namedSku(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const sku = raw.trim();
  if (!sku || FORBIDDEN_SKU.has(sku.toLowerCase())) return undefined;
  return sku;
}

function httpsUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const url = raw.trim();
  if (!url) return undefined;
  if (!url.startsWith("https://") || url.startsWith("https:// ")) return undefined;
  return url;
}

function gtinOf(product: ShopifyFanOutProduct): string | undefined {
  if (typeof product.gtin !== "string") return undefined;
  const gtin = product.gtin.trim();
  if (!gtin || FORBIDDEN_SKU.has(gtin.toLowerCase())) return undefined;
  const digits = gtin.replace(/[\s-]/g, "");
  if (!/^\d{8,14}$/.test(digits)) return undefined;
  return digits;
}

function mpnOf(product: ShopifyFanOutProduct): string | undefined {
  if (typeof product.mpn !== "string") return undefined;
  const mpn = product.mpn.trim();
  if (!mpn || FORBIDDEN_SKU.has(mpn.toLowerCase())) return undefined;
  return mpn;
}

function brandOf(product: ShopifyFanOutProduct): string | undefined {
  if (typeof product.vendor !== "string") return undefined;
  const brand = product.vendor.trim();
  return brand || undefined;
}

function titleOf(product: ShopifyFanOutProduct): string | undefined {
  const title = typeof product.title === "string" ? product.title.trim() : "";
  return title || undefined;
}

function priceAmount(product: ShopifyFanOutProduct): string | undefined {
  if (typeof product.price !== "string" && typeof product.price !== "number") return undefined;
  const raw = String(product.price).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return undefined;
  return raw;
}

function priceMicros(amount: string): string {
  return String(Math.round(Number(amount) * 1_000_000));
}

function currencyOf(product: ShopifyFanOutProduct): string {
  const c = typeof product.currency === "string" ? product.currency.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(c) ? c : "USD";
}

function googleAvailability(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim().toUpperCase().replace(/\s+/g, "_") : "";
  if (v === "OUT_OF_STOCK" || v === "PREORDER" || v === "BACKORDER") return v;
  return "IN_STOCK";
}

function metaAvailability(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "out of stock" || v === "out_of_stock") return "out of stock";
  if (v === "preorder") return "preorder";
  return "in stock";
}

function tiktokAvailability(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim().toUpperCase().replace(/\s+/g, "_") : "";
  if (v === "OUT_OF_STOCK" || v === "PREORDER") return v;
  return "IN_STOCK";
}

function omit(
  network: FanOutNetwork,
  product: ShopifyFanOutProduct,
  reason: FanOutOmitReason,
): FanOutOmission {
  return {
    product_id: product.id,
    sku: namedSku(product.sku),
    reason,
    network,
  };
}

function requireNamedMerchantId(raw: unknown): { id: string; name: string } {
  const id = requireId(raw, "merchant_id");
  if (isShopifyKlaviyoCompoundId(id)) {
    throw new ToolError(
      "RESOURCE_REQUIRED",
      "merchant_id must be the Merchant Center digits id — not a Shopify/Klaviyo compound catalog id.",
      { resource_id: "merchant_id" },
    );
  }
  return normalizeMerchantId(id);
}

function googleIdentity(product: ShopifyFanOutProduct): FanOutOmitReason | null {
  if (!namedSku(product.sku)) return "missing_sku";
  if (!titleOf(product)) return "missing_title";
  if (!priceAmount(product)) return "missing_price";
  const image = product.image?.trim() ?? "";
  if (!image) return "missing_image";
  if (!httpsUrl(product.image)) return "http_not_https";
  const link = product.link?.trim() ?? "";
  if (!link) return "missing_link";
  if (!httpsUrl(product.link)) return "http_not_https";
  const gtin = gtinOf(product);
  const brand = brandOf(product);
  const mpn = mpnOf(product);
  if (!gtin && !(brand && mpn)) return "missing_gtin";
  return null;
}

function imageLinkIdentity(product: ShopifyFanOutProduct): FanOutOmitReason | null {
  if (!namedSku(product.sku)) return "missing_sku";
  if (!titleOf(product)) return "missing_title";
  if (!priceAmount(product)) return "missing_price";
  const image = product.image?.trim() ?? "";
  if (!image) return "missing_image";
  if (!httpsUrl(product.image)) return "http_not_https";
  const link = product.link?.trim() ?? "";
  if (!link) return "missing_link";
  if (!httpsUrl(product.link)) return "http_not_https";
  return null;
}

function klaviyoIdentity(product: ShopifyFanOutProduct): FanOutOmitReason | null {
  if (!namedSku(product.sku)) return "missing_sku";
  if (!titleOf(product)) return "missing_title";
  const link = product.link?.trim() ?? "";
  if (!link) return "missing_link";
  if (!httpsUrl(product.link)) return "http_not_https";
  return null;
}

function mapGoogleItem(
  product: ShopifyFanOutProduct,
  dest: NonNullable<FanOutDestinations["google"]>,
  merchantId: string,
): GoogleFanOutItem {
  const sku = namedSku(product.sku)!;
  const amount = priceAmount(product)!;
  const lang =
    typeof dest.content_language === "string" && dest.content_language.trim()
      ? dest.content_language.trim()
      : "en";
  const feed =
    typeof dest.feed_label === "string" && dest.feed_label.trim() ? dest.feed_label.trim() : "US";
  const item: GoogleFanOutItem = {
    merchant_id: merchantId,
    offer_id: sku,
    content_language: lang,
    feed_label: feed,
    title: titleOf(product)!,
    link: httpsUrl(product.link)!,
    image_link: httpsUrl(product.image)!,
    availability: googleAvailability(product.availability),
    condition: "NEW",
    price_micros: priceMicros(amount),
    currency: currencyOf(product),
  };
  if (typeof dest.data_source === "string" && dest.data_source.trim()) {
    item.data_source = dest.data_source.trim();
  }
  const description = typeof product.description === "string" ? product.description.trim() : "";
  if (description) item.description = description;
  const brand = brandOf(product);
  if (brand) item.brand = brand;
  const gtin = gtinOf(product);
  if (gtin) item.gtin = gtin;
  const mpn = mpnOf(product);
  if (mpn) item.mpn = mpn;
  return item;
}

function mapMetaItem(product: ShopifyFanOutProduct): MetaFanOutItem {
  const sku = namedSku(product.sku)!;
  const amount = priceAmount(product)!;
  const item: MetaFanOutItem = {
    method: "UPDATE",
    retailer_id: sku,
    title: titleOf(product)!,
    availability: metaAvailability(product.availability),
    condition: "new",
    price: `${amount} ${currencyOf(product)}`,
    link: httpsUrl(product.link)!,
    image_link: httpsUrl(product.image)!,
  };
  const description = typeof product.description === "string" ? product.description.trim() : "";
  if (description) item.description = description;
  const brand = brandOf(product);
  if (brand) item.brand = brand;
  if (typeof product.product_type === "string" && product.product_type.trim()) {
    item.product_type = product.product_type.trim();
  }
  return item;
}

function mapTikTokItem(product: ShopifyFanOutProduct): TikTokFanOutItem {
  const sku = namedSku(product.sku)!;
  const item: TikTokFanOutItem = {
    sku_id: sku,
    title: titleOf(product)!,
    image_url: httpsUrl(product.image)!,
    landing_page_url: httpsUrl(product.link)!,
    price: priceAmount(product)!,
    currency: currencyOf(product),
    availability: tiktokAvailability(product.availability),
  };
  const description = typeof product.description === "string" ? product.description.trim() : "";
  if (description) item.description = description;
  const brand = brandOf(product);
  if (brand) item.brand = brand;
  if (typeof product.product_type === "string" && product.product_type.trim()) {
    item.product_type = product.product_type.trim();
  }
  return item;
}

function mapKlaviyoItem(product: ShopifyFanOutProduct): KlaviyoFanOutItem {
  const sku = namedSku(product.sku)!;
  assertNotInventedShopifyKlaviyoId(sku, "sku");
  const title = titleOf(product)!;
  const description =
    typeof product.description === "string" && product.description.trim()
      ? product.description.trim()
      : title;
  const item: KlaviyoFanOutItem = {
    external_id: sku,
    title,
    description,
    url: httpsUrl(product.link)!,
    published: true,
  };
  const image = httpsUrl(product.image);
  if (image) item.image_full_url = image;
  const amount = priceAmount(product);
  if (amount) item.price = Number(amount);
  return item;
}

function emptyNetwork(): { items: never[]; omitted: FanOutOmission[] } {
  return { items: [], omitted: [] };
}

/**
 * Map Shopify rows to per-network proposed payloads.
 * Does not call destination APIs. Live fan-out still needs each network's write grant.
 */
export function mapCatalogFanOut(input: {
  products: ShopifyFanOutProduct[];
  destinations: FanOutDestinations;
}): CatalogFanOutResult {
  if (!Array.isArray(input.products)) {
    throw new ToolError("INVALID_ARGUMENT", "products must be an array", { api: "catalog-fan-out" });
  }
  for (const product of input.products) {
    if (product?.id && isShopifyKlaviyoCompoundId(product.id)) {
      throw new ToolError(
        "UNSUPPORTED_OPERATION",
        "Do not invent $shopify:::$default::: ids. Use Shopify gid / sku and Klaviyo $custom:::$default::: ids copied from list tools.",
        { api: "catalog-fan-out", resource_id: product.id },
      );
    }
  }

  const dest = input.destinations ?? {};
  const result: CatalogFanOutResult = {
    google: emptyNetwork(),
    meta: emptyNetwork(),
    tiktok: emptyNetwork(),
    klaviyo: emptyNetwork(),
    destination_tools: {
      google: destinationWriteTool("google"),
      meta: destinationWriteTool("meta"),
      tiktok: destinationWriteTool("tiktok"),
      klaviyo: destinationWriteTool("klaviyo"),
    },
    invented_shopify_klaviyo_ids: false,
  };

  if (dest.google) {
    const merchant = requireNamedMerchantId(dest.google.merchant_id);
    for (const product of input.products) {
      const reason = googleIdentity(product);
      if (reason) {
        result.google.omitted.push(omit("google", product, reason));
        continue;
      }
      result.google.items.push(mapGoogleItem(product, dest.google, merchant.id));
    }
  }

  if (dest.meta) {
    if (dest.meta.ad_account_id !== undefined) requireId(dest.meta.ad_account_id, "ad_account_id");
    if (dest.meta.catalog_id !== undefined) requireId(dest.meta.catalog_id, "catalog_id");
    for (const product of input.products) {
      const reason = imageLinkIdentity(product);
      if (reason) {
        result.meta.omitted.push(omit("meta", product, reason));
        continue;
      }
      result.meta.items.push(mapMetaItem(product));
    }
  }

  if (dest.tiktok) {
    if (dest.tiktok.advertiser_id !== undefined) requireId(dest.tiktok.advertiser_id, "advertiser_id");
    if (dest.tiktok.catalog_id !== undefined) requireId(dest.tiktok.catalog_id, "catalog_id");
    for (const product of input.products) {
      const reason = imageLinkIdentity(product);
      if (reason) {
        result.tiktok.omitted.push(omit("tiktok", product, reason));
        continue;
      }
      result.tiktok.items.push(mapTikTokItem(product));
    }
  }

  if (dest.klaviyo) {
    for (const product of input.products) {
      const reason = klaviyoIdentity(product);
      if (reason) {
        result.klaviyo.omitted.push(omit("klaviyo", product, reason));
        continue;
      }
      result.klaviyo.items.push(mapKlaviyoItem(product));
    }
  }

  return result;
}

export function unnamedMerchantIdErrorMessage(): string {
  return MSG.RESOURCE_REQUIRED;
}
