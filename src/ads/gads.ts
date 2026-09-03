import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG } from "../errors.js";
import { hasFeature } from "../license/verify.js";

export function requireAdsLicense(ctx: AppContext, tool: string): Envelope | null {
  if (!hasFeature(ctx.license, "ads")) {
    return failEnvelope(tool, "LICENSE_REQUIRED", MSG.LICENSE_REQUIRED, {
      hint: "GA4 / GSC / GTM keep working. Ads bytes will transit DGTL's allowlisted gateway in a later phase; this plugin never ships a developer-token.",
    });
  }
  return null;
}

export function gadsDisabled(ctx: AppContext, tool: string): Envelope {
  const miss = requireAdsLicense(ctx, tool);
  if (miss) return miss;
  return failEnvelope(tool, "ADS_SCOPE_MISSING", MSG.ADS_SCOPE_MISSING, {
    hint: "License is valid. Google Ads runtime (user token or gateway) is Phase 9–10. No developer-token is attached on this client.",
  });
}

export function licenseStatus(ctx: AppContext): Envelope {
  return okEnvelope("license_status", {
    data: {
      ok: ctx.license.ok,
      features: ctx.license.features,
      exp: ctx.license.exp ?? null,
      sub: ctx.license.sub ?? null,
      reason: ctx.license.reason ?? null,
      gateway: { reachable: false, note: "No gateway in this binary (Phase 10)." },
    },
  });
}
