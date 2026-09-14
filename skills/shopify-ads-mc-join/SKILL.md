---
name: shopify-ads-mc-join
description: Join Shopify catalog (SKU / handle / inventory) to Merchant Center products and Google Ads Shopping listing groups. Use when the user asks which Shopify SKUs are Shopping-ads ready, why a product is missing from ads, or how to match inventory to MC offerId. Never invent SKUs.
---

# Shopify ↔ Ads / Merchant Center product join

Wave 7. Three surfaces, three hops. Do **not** collapse them.

| Surface | Tools | Hop | Join key |
| --- | --- | --- | --- |
| Shopify catalog + inventory | `shopify_list_products`, `shopify_get_product`, `shopify_list_locations`, `shopify_list_inventory_levels`, `shopify_list_publications`, `shopify_list_catalogs`, `shopify_list_product_feeds` | **direct_shopify** (merchant token, LOCAL_FREE) | variant `sku`, `inventoryItem.id`, product `handle`, publication/catalog id |
| Merchant Center products / status | `mc_list_accounts`, `mc_list_products`, `mc_get_product`, `mc_list_product_statuses` | **direct_google** Consent MC (Pro `ads` + `content` scope) | `offerId`; product id is `contentLanguage~feedLabel~offerId` |
| Ads Shopping / listing groups | `gads_list_merchant_center_links`, `gads_create_shopping_campaign`, `gads_add_shopping_listing_groups` | **stamp** Ads (developer-token) | listing group `ITEM_ID` = MC offerId (usually the SKU) |

Stamp does **not** proxy Shopify. Multi-store vault is out of this wave.

## Auth (do not mix families)

1. Shopify: `SHOPIFY_STORE` + `SHOPIFY_ACCESS_TOKEN` or `PLUGIN_DATA/shopify-oauth.json`. Missing → `SHOPIFY_NOT_CONNECTED`. **No Polar.**
2. Merchant Center: Pro license **and** Consent MC (`auth login-mc` / `GOOGLE_MC_ACCESS_TOKEN`). Missing license → `LICENSE_REQUIRED`. Missing MC token → `MC_NOT_CONNECTED`. Never Consent A.
3. Ads Shopping create: Pro + Consent C + stamp. Campaigns default **PAUSED**.

## Sequence

1. `shopify_get_shop` — confirm `*.myshopify.com`. Never invent a store.
2. `shopify_list_products` → `shopify_get_product` for variant `sku` + `inventoryItem.id`.
3. If the question is “which channel / market / feed is source of truth”: `shopify_list_publications` → `shopify_list_catalogs` → `shopify_list_product_feeds` (need explicit `read_publications` / `read_product_listings`). Join publication.catalog.id. Not Meta catalog.
4. `shopify_list_locations` → pick **one** location (if length ≠ 1, stop and ask) → `shopify_list_inventory_levels`.
5. Discover `merchant_id`: `mc_list_accounts` or `gads_list_merchant_center_links`. If length ≠ 1, stop and ask.
6. `mc_list_products` / `mc_list_product_statuses`. Join:
   - **Preferred:** Shopify variant `sku` == MC `offerId`
   - Fallback: Shopify product `handle` == `offerId` (only if SKU is empty **and** the feed uses handles — say so)
   - Do **not** join on Shopify numeric product id unless the user shows that is the offerId
7. Readiness: `shopping_ads_ready` from MC statuses. Inventory available from Shopify does **not** mean Shopping-ads ready.
8. Only then Ads: `gads_create_shopping_campaign` needs `merchant_center_id`. Listing groups `ITEM_ID` use the **MC offerId**, not the Shopify gid.

## Join rules

- Empty join is **not** an auth failure. Cite both sides (Shopify sku vs MC offerId).
- Do not invent GTINs, SKUs, or offerIds.
- Shopify `inventoryQuantity` / available qty is merchandising truth; MC `item_level_issues` is ads eligibility.
- Writes are a **separate** path: matching write scope + shop-domain confirm. `shopify_adjust_inventory` needs `write_inventory`. `shopify_product_set` needs `write_products` (allowlisted fields only; variants/tags **replace**). Do not adjust inventory or productSet to “fix” a Shopping disapproval — that is MC eligibility. Never silently expand scopes on an existing custom app.

## Refuse

- Consent A for MC or Ads.
- Stamp hop for Shopify (no vault).
- Guessing `merchant_id`, `offerId`, or Shopify ids.
- TikTok / Meta / Klaviyo **writes** from this join skill — use `catalog-fan-out` (per-network tools, not a mega upsert-all).
- Treating Shopify handle as a Google Ads asset.
- Inventing `$shopify:::$default:::` or unnamed `merchant_id`. Raw GraphQL. Customers dump.
