/**
 * Wave 9 — ops runbooks linked from support_packet hints.
 * Paths are docs-relative. Never tokens, JWTs, or hop URLs.
 */
import type { ErrorCode } from "../errors.js";

export type RunbookHint = {
  runbook: string;
  next_human_step: string;
};

/** Stable docs-relative runbook index. Anchors match ERROR_CODES. */
export const RUNBOOK_INDEX = "docs/ops/RUNBOOKS.md";

export const ERROR_RUNBOOKS: Partial<Record<ErrorCode, RunbookHint>> = {
  ADS_MUTATE_NOT_ENABLED: {
    runbook: `${RUNBOOK_INDEX}#ads_mutate_not_enabled`,
    next_human_step:
      "Check plugin DGTL_ADS_MUTATE_ENABLED (default on) AND Worker ADS_MUTATE_ENABLED (fail-closed). Live mutate needs both. Do not publish the Worker from this packet.",
  },
  META_MUTATE_NOT_ENABLED: {
    runbook: `${RUNBOOK_INDEX}#meta_mutate_not_enabled`,
    next_human_step:
      "Check plugin DGTL_META_MUTATE_ENABLED (default on) AND Worker META_MUTATE_ENABLED. Live Graph mutates also need ads_management Advanced Access.",
  },
  TIKTOK_MUTATE_NOT_ENABLED: {
    runbook: `${RUNBOOK_INDEX}#tiktok_mutate_not_enabled`,
    next_human_step:
      "Check plugin DGTL_TIKTOK_MUTATE_ENABLED (default on) AND Worker TIKTOK_MUTATE_ENABLED. Polar JWT must include tiktok. App secret stays on the Worker.",
  },
  LICENSE_REQUIRED: {
    runbook: `${RUNBOOK_INDEX}#license_required`,
    next_human_step:
      "Redeem Polar Pro ($19/mo) and paste the license JWT (DGTL_LICENSE_JWT or PLUGIN_DATA/license.jwt). Ads/Meta need features ads/meta. TikTok needs a separate tiktok bit. Never send a developer-token.",
  },
  MERCHANT_CENTER_REQUIRED: {
    runbook: `${RUNBOOK_INDEX}#merchant_center_required`,
    next_human_step:
      "Shopping create needs a digits merchant_center_id from gads_list_merchant_center_links or mc_list_accounts. No Ads mutate HTTP was sent.",
  },
  META_SCOPE_MISSING: {
    runbook: `${RUNBOOK_INDEX}#meta_scope_missing`,
    next_human_step:
      "Re-authorize Meta after ads_management Advanced Access. Do not silently retry. ads_read reads may still work. Support never collects Meta tokens.",
  },
  GBP_NOT_ENABLED: {
    runbook: `${RUNBOOK_INDEX}#gbp_not_enabled`,
    next_human_step:
      "Set DGTL_GBP_ENABLED=true only after GBP Basic API Access quota is non-zero, then connect Consent B (business.manage). Never add business.manage to Consent A.",
  },
  GBP_NOT_CONNECTED: {
    runbook: `${RUNBOOK_INDEX}#gbp_not_connected`,
    next_human_step:
      "Run `dgtl-connector-mcp auth login-gbp` or set GOOGLE_GBP_ACCESS_TOKEN. Consent B is separate from Consent A. login-gbp does not flip DGTL_GBP_ENABLED.",
  },
  SHOPIFY_NOT_CONNECTED: {
    runbook: `${RUNBOOK_INDEX}#shopify_not_connected`,
    next_human_step:
      "Set SHOPIFY_STORE + SHOPIFY_ACCESS_TOKEN (merchant custom app) or PLUGIN_DATA/shopify-oauth.json. Local-free — no Polar. Support never collects Shopify tokens.",
  },
  WRITE_NOT_ENABLED: {
    runbook: `${RUNBOOK_INDEX}#write_not_enabled`,
    next_human_step:
      "Set DGTL_WRITES_ENABLED=true for Consent W GTM writes or Shopify inventory adjust. Marketplace default stays off. Consent A remains readonly.",
  },
  MC_NOT_CONNECTED: {
    runbook: `${RUNBOOK_INDEX}#mc_not_connected`,
    next_human_step:
      "Run `dgtl-connector-mcp auth login-mc` or set GOOGLE_MC_ACCESS_TOKEN (Consent MC, scope content). Never reuse Consent A. Needs a valid Pro license.",
  },
  MC_SCOPE_MISSING: {
    runbook: `${RUNBOOK_INDEX}#mc_scope_missing`,
    next_human_step:
      "Re-authorize Consent MC so the token includes https://www.googleapis.com/auth/content. Do not add content to Consent A.",
  },
  TIKTOK_NOT_CONNECTED: {
    runbook: `${RUNBOOK_INDEX}#tiktok_not_connected`,
    next_human_step:
      "Set TIKTOK_ACCESS_TOKEN or PLUGIN_DATA/tiktok-oauth.json after Polar tiktok + stamp secrets. App id/secret stay on the Worker.",
  },
  GATEWAY_UNAVAILABLE: {
    runbook: `${RUNBOOK_INDEX}#gateway_unavailable`,
    next_human_step:
      "Set DGTL_GATEWAY_URL to the hosted stamp Worker and confirm GET /v1/health ok=true. Free GA4/GSC/GTM/Shopify tools still work.",
  },
  ADS_SCOPE_MISSING: {
    runbook: `${RUNBOOK_INDEX}#ads_scope_missing`,
    next_human_step:
      "Run `dgtl-connector-mcp auth login-ads` or set GOOGLE_ADS_ACCESS_TOKEN (Consent C, scope adwords). Never reuse Consent A.",
  },
  GBP_SCOPE_MISSING: {
    runbook: `${RUNBOOK_INDEX}#gbp_scope_missing`,
    next_human_step:
      "Re-authorize Consent B (`auth login-gbp`) so the grant includes business.manage. Tools stay GET-only.",
  },
  SHOPIFY_SCOPE_MISSING: {
    runbook: `${RUNBOOK_INDEX}#shopify_scope_missing`,
    next_human_step:
      "Reinstall the merchant custom app with the missing Admin scope. write_inventory is an explicit expansion, not Polar.",
  },
  CONSENT_W_REQUIRED: {
    runbook: `${RUNBOOK_INDEX}#consent_w_required`,
    next_human_step:
      "Run `dgtl-connector-mcp auth login-write` with the Consent W Desktop client. Never add edit/publish scopes to Consent A.",
  },
};

export function runbookForError(code: string | null | undefined): {
  runbook: string | null;
  next_human_step: string | null;
} {
  if (!code) return { runbook: null, next_human_step: null };
  const row = ERROR_RUNBOOKS[code as ErrorCode];
  if (!row) return { runbook: null, next_human_step: null };
  return { runbook: row.runbook, next_human_step: row.next_human_step };
}
