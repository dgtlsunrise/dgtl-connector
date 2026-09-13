---
name: shopify-readonly
description: Read Shopify products, orders, locations, inventory, publications, catalogs, and product feeds with merchant-held local credentials (SHOPIFY_STORE + SHOPIFY_ACCESS_TOKEN). Use when the user wants shop inventory, catalog source of truth, or order lists. Fail closed without credentials (SHOPIFY_NOT_CONNECTED). Free local lane — no Polar Pro, no stamp hop. Default scopes are the original read_*; Wave 15 expands and writes are explicit + flag-gated.
---

# Shopify readonly (local merchant credentials)

## Auth

1. Merchant installs a **custom app** on their store with **`read_products`**, **`read_orders`**, **`read_inventory`**, **`read_locations`**. That is the **default install**.
2. **Explicit scope expand** (reinstall / request; **never silent** on an existing app): **`read_publications`**, **`read_product_listings`**, plus write scopes **`write_inventory`** / **`write_products`** when those tools are needed. Missing detectable scope → **`SHOPIFY_SCOPE_MISSING`**.
3. Set `SHOPIFY_STORE` (`*.myshopify.com`) + `SHOPIFY_ACCESS_TOKEN` (`shpat_…`), **or** `PLUGIN_DATA/shopify-oauth.json` (mode 0600).
4. Optional: `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` for Dev Dashboard client_credentials refresh into the same store file.
5. Missing store/token → **`SHOPIFY_NOT_CONNECTED`** — do not call Admin API. Support never collects Shopify tokens.
6. **No Polar license. No stamp gateway.** Same free-local posture as Consent A GA4.

Admin GraphQL API version pin: **2026-04** (unchanged this wave).

## Tools

1. `shopify_get_shop` — sanity: domain + name.
2. `shopify_list_products` → pick `product_id` → `shopify_get_product` (variants include `sku` + `inventoryItem.id`).
3. `shopify_list_orders` (closed status / financial / fulfillment / date filters) → `shopify_get_order`.
4. `shopify_list_locations` → pick `location_id` → `shopify_list_inventory_levels`.
5. Catalog source of truth (Wave 15): `shopify_list_publications` (`read_publications`) → `shopify_list_catalogs` (`read_products`) → `shopify_list_product_feeds` (`read_product_listings`). Join publication.catalog.id to catalog id.
6. Writes are **not** this skill: `shopify_adjust_inventory` (`write_inventory`) and `shopify_product_set` (`write_products`). Flag `DGTL_WRITES_ENABLED` (default off) + matching write scope + `confirm_phrase` / `confirm` containing the shop domain. `productSet` list fields **replace** omitted variants/tags. See TOOLS.md.

Never invent product/order/location/publication ids. Empty lists are not auth failures. For SKU ↔ Shopping ads join, use `shopify-ads-mc-join`.

## Refuse

- Live inventory adjust or productSet without `DGTL_WRITES_ENABLED` and shop-domain confirm.
- Customers full PII dump / ShopifyQL escape hatch / raw GraphQL.
- Meta catalog / CAPI (later wave). Charging / Polar for local read. Stamp multi-store vault.
- Axos or any store the user did not authorize.
