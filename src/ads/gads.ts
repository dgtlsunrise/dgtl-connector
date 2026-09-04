import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG } from "../errors.js";
import { probeGatewayReachable, postGateway } from "../gateway/client.js";
import { hasFeature } from "../license/verify.js";
import { PLUGIN_VERSION, detectHost } from "../version.js";
import { SCOPE } from "../google/scopes.js";

export function requireAdsLicense(ctx: AppContext, tool: string): Envelope | null {
  if (!hasFeature(ctx.license, "ads")) {
    return failEnvelope(tool, "LICENSE_REQUIRED", MSG.LICENSE_REQUIRED, {
      hint: "GA4 / GSC / GTM keep working. Ads bytes transit DGTL's allowlisted gateway; this plugin never ships a developer-token.",
    });
  }
  return null;
}

/**
 * License-gated Google Ads tools via gateway (PR-5).
 * Order: LICENSE_REQUIRED → GATEWAY_UNAVAILABLE → ADS_SCOPE_MISSING → hop.
 * Consent C token from authAds only — never ctx.auth / GOOGLE_ACCESS_TOKEN.
 */
export async function gadsDisabled(
  ctx: AppContext,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<Envelope> {
  const miss = requireAdsLicense(ctx, tool);
  if (miss) return miss;

  // Power-user DGTL_ADS_DEVELOPER_TOKEN unimplemented (OQ 12).
  void ctx.env.DGTL_ADS_DEVELOPER_TOKEN;

  const base = ctx.flags.gatewayUrl;
  if (!base) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: "License is valid. Set DGTL_GATEWAY_URL to the DGTL Worker. Do not reconnect Ads for this — free tools still work.",
    });
  }

  const probe = await probeGatewayReachable(ctx);
  if (!probe.reachable) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: probe.note ?? "Gateway health probe failed. Free GA4/GSC/GTM tools still work.",
    });
  }

  const adsTok = await ctx.authAds.getAccessToken();
  if (!adsTok?.accessToken) {
    return failEnvelope(tool, "ADS_SCOPE_MISSING", MSG.ADS_SCOPE_MISSING, {
      hint: "License and gateway are ok. Connect Consent C via GOOGLE_ADS_ACCESS_TOKEN or PLUGIN_DATA/google-oauth-ads.json — never reuse Consent A (GOOGLE_ACCESS_TOKEN). No developer-token is attached on this client.",
      missing_scope: SCOPE.adwords,
    });
  }

  return postGateway(ctx, {
    family: "gads",
    tool,
    userAccessToken: adsTok.accessToken,
    args,
  });
}

export async function licenseStatus(ctx: AppContext): Promise<Envelope> {
  const gateway = await probeGatewayReachable(ctx);
  return okEnvelope("license_status", {
    data: {
      ok: ctx.license.ok,
      features: ctx.license.features,
      exp: ctx.license.exp ?? null,
      sub: ctx.license.sub ?? null,
      jti: ctx.license.jti ?? null,
      reason: ctx.license.reason ?? null,
      plugin_version: PLUGIN_VERSION,
      host: detectHost(ctx.env),
      gateway: {
        reachable: gateway.reachable,
        ...(gateway.note ? { note: gateway.note } : {}),
      },
    },
  });
}
