/**
 * Wave 3 named Meta tools — targeting packs, placements, pixel/catalog read, audiences.
 * dry_run default; live confirm_phrase must include act_{ad_account_id} (+ child ids).
 * No agent-facing meta_mutate envelope. No hashed PII / Customer Match.
 */

import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import { requireId } from "../ids.js";
import { probeGatewayReachable, postGateway } from "../gateway/client.js";
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
import { metaDisabled } from "./meta.js";

const OBJECT_ID_RE = /^\d{1,30}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

const TARGETING_PACK_KEYS = [
  "countries",
  "age_min",
  "age_max",
  "genders",
  "locales",
  "interest_ids",
  "behavior_ids",
  "custom_audience_ids",
  "excluded_custom_audience_ids",
  "publisher_platforms",
  "facebook_positions",
  "instagram_positions",
  "audience_network_positions",
  "messenger_positions",
  "device_platforms",
] as const;

function copyPack(args: Record<string, unknown>, extra: readonly string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of [...TARGETING_PACK_KEYS, ...extra]) {
    if (args[k] !== undefined && args[k] !== null && args[k] !== "") out[k] = args[k];
  }
  return out;
}

async function liveMetaMutateHop(
  ctx: AppContext,
  tool: string,
  ad_account_id: string,
  confirmIds: string[],
  args: Record<string, unknown>,
  hopArgs: Record<string, unknown>,
  dryNote: string,
  resource: { type: string; id: string; display_name: string },
): Promise<Envelope> {
  if (!ctx.flags.metaMutateEnabled) {
    return failEnvelope(tool, "META_MUTATE_NOT_ENABLED", MSG.META_MUTATE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: "meta",
    });
  }
  const miss = requireMetaLicense(ctx, tool);
  if (miss) return miss;

  const dryRun = dryRunDefault(args);
  const proposed = {
    ...hopArgs,
    act: actPhrase(ad_account_id),
  };
  if (dryRun) {
    return okEnvelope(tool, {
      resource,
      data: {
        dry_run: true,
        proposed,
        cited: hopArgs,
        note: dryNote,
      },
    });
  }

  try {
    assertConfirmContainsActAndIds(args.confirm_phrase, ad_account_id, confirmIds);
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }

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
  const scopeCheck = assertAdsManagementWhenDetectable(metaTok.scopes);
  if (!scopeCheck.ok) {
    return failEnvelope(tool, "META_SCOPE_MISSING", MSG.META_SCOPE_MISSING, {
      api: "meta",
      missing_scope: ADS_MANAGEMENT,
      hint: "Granted scopes are present but lack ads_management. Re-authorize Meta after Advanced Access — do not silently retry.",
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

function parseAdAccount(args: Record<string, unknown>): string {
  return normalizeAdAccountId(requireId(args.ad_account_id, "ad_account_id"));
}

export async function metaListPixels(ctx: AppContext, args: Record<string, unknown>): Promise<Envelope> {
  return metaDisabled(ctx, "meta_list_pixels", args);
}

export async function metaGetPixel(ctx: AppContext, args: Record<string, unknown>): Promise<Envelope> {
  return metaDisabled(ctx, "meta_get_pixel", args);
}

export async function metaListCatalogs(ctx: AppContext, args: Record<string, unknown>): Promise<Envelope> {
  return metaDisabled(ctx, "meta_list_catalogs", args);
}

export async function metaListCatalogProducts(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return metaDisabled(ctx, "meta_list_catalog_products", args);
}

export async function metaListCustomAudiences(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return metaDisabled(ctx, "meta_list_custom_audiences", args);
}

export async function metaUpdateAdsetTargeting(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "meta_update_adset_targeting";
  try {
    const ad_account_id = parseAdAccount(args);
    if (!/^\d{5,20}$/.test(ad_account_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "ad_account_id must be digits-only", { api: "meta" });
    }
    const adset_id = requireId(args.adset_id, "adset_id").trim();
    if (!OBJECT_ID_RE.test(adset_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "adset_id must be digits-only", { api: "meta" });
    }
    const countriesRaw = args.countries;
    if (countriesRaw === undefined || countriesRaw === null || countriesRaw === "") {
      return failEnvelope(
        tool,
        "INVALID_ARGUMENT",
        "countries are required (ISO-3166-1 alpha-2). Targeting update replaces the ad set targeting object — include geo.",
        { api: "meta" },
      );
    }
    const hopArgs: Record<string, unknown> = {
      ad_account_id,
      adset_id,
      ...copyPack(args, ["pixel_id", "custom_event_type", "catalog_id", "product_set_id"]),
    };
    return await liveMetaMutateHop(
      ctx,
      tool,
      ad_account_id,
      [adset_id],
      args,
      hopArgs,
      `No Meta Graph mutate HTTP. Targeting is server-built from named packs (never send targeting JSON). Pass dry_run=false with confirm_phrase containing ${actPhrase(ad_account_id)} AND ${adset_id}. Live hop needs ads_management Advanced Access (META_SCOPE_MISSING if missing).`,
      { type: "meta_adset", id: adset_id, display_name: adset_id },
    );
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
}

export async function metaAttachAudience(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "meta_attach_audience";
  try {
    const ad_account_id = parseAdAccount(args);
    if (!/^\d{5,20}$/.test(ad_account_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "ad_account_id must be digits-only", { api: "meta" });
    }
    const adset_id = requireId(args.adset_id, "adset_id").trim();
    if (!OBJECT_ID_RE.test(adset_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "adset_id must be digits-only", { api: "meta" });
    }
    if (args.custom_audience_ids === undefined || args.custom_audience_ids === null || args.custom_audience_ids === "") {
      return failEnvelope(tool, "INVALID_ARGUMENT", "custom_audience_ids is required", { api: "meta" });
    }
    if (args.countries === undefined || args.countries === null || args.countries === "") {
      return failEnvelope(
        tool,
        "INVALID_ARGUMENT",
        "countries are required. Attach replaces ad set targeting — include geo plus custom_audience_ids.",
        { api: "meta" },
      );
    }
    const hopArgs: Record<string, unknown> = {
      ad_account_id,
      adset_id,
      ...copyPack(args),
    };
    return await liveMetaMutateHop(
      ctx,
      tool,
      ad_account_id,
      [adset_id],
      args,
      hopArgs,
      `No Meta Graph mutate HTTP. Server builds targeting.custom_audiences from named ids. Pass dry_run=false with confirm_phrase containing ${actPhrase(ad_account_id)} AND ${adset_id}.`,
      { type: "meta_adset", id: adset_id, display_name: adset_id },
    );
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
}

export async function metaCreateCustomAudience(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "meta_create_custom_audience";
  try {
    const ad_account_id = parseAdAccount(args);
    if (!/^\d{5,20}$/.test(ad_account_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "ad_account_id must be digits-only", { api: "meta" });
    }
    const name = requireId(args.name, "name").trim();
    const pixel_id = requireId(args.pixel_id, "pixel_id").trim();
    if (!OBJECT_ID_RE.test(pixel_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "pixel_id must be digits-only", { api: "meta" });
    }
    const hopArgs: Record<string, unknown> = {
      ad_account_id,
      name,
      pixel_id,
    };
    if (args.retention_days !== undefined && args.retention_days !== null && args.retention_days !== "") {
      hopArgs.retention_days = args.retention_days;
    }
    if (typeof args.url_contains === "string" && args.url_contains.trim()) {
      const needle = args.url_contains.trim();
      if (/^https?:\/\//i.test(needle)) {
        return failEnvelope(
          tool,
          "INVALID_ARGUMENT",
          "url_contains is a path substring (e.g. /shop), not a hop URL",
          { api: "meta" },
        );
      }
      hopArgs.url_contains = needle;
    }
    if (args.prefill !== undefined) hopArgs.prefill = args.prefill;
    hopArgs.subtype = "WEBSITE";
    return await liveMetaMutateHop(
      ctx,
      tool,
      ad_account_id,
      [pixel_id],
      args,
      hopArgs,
      `No Meta Graph mutate HTTP. Website custom audience from pixel (no hashed PII / Customer Match). Pass dry_run=false with confirm_phrase containing ${actPhrase(ad_account_id)} AND ${pixel_id}.`,
      { type: "meta_custom_audience", id: ad_account_id, display_name: name },
    );
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
}

export async function metaCreateLookalikeAudience(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "meta_create_lookalike_audience";
  try {
    const ad_account_id = parseAdAccount(args);
    if (!/^\d{5,20}$/.test(ad_account_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "ad_account_id must be digits-only", { api: "meta" });
    }
    const name = requireId(args.name, "name").trim();
    const origin_audience_id = requireId(args.origin_audience_id, "origin_audience_id").trim();
    if (!OBJECT_ID_RE.test(origin_audience_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "origin_audience_id must be digits-only", { api: "meta" });
    }
    const country = requireId(args.country, "country").trim().toUpperCase();
    if (!COUNTRY_RE.test(country)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "country must be ISO-3166-1 alpha-2", { api: "meta" });
    }
    const hopArgs: Record<string, unknown> = {
      ad_account_id,
      name,
      origin_audience_id,
      country,
    };
    if (args.lookalike_ratio !== undefined && args.lookalike_ratio !== null && args.lookalike_ratio !== "") {
      hopArgs.lookalike_ratio = args.lookalike_ratio;
    }
    if (typeof args.lookalike_type === "string" && args.lookalike_type.trim()) {
      hopArgs.lookalike_type = args.lookalike_type.trim().toLowerCase();
    }
    return await liveMetaMutateHop(
      ctx,
      tool,
      ad_account_id,
      [origin_audience_id],
      args,
      hopArgs,
      `No Meta Graph mutate HTTP. Lookalike from origin_audience_id (server-built lookalike_spec). Pass dry_run=false with confirm_phrase containing ${actPhrase(ad_account_id)} AND ${origin_audience_id}.`,
      { type: "meta_lookalike_audience", id: ad_account_id, display_name: name },
    );
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
}
