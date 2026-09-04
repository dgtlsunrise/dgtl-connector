import type { AppContext } from "../context.js";
import { failEnvelope, type Envelope } from "../envelope.js";
import { MSG } from "../errors.js";
import { hasFeature } from "../license/verify.js";

/**
 * Fail-closed Meta tools until gateway (PR-5).
 * Meta token from authMeta only — never ctx.auth / GOOGLE_ACCESS_TOKEN.
 */
export async function metaDisabled(ctx: AppContext, tool: string): Promise<Envelope> {
  if (!hasFeature(ctx.license, "meta")) {
    return failEnvelope(tool, "LICENSE_REQUIRED", MSG.LICENSE_REQUIRED, {
      hint: "Meta Ads is paid. The app secret never ships in this plugin; appsecret_proof is computed on the DGTL gateway (Phase 11).",
    });
  }

  const metaTok = await ctx.authMeta.getAccessToken();
  if (!metaTok?.accessToken) {
    return failEnvelope(tool, "META_NOT_CONNECTED", MSG.META_NOT_CONNECTED, {
      hint: "License is valid. Set META_ACCESS_TOKEN or PLUGIN_DATA/meta-oauth.json. Do not reuse Google Consent A tokens.",
    });
  }

  // Meta token present; gateway hop is PR-5.
  return failEnvelope(tool, "META_NOT_CONNECTED", MSG.META_NOT_CONNECTED, {
    hint: "Meta user token is present. Meta runtime (allowlisted gateway) is not in this binary yet (PR-5). The app secret never ships in this plugin.",
  });
}
