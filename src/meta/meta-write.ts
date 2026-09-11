/**
 * Meta Ads mutate tools — status pause/enable only (Slice 4).
 * Flag DGTL_META_MUTATE_ENABLED defaults off (fail closed, zero Graph mutate HTTP).
 * Tools: meta_update_campaign, meta_update_adset, meta_update_ad.
 * Never touches Consent A / GOOGLE_ACCESS_TOKEN. App secret stays on Worker.
 */

import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import { requireId } from "../ids.js";
import { probeGatewayReachable, postGateway } from "../gateway/client.js";
import { hasFeature } from "../license/verify.js";

const HINT_FLAG =
  "Set DGTL_META_MUTATE_ENABLED=true on the plugin and META_MUTATE_ENABLED=true on stamp only after Meta ads_management Advanced Access. Default stays off. Reads stay ads_read-only.";

const ALLOWED_STATUS = new Set(["ACTIVE", "PAUSED"]);
const ADS_MANAGEMENT = "ads_management";

export type MetaStatusUpdateTool =
  | "meta_update_campaign"
  | "meta_update_adset"
  | "meta_update_ad";

function dryRunDefault(args: Record<string, unknown>): boolean {
  return args.dry_run !== false;
}

export function normalizeAdAccountId(raw: string): string {
  return raw.replace(/^act_/i, "").trim();
}

export function actPhrase(adAccountId: string): string {
  return `act_${normalizeAdAccountId(adAccountId)}`;
}

/**
 * Harness / eval rule: live mutate without a **user** message this turn containing
 * act_{ad_account_id} AND the object id is a fail. List-tool output is not the user message.
 */
export function harnessUserMessageContainsMetaConfirm(opts: {
  userMessageThisTurn: string | null | undefined;
  adAccountId: string;
  objectId: string;
}): boolean {
  const msg = opts.userMessageThisTurn;
  if (msg == null || msg === "") return false;
  const act = actPhrase(opts.adAccountId);
  return msg.includes(act) && msg.includes(opts.objectId);
}

function assertConfirmContainsActAndObject(
  confirmPhrase: unknown,
  adAccountId: string,
  objectId: string,
): void {
  const phrase = typeof confirmPhrase === "string" ? confirmPhrase : "";
  const act = actPhrase(adAccountId);
  if (!phrase.includes(act) || !phrase.includes(objectId)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "Live Meta mutate requires confirm_phrase that includes act_{ad_account_id} AND the object id. Constant phrases without both are not accepted.",
      {
        api: "meta",
        hint: "Prefer dry_run first. Live mutate only after a user message this turn that contains act_{ad_account_id} and the campaign/adset/ad id — list-tool output is not the user message.",
      },
    );
  }
}

function requireMetaLicense(ctx: AppContext, tool: string): Envelope | null {
  if (!hasFeature(ctx.license, "meta")) {
    return failEnvelope(tool, "LICENSE_REQUIRED", MSG.LICENSE_REQUIRED, {
      hint: "Meta Ads is paid. The app secret never ships in this plugin; appsecret_proof is computed on the DGTL gateway.",
    });
  }
  return null;
}

function objectIdKey(tool: MetaStatusUpdateTool): "campaign_id" | "adset_id" | "ad_id" {
  if (tool === "meta_update_campaign") return "campaign_id";
  if (tool === "meta_update_adset") return "adset_id";
  return "ad_id";
}

function resourceType(tool: MetaStatusUpdateTool): string {
  if (tool === "meta_update_campaign") return "meta_campaign";
  if (tool === "meta_update_adset") return "meta_adset";
  return "meta_ad";
}

/**
 * If granted scopes are detectable and ads_management is absent → META_SCOPE_MISSING.
 * When scopes are unknown/empty, do not invent a deny — stamp maps Graph permission errors.
 */
export function assertAdsManagementWhenDetectable(
  scopes: string[] | undefined | null,
): { ok: true } | { ok: false } {
  if (!scopes || scopes.length === 0) return { ok: true };
  const normalized = scopes.map((s) => s.trim().toLowerCase());
  if (normalized.includes(ADS_MANAGEMENT)) return { ok: true };
  return { ok: false };
}

async function metaUpdateStatus(
  ctx: AppContext,
  tool: MetaStatusUpdateTool,
  args: Record<string, unknown>,
): Promise<Envelope> {
  if (!ctx.flags.metaMutateEnabled) {
    return failEnvelope(tool, "META_MUTATE_NOT_ENABLED", MSG.META_MUTATE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: "meta",
    });
  }

  const miss = requireMetaLicense(ctx, tool);
  if (miss) return miss;

  const ad_account_id = normalizeAdAccountId(requireId(args.ad_account_id, "ad_account_id"));
  const idKey = objectIdKey(tool);
  const object_id = requireId(args[idKey], idKey).trim();
  if (!/^\d{1,30}$/.test(object_id)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", `${idKey} must be digits-only`, {
      api: "meta",
    });
  }
  const statusRaw = requireId(args.status, "status").trim().toUpperCase();
  if (!ALLOWED_STATUS.has(statusRaw)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "status must be ACTIVE or PAUSED", {
      api: "meta",
      hint: "Only ACTIVE or PAUSED. DELETED and other statuses are not supported in Slice 4.",
    });
  }

  const dryRun = dryRunDefault(args);
  const proposed = {
    ad_account_id,
    act: actPhrase(ad_account_id),
    [idKey]: object_id,
    status: statusRaw,
  };

  if (dryRun) {
    return okEnvelope(tool, {
      resource: {
        type: resourceType(tool),
        id: object_id,
        display_name: object_id,
      },
      data: {
        dry_run: true,
        proposed,
        cited: { ad_account_id, [idKey]: object_id, status: statusRaw },
        note: `No Meta Graph mutate HTTP. Pass dry_run=false with confirm_phrase containing ${actPhrase(ad_account_id)} AND ${object_id} only after a user message this turn that includes both.`,
      },
    });
  }

  assertConfirmContainsActAndObject(args.confirm_phrase, ad_account_id, object_id);

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

  // Never read ctx.auth / GOOGLE_ACCESS_TOKEN here.
  void ctx.auth;

  const hopArgs: Record<string, unknown> = {
    ad_account_id,
    [idKey]: object_id,
    status: statusRaw,
  };

  const env = await postGateway(ctx, {
    family: "meta",
    tool,
    userAccessToken: metaTok.accessToken,
    args: hopArgs,
  });

  return enrichMetaMutateEnvelope(tool, hopArgs, env);
}

function enrichMetaMutateEnvelope(
  tool: string,
  args: Record<string, unknown>,
  env: Envelope,
): Envelope {
  if (!env.ok) {
    if (env.error_code === "META_SCOPE_MISSING" && !env.hint) {
      env.hint =
        "Meta denied the mutate — usually missing ads_management. Do not silently retry. Reads may still work with ads_read.";
    }
    return env;
  }
  const cited: Record<string, unknown> = {};
  if (typeof args.ad_account_id === "string") cited.ad_account_id = args.ad_account_id;
  if (typeof args.campaign_id === "string") cited.campaign_id = args.campaign_id;
  if (typeof args.adset_id === "string") cited.adset_id = args.adset_id;
  if (typeof args.ad_id === "string") cited.ad_id = args.ad_id;
  if (typeof args.status === "string") cited.status = args.status;
  if (Object.keys(cited).length) {
    const data: Record<string, unknown> =
      env.data && typeof env.data === "object" && !Array.isArray(env.data)
        ? { ...(env.data as Record<string, unknown>) }
        : { rows: env.data };
    if (data.cited === undefined) data.cited = cited;
    env.data = data;
  }
  return env;
}

export async function metaUpdateCampaign(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return metaUpdateStatus(ctx, "meta_update_campaign", args);
}

export async function metaUpdateAdset(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return metaUpdateStatus(ctx, "meta_update_adset", args);
}

export async function metaUpdateAd(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return metaUpdateStatus(ctx, "meta_update_ad", args);
}
