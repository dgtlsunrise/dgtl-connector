---
name: gsc-vs-ads-keywords
description: Join Search Console queries to Google Ads search terms only when the user named both a GSC site_url and an Ads customer_id. Use for cannibalization, paid vs organic keywords. Do not pick a default property or a “true” channel. Ads tools return LICENSE_REQUIRED until paid unlock.
---

# GSC vs Ads keywords

Join **only** on two named IDs.

1. Confirm exact `site_url` via `gsc_list_sites` (never coerce `sc-domain:` vs URL-prefix).
2. Confirm `customer_id` (and optional `login_customer_id` for an MCC). Never first accessible customer.
3. If `gads_search` returns `LICENSE_REQUIRED`, stop. Do not invent Ads rows. GSC can still run.
4. Organic queries: `gsc_query_search_analytics` with `dimensions: ["query"]`.
5. Paid search terms: `gads_search` recipe `search_terms` (when licensed). Do not send raw GAQL.

Header (required): exact GSC `site_url` + date range + `data_state`; Ads `customer_id` + date range. GSC dates are not the GA4 property timezone. No keyword rows before the header.

Do not declare a winner. Present two tables, two definitions (GSC clicks ≠ Ads clicks). Do not overlay Client A’s GSC onto Client B’s Ads account.
