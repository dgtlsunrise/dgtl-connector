# Ops runbooks (Wave 9)

Token-safe next human steps. `support_packet` returns `runbook` + `next_human_step` when `error_code` maps here. Never paste tokens, JWTs, or HAR files.

Index also linked from [ERRORS.md](../ERRORS.md).

## `ADS_MUTATE_NOT_ENABLED`

Live Google Ads mutate needs **both** plugin `DGTL_ADS_MUTATE_ENABLED` (default **on**) and Worker `ADS_MUTATE_ENABLED` (fail-closed, default **off**). Reads still work with Pro + Consent C. Do not publish the Worker from a support packet.

## `META_MUTATE_NOT_ENABLED`

Same dual-gate for Meta. Live Graph mutates also need `ads_management` Advanced Access. ads_read reads may still work.

## `TIKTOK_MUTATE_NOT_ENABLED`

Plugin default on; Worker `TIKTOK_MUTATE_ENABLED` fail-closed. Polar JWT must include `tiktok` (not ads/meta bits). App secret stays on the Worker.

## `LICENSE_REQUIRED`

Redeem Polar Pro ($19/mo). Paste JWT via `DGTL_LICENSE_JWT` or `PLUGIN_DATA/license.jwt`. Ads/Meta need `features: ["ads","meta"]`. TikTok needs a separate `tiktok` bit. Never a Google Ads developer-token.

## `MERCHANT_CENTER_REQUIRED`

Shopping create needs a digits `merchant_center_id` from `gads_list_merchant_center_links` or `mc_list_accounts`. No Ads mutate HTTP was sent.

## `META_SCOPE_MISSING`

Re-authorize Meta after `ads_management` Advanced Access. Do not silently retry. Support never collects Meta tokens.

## `GBP_NOT_ENABLED`

`DGTL_GBP_ENABLED=false` (default). Enable only after GBP Basic API Access quota is non-zero. Consent B (`business.manage`) is a separate grant — never on Consent A.

## `GBP_NOT_CONNECTED`

`auth login-gbp` or `GOOGLE_GBP_ACCESS_TOKEN`. `login-gbp` does not flip the flag.

## `GBP_SCOPE_MISSING`

Re-authorize Consent B so the grant includes `business.manage`. Tools stay GET-only.

## `SHOPIFY_NOT_CONNECTED`

`SHOPIFY_STORE` + `SHOPIFY_ACCESS_TOKEN` or `PLUGIN_DATA/shopify-oauth.json`. Local-free — no Polar. Support never collects Shopify tokens.

## `SHOPIFY_SCOPE_MISSING`

Reinstall the merchant custom app with the missing Admin scope. `write_inventory` is an explicit expansion.

## `WRITE_NOT_ENABLED`

`DGTL_WRITES_ENABLED=false` (marketplace default). Required for Consent W GTM writes and Shopify inventory adjust. Consent A stays readonly.

## `CONSENT_W_REQUIRED`

`auth login-write` with the Consent W Desktop client. Never add edit/publish to Consent A.

## `MC_NOT_CONNECTED`

`auth login-mc` or `GOOGLE_MC_ACCESS_TOKEN` (Consent MC, scope `content`). Needs Pro. Never reuse Consent A.

## `MC_SCOPE_MISSING`

Re-authorize Consent MC for `https://www.googleapis.com/auth/content`.

## `TIKTOK_NOT_CONNECTED`

`TIKTOK_ACCESS_TOKEN` or `PLUGIN_DATA/tiktok-oauth.json` after Polar `tiktok` + stamp secrets. App id/secret stay on the Worker.

## `GATEWAY_UNAVAILABLE`

Set `DGTL_GATEWAY_URL` to the hosted stamp Worker. Confirm `GET /v1/health` `ok=true`. Free GA4/GSC/GTM/Shopify tools still work.

## `ADS_SCOPE_MISSING`

`auth login-ads` or `GOOGLE_ADS_ACCESS_TOKEN` (Consent C, `adwords`). Never reuse Consent A.
