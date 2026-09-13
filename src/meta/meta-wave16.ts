/**
 * Wave 16 named Meta tools — catalog items_batch + CAPI events.
 * dry_run default; live confirm_phrase must include act_{ad_account_id} + catalog_id / pixel_id.
 * CAPI dual-gates Worker META_CAPI_ENABLED (fail-closed, not META_MUTATE_ENABLED).
 * Plugin hashes user_data before hop. Never unhashed PII in hop args, envelopes, or logs.
 * App secret stays on Worker. No agent-facing meta_mutate. Never Axos BM.
 */

import { createHash } from "node:crypto";
import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import { requireId } from "../ids.js";
import { probeGatewayReachable, postGateway } from "../gateway/client.js";
import { metaDisabled } from "./meta.js";
import {
  ADS_MANAGEMENT,
  HINT_FLAG,
  actPhrase,
  assertAdsManagementWhenDetectable,
  assertConfirmContainsActAndIds,
  dryRunDefault,
  normalizeAdAccountId,
  requireMetaLicense,
} from "./meta-write.js";

export const CATALOG_MANAGEMENT = "catalog_management";
export const HINT_CAPI =
  "Plugin Meta CAPI defaults on; set DGTL_META_CAPI_ENABLED=false (or META_CAPI_ENABLED=false) to opt out. Live hop needs Worker META_CAPI_ENABLED=true (fail-closed, separate from META_MUTATE_ENABLED). Polar Pro meta bit. App secret stays on the Worker. Never log unhashed PII.";

const OBJECT_ID_RE = /^\d{1,30}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const PRICE_RE = /^\d+(?:\.\d{1,2})?\s+[A-Z]{3}$/;
const HANDLE_RE = /^[A-Za-z0-9._:-]{1,128}$/;

const ITEM_TYPES = new Set([
  "PRODUCT_ITEM",
  "DESTINATION",
  "FLIGHT",
  "HOME_LISTING",
  "HOTEL",
  "VEHICLE",
]);
const ITEM_METHODS = new Set(["CREATE", "UPDATE", "DELETE"]);
const AVAILABILITY = new Set([
  "in stock",
  "out of stock",
  "preorder",
  "available for order",
  "discontinued",
]);
const CONDITIONS = new Set(["new", "refurbished", "used"]);
const VERTICALS = new Set([
  "commerce",
  "hotels",
  "flights",
  "destinations",
  "vehicles",
  "home_listings",
]);
const CAPI_EVENTS = new Set([
  "Purchase",
  "Lead",
  "CompleteRegistration",
  "AddToCart",
  "AddToWishlist",
  "InitiateCheckout",
  "ViewContent",
  "Search",
  "AddPaymentInfo",
  "Subscribe",
  "StartTrial",
  "SubmitApplication",
  "Contact",
  "CustomizeProduct",
  "Donate",
  "FindLocation",
  "Schedule",
  "PageView",
]);
const ACTION_SOURCES = new Set([
  "website",
  "app",
  "email",
  "phone_call",
  "chat",
  "physical_store",
  "system_generated",
  "business_messaging",
  "other",
]);

const HASHED_USER_KEYS = ["em", "ph", "fn", "ln", "ct", "st", "zp", "country", "external_id"] as const;
const PLAIN_USER_KEYS = ["client_ip_address", "client_user_agent", "fbc", "fbp"] as const;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashCapiUserField(key: (typeof HASHED_USER_KEYS)[number], raw: string): string {
  const trimmed = raw.trim();
  if (SHA256_HEX.test(trimmed)) return trimmed;
  if (key === "em") return sha256Hex(trimmed.toLowerCase());
  if (key === "ph") return sha256Hex(trimmed.replace(/\D/g, ""));
  if (key === "country") return sha256Hex(trimmed.toLowerCase());
  return sha256Hex(trimmed.toLowerCase());
}

export function assertCatalogWriteWhenDetectable(
  scopes: string[] | undefined | null,
): { ok: true } | { ok: false } {
  if (!scopes || scopes.length === 0) return { ok: true };
  const normalized = scopes.map((s) => s.trim().toLowerCase());
  if (normalized.includes(ADS_MANAGEMENT) || normalized.includes(CATALOG_MANAGEMENT)) return { ok: true };
  return { ok: false };
}

function parseAdAccount(args: Record<string, unknown>): string {
  return normalizeAdAccountId(requireId(args.ad_account_id, "ad_account_id"));
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

async function liveCatalogHop(
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
  const metaTok = await ctx.authMeta.getAccessToken();
  if (!metaTok?.accessToken) {
    return failEnvelope(tool, "META_NOT_CONNECTED", MSG.META_NOT_CONNECTED, {
      hint: "License and gateway are ok. Set META_ACCESS_TOKEN or run auth login-meta — never reuse Google Consent A.",
    });
  }
  const scopeCheck = assertCatalogWriteWhenDetectable(metaTok.scopes);
  if (!scopeCheck.ok) {
    return failEnvelope(tool, "META_SCOPE_MISSING", MSG.META_SCOPE_MISSING, {
      api: "meta",
      missing_scope: `${ADS_MANAGEMENT}|${CATALOG_MANAGEMENT}`,
      hint: "Granted scopes are present but lack ads_management or catalog_management. Re-authorize after App Review — do not silently retry.",
    });
  }
  void ctx.auth;
  return postGateway(ctx, {
    family: "meta",
    tool,
    userAccessToken: metaTok.accessToken,
    args: hopArgs,
  });
}

async function liveCapiHop(
  ctx: AppContext,
  tool: string,
  hopArgs: Record<string, unknown>,
): Promise<Envelope> {
  const base = ctx.flags.gatewayUrl;
  if (!base) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: "License + CAPI flag ok. Set DGTL_GATEWAY_URL. Free tools still work.",
    });
  }
  const probe = await probeGatewayReachable(ctx);
  if (!probe.reachable) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: probe.note ?? "Gateway health probe failed.",
    });
  }
  if (probe.meta_capi_enabled !== true) {
    return failEnvelope(tool, "META_CAPI_NOT_ENABLED", MSG.META_CAPI_NOT_ENABLED, {
      hint: HINT_CAPI,
      api: "meta",
    });
  }
  const metaTok = await ctx.authMeta.getAccessToken();
  if (!metaTok?.accessToken) {
    return failEnvelope(tool, "META_NOT_CONNECTED", MSG.META_NOT_CONNECTED, {
      hint: "License and gateway are ok. Set META_ACCESS_TOKEN or run auth login-meta — never reuse Google Consent A.",
    });
  }
  const scopeCheck = assertAdsManagementWhenDetectable(metaTok.scopes);
  if (!scopeCheck.ok) {
    return failEnvelope(tool, "META_SCOPE_MISSING", MSG.META_SCOPE_MISSING, {
      api: "meta",
      missing_scope: ADS_MANAGEMENT,
      hint: "Granted scopes are present but lack ads_management. Re-authorize after Advanced Access — do not silently retry.",
    });
  }
  void ctx.auth;
  return postGateway(ctx, {
    family: "meta",
    tool,
    userAccessToken: metaTok.accessToken,
    args: hopArgs,
  });
}

function parseCatalogItem(
  raw: unknown,
  index: number,
): { ok: true; item: Record<string, unknown> } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: `items[${index}] must be an object` };
  }
  const rec = raw as Record<string, unknown>;
  const method = typeof rec.method === "string" ? rec.method.trim().toUpperCase() : "";
  if (!ITEM_METHODS.has(method)) {
    return { ok: false, message: `items[${index}].method must be CREATE, UPDATE, or DELETE` };
  }
  const retailer_id = typeof rec.retailer_id === "string" ? rec.retailer_id.trim() : "";
  if (!retailer_id || retailer_id.length > 100) {
    return { ok: false, message: `items[${index}].retailer_id is required` };
  }
  const item: Record<string, unknown> = { method, retailer_id };
  if (method === "DELETE") return { ok: true, item };

  const title = typeof rec.title === "string" ? rec.title.trim() : "";
  if (!title || title.length > 200) {
    return { ok: false, message: `items[${index}].title is required for ${method}` };
  }
  item.title = title;

  const link = assertHttpsUrl(rec.link, "link");
  if (!link.ok) return { ok: false, message: `items[${index}].link must be https://…` };
  item.link = link.url;

  const image = assertHttpsUrl(rec.image_link, "image_link");
  if (!image.ok) return { ok: false, message: `items[${index}].image_link must be https://…` };
  item.image_link = image.url;

  if (rec.additional_image_link !== undefined && rec.additional_image_link !== "") {
    const extra = assertHttpsUrl(rec.additional_image_link, "additional_image_link");
    if (!extra.ok) return { ok: false, message: `items[${index}].additional_image_link must be https://…` };
    item.additional_image_link = extra.url;
  }

  const price = typeof rec.price === "string" ? rec.price.trim() : "";
  if (!PRICE_RE.test(price)) {
    return { ok: false, message: `items[${index}].price must look like "9.99 USD"` };
  }
  item.price = price;

  if (typeof rec.availability === "string" && rec.availability.trim()) {
    const a = rec.availability.trim().toLowerCase();
    if (!AVAILABILITY.has(a)) {
      return { ok: false, message: `items[${index}].availability is outside the closed allowlist` };
    }
    item.availability = a;
  }
  if (typeof rec.condition === "string" && rec.condition.trim()) {
    const c = rec.condition.trim().toLowerCase();
    if (!CONDITIONS.has(c)) {
      return { ok: false, message: `items[${index}].condition is outside the closed allowlist` };
    }
    item.condition = c;
  }

  const optionalStrings = [
    "description",
    "brand",
    "item_group_id",
    "sale_price",
    "google_product_category",
    "color",
    "size",
    "gender",
    "age_group",
    "material",
    "pattern",
    "product_type",
    "status",
  ] as const;
  for (const k of optionalStrings) {
    if (typeof rec[k] === "string" && rec[k].trim()) {
      const s = rec[k].trim();
      if (/^https?:\/\//i.test(s) && k !== "sale_price") {
        return { ok: false, message: `items[${index}].${k} must not be a hop URL` };
      }
      item[k] = s.slice(0, 1000);
    }
  }
  if (rec.quantity !== undefined && rec.quantity !== null && rec.quantity !== "") {
    const n = typeof rec.quantity === "number" ? rec.quantity : Number(rec.quantity);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
      return { ok: false, message: `items[${index}].quantity must be a non-negative integer` };
    }
    item.quantity = n;
  }
  return { ok: true, item };
}

function parseCapiEvent(
  raw: unknown,
  index: number,
): { ok: true; event: Record<string, unknown> } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: `events[${index}] must be an object` };
  }
  const rec = raw as Record<string, unknown>;
  const event_name = typeof rec.event_name === "string" ? rec.event_name.trim() : "";
  if (!CAPI_EVENTS.has(event_name)) {
    return { ok: false, message: `events[${index}].event_name is outside the closed CAPI enum` };
  }
  const event_id = typeof rec.event_id === "string" ? rec.event_id.trim() : "";
  if (!event_id || event_id.length > 128) {
    return { ok: false, message: `events[${index}].event_id is required (dedup)` };
  }
  const action_source =
    typeof rec.action_source === "string" && rec.action_source.trim()
      ? rec.action_source.trim()
      : "website";
  if (!ACTION_SOURCES.has(action_source)) {
    return { ok: false, message: `events[${index}].action_source is outside the closed allowlist` };
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

  const event: Record<string, unknown> = {
    event_name,
    event_id,
    event_time,
    action_source,
  };

  if (rec.event_source_url !== undefined && rec.event_source_url !== "") {
    const src = assertHttpsUrl(rec.event_source_url, "event_source_url");
    if (!src.ok) return { ok: false, message: `events[${index}].event_source_url must be https://…` };
    event.event_source_url = src.url;
  }

  for (const k of HASHED_USER_KEYS) {
    if (typeof rec[k] === "string" && rec[k].trim()) {
      event[k] = hashCapiUserField(k, rec[k]);
    }
  }
  for (const k of PLAIN_USER_KEYS) {
    if (typeof rec[k] === "string" && rec[k].trim()) {
      const s = rec[k].trim();
      if (/^https?:\/\//i.test(s)) {
        return { ok: false, message: `events[${index}].${k} must not be a hop URL` };
      }
      event[k] = s.slice(0, 512);
    }
  }

  if (rec.event_value !== undefined && rec.event_value !== null && rec.event_value !== "") {
    const n = typeof rec.event_value === "number" ? rec.event_value : Number(rec.event_value);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, message: `events[${index}].event_value must be a non-negative number` };
    }
    event.event_value = n;
  }
  if (typeof rec.currency === "string" && rec.currency.trim()) {
    const ccy = rec.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(ccy)) {
      return { ok: false, message: `events[${index}].currency must be ISO-4217` };
    }
    event.currency = ccy;
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
    if (ids.length) event.content_ids = ids;
  }
  for (const k of ["content_type", "content_name", "order_id"] as const) {
    if (typeof rec[k] === "string" && rec[k].trim()) event[k] = rec[k].trim().slice(0, 256);
  }
  if (rec.num_items !== undefined && rec.num_items !== null && rec.num_items !== "") {
    const n = typeof rec.num_items === "number" ? rec.num_items : Number(rec.num_items);
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
      return { ok: false, message: `events[${index}].num_items must be a positive integer` };
    }
    event.num_items = n;
  }
  return { ok: true, event };
}

/** Marketing API catalog items_batch upsert. dry_run default; confirm act_ + catalog_id. */
export async function metaCatalogItemsBatch(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "meta_catalog_items_batch";
  if (!ctx.flags.metaMutateEnabled) {
    return failEnvelope(tool, "META_MUTATE_NOT_ENABLED", MSG.META_MUTATE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: "meta",
    });
  }
  const miss = requireMetaLicense(ctx, tool);
  if (miss) return miss;

  try {
    const ad_account_id = parseAdAccount(args);
    if (!/^\d{5,20}$/.test(ad_account_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "ad_account_id must be digits-only", { api: "meta" });
    }
    const catalog_id = requireId(args.catalog_id, "catalog_id").trim();
    if (!OBJECT_ID_RE.test(catalog_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "catalog_id must be digits-only", { api: "meta" });
    }
    const item_type =
      typeof args.item_type === "string" && args.item_type.trim()
        ? args.item_type.trim().toUpperCase()
        : "PRODUCT_ITEM";
    if (!ITEM_TYPES.has(item_type)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "item_type is outside the closed allowlist", {
        api: "meta",
      });
    }
    if (!Array.isArray(args.items) || args.items.length < 1 || args.items.length > 50) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "items must be 1–50 closed catalog rows", {
        api: "meta",
      });
    }
    const items: Array<Record<string, unknown>> = [];
    for (let i = 0; i < args.items.length; i += 1) {
      const parsed = parseCatalogItem(args.items[i], i);
      if (!parsed.ok) {
        return failEnvelope(tool, "INVALID_ARGUMENT", parsed.message, { api: "meta" });
      }
      items.push(parsed.item);
    }
    const hopArgs: Record<string, unknown> = {
      ad_account_id,
      catalog_id,
      item_type,
      items,
    };
    if (args.allow_upsert !== undefined) hopArgs.allow_upsert = args.allow_upsert !== false;

    if (dryRunDefault(args)) {
      return okEnvelope(tool, {
        resource: { type: "meta_catalog", id: catalog_id, display_name: catalog_id },
        data: {
          dry_run: true,
          proposed: { ...hopArgs, act: actPhrase(ad_account_id) },
          cited: { ad_account_id, catalog_id, item_type, item_count: items.length },
          note: `No Meta Graph mutate HTTP. Pass dry_run=false with confirm_phrase containing ${actPhrase(ad_account_id)} AND ${catalog_id}. HTTPS image_link / link only. ads_management or catalog_management when detectable.`,
        },
      });
    }
    assertConfirmContainsActAndIds(args.confirm_phrase, ad_account_id, [catalog_id]);
    return await liveCatalogHop(ctx, tool, hopArgs);
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
}

/** Catalog batch handle status read (check_batch_request_status). */
export async function metaGetBatchStatus(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "meta_get_batch_status";
  try {
    const catalog_id = requireId(args.catalog_id, "catalog_id").trim();
    if (!OBJECT_ID_RE.test(catalog_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "catalog_id must be digits-only", { api: "meta" });
    }
    const handle = requireId(args.handle, "handle").trim();
    if (!HANDLE_RE.test(handle)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "handle must be the items_batch handle (no URL)", {
        api: "meta",
      });
    }
    const hopArgs: Record<string, unknown> = { catalog_id, handle };
    if (typeof args.ad_account_id === "string" && args.ad_account_id.trim()) {
      hopArgs.ad_account_id = normalizeAdAccountId(args.ad_account_id);
    }
    return await metaDisabled(ctx, tool, hopArgs);
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
}

/** Confirm-gated owned product catalog create. */
export async function metaCreateCatalog(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "meta_create_catalog";
  if (!ctx.flags.metaMutateEnabled) {
    return failEnvelope(tool, "META_MUTATE_NOT_ENABLED", MSG.META_MUTATE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: "meta",
    });
  }
  const miss = requireMetaLicense(ctx, tool);
  if (miss) return miss;

  try {
    const ad_account_id = parseAdAccount(args);
    if (!/^\d{5,20}$/.test(ad_account_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "ad_account_id must be digits-only", { api: "meta" });
    }
    const name = requireId(args.name, "name").trim();
    if (!name || name.length > 400 || /[\u0000-\u001f\u007f]/.test(name)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "name must be a non-empty string ≤400 chars", {
        api: "meta",
      });
    }
    const vertical =
      typeof args.vertical === "string" && args.vertical.trim()
        ? args.vertical.trim().toLowerCase()
        : "commerce";
    if (!VERTICALS.has(vertical)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "vertical is outside the closed allowlist", {
        api: "meta",
      });
    }
    const hopArgs: Record<string, unknown> = { ad_account_id, name, vertical };
    if (dryRunDefault(args)) {
      return okEnvelope(tool, {
        resource: { type: "meta_catalog", id: ad_account_id, display_name: name },
        data: {
          dry_run: true,
          proposed: { ...hopArgs, act: actPhrase(ad_account_id) },
          cited: hopArgs,
          note: `No Meta Graph mutate HTTP. Pass dry_run=false with confirm_phrase containing ${actPhrase(ad_account_id)}. ads_management or catalog_management when detectable.`,
        },
      });
    }
    assertConfirmContainsActAndIds(args.confirm_phrase, ad_account_id, []);
    return await liveCatalogHop(ctx, tool, hopArgs);
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
}

/** Closed CAPI event send. Hashes user_data. Requires event_id. Dual-gate META_CAPI_ENABLED. */
export async function metaSendCapiEvents(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "meta_send_capi_events";
  if (!ctx.flags.metaCapiEnabled) {
    return failEnvelope(tool, "META_CAPI_NOT_ENABLED", MSG.META_CAPI_NOT_ENABLED, {
      hint: HINT_CAPI,
      api: "meta",
    });
  }
  const miss = requireMetaLicense(ctx, tool);
  if (miss) return miss;

  try {
    const ad_account_id = parseAdAccount(args);
    if (!/^\d{5,20}$/.test(ad_account_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "ad_account_id must be digits-only", { api: "meta" });
    }
    const pixel_id = requireId(args.pixel_id, "pixel_id").trim();
    if (!OBJECT_ID_RE.test(pixel_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "pixel_id must be digits-only", { api: "meta" });
    }
    if (!Array.isArray(args.events) || args.events.length < 1 || args.events.length > 10) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "events must be 1–10 closed CAPI rows", {
        api: "meta",
      });
    }
    const events: Array<Record<string, unknown>> = [];
    for (let i = 0; i < args.events.length; i += 1) {
      const parsed = parseCapiEvent(args.events[i], i);
      if (!parsed.ok) {
        return failEnvelope(tool, "INVALID_ARGUMENT", parsed.message, { api: "meta" });
      }
      events.push(parsed.event);
    }
    const hopArgs: Record<string, unknown> = {
      ad_account_id,
      pixel_id,
      events,
    };
    if (typeof args.test_event_code === "string" && args.test_event_code.trim()) {
      hopArgs.test_event_code = args.test_event_code.trim().slice(0, 64);
    }

    if (dryRunDefault(args)) {
      return okEnvelope(tool, {
        resource: { type: "meta_pixel", id: pixel_id, display_name: pixel_id },
        data: {
          dry_run: true,
          proposed: { ...hopArgs, act: actPhrase(ad_account_id) },
          cited: {
            ad_account_id,
            pixel_id,
            event_ids: events.map((e) => e.event_id),
            event_names: events.map((e) => e.event_name),
          },
          note: `No Meta CAPI HTTP. user_data is SHA-256 only (never unhashed PII). Pass dry_run=false with confirm_phrase containing ${actPhrase(ad_account_id)} AND ${pixel_id}. Live hop needs Worker META_CAPI_ENABLED=true.`,
        },
      });
    }
    assertConfirmContainsActAndIds(args.confirm_phrase, ad_account_id, [pixel_id]);
    return await liveCapiHop(ctx, tool, hopArgs);
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
}
