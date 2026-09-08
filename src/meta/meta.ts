import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, HINT_EMPTY_ROWS, type Envelope } from "../envelope.js";
import { MSG } from "../errors.js";
import { probeGatewayReachable, postGateway } from "../gateway/client.js";
import { hasFeature } from "../license/verify.js";
import {
  META_BREAKDOWN_NAMES,
  META_DATE_PRESET_NAMES,
  META_FIELD_NAMES,
  META_LEVEL_NAMES,
  describeMetaInsightsSchema,
} from "./insights-schema.js";

/**
 * License-gated Meta tools via gateway (PR-5).
 * Order: LICENSE_REQUIRED → GATEWAY_UNAVAILABLE → META_NOT_CONNECTED → hop.
 * Meta token from authMeta only — never ctx.auth / GOOGLE_ACCESS_TOKEN.
 *
 * Local DX: meta_describe_insights_schema is license-gated but does not hop
 * (catalog only — agents must not invent insights fields).
 */

function requireMetaLicense(ctx: AppContext, tool: string): Envelope | null {
  if (!hasFeature(ctx.license, "meta")) {
    return failEnvelope(tool, "LICENSE_REQUIRED", MSG.LICENSE_REQUIRED, {
      hint: "Meta Ads is paid. The app secret never ships in this plugin; appsecret_proof is computed on the DGTL gateway.",
    });
  }
  return null;
}

/** Local catalog — Polar gated, zero Graph / gateway. */
export async function metaDescribeInsightsSchema(ctx: AppContext): Promise<Envelope> {
  const miss = requireMetaLicense(ctx, "meta_describe_insights_schema");
  if (miss) return miss;
  const data = describeMetaInsightsSchema();
  return okEnvelope("meta_describe_insights_schema", {
    data,
    page: { truncated: false, row_count: data.fields.length },
    hint: "Local catalog only. Do not invent breakdowns/fields. Writes/catalogs/lift stay deferred.",
  });
}

function validateMetaInsightsArgs(args: Record<string, unknown>): Envelope | null {
  const tool = "meta_insights";
  if (args.level !== undefined && typeof args.level === "string" && !META_LEVEL_NAMES.has(args.level)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
      hint: `Unknown level. Valid: ${[...META_LEVEL_NAMES].join(", ")}. Call meta_describe_insights_schema.`,
    });
  }
  if (
    args.date_preset !== undefined &&
    typeof args.date_preset === "string" &&
    !META_DATE_PRESET_NAMES.has(args.date_preset)
  ) {
    return failEnvelope(tool, "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
      hint: `Unknown date_preset. Valid: ${[...META_DATE_PRESET_NAMES].join(", ")}. Call meta_describe_insights_schema.`,
    });
  }
  if (args.breakdowns !== undefined) {
    if (!Array.isArray(args.breakdowns)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
        hint: "breakdowns must be an array of strings. Call meta_describe_insights_schema.",
      });
    }
    const bad = args.breakdowns.filter((b) => typeof b !== "string" || !META_BREAKDOWN_NAMES.has(b));
    if (bad.length) {
      return failEnvelope(tool, "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
        hint: `Unknown breakdown(s): ${bad.join(", ")}. Valid: ${[...META_BREAKDOWN_NAMES].join(", ")}.`,
      });
    }
  }
  if (args.fields !== undefined) {
    if (!Array.isArray(args.fields)) {
      return failEnvelope(tool, "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
        hint: "fields must be an array of strings from meta_describe_insights_schema.",
      });
    }
    const bad = args.fields.filter((f) => typeof f !== "string" || !META_FIELD_NAMES.has(f));
    if (bad.length) {
      return failEnvelope(tool, "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
        hint: `Unknown field(s): ${bad.join(", ")}. Valid: ${[...META_FIELD_NAMES].join(", ")}. Do not invent Graph field names.`,
      });
    }
  }
  return null;
}

export async function metaDisabled(
  ctx: AppContext,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<Envelope> {
  const miss = requireMetaLicense(ctx, tool);
  if (miss) return miss;

  if (tool === "meta_insights") {
    const bad = validateMetaInsightsArgs(args);
    if (bad) return bad;
  }

  const base = ctx.flags.gatewayUrl;
  if (!base) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: "License is valid. Set DGTL_GATEWAY_URL to the DGTL Worker. Do not treat this as a Meta reconnect. Free tools still work.",
    });
  }

  const probe = await probeGatewayReachable(ctx);
  if (!probe.reachable) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: probe.note ?? "Gateway health probe failed. Free GA4/GSC/GTM tools still work.",
    });
  }

  const metaTok = await ctx.authMeta.getAccessToken();
  if (!metaTok?.accessToken) {
    return failEnvelope(tool, "META_NOT_CONNECTED", MSG.META_NOT_CONNECTED, {
      hint: "License and gateway are ok. Set META_ACCESS_TOKEN or run `auth login-meta --code` (PLUGIN_DATA/meta-oauth.json). Do not reuse Google Consent A tokens. Support never collects Meta tokens.",
    });
  }

  const env = await postGateway(ctx, {
    family: "meta",
    tool,
    userAccessToken: metaTok.accessToken,
    args,
  });

  return enrichMetaEnvelope(tool, args, env);
}

function enrichMetaEnvelope(tool: string, args: Record<string, unknown>, env: Envelope): Envelope {
  if (!env.ok) {
    if (env.error_code === "NOT_FOUND" && !env.hint) {
      env.hint =
        "NOT_FOUND is usually a wrong ad_account_id or object_id. Re-run meta_list_ad_accounts / list campaigns — retrying the same id will not help.";
    }
    return env;
  }

  const cited: Record<string, unknown> = {};
  if (typeof args.ad_account_id === "string") cited.ad_account_id = args.ad_account_id;
  if (typeof args.object_id === "string") cited.object_id = args.object_id;
  if (typeof args.level === "string") cited.level = args.level;
  if (typeof args.date_preset === "string") cited.date_preset = args.date_preset;
  if (typeof args.date_start === "string") cited.date_start = args.date_start;
  if (typeof args.date_stop === "string") cited.date_stop = args.date_stop;
  if (Array.isArray(args.breakdowns)) cited.breakdowns = args.breakdowns;
  if (typeof args.creative_id === "string") cited.creative_id = args.creative_id;

  if (Object.keys(cited).length) {
    const data: Record<string, unknown> =
      env.data && typeof env.data === "object" && !Array.isArray(env.data)
        ? { ...(env.data as Record<string, unknown>) }
        : { rows: env.data };
    if (data.cited === undefined) data.cited = cited;
    env.data = data;
  }

  const rows = env.page?.row_count;
  if ((rows === 0 || rows === undefined) && !env.hint && tool === "meta_insights") {
    env.hint = `${HINT_EMPTY_ROWS} For Meta: try last_30d / drop breakdowns / confirm object_id via list tools. Call meta_describe_insights_schema before inventing fields.`;
  } else if (rows === 0 && !env.hint) {
    env.hint =
      "Empty list is not an auth failure; confirm ad_account_id via meta_list_ad_accounts and that this Meta user can see the object.";
  }
  return env;
}
