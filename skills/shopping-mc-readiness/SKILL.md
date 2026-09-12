---
name: shopping-mc-readiness
description: Tie Google Ads Shopping campaign create to Merchant Center product readiness. Use when the user wants Shopping ads, listing groups, product_link, feed issues, or asks whether products are approved. Discover merchant_id, read MC products/status/issues via Merchant API, then create Shopping campaigns only when products are Shopping-ads ready. Never Consent A. Never guess merchant_id.
---

# Shopping ads create ↔ Merchant Center product readiness

Wave 4. Real Merchant Center is **Merchant API** (Content API for Shopping sunset 2026-08-18). Hop is **direct Google** with Consent MC — **not** stamp, **not** Ads `product_link`, **not** Consent A.

## Hop (do not reopen)

| Surface | Hop | Secret |
| --- | --- | --- |
| Shopping **campaign** / listing groups / product_link | stamp `gads_*` | Ads developer-token on Worker |
| Products / statuses / feed issues | plugin `mc_*` → `merchantapi.googleapis.com` | User OAuth `https://www.googleapis.com/auth/content` |

Stamp does not proxy Merchant API. The Ads developer-token is the wrong secret. Polar has no separate `mc` bit — MC tools require Pro (`ads`) **and** Consent MC.

## Auth

1. Pro license (`ads`). Else `LICENSE_REQUIRED`.
2. Consent MC: `GOOGLE_MC_ACCESS_TOKEN` or `dgtl-connector-mcp auth login-mc` → `PLUGIN_DATA/google-oauth-mc.json`. Separate Desktop client (`GOOGLE_OAUTH_MC_CLIENT_ID`). **Never** add `content` to Consent A.
3. Missing MC token → `MC_NOT_CONNECTED`. Wrong scopes → `MC_SCOPE_MISSING`.
4. Google's `content` scope is read/write; **Wave 4 tools are GET-only**. Do not insert/update/delete products.
5. Live Merchant API enablement on that GCP project is a **Noel gate**. `ACCESS_NOT_CONFIGURED` means the API is off — not an empty catalog.

## Sequence (never skip the picker)

1. Discover `merchant_id`:
   - `gads_list_merchant_center_links` (Ads product_link — not product data), **or**
   - `mc_list_accounts`.
2. If the list length ≠ 1, stop and ask. Never use index 0.
3. Readiness:
   - `mc_list_data_sources` — is a feed configured?
   - `mc_list_account_issues` — website / feed / suspension issues block Shopping ads even when SKUs look fine.
   - `mc_list_product_statuses` — `shopping_ads_ready` is true only when `SHOPPING_ADS` has `approvedCountries`. `item_level_issues` are the product-level blockers.
   - `mc_list_products` / `mc_get_product` for titles, offer ids, nested `productStatus`.
4. `product_id` is `contentLanguage~feedLabel~offerId` (e.g. `en~US~SKU123`). Never a bare SKU.
5. Only then Ads:
   - `gads_create_shopping_campaign` needs `merchant_center_id` or it returns `MERCHANT_CENTER_REQUIRED` (zero Ads hop).
   - Campaign defaults **PAUSED**. Listing groups: `gads_add_shopping_listing_groups` (`ALL_PRODUCTS` UNIT or `BRAND`/`ITEM_ID`). New shopping ad group is **ENABLED** under a PAUSED campaign.
   - `gads_link_merchant_center` is product_link create — not Content API / Merchant API.

## Readiness rules

- Empty products is **not** an auth failure. Check `merchant_id` and the feed.
- Account `CRITICAL`/`ERROR` issues → do **not** tell the user Shopping ads will serve. Fix in Merchant Center first.
- `shopping_ads_ready=false` → cite `item_level_issues` (code, attribute, documentation). Do not invent GTINs or shipping.
- Free listings vs Shopping ads: `reportingContext` `SHOPPING_ADS` is the ads destination. Do not treat free-listings approval as Shopping-ads ready.

## Refuse

- Consent A / `GOOGLE_ACCESS_TOKEN` for MC.
- Stamp hop / developer-token for Merchant API.
- Product insert/update/delete, feed fetch, or any MC mutate (later wave; dry_run + confirm if added).
- Guessing `merchant_id` or `product_id`.
- Axos. GBP / TikTok / Consent W E2E.
- Publish/deploy.
