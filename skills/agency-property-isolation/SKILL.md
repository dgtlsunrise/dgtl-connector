---
name: agency-property-isolation
description: Keep agency clients from mixing. Use when the login can see many GA4 properties, GSC sites, GTM containers, Shopify shops, Klaviyo accounts, Merchant Center ids, Meta ad accounts, or TikTok advertisers, or when the user names a client. Label every answer with resource IDs. Do not join Client A's Search Console to Client B's GA4, or Client A's Shopify SKU to Client B's MC / Meta / TikTok catalog.
---

# Agency property isolation

A typical agency login sees tens of properties. Silent defaults leak the wrong client into a report.

## When to use

- More than one GA4 property, GSC site, GTM container, Shopify shop, Klaviyo account, Merchant Center id, Meta ad account, or TikTok advertiser is visible
- User mentions a client, brand, or domain
- You are about to compare GA4 and GSC, or Shopify SKUs to MC / Meta / TikTok / Klaviyo catalogs, in the same answer

## Rules

1. Follow `select-google-property` first (Google surfaces). For Shopify / Klaviyo / MC / Meta / TikTok, list then ask — never index 0.
2. Every numeric claim includes the resource that produced it:
   - GA4: `properties/{id}` and display name
   - GSC: exact `siteUrl`
   - GTM: account id + `GTM-XXXX` + live vs workspace
   - Shopify: shop domain (`*.myshopify.com`)
   - Klaviyo: account id from `klaviyo_get_account`
   - Merchant Center: digits `merchant_id`
   - Meta: `act_{ad_account_id}` (plus `catalog_id` / `pixel_id` when those tools used them)
   - TikTok: `advertiser_id` (plus `catalog_id` / `pixel_code` when used)
3. Do **not** overlay GSC queries from site A onto GA4 sessions from property B unless the user explicitly named **both** IDs as the same client.
4. Do **not** join Client A's Shopify SKU / GTIN onto Client B's `merchant_id`, Meta catalog, TikTok catalog, or Klaviyo `$custom` catalog.
5. Do not “helpfully” include a second client for benchmark unless asked.
6. If the user switches clients mid-thread, re-state IDs; do not reuse the previous `property_id` / shop / `merchant_id` / `act_` / `advertiser_id`.
7. Empty rows: say which ID was empty. Do not pull the sibling client that has traffic.

## OAuth / merchant tokens do not isolate

Readonly Google scopes see everything that Google user already can. Shopify / Klaviyo tokens see that merchant only — still do not mix two shops or two Klaviyo accounts in one join. If they must not see Client C, that is Google ACL or a separate merchant app (don’t share the agency owner login). Explain; don’t offer a DGTL vault in v1; don’t collect tokens.

## Copy

“Your login can see **{n}** GA4 properties. I will not use the first. Which client / property ID?”
