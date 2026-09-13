# Spike — GA4 Data API `conversionSpec`

Date: 2026-09-13  
Wave: 11  
Sources: [v1beta RunReportRequest](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport), [v1alpha RunReportRequest](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1alpha/properties/runReport), [googleapis v1beta proto](https://github.com/googleapis/googleapis/blob/master/google/analytics/data/v1beta/analytics_data_api.proto).

## Verdict

**v1beta does not support `conversionSpec`.** Do **not** add `ga4_run_conversion_report` and do **not** send `conversionSpec` on `properties:runReport` (v1beta). Google would reject the field (`INVALID_ARGUMENT`).

v1alpha documents:

```json
"conversionSpec": {
  "conversionActions": ["conversionActions/1234"],
  "attributionModel": "DATA_DRIVEN"
}
```

Wave 11 stays on Data API **v1beta** (same as `ga4_run_report`). conversionSpec is out of scope.

## What we shipped instead

| Mechanism | Where |
| --- | --- |
| Closed Ads-id MTA recipes | `ga4_run_report` `recipe=ads_mta_*` |
| Ads-id dimension allowlist | `src/google/ga4-ads-id.ts` |
| `keyEvents:{eventName}` | optional `key_event_names` |
| `searchQuery` denylist | unchanged (`keyword` / `query` / `searchTerm` exact) |

GA4 has **no keyword id** dimension (only keyword *text*). `ads_mta_keyword_ids` is a named recipe that refuses with `UNSUPPORTED_DIMENSION` and points at `gads_search` recipe=`keywords`.

## Attribution settings (related spike)

Admin **v1beta** has no `GetAttributionSettings` / `UpdateAttributionSettings` RPCs. Those exist on **v1alpha**. GET accepts `analytics.readonly` (Consent A). PATCH requires `analytics.edit` (Consent G). Tools: `ga4_get_attribution_settings` / `ga4_update_attribution_settings`.

## Ads links list (related spike)

`properties.googleAdsLinks.list` (v1beta GET) documents OAuth `analytics.readonly` **or** `analytics.edit`. Implemented on Consent A HTTP (`ga4_list_google_ads_links`).
