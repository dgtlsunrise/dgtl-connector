---
name: shopify-readonly
description: Read Shopify products, orders, locations, and inventory with merchant-held local credentials (SHOPIFY_STORE + SHOPIFY_ACCESS_TOKEN). Use when the user wants shop inventory, product details, or order lists. Fail closed without credentials (SHOPIFY_NOT_CONNECTED). Free local lane — no Polar Pro, no stamp hop. Default scopes are read_*; writes are a separate flag-gated tool.
---

# Shopify readonly (local merchant credentials)

## Auth

1. Merchant installs a **custom app** on their store with **`read_products`**, **`read_orders`**, **`read_inventory`**, **`read_locations`**. `write_inventory` is **not** on the default install.
2. Set `SHOPIFY_STORE` (`*.myshopify.com`) + `SHOPIFY_ACCESS_TOKEN` (`shpat_…`), **or** `PLUGIN_DATA/shopify-oauth.json` (mode 0600).
3. Optional: `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` for Dev Dashboard client_credentials refresh into the same store file.
4. Missing store/token → **`SHOPIFY_NOT_CONNECTED`** — do not call Admin API. Support never collects Shopify tokens.
5. **No Polar license. No stamp gateway.** Same free-local posture as Consent A GA4.

Admin GraphQL API version pin: **2026-04**.

## Tools

1. `shopify_get_shop` — sanity: domain + name.
2. `shopify_list_products` → pick `product_id` → `shopify_get_product` (variants include `sku` + `inventoryItem.id`).
3. `shopify_list_orders` (closed status / financial / fulfillment / date filters) → `shopify_get_order`.
4. `shopify_list_locations` → pick `location_id` → `shopify_list_inventory_levels`.
5. Writes: `shopify_adjust_inventory` is **not** this skill. Flag `DGTL_WRITES_ENABLED` (default off) + `write_inventory` + `confirm_phrase` with shop domain. See TOOLS.md.

Never invent product/order/location ids. Empty lists are not auth failures. For SKU ↔ Shopping ads join, use `shopify-ads-mc-join`.

## Refuse

- Live inventory adjust without `DGTL_WRITES_ENABLED` and shop-domain confirm.
- Customers full PII dump / ShopifyQL escape hatch / raw GraphQL.
- Charging / Polar for local read. Stamp multi-store vault.
- Axos or any store the user did not authorize.
