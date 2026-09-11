/**
 * Meta Ads mutate tools — status / name / adset budget (Slice 4+5).
 * Flag DGTL_META_MUTATE_ENABLED defaults on (opt out with =false). Worker META_MUTATE_ENABLED still required for live hop.
 * Tools: meta_update_* + meta_create_* + meta_upload_ad_image/video + meta_create_ad_creative.
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
/** Meta write scope — never on Consent A. W0.5: CONSENT_A ∩ ads_management = ∅ */
export const ADS_MANAGEMENT = "ads_management";
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

function assertConfirmContainsActAndIds(
  confirmPhrase: unknown,
  adAccountId: string,
  extraIds: string[],
): void {
  const phrase = typeof confirmPhrase === "string" ? confirmPhrase : "";
  const act = actPhrase(adAccountId);
  const missing = !phrase.includes(act) || extraIds.some((id) => id && !phrase.includes(id));
  if (missing) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "Live Meta mutate requires confirm_phrase that includes act_{ad_account_id} AND the relevant ids. Constant phrases without both are not accepted.",
      {
        api: "meta",
        hint: "Prefer dry_run first. Live mutate only after a user message this turn that contains act_{ad_account_id} and the campaign/adset/ad/creative ids — list-tool output is not the user message.",
      },
    );
  }
}

function assertConfirmContainsActAndObject(
  confirmPhrase: unknown,
  adAccountId: string,
  objectId: string,
): void {
  assertConfirmContainsActAndIds(confirmPhrase, adAccountId, [objectId]);
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


export type MetaCreateTool = "meta_create_campaign" | "meta_create_adset" | "meta_create_ad";

const META_OBJECTIVES = new Set([
  "OUTCOME_AWARENESS",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
  "OUTCOME_TRAFFIC",
  "OUTCOME_APP_PROMOTION",
]);
const META_BILLING = new Set(["IMPRESSIONS", "LINK_CLICKS"]);
const META_OPT = new Set([
  "LINK_CLICKS",
  "LANDING_PAGE_VIEWS",
  "IMPRESSIONS",
  "REACH",
  "OFFSITE_CONVERSIONS",
  "LEAD_GENERATION",
  "VALUE",
  "THRUPLAY",
]);
const META_BID = new Set(["LOWEST_COST_WITHOUT_CAP"]);
const COUNTRY_RE = /^[A-Z]{2}$/;

function normalizeCountriesPlugin(
  raw: unknown,
): { ok: true; countries: string[] } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") return { ok: false };
  let list: unknown[] = [];
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s) as unknown;
        if (!Array.isArray(parsed)) return { ok: false };
        list = parsed;
      } catch {
        return { ok: false };
      }
    } else {
      list = s.split(/[\s,]+/).filter(Boolean);
    }
  } else if (Array.isArray(raw)) {
    list = raw;
  } else {
    return { ok: false };
  }
  if (list.length < 1 || list.length > 50) return { ok: false };
  const countries: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") return { ok: false };
    const c = item.trim().toUpperCase();
    if (!COUNTRY_RE.test(c)) return { ok: false };
    countries.push(c);
  }
  return { ok: true, countries };
}

function createResourceType(tool: MetaCreateTool): string {
  if (tool === "meta_create_campaign") return "meta_campaign";
  if (tool === "meta_create_adset") return "meta_adset";
  return "meta_ad";
}

async function metaCreateObject(
  ctx: AppContext,
  tool: MetaCreateTool,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const common = ["ad_account_id", "name", "status", "dry_run", "confirm_phrase"];
  const allowed = new Set(
    tool === "meta_create_campaign"
      ? [...common, "objective", "special_ad_categories"]
      : tool === "meta_create_adset"
        ? [
            ...common,
            "campaign_id",
            "daily_budget",
            "lifetime_budget",
            "billing_event",
            "optimization_goal",
            "bid_strategy",
            "countries",
            "end_time",
          ]
        : [...common, "adset_id", "creative_id"],
  );
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", `Field ${key} is not allowed for ${tool}`, {
        api: "meta",
        hint: "Closed create fields only. Do not send raw body/targeting/creative/object_story_spec/upload fields.",
      });
    }
  }

  if (!ctx.flags.metaMutateEnabled) {
    return failEnvelope(tool, "META_MUTATE_NOT_ENABLED", MSG.META_MUTATE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: "meta",
    });
  }
  const miss = requireMetaLicense(ctx, tool);
  if (miss) return miss;

  let ad_account_id: string;
  try {
    ad_account_id = normalizeAdAccountId(requireId(args.ad_account_id, "ad_account_id"));
    if (!/^\d{5,20}$/.test(ad_account_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "ad_account_id must be digits-only (act_ prefix optional)", {
        api: "meta",
      });
    }
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }

  const nameN =
    typeof args.name === "string" ? args.name.trim() : "";
  if (!nameN || nameN.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(nameN)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "name must be a non-empty string ≤400 chars", {
      api: "meta",
    });
  }
  const statusRaw =
    args.status === undefined || args.status === null || args.status === ""
      ? "PAUSED"
      : String(args.status).trim().toUpperCase();
  if (!ALLOWED_STATUS.has(statusRaw)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "status must be ACTIVE or PAUSED", { api: "meta" });
  }

  const hopArgs: Record<string, unknown> = {
    ad_account_id,
    name: nameN,
    status: statusRaw,
  };
  const confirmIds: string[] = [];

  if (tool === "meta_create_campaign") {
    const objective = typeof args.objective === "string" ? args.objective.trim().toUpperCase() : "";
    if (!META_OBJECTIVES.has(objective)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "objective must be a closed OUTCOME_* value", {
        api: "meta",
      });
    }
    hopArgs.objective = objective;
    if (args.special_ad_categories !== undefined) {
      hopArgs.special_ad_categories = args.special_ad_categories;
    }
  } else if (tool === "meta_create_adset") {
    const campaign_id = requireId(args.campaign_id, "campaign_id").trim();
    if (!/^\d{1,30}$/.test(campaign_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "campaign_id must be digits-only", { api: "meta" });
    }
    hopArgs.campaign_id = campaign_id;
    confirmIds.push(campaign_id);
    const hasDaily =
      args.daily_budget !== undefined && args.daily_budget !== null && args.daily_budget !== "";
    const hasLife =
      args.lifetime_budget !== undefined &&
      args.lifetime_budget !== null &&
      args.lifetime_budget !== "";
    if (hasDaily === hasLife) {
      return failEnvelope(
        tool,
        "INVALID_ARGUMENT",
        "Provide daily_budget OR lifetime_budget (not both). Units: integer cents (not Google Ads micros).",
        { api: "meta" },
      );
    }
    const rawBudget = hasDaily ? args.daily_budget : args.lifetime_budget;
    const b = resolveMetaBudgetCents(rawBudget);
    if (!b.ok) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "budget must be a positive integer in cents", {
        api: "meta",
        hint: "Meta budgets are cents (e.g. 5000 = $50.00 USD), not micros.",
      });
    }
    if (b.cents_number > DEFAULT_MAX_META_BUDGET_CENTS) {
      return failEnvelope(tool, "SPEND_CAP_EXCEEDED", MSG.SPEND_CAP_EXCEEDED, {
        api: "meta",
        hint: `Max Meta daily_budget / lifetime_budget is ${DEFAULT_MAX_META_BUDGET_CENTS} cents ($100,000). Units are cents, not micros. No Graph mutate HTTP was sent.`,
      });
    }
    if (hasDaily) hopArgs.daily_budget = b.cents;
    else hopArgs.lifetime_budget = b.cents;
    if (hasLife) {
      if (typeof args.end_time !== "string" || !args.end_time.trim()) {
        return failEnvelope(tool, "INVALID_ARGUMENT", "end_time is required when using lifetime_budget", {
          api: "meta",
        });
      }
      hopArgs.end_time = args.end_time.trim();
    }
    const countries = normalizeCountriesPlugin(args.countries);
    if (!countries.ok) {
      return failEnvelope(
        tool,
        "INVALID_ARGUMENT",
        "countries must be ISO-3166-1 alpha-2 codes (server builds targeting.geo_locations — do not send targeting JSON)",
        { api: "meta" },
      );
    }
    hopArgs.countries = countries.countries;
    if (args.billing_event !== undefined && args.billing_event !== "") {
      const be = String(args.billing_event).trim().toUpperCase();
      if (!META_BILLING.has(be)) {
        return failEnvelope(tool, "INVALID_ARGUMENT", "billing_event must be IMPRESSIONS or LINK_CLICKS", {
          api: "meta",
        });
      }
      hopArgs.billing_event = be;
    }
    if (args.optimization_goal !== undefined && args.optimization_goal !== "") {
      const og = String(args.optimization_goal).trim().toUpperCase();
      if (!META_OPT.has(og)) {
        return failEnvelope(tool, "INVALID_ARGUMENT", "optimization_goal is outside the closed allowlist", {
          api: "meta",
        });
      }
      hopArgs.optimization_goal = og;
    }
    if (args.bid_strategy !== undefined && args.bid_strategy !== "") {
      const bs = String(args.bid_strategy).trim().toUpperCase();
      if (!META_BID.has(bs)) {
        return failEnvelope(tool, "INVALID_ARGUMENT", "bid_strategy is outside the closed allowlist", {
          api: "meta",
        });
      }
      hopArgs.bid_strategy = bs;
    }
  } else {
    const adset_id = requireId(args.adset_id, "adset_id").trim();
    const creative_id = requireId(args.creative_id, "creative_id").trim();
    if (!/^\d{1,30}$/.test(adset_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "adset_id must be digits-only", { api: "meta" });
    }
    if (!/^\d{1,30}$/.test(creative_id)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "creative_id must be digits-only (existing creative; no upload)", {
        api: "meta",
      });
    }
    hopArgs.adset_id = adset_id;
    hopArgs.creative_id = creative_id;
    confirmIds.push(adset_id, creative_id);
  }

  const dryRun = dryRunDefault(args);
  const proposed = {
    ...hopArgs,
    act: actPhrase(ad_account_id),
    budget_units: hopArgs.daily_budget || hopArgs.lifetime_budget ? "cents" : undefined,
  };

  if (dryRun) {
    return okEnvelope(tool, {
      resource: {
        type: createResourceType(tool),
        id: ad_account_id,
        display_name: nameN,
      },
      data: {
        dry_run: true,
        proposed,
        cited: hopArgs,
        note: `No Meta Graph mutate HTTP. New objects default PAUSED unless status=ACTIVE. Pass dry_run=false with confirm_phrase containing ${actPhrase(ad_account_id)}${confirmIds.length ? " AND " + confirmIds.join(" AND ") : ""} only after a user message this turn that includes them. Closed fields only — no creative upload / targeting bag / open Graph proxy. ads_management Advanced Access still required for live hop (META_SCOPE_MISSING if missing).`,
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

  const env = await postGateway(ctx, {
    family: "meta",
    tool,
    userAccessToken: metaTok.accessToken,
    args: hopArgs,
  });
  return enrichMetaMutateEnvelope(tool, hopArgs, env);
}

export async function metaCreateCampaign(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  try {
    return await metaCreateObject(ctx, "meta_create_campaign", args);
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope("meta_create_campaign", err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
}

export async function metaCreateAdset(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  try {
    return await metaCreateObject(ctx, "meta_create_adset", args);
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope("meta_create_adset", err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
}

export async function metaCreateAd(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  try {
    return await metaCreateObject(ctx, "meta_create_ad", args);
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope("meta_create_ad", err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
}

const META_CTA = new Set([
  "LEARN_MORE",
  "SHOP_NOW",
  "SIGN_UP",
  "CONTACT_US",
  "DOWNLOAD",
  "BOOK_TRAVEL",
  "GET_OFFER",
  "SUBSCRIBE",
  "APPLY_NOW",
  "GET_QUOTE",
  "BUY_NOW",
  "NO_BUTTON",
]);

export type MetaCreativeTool =
  | "meta_upload_ad_image"
  | "meta_upload_ad_video"
  | "meta_create_ad_creative";

function gateMetaMutateOrFail(ctx: AppContext, tool: string): Envelope | null {
  if (!ctx.flags.metaMutateEnabled) {
    return failEnvelope(tool, "META_MUTATE_NOT_ENABLED", MSG.META_MUTATE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: "meta",
    });
  }
  return requireMetaLicense(ctx, tool);
}

async function liveMetaCreativeHop(
  ctx: AppContext,
  tool: MetaCreativeTool,
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
  const scopeCheck = assertAdsManagementWhenDetectable(metaTok.scopes);
  if (!scopeCheck.ok) {
    return failEnvelope(tool, "META_SCOPE_MISSING", MSG.META_SCOPE_MISSING, {
      api: "meta",
      missing_scope: ADS_MANAGEMENT,
      hint: "Granted scopes are present but lack ads_management. Re-authorize Meta after Advanced Access — do not silently retry.",
    });
  }
  void ctx.auth;
  const env = await postGateway(ctx, {
    family: "meta",
    tool,
    userAccessToken: metaTok.accessToken,
    args: hopArgs,
  });
  return enrichMetaMutateEnvelope(tool, hopArgs, env);
}

function assertHttpsLanding(raw: unknown, field: string): { ok: true; url: string } | { ok: false; reason: string } {
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

/** Upload Meta ad image (base64) → image_hash for AdCreative. Confirm-gated; dry_run default. */
export async function metaUploadAdImage(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "meta_upload_ad_image";
  const miss = gateMetaMutateOrFail(ctx, tool);
  if (miss) return miss;

  const allowed = new Set(["ad_account_id", "bytes", "name", "dry_run", "confirm_phrase"]);
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", `Field ${key} is not allowed for ${tool}`, {
        api: "meta",
        hint: "Closed upload fields only — bytes (base64) + optional name. No open Graph proxy.",
      });
    }
  }

  let ad_account_id: string;
  try {
    ad_account_id = normalizeAdAccountId(requireId(args.ad_account_id, "ad_account_id"));
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
  if (!/^\d{5,20}$/.test(ad_account_id)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "ad_account_id must be digits-only (act_ prefix optional)", {
      api: "meta",
    });
  }
  const bytes = typeof args.bytes === "string" ? args.bytes.trim() : "";
  if (bytes.length < 32 || bytes.length > 4_000_000) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "bytes must be base64 (32…4e6 chars)", { api: "meta" });
  }
  const hopArgs: Record<string, unknown> = { ad_account_id, bytes };
  if (typeof args.name === "string" && args.name.trim()) {
    const n = args.name.trim();
    if (n.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(n)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", "name must be ≤400 chars", { api: "meta" });
    }
    hopArgs.name = n;
  }

  if (dryRunDefault(args)) {
    return okEnvelope(tool, {
      resource: { type: "meta_ad_account", id: ad_account_id, display_name: "adimages" },
      data: {
        dry_run: true,
        proposed: { ad_account_id, bytes_len: bytes.length, name: hopArgs.name },
        note: `No Meta Graph upload HTTP. Pass dry_run=false with confirm_phrase containing ${actPhrase(ad_account_id)}. Returns image_hash for meta_create_ad_creative.`,
      },
    });
  }
  try {
    assertConfirmContainsActAndIds(args.confirm_phrase, ad_account_id, []);
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
  return liveMetaCreativeHop(ctx, tool, hopArgs);
}

/** Optional Meta ad video upload via https file_url (media source, not hop proxy). */
export async function metaUploadAdVideo(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "meta_upload_ad_video";
  const miss = gateMetaMutateOrFail(ctx, tool);
  if (miss) return miss;

  const allowed = new Set(["ad_account_id", "file_url", "title", "name", "dry_run", "confirm_phrase"]);
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", `Field ${key} is not allowed for ${tool}`, {
        api: "meta",
        hint: "Closed upload fields only — file_url (https media) + optional title/name. Not an open Graph proxy.",
      });
    }
  }

  let ad_account_id: string;
  try {
    ad_account_id = normalizeAdAccountId(requireId(args.ad_account_id, "ad_account_id"));
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
  if (!/^\d{5,20}$/.test(ad_account_id)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "ad_account_id must be digits-only (act_ prefix optional)", {
      api: "meta",
    });
  }
  const file = assertHttpsLanding(args.file_url, "file_url");
  if (!file.ok) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "file_url must be https://…", {
      api: "meta",
      hint: file.reason,
    });
  }
  const hopArgs: Record<string, unknown> = { ad_account_id, file_url: file.url };
  for (const k of ["title", "name"] as const) {
    if (typeof args[k] === "string" && String(args[k]).trim()) {
      const n = String(args[k]).trim();
      if (n.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(n)) {
        return failEnvelope(tool, "INVALID_ARGUMENT", `${k} must be ≤400 chars`, { api: "meta" });
      }
      hopArgs[k] = n;
    }
  }

  if (dryRunDefault(args)) {
    return okEnvelope(tool, {
      resource: { type: "meta_ad_account", id: ad_account_id, display_name: "advideos" },
      data: {
        dry_run: true,
        proposed: { ...hopArgs, file_url: file.url },
        note: `No Meta Graph upload HTTP. Pass dry_run=false with confirm_phrase containing ${actPhrase(ad_account_id)}. Returns video_id for meta_create_ad_creative.`,
      },
    });
  }
  try {
    assertConfirmContainsActAndIds(args.confirm_phrase, ad_account_id, []);
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
  return liveMetaCreativeHop(ctx, tool, hopArgs);
}

/** Create Meta AdCreative from image_hash XOR video_id; returns creative_id for meta_create_ad. */
export async function metaCreateAdCreative(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "meta_create_ad_creative";
  const miss = gateMetaMutateOrFail(ctx, tool);
  if (miss) return miss;

  const allowed = new Set([
    "ad_account_id",
    "name",
    "page_id",
    "image_hash",
    "video_id",
    "link",
    "message",
    "title",
    "description",
    "call_to_action_type",
    "dry_run",
    "confirm_phrase",
  ]);
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", `Field ${key} is not allowed for ${tool}`, {
        api: "meta",
        hint: "Closed AdCreative fields only — no object_story_spec bag / open Graph proxy.",
      });
    }
  }

  let ad_account_id: string;
  try {
    ad_account_id = normalizeAdAccountId(requireId(args.ad_account_id, "ad_account_id"));
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
  if (!/^\d{5,20}$/.test(ad_account_id)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "ad_account_id must be digits-only (act_ prefix optional)", {
      api: "meta",
    });
  }
  const nameN = typeof args.name === "string" ? args.name.trim() : "";
  if (!nameN || nameN.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(nameN)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "name must be a non-empty string ≤400 chars", {
      api: "meta",
    });
  }
  const page_id = typeof args.page_id === "string" ? args.page_id.trim() : "";
  if (!/^\d{1,30}$/.test(page_id)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "page_id must be digits-only", { api: "meta" });
  }
  const hasImage = Boolean(args.image_hash && String(args.image_hash).trim());
  const hasVideo = Boolean(args.video_id && String(args.video_id).trim());
  if (hasImage === hasVideo) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "Provide image_hash XOR video_id", { api: "meta" });
  }
  const link = assertHttpsLanding(args.link, "link");
  if (!link.ok) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "link must be https://…", {
      api: "meta",
      hint: link.reason,
    });
  }
  const cta =
    typeof args.call_to_action_type === "string" && args.call_to_action_type.trim()
      ? args.call_to_action_type.trim().toUpperCase()
      : "LEARN_MORE";
  if (!META_CTA.has(cta)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "call_to_action_type outside closed allowlist", {
      api: "meta",
    });
  }

  const hopArgs: Record<string, unknown> = {
    ad_account_id,
    name: nameN,
    page_id,
    link: link.url,
    call_to_action_type: cta,
  };
  if (hasImage) hopArgs.image_hash = String(args.image_hash).trim();
  if (hasVideo) hopArgs.video_id = String(args.video_id).trim();
  if (typeof args.message === "string" && args.message.trim()) hopArgs.message = args.message.trim().slice(0, 2000);
  if (typeof args.title === "string" && args.title.trim()) hopArgs.title = args.title.trim().slice(0, 255);
  if (typeof args.description === "string" && args.description.trim()) {
    hopArgs.description = args.description.trim().slice(0, 500);
  }

  if (dryRunDefault(args)) {
    return okEnvelope(tool, {
      resource: { type: "meta_ad_account", id: ad_account_id, display_name: nameN },
      data: {
        dry_run: true,
        proposed: hopArgs,
        note: `No Meta Graph mutate HTTP. Pass dry_run=false with confirm_phrase containing ${actPhrase(ad_account_id)} AND page_id. Returns creative_id for meta_create_ad.`,
      },
    });
  }
  try {
    assertConfirmContainsActAndIds(args.confirm_phrase, ad_account_id, [page_id]);
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "meta" });
    }
    throw err;
  }
  return liveMetaCreativeHop(ctx, tool, hopArgs);
}

