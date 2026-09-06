---
name: ga4-vs-ads-conversions
description: Compare GA4 key events to Google Ads conversions only when the user named both property_id and customer_id. Two numbers, two definitions, no winner. Do not pick a true attribution model. Ads tools return LICENSE_REQUIRED without a DGTL license.
---

# GA4 vs Ads conversions

Two numbers, two definitions, no winner.

1. Confirm `property_id` (picker / `ga4_list_account_summaries`). Never index 0.
2. Confirm Ads `customer_id`. Never first MCC child.
3. GA4: `ga4_list_key_events` then `ga4_run_report` for those event names. Check metadata; do not invent `conversions`.
4. Ads: `gads_search` recipe `conversion_actions` / `performance` when licensed. `LICENSE_REQUIRED` means stop on the Ads side.
5. Say: GA4 key events and Ads conversions are different systems (counting windows, attribution, view-through). Do not pick a “true” number.

Header (required): GA4 `property_id` + property timezone + date range; Ads `customer_id` + Ads account time zone when the get-customer tool returned it. No numbers before the header.

Cross-join skills take **both** IDs and refuse if the user did not name both.
