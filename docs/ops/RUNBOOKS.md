# Ops runbooks (Wave 9)

Token-safe next human steps. `support_packet` returns `runbook` + `next_human_step` when `error_code` maps here. Never paste tokens, JWTs, or HAR files.

Index also linked from [ERRORS.md](../ERRORS.md).

## `ADS_MUTATE_NOT_ENABLED`

Live Google Ads mutate needs **both** plugin `DGTL_ADS_MUTATE_ENABLED` (default **on**) and Worker `ADS_MUTATE_ENABLED` (fail-closed, default **off**). Reads still work with Pro + Consent C. Do not publish the Worker from a support packet.

## `META_MUTATE_NOT_ENABLED`

Same dual-gate for Meta. Live Graph mutates also need `ads_management` Advanced Access. Catalog items_batch / create catalog use this flag. ads_read reads may still work.

## `META_CAPI_NOT_ENABLED`

Plugin `DGTL_META_CAPI_ENABLED` defaults on; Worker `META_CAPI_ENABLED` is fail-closed and **separate** from `META_MUTATE_ENABLED`. Polar Pro `meta` bit. App secret stays on the Worker. Never collect unhashed PII. Stamp hop `POST /{GRAPH_API_VERSION}/{pixel_id}/events`.

## `TIKTOK_MUTATE_NOT_ENABLED`

Plugin default on; Worker `TIKTOK_MUTATE_ENABLED` fail-closed. Catalog create/upload/bind and campaign create use this flag. Polar JWT must include `tiktok` (not ads/meta bits). App secret stays on the Worker.

## `TIKTOK_EVENTS_NOT_ENABLED`

Plugin `DGTL_TIKTOK_EVENTS_ENABLED` defaults on; Worker `TIKTOK_EVENTS_ENABLED` is fail-closed and **separate** from `TIKTOK_MUTATE_ENABLED`. Polar `tiktok` bit. App secret stays on the Worker. Never collect unhashed PII. `content_id` must match catalog `sku_id`. Stamp hop `POST /open_api/{TIKTOK_API_VERSION}/event/track/`.

## `SGTM_NOT_ENABLED`

Plugin `DGTL_SGTM_INGEST_TEST_ENABLED` defaults **off**. Live apply ingest needs that flag on **and** Worker `SGTM_INGEST_ENABLED=true` (fail-closed, health `sgtm_ingest_enabled`). Polar `sgtm` is reserved, default-off — **do not mint**. Never put funded or apply keys in web GTM. HTTP path is `POST /v1/sgtm/ingest` (not a hop-catalog MCP hop).

## `SGTM_APPLY_KEY_MISSING`

Set `DGTL_SGTM_APPLY_KEY` (or `DGTL_APPLY_KEY`) on the plugin host only. Header is `X-DGTL-Apply-Key`. Never send `X-DGTL-Ingest-Key` from this plugin. Never put apply or funded keys in web GTM variables.

## `LICENSE_REQUIRED`

Redeem Polar Pro ($19/mo). Paste JWT via `DGTL_LICENSE_JWT` or `PLUGIN_DATA/license.jwt`. Ads/Meta need `features: ["ads","meta"]`. TikTok needs a separate `tiktok` bit. Never a Google Ads developer-token.

## `MERCHANT_CENTER_REQUIRED`

Shopping create needs a digits `merchant_center_id` from `gads_list_merchant_center_links` or `mc_list_accounts`. No Ads mutate HTTP was sent.

## `META_SCOPE_MISSING`

Re-authorize Meta after `ads_management` Advanced Access. Do not silently retry. Support never collects Meta tokens.

## `META_NOT_CONNECTED`

License + gateway are ok, but Meta user OAuth is missing. Set `META_ACCESS_TOKEN` or run `dgtl-connector-mcp auth login-meta --code`. Never reuse Consent A. Support never collects Meta tokens. App secret stays on the Worker.

## `GBP_NOT_ENABLED`

`DGTL_GBP_ENABLED=false` (default). Enable only after GBP Basic API Access quota is non-zero. Consent B (`business.manage`) is a separate grant — never on Consent A.

## `GBP_NOT_CONNECTED`

`auth login-gbp` or `GOOGLE_GBP_ACCESS_TOKEN`. `login-gbp` does not flip the flag.

## `GBP_SCOPE_MISSING`

Re-authorize Consent B so the grant includes `business.manage`. Tools stay GET-only.

## `SHOPIFY_NOT_CONNECTED`

`SHOPIFY_STORE` + `SHOPIFY_ACCESS_TOKEN` or `PLUGIN_DATA/shopify-oauth.json`. Local-free — no Polar. Support never collects Shopify tokens.

## `SHOPIFY_SCOPE_MISSING`

Reinstall the merchant custom app with the missing Admin scope. Default install is `read_products` + `read_orders` + `read_inventory` + `read_locations`. Explicit expand (never silent): `read_publications`, `read_product_listings`, `write_inventory`, `write_products`.

## `WRITE_NOT_ENABLED`

`DGTL_WRITES_ENABLED=false` (marketplace default). Required for GTM / GA4 Admin / GSC writes, Shopify inventory adjust / productSet, Klaviyo draft/upsert/event/catalog/send-job, and live Merchant Center ProductInput writes. Free Google may already hold manage scopes. Prefer `dry_run` first; Shopify live confirm must include the shop domain; Klaviyo live confirm must include the account id (send-job also needs `campaign_id` + `SEND`); MC live confirm must include `merchant_id`.

## `KLAVIYO_NOT_CONNECTED`

`KLAVIYO_API_KEY` or `PLUGIN_DATA/klaviyo.json`. Local-free `pk_` — no Polar. Support never collects Klaviyo keys. Never log the key.

## `KLAVIYO_SCOPE_MISSING`

Generate a new Klaviyo private key with the matching accounts/profiles/lists/flows/campaigns/metrics/events/catalogs/reviews scopes. Not Polar OAuth.

## `CONSENT_W_REQUIRED`

`auth login` (Free Google; `login-write` aliases). Legacy `google-oauth-write.json` is still accepted. Then set `DGTL_WRITES_ENABLED=true`. Do not add `adwords`, `content`, or `business.manage`.

## `CONSENT_G_REQUIRED`

`auth login` (Free Google; `login-ga4-admin` aliases) so the token has `analytics.edit`. Legacy `google-oauth-ga4-admin.json` is still accepted. Then set `DGTL_WRITES_ENABLED=true` for mutate tools. Prefer `dry_run`. Live confirm must include `properties/{id}` (or `accounts/{id}` on create property).

## `CONSENT_S_REQUIRED`

`auth login` (Free Google; `login-gsc-write` aliases) so the token has `webmasters` write. Legacy `google-oauth-gsc-write.json` is still accepted. Then set `DGTL_WRITES_ENABLED=true` for `gsc_submit_sitemap` / `gsc_delete_sitemap`. Prefer `dry_run`. Live confirm must include the exact `site_url`.

## `MC_NOT_CONNECTED`

`auth login-mc` or `GOOGLE_MC_ACCESS_TOKEN` (Consent MC, scope `content`). Needs Pro (`ads`). Never reuse Consent A. Wave 14 ProductInput writes use the same grant — never guess `merchant_id`; live needs `DGTL_WRITES_ENABLED` + confirm containing that id.

## `MC_SCOPE_MISSING`

Re-authorize Consent MC for `https://www.googleapis.com/auth/content`.

## `TIKTOK_NOT_CONNECTED`

`TIKTOK_ACCESS_TOKEN` or `PLUGIN_DATA/tiktok-oauth.json` after Polar `tiktok` + stamp secrets. App id/secret stay on the Worker.

## `TIKTOK_SCOPE_MISSING`

Re-authorize TikTok after Marketing API / app review for this advertiser (or TikTok denied the mutate). Do not silently retry. Support never collects TikTok tokens. App secret stays on the Worker.

## `GATEWAY_UNAVAILABLE`

Set `DGTL_GATEWAY_URL` to the hosted stamp Worker. Confirm `GET /v1/health` `ok=true`. Free GA4/GSC/GTM/Shopify tools still work.

## `ADS_SCOPE_MISSING`

`auth login-ads` or `GOOGLE_ADS_ACCESS_TOKEN` (Consent C, `adwords`). Never reuse Consent A.
