import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG } from "../errors.js";
import { hasFeature } from "../license/verify.js";
import { PLUGIN_VERSION, detectHost } from "../version.js";
import { SCOPE } from "../google/scopes.js";

export function requireAdsLicense(ctx: AppContext, tool: string): Envelope | null {
  if (!hasFeature(ctx.license, "ads")) {
    return failEnvelope(tool, "LICENSE_REQUIRED", MSG.LICENSE_REQUIRED, {
      hint: "GA4 / GSC / GTM keep working. Ads bytes will transit DGTL's allowlisted gateway in a later phase; this plugin never ships a developer-token.",
    });
  }
  return null;
}

/**
 * Fail-closed Ads tools until gateway (PR-5).
 * Consent C token from authAds only — never ctx.auth / GOOGLE_ACCESS_TOKEN.
 */
export async function gadsDisabled(ctx: AppContext, tool: string): Promise<Envelope> {
  const miss = requireAdsLicense(ctx, tool);
  if (miss) return miss;

  const adsTok = await ctx.authAds.getAccessToken();
  if (!adsTok?.accessToken) {
    return failEnvelope(tool, "ADS_SCOPE_MISSING", MSG.ADS_SCOPE_MISSING, {
      hint: "License is valid. Connect Consent C via GOOGLE_ADS_ACCESS_TOKEN or PLUGIN_DATA/google-oauth-ads.json — never reuse Consent A (GOOGLE_ACCESS_TOKEN). No developer-token is attached on this client.",
      missing_scope: SCOPE.adwords,
    });
  }

  // C token present; gateway hop is PR-5. Keep ADS_SCOPE_MISSING until GATEWAY_UNAVAILABLE exists.
  return failEnvelope(tool, "ADS_SCOPE_MISSING", MSG.ADS_SCOPE_MISSING, {
    hint: "Consent C Ads token is present. Google Ads runtime (allowlisted gateway) is not in this binary yet (PR-5). No developer-token is attached on this client.",
    missing_scope: SCOPE.adwords,
  });
}

export function licenseStatus(ctx: AppContext): Envelope {
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
      // Stay false until PR-5 (URL unset / no health probe). Do not advertise a live gateway.
      gateway: { reachable: false, note: "No gateway probe in this binary (PR-5)." },
    },
  });
}
