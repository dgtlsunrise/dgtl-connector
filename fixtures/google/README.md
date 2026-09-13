# Synthetic Google-shaped fixtures

Names are `Example Brand`, `sc-domain:example.com`, `properties/111111111`. No live customer data. No OAuth material.

`ga4/accountSummaries.list.json` has 40 properties (`properties/2000000001` … `2000000040`). Index 0 is labeled MUST NOT AUTOSELECT.

`gtm/tags.oversize.json` has 80 tags for truncation tests.

`gbp/` is Wave 5 Account Management / Business Information / Performance API shapes. Names are `Example Brand Store` / `locations/12345678901234567890`. No live customer data.

`gtm/triggers.create.json`, `triggers.update.json`, `variables.create.json`, `variables.update.json` are Wave 6 Consent W mutate shapes. No live container data.

`ga4/googleAdsLinks.*`, `attributionSettings.*`, `dataStreams.create.json`, `dataStreams.patch.json`, `keyEvents.create.json`, `keyEvents.patch.json`, `customDimensions.create.json`, `customMetrics.create.json`, `measurementProtocolSecrets.*`, and `properties.create.json` are Wave 11 Consent G Admin shapes. Measurement Protocol `secretValue` strings are synthetic and must never appear in call logs. No live customer properties.
