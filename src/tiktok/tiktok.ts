import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, HINT_EMPTY_ROWS, type Envelope } from "../envelope.js";
import { MSG } from "../errors.js";
import { probeGatewayReachable, postGateway } from "../gateway/client.js";
import { hasFeature } from "../license/verify.js";

/**
 * License-gated TikTok tools via stamp (Wave 8).
 * Order: LICENSE_REQUIRED → GATEWAY_UNAVAILABLE → TIKTOK_NOT_CONNECTED → hop.
 * App id/secret never in this plugin. User token from authTiktok only.
 */

const TIKTOK_LEVELS = new Set(["advertiser", "campaign", "adgroup", "ad"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function requireTikTokLicense(ctx: AppContext, tool: string): Envelope | null {
  if (!hasFeature(ctx.license, "tiktok")) {
    return failEnvelope(tool, "LICENSE_REQUIRED", MSG.LICENSE_REQUIRED, {
      hint: "TikTok Ads is a separate Polar feature (`tiktok`), not ads/meta. The Marketing API app secret never ships in this plugin; hops go through the DGTL gateway. Noel must mint the tiktok bit.",
    });
  }
  return null;
}

function validateInsightsArgs(args: Record<string, unknown>): Envelope | null {
  const tool = "tiktok_insights";
  if (args.level !== undefined && typeof args.level === "string" && !TIKTOK_LEVELS.has(args.level)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
      hint: "Unknown level. Valid: advertiser, campaign, adgroup, ad.",
    });
  }
  const start = args.date_start;
  const stop = args.date_stop;
  if (typeof start !== "string" || typeof stop !== "string" || !DATE_RE.test(start) || !DATE_RE.test(stop)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
      hint: "tiktok_insights requires date_start and date_stop as YYYY-MM-DD. Do not invent report field names.",
    });
  }
  return null;
}

export async function tiktokDisabled(
  ctx: AppContext,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<Envelope> {
  const miss = requireTikTokLicense(ctx, tool);
  if (miss) return miss;

  if (tool === "tiktok_insights") {
    const bad = validateInsightsArgs(args);
    if (bad) return bad;
  }

  const base = ctx.flags.gatewayUrl;
  if (!base) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: "License is valid. Set DGTL_GATEWAY_URL to the DGTL Worker. Do not treat this as a TikTok reconnect. Free tools still work.",
    });
  }

  const probe = await probeGatewayReachable(ctx);
  if (!probe.reachable) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: probe.note ?? "Gateway health probe failed. Free GA4/GSC/GTM tools still work.",
    });
  }

  const tok = await ctx.authTiktok.getAccessToken();
  if (!tok?.accessToken) {
    return failEnvelope(tool, "TIKTOK_NOT_CONNECTED", MSG.TIKTOK_NOT_CONNECTED, {
      hint: "License and gateway are ok. Set TIKTOK_ACCESS_TOKEN or PLUGIN_DATA/tiktok-oauth.json. Do not reuse Google Consent A or Meta tokens. Support never collects TikTok tokens.",
    });
  }

  const hopArgs: Record<string, unknown> = { ...args };
  if (typeof hopArgs.page_size === "number" && hopArgs.limit === undefined) {
    hopArgs.limit = hopArgs.page_size;
  }
  const env = await postGateway(ctx, {
    family: "tiktok",
    tool,
    userAccessToken: tok.accessToken,
    args: hopArgs,
  });

  return enrichTikTokEnvelope(tool, args, env);
}

function enrichTikTokEnvelope(tool: string, args: Record<string, unknown>, env: Envelope): Envelope {
  if (!env.ok) {
    if (env.error_code === "NOT_FOUND" && !env.hint) {
      env.hint =
        "NOT_FOUND is usually a wrong advertiser_id. Re-run tiktok_list_advertisers — retrying the same id will not help.";
    }
    return env;
  }

  const cited: Record<string, unknown> = {};
  if (typeof args.advertiser_id === "string") cited.advertiser_id = args.advertiser_id;
  if (typeof args.campaign_id === "string") cited.campaign_id = args.campaign_id;
  if (typeof args.level === "string") cited.level = args.level;
  if (typeof args.date_start === "string") cited.date_start = args.date_start;
  if (typeof args.date_stop === "string") cited.date_stop = args.date_stop;

  const data =
    env.data && typeof env.data === "object"
      ? { ...(env.data as Record<string, unknown>), cited }
      : { cited };
  env.data = data;
  if (env.page && env.page.row_count === 0 && !env.hint) {
    env.hint = HINT_EMPTY_ROWS;
  }
  void tool;
  return env;
}
