/**
 * Meta Ads mutate tools — status / name / adset budget (Slice 4+5).
 * Flag DGTL_META_MUTATE_ENABLED defaults on (opt out with =false). Worker META_MUTATE_ENABLED still required for live hop.
 * Tools: meta_update_campaign, meta_update_adset, meta_update_ad.
 * Budgets are Meta **cents** (smallest currency unit), not Google Ads micros.
 * Never touches Consent A / GOOGLE_ACCESS_TOKEN. App secret stays on Worker.
 */

import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import { requireId } from "../ids.js";
import { probeGatewayReachable, postGateway } from "../gateway/client.js";
import { hasFeature } from "../license/verify.js";

const HINT_FLAG =
  "Plugin Meta mutate defaults on; set DGTL_META_MUTATE_ENABLED=false (or META_MUTATE_ENABLED=false) to opt out. Live hop still needs Worker META_MUTATE_ENABLED=true after Meta ads_management Advanced Access. Reads stay ads_read-only.";

const ALLOWED_STATUS = new Set(["ACTIVE", "PAUSED"]);
const ADS_MANAGEMENT = "ads_management";
const NAME_MAX = 400;

/**
 * Same $100k/day product sanity cap as Google Ads, expressed in Meta cents
 * (USD-equivalent). Override is Worker-side (META_MUTATE_MAX_BUDGET_CENTS).
 */
export const DEFAULT_MAX_META_BUDGET_CENTS = 10_000_000; // $100,000.00

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

export function resolveMetaBudgetCents(
  raw: unknown,
): { ok: true; cents: string; cents_number: number } | { ok: false; reason: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: false, reason: "missing_budget" };
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw <= 0) {
      return { ok: false, reason: "invalid_budget" };
    }
    return { ok: true, cents: String(raw), cents_number: raw };
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!/^\d{1,18}$/.test(s)) return { ok: false, reason: "invalid_budget" };
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: "invalid_budget" };
    return { ok: true, cents: s, cents_number: n };
  }
  return { ok: false, reason: "invalid_budget" };
}

function normalizeOptionalName(
  raw: unknown,
): { ok: true; name?: string } | { ok: false; reason: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true };
  if (typeof raw !== "string") return { ok: false, reason: "invalid_name" };
  const name = raw.trim();
  if (!name || name.length > NAME_MAX) return { ok: false, reason: "invalid_name" };
  if (/[\u0000-\u001f\u007f]/.test(name)) return { ok: false, reason: "invalid_name" };
  return { ok: true, name };
}

type ParsedUpdate = {
  ad_account_id: string;
  object_id: string;
  idKey: "campaign_id" | "adset_id" | "ad_id";
  status?: string;
  name?: string;
  daily_budget?: string;
  lifetime_budget?: string;
};

function parseUpdateArgs(
  tool: MetaStatusUpdateTool,
  args: Record<string, unknown>,
): { ok: true; parsed: ParsedUpdate } | { ok: false; envelope: Envelope } {
  const ad_account_id = normalizeAdAccountId(requireId(args.ad_account_id, "ad_account_id"));
  const idKey = objectIdKey(tool);
  const object_id = requireId(args[idKey], idKey).trim();
  if (!/^\d{1,30}$/.test(object_id)) {
    return {
      ok: false,
      envelope: failEnvelope(tool, "INVALID_ARGUMENT", `${idKey} must be digits-only`, {
        api: "meta",
      }),
    };
  }

  const parsed: ParsedUpdate = { ad_account_id, object_id, idKey };

  if (args.status !== undefined && args.status !== null && args.status !== "") {
    const statusRaw = requireId(args.status, "status").trim().toUpperCase();
    if (!ALLOWED_STATUS.has(statusRaw)) {
      return {
        ok: false,
        envelope: failEnvelope(tool, "INVALID_ARGUMENT", "status must be ACTIVE or PAUSED", {
          api: "meta",
          hint: "Only ACTIVE or PAUSED. DELETED and other statuses are not supported.",
        }),
      };
    }
    parsed.status = statusRaw;
  }

  const name = normalizeOptionalName(args.name);
  if (!name.ok) {
    return {
      ok: false,
      envelope: failEnvelope(tool, "INVALID_ARGUMENT", "name must be a non-empty string ≤400 chars", {
        api: "meta",
      }),
    };
  }
  if (name.name) parsed.name = name.name;

  const hasDaily =
    args.daily_budget !== undefined && args.daily_budget !== null && args.daily_budget !== "";
  const hasLife =
    args.lifetime_budget !== undefined &&
    args.lifetime_budget !== null &&
    args.lifetime_budget !== "";

  if (tool === "meta_update_adset") {
    if (hasDaily && hasLife) {
      return {
        ok: false,
        envelope: failEnvelope(
          tool,
          "INVALID_ARGUMENT",
          "Provide daily_budget OR lifetime_budget (not both). Units: integer cents (Meta account currency smallest unit — not Google Ads micros).",
          { api: "meta" },
        ),
      };
    }
    if (hasDaily) {
      const b = resolveMetaBudgetCents(args.daily_budget);
      if (!b.ok) {
        return {
          ok: false,
          envelope: failEnvelope(
            tool,
            "INVALID_ARGUMENT",
            "daily_budget must be a positive integer in cents",
            {
              api: "meta",
              hint: "Meta budgets are cents (e.g. 5000 = $50.00 USD), not micros.",
            },
          ),
        };
      }
      if (b.cents_number > DEFAULT_MAX_META_BUDGET_CENTS) {
        return {
          ok: false,
          envelope: failEnvelope(tool, "SPEND_CAP_EXCEEDED", MSG.SPEND_CAP_EXCEEDED, {
            api: "meta",
            hint: `Max Meta daily_budget / lifetime_budget is ${DEFAULT_MAX_META_BUDGET_CENTS} cents ($100,000). Units are cents, not micros. No Graph mutate HTTP was sent.`,
          }),
        };
      }
      parsed.daily_budget = b.cents;
    }
    if (hasLife) {
      const b = resolveMetaBudgetCents(args.lifetime_budget);
      if (!b.ok) {
        return {
          ok: false,
          envelope: failEnvelope(
            tool,
            "INVALID_ARGUMENT",
            "lifetime_budget must be a positive integer in cents",
            { api: "meta" },
          ),
        };
      }
      if (b.cents_number > DEFAULT_MAX_META_BUDGET_CENTS) {
        return {
          ok: false,
          envelope: failEnvelope(tool, "SPEND_CAP_EXCEEDED", MSG.SPEND_CAP_EXCEEDED, {
            api: "meta",
            hint: `Max Meta daily_budget / lifetime_budget is ${DEFAULT_MAX_META_BUDGET_CENTS} cents ($100,000). Units are cents, not micros. No Graph mutate HTTP was sent.`,
          }),
        };
      }
      parsed.lifetime_budget = b.cents;
    }
  } else if (hasDaily || hasLife) {
    return {
      ok: false,
      envelope: failEnvelope(
        tool,
        "INVALID_ARGUMENT",
        "Budget fields are only allowed on meta_update_adset (closed allowlist). Do not invent campaign/ad budget fields.",
        { api: "meta" },
      ),
    };
  }

  if (
    !parsed.status &&
    !parsed.name &&
    !parsed.daily_budget &&
    !parsed.lifetime_budget
  ) {
    return {
      ok: false,
      envelope: failEnvelope(
        tool,
        "INVALID_ARGUMENT",
        tool === "meta_update_adset"
          ? "Provide at least one of: status, name, daily_budget, lifetime_budget"
          : "Provide at least one of: status, name",
        { api: "meta" },
      ),
    };
  }

  return { ok: true, parsed };
}

async function metaUpdateFields(
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

  let parsedResult: ReturnType<typeof parseUpdateArgs>;
  try {
    parsedResult = parseUpdateArgs(tool, args);
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
  if (!parsedResult.ok) return parsedResult.envelope;
  const { parsed } = parsedResult;

  const dryRun = dryRunDefault(args);
  const proposed: Record<string, unknown> = {
    ad_account_id: parsed.ad_account_id,
    act: actPhrase(parsed.ad_account_id),
    [parsed.idKey]: parsed.object_id,
  };
  if (parsed.status) proposed.status = parsed.status;
  if (parsed.name) proposed.name = parsed.name;
  if (parsed.daily_budget) {
    proposed.daily_budget = parsed.daily_budget;
    proposed.budget_units = "cents";
  }
  if (parsed.lifetime_budget) {
    proposed.lifetime_budget = parsed.lifetime_budget;
    proposed.budget_units = "cents";
  }

  if (dryRun) {
    return okEnvelope(tool, {
      resource: {
        type: resourceType(tool),
        id: parsed.object_id,
        display_name: parsed.name ?? parsed.object_id,
      },
      data: {
        dry_run: true,
        proposed,
        cited: {
          ad_account_id: parsed.ad_account_id,
          [parsed.idKey]: parsed.object_id,
          ...(parsed.status ? { status: parsed.status } : {}),
          ...(parsed.name ? { name: parsed.name } : {}),
          ...(parsed.daily_budget ? { daily_budget: parsed.daily_budget } : {}),
          ...(parsed.lifetime_budget ? { lifetime_budget: parsed.lifetime_budget } : {}),
        },
        note: `No Meta Graph mutate HTTP. Pass dry_run=false with confirm_phrase containing ${actPhrase(parsed.ad_account_id)} AND ${parsed.object_id} only after a user message this turn that includes both. Closed fields only — do not invent objective/creative/targeting.`,
      },
    });
  }

  try {
    assertConfirmContainsActAndObject(args.confirm_phrase, parsed.ad_account_id, parsed.object_id);
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

  // Never read ctx.auth / GOOGLE_ACCESS_TOKEN here.
  void ctx.auth;

  const hopArgs: Record<string, unknown> = {
    ad_account_id: parsed.ad_account_id,
    [parsed.idKey]: parsed.object_id,
  };
  if (parsed.status) hopArgs.status = parsed.status;
  if (parsed.name) hopArgs.name = parsed.name;
  if (parsed.daily_budget) hopArgs.daily_budget = parsed.daily_budget;
  if (parsed.lifetime_budget) hopArgs.lifetime_budget = parsed.lifetime_budget;

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
  if (typeof args.name === "string") cited.name = args.name;
  if (typeof args.daily_budget === "string") cited.daily_budget = args.daily_budget;
  if (typeof args.lifetime_budget === "string") cited.lifetime_budget = args.lifetime_budget;
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
  return metaUpdateFields(ctx, "meta_update_campaign", args);
}

export async function metaUpdateAdset(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return metaUpdateFields(ctx, "meta_update_adset", args);
}

export async function metaUpdateAd(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return metaUpdateFields(ctx, "meta_update_ad", args);
}
