import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, HINT_EMPTY_ROWS, type Envelope } from "../envelope.js";
import { MSG } from "../errors.js";
import { probeGatewayReachable, postGateway } from "../gateway/client.js";
import { hasFeature } from "../license/verify.js";
import { checkPluginUpdate } from "../update-check.js";
import { PLUGIN_VERSION, detectHost } from "../version.js";
import { SCOPE } from "../google/scopes.js";
import { GADS_RECIPE_NAMES, describeGadsRecipes } from "./recipes-schema.js";

export function requireAdsLicense(ctx: AppContext, tool: string): Envelope | null {
  if (!hasFeature(ctx.license, "ads")) {
    return failEnvelope(tool, "LICENSE_REQUIRED", MSG.LICENSE_REQUIRED, {
      hint: "GA4 / GSC / GTM keep working. Ads bytes transit DGTL's allowlisted gateway; this plugin never ships a developer-token.",
    });
  }
  return null;
}

/** Local closed-recipe catalog — Polar gated, zero Ads API / gateway. */
export async function gadsDescribeRecipes(ctx: AppContext): Promise<Envelope> {
  const miss = requireAdsLicense(ctx, "gads_describe_recipes");
  if (miss) return miss;
  const data = describeGadsRecipes();
  return okEnvelope("gads_describe_recipes", {
    data,
    page: { truncated: false, row_count: data.recipes.length },
    hint: "Local closed recipes only. Do not invent GAQL or metrics.* fields. No developer-token on this client.",
  });
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

  if (
    (tool === "gads_search" || tool === "gads_campaign_performance") &&
    args.recipe !== undefined &&
    typeof args.recipe === "string" &&
    !GADS_RECIPE_NAMES.has(args.recipe)
  ) {
    return failEnvelope(tool, "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
      hint: `Unknown recipe. Valid: ${[...GADS_RECIPE_NAMES].join(", ")}. Call gads_describe_recipes — no raw GAQL.`,
    });
  }

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
      hint: "License and gateway are ok. Connect Consent C via GOOGLE_ADS_ACCESS_TOKEN or `auth login-ads` (PLUGIN_DATA/google-oauth-ads.json) — never reuse Consent A (GOOGLE_ACCESS_TOKEN). No developer-token is attached on this client.",
      missing_scope: SCOPE.adwords,
    });
  }

  const env = await postGateway(ctx, {
    family: "gads",
    tool,
    userAccessToken: adsTok.accessToken,
    args,
  });

  return enrichGadsEnvelope(tool, args, env);
}

function enrichGadsEnvelope(tool: string, args: Record<string, unknown>, env: Envelope): Envelope {
  if (!env.ok) {
    if ((env.error_code === "NOT_FOUND" || env.error_code === "PERMISSION_DENIED") && !env.hint) {
      env.hint =
        "Re-run gads_list_accessible_customers and use digits-only customer_id (no hyphens). Do not invent GAQL fields — call gads_describe_recipes. No developer-token on this client.";
    }
    return env;
  }

  const cited: Record<string, unknown> = {};
  if (typeof args.customer_id === "string") {
    cited.customer_id = String(args.customer_id).replace(/-/g, "");
  }
  if (typeof args.login_customer_id === "string") {
    cited.login_customer_id = String(args.login_customer_id).replace(/-/g, "");
  }
  if (typeof args.recipe === "string") cited.recipe = args.recipe;
  if (args.date_range && typeof args.date_range === "object") cited.date_range = args.date_range;
  if (tool === "gads_campaign_performance") cited.recipe = cited.recipe ?? "performance";

  if (Object.keys(cited).length) {
    const data: Record<string, unknown> =
      env.data && typeof env.data === "object" && !Array.isArray(env.data)
        ? { ...(env.data as Record<string, unknown>) }
        : { rows: env.data };
    if (data.cited === undefined) data.cited = cited;
    env.data = data;
  }

  const rows = env.page?.row_count;
  if (rows === 0 && !env.hint) {
    env.hint =
      tool === "gads_list_accessible_customers"
        ? "Empty customer list is not a developer-token problem on this client — confirm Consent C user can access Ads accounts."
        : `${HINT_EMPTY_ROWS} Confirm customer_id via gads_list_accessible_customers; call gads_describe_recipes before inventing fields.`;
  }
  return env;
}

export async function licenseStatus(ctx: AppContext): Promise<Envelope> {
  const gateway = await probeGatewayReachable(ctx);
  const update = await checkPluginUpdate({
    env: ctx.env,
    fetchImpl: ctx.fetchImpl,
    currentVersion: PLUGIN_VERSION,
  });
  return okEnvelope("license_status", {
    data: {
      ok: ctx.license.ok,
      features: ctx.license.features,
      exp: ctx.license.exp ?? null,
      sub: ctx.license.sub ?? null,
      jti: ctx.license.jti ?? null,
      reason: ctx.license.reason ?? null,
      plugin_version: update.plugin_version,
      latest_version: update.latest_version,
      update_available: update.update_available,
      ...(update.update_hint ? { update_hint: update.update_hint } : {}),
      host: detectHost(ctx.env),
      gateway: {
        reachable: gateway.reachable,
        ...(gateway.note ? { note: gateway.note } : {}),
      },
    },
  });
}
