import type { AppContext } from "../context.js";
import { failEnvelope, type Envelope } from "../envelope.js";
import { MSG } from "../errors.js";
import { probeGatewayReachable, postGateway } from "../gateway/client.js";
import { hasFeature } from "../license/verify.js";

/**
 * License-gated Meta tools via gateway (PR-5).
 * Order: LICENSE_REQUIRED → GATEWAY_UNAVAILABLE → META_NOT_CONNECTED → hop.
 * Meta token from authMeta only — never ctx.auth / GOOGLE_ACCESS_TOKEN.
 */
export async function metaDisabled(
  ctx: AppContext,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<Envelope> {
  if (!hasFeature(ctx.license, "meta")) {
    return failEnvelope(tool, "LICENSE_REQUIRED", MSG.LICENSE_REQUIRED, {
      hint: "Meta Ads is paid. The app secret never ships in this plugin; appsecret_proof is computed on the DGTL gateway.",
    });
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

  return postGateway(ctx, {
    family: "meta",
    tool,
    userAccessToken: metaTok.accessToken,
    args,
  });
}
