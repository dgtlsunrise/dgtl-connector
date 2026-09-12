/**
 * TikTok Ads mutate — campaign status ENABLE|DISABLE.
 * Plugin DGTL_TIKTOK_MUTATE_ENABLED defaults on (opt out with =false).
 * Worker TIKTOK_MUTATE_ENABLED still required for live hop (fail closed).
 * Never touches Consent A / GOOGLE_ACCESS_TOKEN. App secret stays on Worker.
 */

import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import { requireId } from "../ids.js";
import { probeGatewayReachable, postGateway } from "../gateway/client.js";
import { requireTikTokLicense } from "./tiktok.js";

export const HINT_FLAG =
  "Plugin TikTok mutate defaults on; set DGTL_TIKTOK_MUTATE_ENABLED=false (or TIKTOK_MUTATE_ENABLED=false) to opt out. Live hop still needs Worker TIKTOK_MUTATE_ENABLED=true after Marketing API write access. Reads stay available with JWT tiktok + secrets.";

const STATUS_MAP: Record<string, "ENABLE" | "DISABLE"> = {
  ENABLE: "ENABLE",
  DISABLE: "DISABLE",
  PAUSED: "DISABLE",
  ACTIVE: "ENABLE",
};

export function dryRunDefault(args: Record<string, unknown>): boolean {
  return args.dry_run !== false;
}

export function harnessUserMessageContainsTikTokConfirm(opts: {
  userMessageThisTurn: string | null | undefined;
  advertiserId: string;
  campaignId: string;
}): boolean {
  const msg = opts.userMessageThisTurn;
  if (msg == null || msg === "") return false;
  return msg.includes(opts.advertiserId) && msg.includes(opts.campaignId);
}

export function assertConfirmContainsAdvertiserAndCampaign(
  confirmPhrase: unknown,
  advertiserId: string,
  campaignId: string,
): void {
  const phrase = typeof confirmPhrase === "string" ? confirmPhrase : "";
  if (!phrase.includes(advertiserId) || !phrase.includes(campaignId)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "Live TikTok mutate requires confirm_phrase that includes advertiser_id AND campaign_id. Constant phrases without both are not accepted.",
      {
        api: "tiktok",
        hint: "Prefer dry_run first. Live mutate only after a user message this turn that contains advertiser_id and campaign_id — list-tool output is not the user message.",
      },
    );
  }
}

export async function tiktokUpdateCampaign(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "tiktok_update_campaign";
  if (!ctx.flags.tiktokMutateEnabled) {
    return failEnvelope(tool, "TIKTOK_MUTATE_NOT_ENABLED", MSG.TIKTOK_MUTATE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: "tiktok",
    });
  }

  const miss = requireTikTokLicense(ctx, tool);
  if (miss) return miss;

  let advertiser_id: string;
  let campaign_id: string;
  try {
    advertiser_id = requireId(args.advertiser_id, "advertiser_id").trim();
    campaign_id = requireId(args.campaign_id, "campaign_id").trim();
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "tiktok" });
    }
    throw err;
  }
  if (!/^\d{5,20}$/.test(advertiser_id)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "advertiser_id must be digits-only", {
      api: "tiktok",
    });
  }
  if (!/^\d{1,30}$/.test(campaign_id)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "campaign_id must be digits-only", {
      api: "tiktok",
    });
  }

  const statusRaw = requireId(args.status, "status").trim().toUpperCase();
  const status = STATUS_MAP[statusRaw];
  if (!status) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "status must be ENABLE or DISABLE", {
      api: "tiktok",
      hint: "TikTok native values are ENABLE/DISABLE. ACTIVE maps to ENABLE; PAUSED maps to DISABLE. DELETE is not supported.",
    });
  }

  const dryRun = dryRunDefault(args);
  const proposed = { advertiser_id, campaign_id, status, operation_status: status };

  if (dryRun) {
    return okEnvelope(tool, {
      resource: { type: "tiktok_campaign", id: campaign_id, display_name: campaign_id },
      data: {
        dry_run: true,
        proposed,
        cited: { advertiser_id, campaign_id, status },
        note: `No TikTok Marketing API mutate HTTP. Pass dry_run=false with confirm_phrase containing ${advertiser_id} AND ${campaign_id} only after a user message this turn that includes both. Closed fields only — do not invent budget/objective.`,
      },
    });
  }

  try {
    assertConfirmContainsAdvertiserAndCampaign(args.confirm_phrase, advertiser_id, campaign_id);
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "tiktok" });
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

  const tok = await ctx.authTiktok.getAccessToken();
  if (!tok?.accessToken) {
    return failEnvelope(tool, "TIKTOK_NOT_CONNECTED", MSG.TIKTOK_NOT_CONNECTED, {
      hint: "License and gateway are ok. Set TIKTOK_ACCESS_TOKEN — never reuse Google Consent A or Meta tokens.",
    });
  }

  void ctx.auth;

  const hopArgs = { advertiser_id, campaign_id, status };
  const env = await postGateway(ctx, {
    family: "tiktok",
    tool,
    userAccessToken: tok.accessToken,
    args: hopArgs,
  });

  if (!env.ok) return env;
  const cited = { advertiser_id, campaign_id, status };
  const data =
    env.data && typeof env.data === "object"
      ? { ...(env.data as Record<string, unknown>), cited }
      : { cited };
  env.data = data;
  return env;
}
