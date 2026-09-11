---
name: shopify-readonly
description: Read Shopify products and orders with merchant-held local credentials (SHOPIFY_STORE + SHOPIFY_ACCESS_TOKEN). Use when the user wants shop inventory, product details, or order lists. Fail closed without credentials (SHOPIFY_NOT_CONNECTED). Free local lane — no Polar Pro, no stamp hop. Scopes read_products + read_orders only; never write_*.
---

# Shopify readonly (local merchant credentials)

## Auth

1. Merchant installs a **custom app** on their store with **`read_products`** + **`read_orders`** only (no `write_*` in v1).
2. Set `SHOPIFY_STORE` (`*.myshopify.com`) + `SHOPIFY_ACCESS_TOKEN` (`shpat_…`), **or** `PLUGIN_DATA/shopify-oauth.json` (mode 0600).
3. Optional: `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` for Dev Dashboard client_credentials refresh into the same store file.
4. Missing store/token → **`SHOPIFY_NOT_CONNECTED`** — do not call Admin API. Support never collects Shopify tokens.
5. **No Polar license. No stamp gateway.** Same free-local posture as Consent A GA4.

Admin GraphQL API version pin: **2026-04**.

## Tools

1. `shopify_get_shop` — sanity: domain + name.
2. `shopify_list_products` → pick `product_id` → `shopify_get_product`.
3. `shopify_list_orders` (closed status / financial / fulfillment / date filters) → `shopify_get_order`.

Never invent product/order ids. Empty lists are not auth failures.

## Refuse

- Writes (inventory adjust, draft order, price, fulfill) — out of v1.
- Customers full PII dump / ShopifyQL escape hatch / raw GraphQL.
- Charging / Polar for local read.
- Axos or any store the user did not authorize.
