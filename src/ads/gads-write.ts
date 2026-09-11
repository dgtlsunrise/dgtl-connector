/**
 * Google Ads mutate tools — Consent C + gateway only.
 * Flag DGTL_ADS_MUTATE_ENABLED defaults off (fail closed, zero mutate HTTP).
 * Never touches Consent A / GOOGLE_ACCESS_TOKEN.
 */

import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import { requireId } from "../ids.js";
import { probeGatewayReachable, postGateway } from "../gateway/client.js";
import { SCOPE } from "../google/scopes.js";
import { requireAdsLicense, enrichGadsEnvelope } from "./gads.js";

const HINT_FLAG =
  "Set DGTL_ADS_MUTATE_ENABLED=true on the plugin and ADS_MUTATE_ENABLED=true on stamp only after Google Ads API mutate-capable access + compliance. Default stays off. Never add mutate to Consent A.";

const ALLOWED_STATUS = new Set(["ENABLED", "PAUSED"]);

/**
 * Harness / eval rule: live mutate without a **user** message this turn containing
 * the digits-only customer_id is a fail. List-tool output is not the user message.
 */
export function harnessUserMessageContainsCustomerId(opts: {
  userMessageThisTurn: string | null | undefined;
  customerId: string;
}): boolean {
  const msg = opts.userMessageThisTurn;
  if (msg == null || msg === "") return false;
  const id = opts.customerId.replace(/-/g, "");
  return msg.includes(id);
}

function dryRunDefault(args: Record<string, unknown>): boolean {
  return args.dry_run !== false;
}

function normalizeCustomerId(raw: string): string {
  return raw.replace(/-/g, "");
}

function normalizeCampaignId(raw: string): string {
  return raw.replace(/-/g, "");
}

function assertConfirmContainsCustomerId(confirmPhrase: unknown, customerId: string): void {
  const phrase = typeof confirmPhrase === "string" ? confirmPhrase : "";
  const id = normalizeCustomerId(customerId);
  if (!phrase.includes(id)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "Live mutate requires confirm_phrase that includes the digits-only customer_id. Constant phrases without the customer_id are not accepted.",
      {
        api: "google_ads",
        hint: "Prefer dry_run first. Live mutate only after a user message this turn that contains the customer_id — list-tool output is not the user message.",
      },
    );
  }
}

/**
 * Pause/enable a campaign. dry_run default true.
 * Flag off → ADS_MUTATE_NOT_ENABLED with zero gateway mutate HTTP.
 */
export async function gadsSetCampaignStatus(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_set_campaign_status";

  if (!ctx.flags.adsMutateEnabled) {
    return failEnvelope(tool, "ADS_MUTATE_NOT_ENABLED", MSG.ADS_MUTATE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: "google_ads",
    });
  }

  const miss = requireAdsLicense(ctx, tool);
  if (miss) return miss;

  const customer_id = normalizeCustomerId(requireId(args.customer_id, "customer_id"));
  const campaign_id = normalizeCampaignId(requireId(args.campaign_id, "campaign_id"));
  const statusRaw = requireId(args.status, "status").trim().toUpperCase();
  if (!ALLOWED_STATUS.has(statusRaw)) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "status must be ENABLED or PAUSED", {
      api: "google_ads",
      hint: "Only ENABLED or PAUSED. REMOVED and other statuses are not supported.",
    });
  }
  const dryRun = dryRunDefault(args);
  const login_customer_id =
    typeof args.login_customer_id === "string" && args.login_customer_id.trim()
      ? normalizeCustomerId(args.login_customer_id)
      : undefined;

  const proposed = {
    customer_id,
    campaign_id,
    status: statusRaw,
    resource_name: `customers/${customer_id}/campaigns/${campaign_id}`,
    ...(login_customer_id ? { login_customer_id } : {}),
  };

  if (dryRun) {
    return okEnvelope(tool, {
      resource: {
        type: "gads_campaign",
        id: proposed.resource_name,
        display_name: campaign_id,
      },
      data: {
        dry_run: true,
        proposed,
        cited: { customer_id, campaign_id, status: statusRaw },
        note: "No Ads mutate HTTP. Pass dry_run=false with confirm_phrase containing this customer_id only after a user message this turn that includes it.",
      },
    });
  }

  assertConfirmContainsCustomerId(args.confirm_phrase, customer_id);

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

  const adsTok = await ctx.authAds.getAccessToken();
  if (!adsTok?.accessToken) {
    return failEnvelope(tool, "ADS_SCOPE_MISSING", MSG.ADS_SCOPE_MISSING, {
      hint: "Connect Consent C via GOOGLE_ADS_ACCESS_TOKEN or auth login-ads — never reuse Consent A.",
      missing_scope: SCOPE.adwords,
    });
  }

  // Never read ctx.auth / GOOGLE_ACCESS_TOKEN here.
  void ctx.auth;

  const hopArgs: Record<string, unknown> = {
    customer_id,
    campaign_id,
    status: statusRaw,
  };
  if (login_customer_id) hopArgs.login_customer_id = login_customer_id;

  const env = await postGateway(ctx, {
    family: "gads",
    tool,
    userAccessToken: adsTok.accessToken,
    args: hopArgs,
  });

  return enrichGadsEnvelope(tool, hopArgs, env);
}
