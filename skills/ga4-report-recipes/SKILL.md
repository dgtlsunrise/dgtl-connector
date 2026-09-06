---
name: ga4-report-recipes
description: Standard GA4 reports (traffic, channels, landing pages, events, key events, date comparison) using ga4_run_report only. Use when the user wants sessions, users, channels, conversions, or landing pages. Call ga4_get_metadata before custom or unfamiliar metric names. Never invent UA metrics.
---

# GA4 report recipes

Run **typed** `ga4_run_report` after a confirmed `property_id`. Cap `limit` at 50 unless they ask for more (max 1000).

## Answer header (required)

Every recipe answer **must** start with a one-line header that states:

1. Canonical `property_id` (`properties/…`)
2. Property **timezone** from `ga4_get_property` (do not guess)
3. **Date range** actually sent to `ga4_run_report` (the `date_ranges` values)

Example shape: `properties/123456789 · America/Los_Angeles · 2026-08-09–2026-09-05`. Include currency when Google returned it. Do not emit numbers before this header.

## Preconditions

1. Picker confirmed `property_id`. Call `ga4_get_property`. Timezone + date range go in the header (above).
2. Unfamiliar metric/dimension → `ga4_get_metadata` first. If it is not in the catalog, refuse (`no-hallucinated-metrics`).
3. Key events / conversions → `ga4_list_key_events` so you don’t assume `purchase` exists.

## Recipes (dimensions / metrics)

Use API names exactly.

| Intent | Dimensions | Metrics |
| --- | --- | --- |
| Traffic in range | (none or `date`) | `sessions`, `activeUsers`, `newUsers`, `engagedSessions` |
| Channels | `sessionDefaultChannelGroup` | `sessions`, `engagedSessions`, `conversions` (only if metadata says so) |
| Source/medium | `sessionSource`, `sessionMedium` | `sessions` |
| Landing pages | `landingPage` | `sessions`, `engagementRate` |
| Events | `eventName` | `eventCount` |
| Device | `deviceCategory` | `sessions` |
| Country | `country` | `sessions` |
| Compare two ranges | same as above | pass **two** `date_ranges` |

Do **not** use UA names (`ga:sessions`, `bounceRate` as if it were UA). If they ask bounce rate: check metadata for `bounceRate` in GA4; if missing, explain engagement-based metrics instead of fabricating bounce.

## Never in this skill

- Dimension `searchQuery` / `query` / `keyword` — hand to `gsc-vs-ga4-search`
- Realtime, funnel, ads spend
- Picking property index 0

## Empty rows

`ok: true` and no rows: say the property ID, range, and timezone. Suggest a wider range or `ga4_list_data_streams` to confirm a stream exists. Do not say “reconnect Google” first.

## Quota

If `propertyQuota` is low or Google returns `QUOTA_EXCEEDED`, follow `google-marketing-support`. Do not loop 20 fat reports.
