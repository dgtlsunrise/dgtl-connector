---
name: catalog-fan-out
description: Map Shopify products to Merchant Center, Meta catalog, TikTok catalog, and Klaviyo catalog with per-network validation. Use when the user wants to push or preview a catalog across shopping / ads / email networks. Never a mega upsert-all tool. Never invent $shopify:::$default::: ids. Refuse unnamed merchant_id.
---

# Catalog fan-out (Shopify → MC / Meta / TikTok / Klaviyo)

Wave 19. Four destinations, **four named write tools**. Do **not** collapse them into one upsert.

| Destination | Preview / map | Live write tool | Grant |
| --- | --- | --- | --- |
| Merchant Center | Google payload (omit missing GTIN / missing HTTPS image) | `mc_upsert_product_input` (one offer at a time) | Polar `ads` + Consent MC + `DGTL_WRITES_ENABLED` + `merchant_id` in confirm |
| Meta catalog | HTTPS `image_link` / `link` required | `meta_catalog_items_batch` | Polar `meta` + stamp + `META_MUTATE_ENABLED` dual-gate + confirm `act_` AND `catalog_id` |
| TikTok catalog | HTTPS `image_url` / `landing_page_url`; `sku_id` is Events `content_id` | `tiktok_upload_catalog_products` | Polar `tiktok` + stamp + `TIKTOK_MUTATE_ENABLED` dual-gate + confirm `advertiser_id` AND `catalog_id` |
| Klaviyo catalog | Local `pk_`; `$custom` only | `klaviyo_upsert_catalog_items` | `KLAVIYO_API_KEY` + `DGTL_WRITES_ENABLED` + account-id confirm. **No Polar. No stamp.** |

**Live fan-out still requires each destination’s write grant.** Mapping a row does not write it. A missing grant is not a reason to skip naming the tool — refuse that destination and continue the others only after the user asks.

## Sequence

1. `shopify_get_shop` then `shopify_list_products` → `shopify_get_product` for **sku**, **barcode (GTIN)**, **featured image**, **online store URL**, price, vendor. Never invent SKU / GTIN / handle-as-offerId.
2. Discover destination ids (list → pick; length ≠ 1 → stop):
   - Google: `mc_list_accounts` or `gads_list_merchant_center_links` → **named** `merchant_id` (digits). Also a named `data_source` before ProductInput writes.
   - Meta: `meta_list_ad_accounts` + `meta_list_catalogs` → `act_{id}` + `catalog_id`.
   - TikTok: `tiktok_list_advertisers` + `tiktok_list_catalogs` → `advertiser_id` + `catalog_id`.
   - Klaviyo: `klaviyo_get_account` (account id for confirm) + `klaviyo_list_catalog_items` if updating.
3. Validate per network (same rules as `src/catalog/fan-out.ts`):
   - **Google:** omit the row when GTIN is missing (unless brand **and** MPN exist) **or** image/link is missing / not `https://`. Do not invent a GTIN. Do not send the invalid row.
   - **Meta / TikTok:** omit when image or landing URL is missing / not HTTPS. GTIN is not required.
   - **Klaviyo:** sku + title + HTTPS url. Image optional. `external_id` is the Shopify **sku**. Integration is **`$custom` / `$default` only**.
4. Show omitted rows and reasons. Then call **one destination tool at a time**. `dry_run` defaults true. Live confirm must include that destination’s ids.

## Isolation

- **Refuse unnamed `merchant_id`.** `""`, `"default"`, `"first"`, `"0"`, omitted, or `$shopify:::` is `RESOURCE_REQUIRED`. Never index 0 from `mc_list_accounts`.
- **Do not invent `$shopify:::$default:::` ids.** Those belong to Klaviyo’s Shopify integration. Custom upserts use `external_id` (sku). Klaviyo then mints `$custom:::$default:::{external_id}`. Copy ids from `klaviyo_list_catalog_*` — do not construct Shopify-integration compounds.
- Do not invent Shopify catalog / publication ids either. `shopify_list_catalogs` is source of truth.

## Refuse

- A mega `upsert-all` / `fan_out_live` tool. This skill is judgment; writes are the named tools above.
- Polar `klaviyo` OAuth / stamp hop for Klaviyo (Wave 19b deferred). Local `pk_` only.
- Consent A for MC / Ads / Meta / TikTok.
- Wave 20 conversion fabric (CAPI / Events / Klaviyo events as a join). Catalog only.
- Campaign send jobs. Axos. Guessing GTINs to “fix” Google omissions.
