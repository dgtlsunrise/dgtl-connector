/**
 * Wave 17 named TikTok tools — catalog + Events API + optional campaign create.
 * dry_run default; live confirm_phrase must include advertiser_id (plus catalog_id / pixel_code when present).
 * Catalog writes and campaign create reuse TIKTOK_MUTATE_ENABLED.
 * Events dual-gate Worker TIKTOK_EVENTS_ENABLED (fail-closed, not TIKTOK_MUTATE_ENABLED).
 * Plugin hashes email/phone/external_id before hop. content_id must match catalog sku_id.
 * App secret stays on Worker. Polar `tiktok` only. Never Axos. No Klaviyo.
 */

import { createHash } from "node:crypto";
import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import { requireId } from "../ids.js";
import { probeGatewayReachable, postGateway } from "../gateway/client.js";
import { requireTikTokLicense, tiktokDisabled } from "./tiktok.js";
import { HINT_FLAG, dryRunDefault } from "./tiktok-write.js";

export const HINT_EVENTS =
  "Plugin TikTok Events API defaults on; set DGTL_TIKTOK_EVENTS_ENABLED=false (or TIKTOK_EVENTS_ENABLED=false) to opt out. Live hop needs Worker TIKTOK_EVENTS_ENABLED=true (fail-closed, separate from TIKTOK_MUTATE_ENABLED). Polar tiktok bit. App secret stays on the Worker. Never log unhashed PII. content_id must match catalog sku_id.";

const ADVERTISER_RE = /^\d{5,20}$/;
const OBJECT_ID_RE = /^\d{1,30}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const PIXEL_CODE_RE = /^[A-Za-z0-9]{4,64}$/;
const SKU_RE = /^[A-Za-z0-9._:-]{1,100}$/;
const PRICE_RE = /^\d+(?:\.\d{1,2})?$/;
const SPEND_CAP = 100_000;

const CATALOG_TYPES = new Set(["ECOM", "HOTEL", "FLIGHT", "DESTINATION", "AUTO"]);
const AVAILABILITY = new Set(["IN_STOCK", "OUT_OF_STOCK", "PREORDER"]);
const CONDITIONS = new Set(["NEW", "REFURBISHED", "USED"]);
const EVENT_SOURCES = new Set(["web", "app", "offline", "crm"]);
const EVENT_NAMES = new Set([
  "AddPaymentInfo",
  "AddToCart",
  "AddToWishlist",
  "ClickButton",
  "CompletePayment",
  "CompleteRegistration",
  "Contact",
  "CustomizeProduct",
  "Download",
  "FindLocation",
  "InitiateCheckout",
  "PlaceAnOrder",
  "Schedule",
  "Search",
  "StartTrial",
  "SubmitApplication",
  "SubmitForm",
  "Subscribe",
  "ViewContent",
]);
const OBJECTIVES = new Set([
  "APP_PROMOTION",
  "WEB_CONVERSIONS",
  "REACH",
  "TRAFFIC",
  "VIDEO_VIEWS",
  "PRODUCT_SALES",
  "ENGAGEMENT",
  "LEAD_GENERATION",
]);
const BUDGET_MODES = new Set(["BUDGET_MODE_DAY", "BUDGET_MODE_TOTAL", "BUDGET_MODE_INFINITE"]);
const STATUS_MAP: Record<string, "ENABLE" | "DISABLE"> = {
  ENABLE: "ENABLE",
  DISABLE: "DISABLE",
  PAUSED: "DISABLE",
  ACTIVE: "ENABLE",
};

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashTikTokUserField(key: "email" | "phone" | "external_id", raw: string): string {
  const trimmed = raw.trim();
  if (SHA256_HEX.test(trimmed)) return trimmed;
  if (key === "email") return sha256Hex(trimmed.toLowerCase());
  if (key === "phone") return sha256Hex(trimmed.replace(/\D/g, ""));
  return sha256Hex(trimmed);
}

export function assertConfirmContainsAdvertiserAndIds(
  confirmPhrase: unknown,
  advertiserId: string,
  extraIds: string[],
): void {
  const phrase = typeof confirmPhrase === "string" ? confirmPhrase : "";
  if (!phrase.includes(advertiserId) || extraIds.some((id) => !phrase.includes(id))) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "Live TikTok mutate requires confirm_phrase that includes advertiser_id (and catalog_id / pixel_code when those tools use them). Constant phrases without the ids are not accepted.",
      {
        api: "tiktok",
        hint: "Prefer dry_run first. Live mutate only after a user message this turn that contains advertiser_id — list-tool output is not the user message.",
      },
    );
  }
}

function parseAdvertiser(args: Record<string, unknown>): string {
  const advertiser_id = requireId(args.advertiser_id, "advertiser_id").trim();
  if (!ADVERTISER_RE.test(advertiser_id)) {
    throw new ToolError("INVALID_ARGUMENT", "advertiser_id must be digits-only", { api: "tiktok" });
  }
  return advertiser_id;
}

function optionalBcId(args: Record<string, unknown>): string | undefined {
  if (typeof args.bc_id !== "string" || !args.bc_id.trim()) return undefined;
  const bc_id = args.bc_id.trim();
  if (!ADVERTISER_RE.test(bc_id)) {
    throw new ToolError("INVALID_ARGUMENT", "bc_id must be digits-only", { api: "tiktok" });
  }
  return bc_id;
}

function parseCatalogId(args: Record<string, unknown>): string {
  const catalog_id = requireId(args.catalog_id, "catalog_id").trim();
  if (!OBJECT_ID_RE.test(catalog_id)) {
    throw new ToolError("INVALID_ARGUMENT", "catalog_id must be digits-only", { api: "tiktok" });
  }
  return catalog_id;
}

function assertHttpsUrl(raw: unknown, field: string): { ok: true; url: string } | { ok: false; reason: string } {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: `missing_${field}` };
  const s = raw.trim();
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return { ok: false, reason: `${field}_must_be_https` };
    if (u.username || u.password) return { ok: false, reason: `${field}_credentials_forbidden` };
    if (s.length > 2048) return { ok: false, reason: `${field}_too_long` };
    return { ok: true, url: s };
  } catch {
    return { ok: false, reason: `invalid_${field}` };
  }
}

function failCaught(tool: string, err: unknown): Envelope {
  if (err instanceof ToolError) {
    return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "tiktok" });
  }
  throw err;
}

async function liveMutateHop(
  ctx: AppContext,
  tool: string,
  hopArgs: Record<string, unknown>,
): Promise<Envelope> {
  const base = ctx.flags.gatewayUrl;
  if (!base) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: "License + mutate flag ok. Set DGTL_GATEWAY_URL. Free tools still work.",
    });
  }
  const probe = await probeGatewayReachable(ctx);
  if (!probe.reachable) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: probe.note ?? "Gateway health probe failed.",
    });
  }
  const tok = await ctx.authTiktok.getAccessToken();
  if (!tok?.accessToken) {
    return failEnvelope(tool, "TIKTOK_NOT_CONNECTED", MSG.TIKTOK_NOT_CONNECTED, {
      hint: "License and gateway are ok. Set TIKTOK_ACCESS_TOKEN — never reuse Google Consent A or Meta tokens.",
    });
  }
  void ctx.auth;
  return postGateway(ctx, {
    family: "tiktok",
    tool,
    userAccessToken: tok.accessToken,
    args: hopArgs,
  });
}

async function liveEventsHop(
  ctx: AppContext,
  tool: string,
  hopArgs: Record<string, unknown>,
): Promise<Envelope> {
  const base = ctx.flags.gatewayUrl;
  if (!base) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: "License + Events flag ok. Set DGTL_GATEWAY_URL. Free tools still work.",
    });
  }
  const probe = await probeGatewayReachable(ctx);
  if (!probe.reachable) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: probe.note ?? "Gateway health probe failed.",
    });
  }
  if (probe.tiktok_events_enabled !== true) {
    return failEnvelope(tool, "TIKTOK_EVENTS_NOT_ENABLED", MSG.TIKTOK_EVENTS_NOT_ENABLED, {
      hint: HINT_EVENTS,
      api: "tiktok",
    });
  }
  const tok = await ctx.authTiktok.getAccessToken();
  if (!tok?.accessToken) {
    return failEnvelope(tool, "TIKTOK_NOT_CONNECTED", MSG.TIKTOK_NOT_CONNECTED, {
      hint: "License and gateway are ok. Set TIKTOK_ACCESS_TOKEN — never reuse Google Consent A or Meta tokens.",
    });
  }
  void ctx.auth;
  return postGateway(ctx, {
    family: "tiktok",
    tool,
    userAccessToken: tok.accessToken,
    args: hopArgs,
  });
}

function parseProduct(
  raw: unknown,
  index: number,
): { ok: true; product: Record<string, unknown> } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: `products[${index}] must be an object` };
  }
  const rec = raw as Record<string, unknown>;
  const sku_id = typeof rec.sku_id === "string" ? rec.sku_id.trim() : "";
  if (!SKU_RE.test(sku_id)) {
    return { ok: false, message: `products[${index}].sku_id is required (this is the Events API content_id)` };
  }
  const title = typeof rec.title === "string" ? rec.title.trim() : "";
  if (!title || title.length > 200) {
    return { ok: false, message: `products[${index}].title is required` };
  }
  const image = assertHttpsUrl(rec.image_url, "image_url");
  if (!image.ok) return { ok: false, message: `products[${index}].image_url must be https://…` };
  const landing = assertHttpsUrl(rec.landing_page_url, "landing_page_url");
  if (!landing.ok) return { ok: false, message: `products[${index}].landing_page_url must be https://…` };
  const price = typeof rec.price === "string" ? rec.price.trim() : rec.price != null ? String(rec.price) : "";
  if (!PRICE_RE.test(price)) {
    return { ok: false, message: `products[${index}].price must look like "29.00"` };
  }
  const currency =
    typeof rec.currency === "string" && rec.currency.trim() ? rec.currency.trim().toUpperCase() : "USD";
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, message: `products[${index}].currency must be ISO-4217` };
  }
  const availability =
    typeof rec.availability === "string" && rec.availability.trim()
      ? rec.availability.trim().toUpperCase().replace(/\s+/g, "_")
      : "IN_STOCK";
  if (!AVAILABILITY.has(availability)) {
    return { ok: false, message: `products[${index}].availability is outside the closed allowlist` };
  }

  const product: Record<string, unknown> = {
    sku_id,
    title,
    image_url: image.url,
    landing_page_url: landing.url,
    price,
    currency,
    availability,
  };

  if (typeof rec.description === "string" && rec.description.trim()) {
    product.description = rec.description.trim().slice(0, 1000);
  }
  if (typeof rec.condition === "string" && rec.condition.trim()) {
    const c = rec.condition.trim().toUpperCase();
    if (!CONDITIONS.has(c)) {
      return { ok: false, message: `products[${index}].condition is outside the closed allowlist` };
    }
    product.condition = c;
  }
  if (typeof rec.sale_price === "string" && rec.sale_price.trim()) {
    if (!PRICE_RE.test(rec.sale_price.trim())) {
      return { ok: false, message: `products[${index}].sale_price must look like "19.00"` };
    }
    product.sale_price = rec.sale_price.trim();
  }
  if (rec.additional_image_urls !== undefined) {
    const list = Array.isArray(rec.additional_image_urls)
      ? rec.additional_image_urls
      : typeof rec.additional_image_urls === "string"
        ? [rec.additional_image_urls]
        : null;
    if (!list) return { ok: false, message: `products[${index}].additional_image_urls must be https strings` };
    const urls: string[] = [];
    for (const item of list.slice(0, 10)) {
      const extra = assertHttpsUrl(item, "additional_image_urls");
      if (!extra.ok) {
        return { ok: false, message: `products[${index}].additional_image_urls must be https://…` };
      }
      urls.push(extra.url);
    }
    if (urls.length) product.additional_image_urls = urls;
  }
  const optionalStrings = [
    "brand",
    "item_group_id",
    "google_product_category",
    "color",
    "size",
    "gender",
    "age_group",
    "material",
    "pattern",
    "product_type",
  ] as const;
  for (const k of optionalStrings) {
    if (typeof rec[k] === "string" && rec[k].trim()) {
      const s = rec[k].trim();
      if (/^https?:\/\//i.test(s)) {
        return { ok: false, message: `products[${index}].${k} must not be a hop URL` };
      }
      product[k] = s.slice(0, 200);
    }
  }
  if (rec.quantity !== undefined && rec.quantity !== null && rec.quantity !== "") {
    const n = typeof rec.quantity === "number" ? rec.quantity : Number(rec.quantity);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
      return { ok: false, message: `products[${index}].quantity must be a non-negative integer` };
    }
    product.quantity = n;
  }
  return { ok: true, product };
}

function parseEvent(
  raw: unknown,
  index: number,
): { ok: true; event: Record<string, unknown> } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: `events[${index}] must be an object` };
  }
  const rec = raw as Record<string, unknown>;
  const event_name = typeof rec.event_name === "string" ? rec.event_name.trim() : "";
  if (!EVENT_NAMES.has(event_name)) {
    return { ok: false, message: `events[${index}].event_name is outside the closed Events API enum` };
  }
  const event_id = typeof rec.event_id === "string" ? rec.event_id.trim() : "";
  if (!event_id || event_id.length > 128) {
    return { ok: false, message: `events[${index}].event_id is required (dedup)` };
  }

  let event_time: number;
  if (rec.event_time === undefined || rec.event_time === null || rec.event_time === "") {
    event_time = Math.floor(Date.now() / 1000);
  } else {
    const n = typeof rec.event_time === "number" ? rec.event_time : Number(rec.event_time);
    if (!Number.isFinite(n) || n < 1_000_000_000 || n > 4_000_000_000) {
      return { ok: false, message: `events[${index}].event_time must be a unix timestamp` };
    }
    event_time = Math.floor(n);
  }

  const event: Record<string, unknown> = { event_name, event_id, event_time };

  if (rec.event_source_url !== undefined && rec.event_source_url !== "") {
    const src = assertHttpsUrl(rec.event_source_url, "event_source_url");
    if (!src.ok) return { ok: false, message: `events[${index}].event_source_url must be https://…` };
    event.event_source_url = src.url;
  }

  const emailRaw = typeof rec.email === "string" ? rec.email : typeof rec.em === "string" ? rec.em : "";
  if (emailRaw.trim()) event.email = hashTikTokUserField("email", emailRaw);
  const phoneRaw = typeof rec.phone === "string" ? rec.phone : typeof rec.ph === "string" ? rec.ph : "";
  if (phoneRaw.trim()) event.phone = hashTikTokUserField("phone", phoneRaw);
  if (typeof rec.external_id === "string" && rec.external_id.trim()) {
    event.external_id = hashTikTokUserField("external_id", rec.external_id);
  }

  for (const k of ["ip", "user_agent", "ttclid", "ttp"] as const) {
    if (typeof rec[k] === "string" && rec[k].trim()) {
      const s = rec[k].trim();
      if (/^https?:\/\//i.test(s)) {
        return { ok: false, message: `events[${index}].${k} must not be a hop URL` };
      }
      event[k] = s.slice(0, 512);
    }
  }

  const contentIdRaw = typeof rec.content_id === "string" ? rec.content_id.trim() : "";
  if (contentIdRaw) {
    if (!SKU_RE.test(contentIdRaw)) {
      return { ok: false, message: `events[${index}].content_id must match catalog sku_id` };
    }
    event.content_id = contentIdRaw;
  }
  if (rec.content_ids !== undefined) {
    const list = Array.isArray(rec.content_ids)
      ? rec.content_ids
      : typeof rec.content_ids === "string"
        ? rec.content_ids.split(/[\s,]+/).filter(Boolean)
        : null;
    if (!list) return { ok: false, message: `events[${index}].content_ids must be strings` };
    const ids = list
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim())
      .slice(0, 50);
    for (const id of ids) {
      if (!SKU_RE.test(id)) {
        return { ok: false, message: `events[${index}].content_ids must match catalog sku_id values` };
      }
    }
    if (ids.length) event.content_ids = ids;
  }

  const valueRaw = rec.value !== undefined && rec.value !== "" ? rec.value : rec.event_value;
  if (valueRaw !== undefined && valueRaw !== null && valueRaw !== "") {
    const n = typeof valueRaw === "number" ? valueRaw : Number(valueRaw);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, message: `events[${index}].value must be a non-negative number` };
    }
    event.value = n;
  }
  if (typeof rec.currency === "string" && rec.currency.trim()) {
    const ccy = rec.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(ccy)) {
      return { ok: false, message: `events[${index}].currency must be ISO-4217` };
    }
    event.currency = ccy;
  }
  for (const k of ["content_type", "content_name", "order_id"] as const) {
    if (typeof rec[k] === "string" && rec[k].trim()) event[k] = rec[k].trim().slice(0, 256);
  }
  if (rec.quantity !== undefined && rec.quantity !== null && rec.quantity !== "") {
    const n = typeof rec.quantity === "number" ? rec.quantity : Number(rec.quantity);
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
      return { ok: false, message: `events[${index}].quantity must be a positive integer` };
    }
    event.quantity = n;
  }
  return { ok: true, event };
}

function requireMutateFlag(ctx: AppContext, tool: string): Envelope | null {
  if (!ctx.flags.tiktokMutateEnabled) {
    return failEnvelope(tool, "TIKTOK_MUTATE_NOT_ENABLED", MSG.TIKTOK_MUTATE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: "tiktok",
    });
  }
  return requireTikTokLicense(ctx, tool);
}

/** Catalog list (Business Center / advertiser). Read hop. */
export async function tiktokListCatalogs(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "tiktok_list_catalogs";
  try {
    const advertiser_id = parseAdvertiser(args);
    const hopArgs: Record<string, unknown> = { advertiser_id };
    const bc_id = optionalBcId(args);
    if (bc_id) hopArgs.bc_id = bc_id;
    if (typeof args.catalog_id === "string" && args.catalog_id.trim()) {
      hopArgs.catalog_id = parseCatalogId(args);
    }
    if (typeof args.page_size === "number") hopArgs.page_size = args.page_size;
    return await tiktokDisabled(ctx, tool, hopArgs);
  } catch (err) {
    return failCaught(tool, err);
  }
}

/** Pixel list. Read hop. */
export async function tiktokListPixels(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "tiktok_list_pixels";
  try {
    const advertiser_id = parseAdvertiser(args);
    const hopArgs: Record<string, unknown> = { advertiser_id };
    if (typeof args.pixel_id === "string" && args.pixel_id.trim()) {
      const pixel_id = args.pixel_id.trim();
      if (!OBJECT_ID_RE.test(pixel_id)) {
        return failEnvelope(tool, "INVALID_ARGUMENT", "pixel_id must be digits-only", { api: "tiktok" });
      }
      hopArgs.pixel_id = pixel_id;
    }
    if (typeof args.pixel_code === "string" && args.pixel_code.trim()) {
      const pixel_code = args.pixel_code.trim();
      if (!PIXEL_CODE_RE.test(pixel_code)) {
        return failEnvelope(tool, "INVALID_ARGUMENT", "pixel_code must be alphanumeric", { api: "tiktok" });
      }
      hopArgs.pixel_code = pixel_code;
    }
    if (typeof args.page_size === "number") hopArgs.page_size = args.page_size;
    return await tiktokDisabled(ctx, tool, hopArgs);
  } catch (err) {
    return failCaught(tool, err);
  }
}

/** Confirm-gated catalog create. Catalog API often also needs bc_id. */
export async function tiktokCreateCatalog(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "tiktok_create_catalog";
  const gated = requireMutateFlag(ctx, tool);
  if (gated) return gated;
  try {
    const advertiser_id = parseAdvertiser(args);
    const name = requireId(args.name, "name").trim();
    if (!name || name.length > 400 || /[\u0000-\u001f\u007f]/.test(name)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "name must be a non-empty string ≤400 chars", {
        api: "tiktok",
      });
    }
    const catalog_type =
      typeof args.catalog_type === "string" && args.catalog_type.trim()
        ? args.catalog_type.trim().toUpperCase()
        : "ECOM";
    if (!CATALOG_TYPES.has(catalog_type)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "catalog_type is outside the closed allowlist", {
        api: "tiktok",
      });
    }
    const hopArgs: Record<string, unknown> = { advertiser_id, name, catalog_name: name, catalog_type };
    const bc_id = optionalBcId(args);
    if (bc_id) hopArgs.bc_id = bc_id;
    if (typeof args.currency === "string" && args.currency.trim()) {
      const currency = args.currency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) {
        return failEnvelope(tool, "INVALID_ARGUMENT", "currency must be ISO-4217", { api: "tiktok" });
      }
      hopArgs.currency = currency;
    }
    if (dryRunDefault(args)) {
      return okEnvelope(tool, {
        resource: { type: "tiktok_catalog", id: advertiser_id, display_name: name },
        data: {
          dry_run: true,
          proposed: hopArgs,
          cited: hopArgs,
          note: `No TikTok Catalog API HTTP. Pass dry_run=false with confirm_phrase containing ${advertiser_id}. Catalog create often needs bc_id. Worker TIKTOK_MUTATE_ENABLED fail-closed.`,
        },
      });
    }
    assertConfirmContainsAdvertiserAndIds(args.confirm_phrase, advertiser_id, bc_id ? [bc_id] : []);
    return await liveMutateHop(ctx, tool, hopArgs);
  } catch (err) {
    return failCaught(tool, err);
  }
}

/** JSON catalog product upload. sku_id is the Events API content_id. */
export async function tiktokUploadCatalogProducts(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "tiktok_upload_catalog_products";
  const gated = requireMutateFlag(ctx, tool);
  if (gated) return gated;
  try {
    const advertiser_id = parseAdvertiser(args);
    const catalog_id = parseCatalogId(args);
    if (!Array.isArray(args.products) || args.products.length < 1 || args.products.length > 50) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "products must be 1–50 closed catalog rows", {
        api: "tiktok",
      });
    }
    const products: Array<Record<string, unknown>> = [];
    for (let i = 0; i < args.products.length; i += 1) {
      const parsed = parseProduct(args.products[i], i);
      if (!parsed.ok) {
        return failEnvelope(tool, "INVALID_ARGUMENT", parsed.message, { api: "tiktok" });
      }
      products.push(parsed.product);
    }
    const hopArgs: Record<string, unknown> = { advertiser_id, catalog_id, products };
    const bc_id = optionalBcId(args);
    if (bc_id) hopArgs.bc_id = bc_id;
    if (dryRunDefault(args)) {
      return okEnvelope(tool, {
        resource: { type: "tiktok_catalog", id: catalog_id, display_name: catalog_id },
        data: {
          dry_run: true,
          proposed: hopArgs,
          cited: {
            advertiser_id,
            catalog_id,
            sku_ids: products.map((p) => p.sku_id),
            product_count: products.length,
          },
          note: `No TikTok Catalog API HTTP. sku_id is the Events API content_id. Pass dry_run=false with confirm_phrase containing ${advertiser_id} AND ${catalog_id}. HTTPS image_url / landing_page_url only.`,
        },
      });
    }
    assertConfirmContainsAdvertiserAndIds(args.confirm_phrase, advertiser_id, [catalog_id]);
    return await liveMutateHop(ctx, tool, hopArgs);
  } catch (err) {
    return failCaught(tool, err);
  }
}

/** Bind pixel (or app) event source to a catalog. */
export async function tiktokBindCatalogEventsource(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "tiktok_bind_catalog_eventsource";
  const gated = requireMutateFlag(ctx, tool);
  if (gated) return gated;
  try {
    const advertiser_id = parseAdvertiser(args);
    const catalog_id = parseCatalogId(args);
    const pixel_code =
      typeof args.pixel_code === "string" && args.pixel_code.trim() ? args.pixel_code.trim() : "";
    const app_id = typeof args.app_id === "string" && args.app_id.trim() ? args.app_id.trim() : "";
    if (Boolean(pixel_code) === Boolean(app_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "Provide pixel_code XOR app_id", { api: "tiktok" });
    }
    if (pixel_code && !PIXEL_CODE_RE.test(pixel_code)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "pixel_code must be alphanumeric", { api: "tiktok" });
    }
    if (app_id && !/^\d{1,30}$/.test(app_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "app_id must be digits-only", { api: "tiktok" });
    }
    const hopArgs: Record<string, unknown> = { advertiser_id, catalog_id };
    if (pixel_code) hopArgs.pixel_code = pixel_code;
    if (app_id) hopArgs.app_id = app_id;
    const bc_id = optionalBcId(args);
    if (bc_id) hopArgs.bc_id = bc_id;
    if (dryRunDefault(args)) {
      return okEnvelope(tool, {
        resource: { type: "tiktok_catalog", id: catalog_id, display_name: catalog_id },
        data: {
          dry_run: true,
          proposed: hopArgs,
          cited: hopArgs,
          note: `No TikTok Catalog API HTTP. Pass dry_run=false with confirm_phrase containing ${advertiser_id} AND ${catalog_id}.`,
        },
      });
    }
    assertConfirmContainsAdvertiserAndIds(args.confirm_phrase, advertiser_id, [catalog_id]);
    return await liveMutateHop(ctx, tool, hopArgs);
  } catch (err) {
    return failCaught(tool, err);
  }
}

/** Closed Events API 2.0 send. Hashes user data. content_id must match catalog sku_id. */
export async function tiktokTrackEvents(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "tiktok_track_events";
  if (!ctx.flags.tiktokEventsEnabled) {
    return failEnvelope(tool, "TIKTOK_EVENTS_NOT_ENABLED", MSG.TIKTOK_EVENTS_NOT_ENABLED, {
      hint: HINT_EVENTS,
      api: "tiktok",
    });
  }
  const miss = requireTikTokLicense(ctx, tool);
  if (miss) return miss;
  try {
    const advertiser_id = parseAdvertiser(args);
    const pixel_code = requireId(args.pixel_code, "pixel_code").trim();
    if (!PIXEL_CODE_RE.test(pixel_code)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "pixel_code must be alphanumeric (Events API event_source_id)", {
        api: "tiktok",
      });
    }
    const event_source =
      typeof args.event_source === "string" && args.event_source.trim()
        ? args.event_source.trim()
        : "web";
    if (!EVENT_SOURCES.has(event_source)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "event_source is outside the closed allowlist", {
        api: "tiktok",
      });
    }
    if (!Array.isArray(args.events) || args.events.length < 1 || args.events.length > 10) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "events must be 1–10 closed Events API rows", {
        api: "tiktok",
      });
    }
    const events: Array<Record<string, unknown>> = [];
    for (let i = 0; i < args.events.length; i += 1) {
      const parsed = parseEvent(args.events[i], i);
      if (!parsed.ok) {
        return failEnvelope(tool, "INVALID_ARGUMENT", parsed.message, { api: "tiktok" });
      }
      events.push(parsed.event);
    }
    const hopArgs: Record<string, unknown> = {
      advertiser_id,
      pixel_code,
      event_source_id: pixel_code,
      event_source,
      events,
    };
    if (typeof args.test_event_code === "string" && args.test_event_code.trim()) {
      hopArgs.test_event_code = args.test_event_code.trim().slice(0, 64);
    }
    if (dryRunDefault(args)) {
      return okEnvelope(tool, {
        resource: { type: "tiktok_pixel", id: pixel_code, display_name: pixel_code },
        data: {
          dry_run: true,
          proposed: hopArgs,
          cited: {
            advertiser_id,
            pixel_code,
            event_ids: events.map((e) => e.event_id),
            event_names: events.map((e) => e.event_name),
            content_ids: events.flatMap((e) =>
              [e.content_id, ...(Array.isArray(e.content_ids) ? e.content_ids : [])].filter(Boolean),
            ),
          },
          note: `No TikTok Events API HTTP. email/phone are SHA-256 only. content_id must match catalog sku_id. Pass dry_run=false with confirm_phrase containing ${advertiser_id} AND ${pixel_code}. Live hop needs Worker TIKTOK_EVENTS_ENABLED=true.`,
        },
      });
    }
    assertConfirmContainsAdvertiserAndIds(args.confirm_phrase, advertiser_id, [pixel_code]);
    return await liveEventsHop(ctx, tool, hopArgs);
  } catch (err) {
    return failCaught(tool, err);
  }
}

/** Marketing API campaign create. Defaults DISABLE (PAUSED maps to DISABLE). */
export async function tiktokCreateCampaign(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "tiktok_create_campaign";
  const gated = requireMutateFlag(ctx, tool);
  if (gated) return gated;
  try {
    const advertiser_id = parseAdvertiser(args);
    const campaign_name = requireId(args.campaign_name, "campaign_name").trim();
    if (!campaign_name || campaign_name.length > 400 || /[\u0000-\u001f\u007f]/.test(campaign_name)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "campaign_name must be a non-empty string ≤400 chars", {
        api: "tiktok",
      });
    }
    const objective_type =
      typeof args.objective_type === "string" ? args.objective_type.trim().toUpperCase() : "";
    if (!OBJECTIVES.has(objective_type)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "objective_type is outside the closed allowlist", {
        api: "tiktok",
      });
    }
    const statusRaw =
      typeof args.operation_status === "string" && args.operation_status.trim()
        ? args.operation_status.trim().toUpperCase()
        : typeof args.status === "string" && args.status.trim()
          ? args.status.trim().toUpperCase()
          : "DISABLE";
    const operation_status = STATUS_MAP[statusRaw];
    if (!operation_status) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "operation_status must be ENABLE or DISABLE", {
        api: "tiktok",
        hint: "Creates default DISABLE. PAUSED maps to DISABLE. DELETE is not supported.",
      });
    }

    let budget: number | undefined;
    if (args.budget !== undefined && args.budget !== null && args.budget !== "") {
      const n = typeof args.budget === "number" ? args.budget : Number(args.budget);
      if (!Number.isFinite(n) || n <= 0) {
        return failEnvelope(tool, "INVALID_ARGUMENT", "budget must be a positive number in advertiser currency", {
          api: "tiktok",
        });
      }
      if (n > SPEND_CAP) {
        return failEnvelope(tool, "SPEND_CAP_EXCEEDED", MSG.SPEND_CAP_EXCEEDED, { api: "tiktok" });
      }
      budget = n;
    }
    const budget_mode_raw =
      typeof args.budget_mode === "string" && args.budget_mode.trim()
        ? args.budget_mode.trim().toUpperCase()
        : budget != null
          ? "BUDGET_MODE_DAY"
          : "BUDGET_MODE_INFINITE";
    if (!BUDGET_MODES.has(budget_mode_raw)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "budget_mode is outside the closed allowlist", {
        api: "tiktok",
      });
    }
    if (budget_mode_raw !== "BUDGET_MODE_INFINITE" && budget == null) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "budget is required unless budget_mode is BUDGET_MODE_INFINITE", {
        api: "tiktok",
      });
    }

    const hopArgs: Record<string, unknown> = {
      advertiser_id,
      campaign_name,
      objective_type,
      budget_mode: budget_mode_raw,
      operation_status,
    };
    if (budget != null) hopArgs.budget = budget;

    if (dryRunDefault(args)) {
      return okEnvelope(tool, {
        resource: { type: "tiktok_campaign", id: advertiser_id, display_name: campaign_name },
        data: {
          dry_run: true,
          proposed: hopArgs,
          cited: hopArgs,
          note: `No TikTok Marketing API mutate HTTP. Creates default DISABLE. Pass dry_run=false with confirm_phrase containing ${advertiser_id}. Worker TIKTOK_MUTATE_ENABLED fail-closed.`,
        },
      });
    }
    assertConfirmContainsAdvertiserAndIds(args.confirm_phrase, advertiser_id, []);
    return await liveMutateHop(ctx, tool, hopArgs);
  } catch (err) {
    return failCaught(tool, err);
  }
}
