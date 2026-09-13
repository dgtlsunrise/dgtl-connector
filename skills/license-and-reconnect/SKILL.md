---
name: license-and-reconnect
description: Map LICENSE_REQUIRED, GATEWAY_UNAVAILABLE, REAUTH_REQUIRED, CONSENT_MISSING, GBP_NOT_ENABLED, GBP_NOT_CONNECTED, GBP_SCOPE_MISSING, WRITE_NOT_ENABLED, CONSENT_W_REQUIRED, CONSENT_G_REQUIRED, CONSENT_S_REQUIRED, ADS_MUTATE_NOT_ENABLED, META_MUTATE_NOT_ENABLED, META_CAPI_NOT_ENABLED, TIKTOK_EVENTS_NOT_ENABLED, TIKTOK_SCOPE_MISSING, META_SCOPE_MISSING, SPEND_CAP_EXCEEDED, ADS_SCOPE_MISSING, META_NOT_CONNECTED, KLAVIYO_NOT_CONNECTED, KLAVIYO_SCOPE_MISSING, SGTM_NOT_ENABLED, SGTM_APPLY_KEY_MISSING. Use when a paid tool failed, Google access expired, a scope was unchecked, writes are gated, gateway is down, conversion fabric is opted out, or the user asks about Ads/Meta unlock. Free GA4/GSC/GTM and local Shopify/Klaviyo keep working without a license.
---

# License and reconnect

## LICENSE_REQUIRED ladder (Pro unlock)

Follow this order. Free GA4 / GSC / GTM keep working at every step.

1. **Missing / expired / invalid JWT** → buy Pro ($19/mo flat unlimited) at https://buy.polar.sh/polar_cl_yZECJ26Ln9mGTQDwBETXCskJRMTwrYAd6thMJO1zHPk (site: https://www.dgtlsunrise.com/). See `pro-upgrade`.
2. **Redeem** → set `DGTL_GATEWAY_URL` (live: `https://stamp.dgtlsunrise.com`; backup: `https://dgtl-stamp.noel-4ea.workers.dev`) then run `dgtl-connector-mcp auth redeem --code <one-time-code>` or `--checkout-id <uuid|polar_c_*>` (stamp resolves confirmation secrets) → writes `PLUGIN_DATA/license.jwt`. Never print or paste the JWT into chat. Or set `DGTL_LICENSE_JWT`. Confirm with `license_status` / `auth status`.
3. **Ads OAuth** (`ADS_SCOPE_MISSING`) → Consent C via `GOOGLE_ADS_ACCESS_TOKEN` or `auth login-ads`. Never reuse Consent A.
4. **Meta OAuth** (`META_NOT_CONNECTED`) → `META_ACCESS_TOKEN` or `auth login-meta --code`. Support never collects Meta tokens.
5. **Gateway** (`GATEWAY_UNAVAILABLE`) → fix `DGTL_GATEWAY_URL` / Worker. **Do not** say “Reconnect Ads.” Do not re-sell Pro if the JWT is already valid.

Do not ask for a Google Ads developer-token or a Meta app secret.

## Codes

| Code | Meaning | What to do |
| --- | --- | --- |
| `LICENSE_REQUIRED` | No/expired/invalid DGTL license JWT | Free tools still work. Follow the ladder above (buy → redeem → Ads/Meta OAuth → gateway). Pro is $19/mo flat unlimited. CTA: https://buy.polar.sh/polar_cl_yZECJ26Ln9mGTQDwBETXCskJRMTwrYAd6thMJO1zHPk (https://www.dgtlsunrise.com/). Prefer `auth redeem`; or paste JWT (`DGTL_LICENSE_JWT` / `PLUGIN_DATA/license.jwt`). Never ask for a developer-token. See `pro-upgrade`. |
| `GATEWAY_UNAVAILABLE` | License ok, but `DGTL_GATEWAY_URL` unset / Worker down / paused | Set or fix the gateway URL (live: `https://stamp.dgtlsunrise.com`; backup: `https://dgtl-stamp.noel-4ea.workers.dev`). **Do not** tell the user to reconnect Ads. Free tools still work. |
| `REAUTH_REQUIRED` | Google token expired or revoked | Host-injected token refresh, or `dgtl-connector-mcp auth login` (PKCE / AuthPort). Not a Gmail Connect card on stdio. |
| `CONSENT_MISSING` | A product scope was unchecked | Same Free Google Connect (GA4+GSC+GTM read and manage). Do not start a second product login. |
| `GBP_NOT_ENABLED` | `DGTL_GBP_ENABLED` false | Flag default off. Not a Consent A reconnect. Enable only after GBP quota is non-zero. |
| `GBP_NOT_CONNECTED` | Flag on, no Consent B token | `GOOGLE_GBP_ACCESS_TOKEN` or `auth login-gbp`. Never reuse Consent A / `GOOGLE_ACCESS_TOKEN`. No stamp hop. |
| `GBP_SCOPE_MISSING` | Token lacks `business.manage` | Re-authorize Consent B. Do not add `business.manage` to Consent A. Tools are GET-only. |
| `WRITE_NOT_ENABLED` | `DGTL_WRITES_ENABLED` false | GTM / GA4 Admin / GSC, Shopify productSet / inventory, Klaviyo draft/upsert/event/catalog/send-job, and MC ProductInput fail closed. Marketplace default off. Free Google may already hold manage scopes. See `gtm-readonly-limits`. |
| `CONSENT_W_REQUIRED` | Writes flagged on but GTM write scopes missing | Run `auth login` (alias `login-write`). Legacy `google-oauth-write.json` still accepted. |
| `CONSENT_G_REQUIRED` | GA4 Admin write path but `analytics.edit` missing | Run `auth login` (alias `login-ga4-admin`). Legacy `google-oauth-ga4-admin.json` still accepted. Then `DGTL_WRITES_ENABLED=true`. |
| `CONSENT_S_REQUIRED` | GSC sitemap write path but `webmasters` write missing | Run `auth login` (alias `login-gsc-write`). Legacy `google-oauth-gsc-write.json` still accepted. Then `DGTL_WRITES_ENABLED=true` for `gsc_submit_sitemap` / `gsc_delete_sitemap`. |
| `ADS_MUTATE_NOT_ENABLED` | Ads mutate opted out (`DGTL_ADS_MUTATE_ENABLED=false`) | Plugin defaults **on**. Opt out with env=`false`. Live hop still needs Worker `ADS_MUTATE_ENABLED=true`. Never Consent A. |
| `META_MUTATE_NOT_ENABLED` | Meta mutate opted out (`DGTL_META_MUTATE_ENABLED=false`) | Plugin defaults **on**. Opt out with env=`false`. Live hop still needs Worker `META_MUTATE_ENABLED=true` after `ads_management` Advanced Access. Catalog items_batch / create catalog use this flag. Closed fields only — do not invent objective/creative. |
| `META_CAPI_NOT_ENABLED` | CAPI opted out or Worker `META_CAPI_ENABLED` off | Plugin defaults **on**. Live hop needs Worker `META_CAPI_ENABLED=true` (fail-closed, **not** `META_MUTATE_ENABLED`). Polar Pro `meta`. Never collect unhashed PII. |
| `TIKTOK_EVENTS_NOT_ENABLED` | Events API opted out or Worker `TIKTOK_EVENTS_ENABLED` off | Plugin defaults **on**. Live hop needs Worker `TIKTOK_EVENTS_ENABLED=true` (fail-closed, **not** `TIKTOK_MUTATE_ENABLED`). Polar `tiktok`. `content_id` must match catalog `sku_id`. Never collect unhashed PII. |
| `META_SCOPE_MISSING` | Token lacks `ads_management` / `catalog_management` (or Graph denied mutate) | Re-authorize Meta after App Review Advanced Access. Do not silently retry. Reads may still work. |
| `SPEND_CAP_EXCEEDED` | Budget above sanity cap | Google: lower `amount_micros` / `daily_budget_dollars` (micros). Meta: lower `daily_budget` / `lifetime_budget` (**cents**, not micros). Cap $100k/day equivalent. No mutate hop. |
| `ADS_SCOPE_MISSING` | License + gateway ok, Ads OAuth missing | Consent C (`adwords`) is a second grant — never reuse Consent A / `GOOGLE_ACCESS_TOKEN`. |
| `META_NOT_CONNECTED` | License + gateway ok, Meta OAuth missing | Separate Meta login (`ads_read`). App secret is never in the plugin. |
| `KLAVIYO_NOT_CONNECTED` | Local `pk_` missing / invalid | `KLAVIYO_API_KEY` or `PLUGIN_DATA/klaviyo.json`. Local-free — no Polar OAuth, no stamp hop, not Consent A. Support never collects Klaviyo keys. Never log the key. |
| `KLAVIYO_SCOPE_MISSING` | `pk_` present but Klaviyo 403 | Generate a new key with accounts/profiles/lists/flows/campaigns/metrics/events/catalogs/reviews. Not Polar OAuth. |
| `TIKTOK_SCOPE_MISSING` | Token lacks Marketing API for this advertiser | Re-authorize after app review. Do not silently retry. App secret stays on the Worker. |
| `SGTM_NOT_ENABLED` | Plugin ingest test off or Worker `SGTM_INGEST_ENABLED` off | Plugin flag defaults **off**. Polar `sgtm` is reserved, default-off, **not minted**. Never put apply/funded keys in web GTM. |
| `SGTM_APPLY_KEY_MISSING` | Live ingest without host apply key | Set `DGTL_SGTM_APPLY_KEY` on the host only. Never send `X-DGTL-Ingest-Key`. Never log the key. |

## Rules

1. Call `license_status` and `google_whoami` before guessing.
2. Never collect refresh tokens, `developer-token`, Meta app secrets, or license JWTs into chat.
3. Do not hide paid or gated write tools; they are listed and fail closed.
4. Do not tell the user GA4 is broken because Ads is locked.
5. For GTM write/publish: follow `gtm-readonly-limits` — refuse when flag off; when on, dry-run + user publicId confirm — never invent confirm. Trigger/variable create uses the same gates. Publish last.
6. For `GATEWAY_UNAVAILABLE`: check `license_status.gateway` / `DGTL_GATEWAY_URL` — never say “Reconnect Ads.”
7. For `LICENSE_REQUIRED`: walk the ladder (buy → redeem → Ads/Meta → gateway). Prefer `auth redeem` over asking the user to paste a bearer.
