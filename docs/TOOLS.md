# Tools (v1, closed)

**Closed free tool count: 26.** (the original 22 plus `ga4_list_account_summaries` plus `gsc_describe_schema` plus Wave 13 `gtm_list_clients` plus `gtm_list_environments`)

That 26 is the **Consent A kernel** (`CONSENT_A_TOOLS` / `FREE_TOOL_NAMES` alias). Shopify and Klaviyo are **local-free** (`LOCAL_FREE_TOOLS` — Shopify merchant token / Klaviyo `pk_`; no Polar — fail `SHOPIFY_NOT_CONNECTED` / `KLAVIYO_NOT_CONNECTED`). Ads/Meta/Merchant Center/TikTok are **license-gated** (`LICENSE_GATED_TOOLS`, Polar Pro — fail `LICENSE_REQUIRED`). TikTok requires JWT feature `tiktok` (not ads/meta). GBP is local-free when the flag is on (Consent B, not Consent A). Flag off → `GBP_NOT_ENABLED`. Flag on without Consent B → `GBP_NOT_CONNECTED`. Do not stuff Shopify or Klaviyo into the 26-tool kernel.

**Marketplace / public listing copy is Free Google read and manage.** `plugin.json` / `package.json` / [MARKETPLACE.md](MARKETPLACE.md) describe local GA4 + GSC + GTM (26-tool kernel) as **read and manage**. Mutates stay flag-gated. Ads / Meta / TikTok are Pro. MC / GBP / Shopify / Klaviyo write details live in this operator doc and [PERMISSIONS.md](PERMISSIONS.md) — they are **not** marketplace unlock promises. Marketplace submit is deferred. Do not publish the site, Worker, or marketplace listing from a docs PR.

If you need a 27th **Consent A** tool, bump a version and update `schemas/v1/catalog.json` in the same change. Do not “just add it.” Quality over dump. Small typed tools, not a mega-query kitchen sink.

Machine-readable list: [`schemas/v1/catalog.json`](../schemas/v1/catalog.json). Parameter schema: [`schemas/v1/tools.schema.json`](../schemas/v1/tools.schema.json). Error envelope: [`schemas/v1/error.schema.json`](../schemas/v1/error.schema.json).

**Not all tools are read.** Consent A GA4 / GSC / GTM, Shopify products/orders/inventory/locations/publications/catalogs/feeds, Klaviyo account/profiles/lists/flows/campaigns/metrics/catalog/reviews, and GBP (when enabled) are read (or fail-closed). GTM write (`gtm_create_tag`, `gtm_update_tag`, `gtm_create_trigger`, `gtm_update_trigger`, `gtm_create_variable`, `gtm_update_variable`, `gtm_publish_container`, `gtm_create_client`, `gtm_update_client`, `gtm_create_container`, `gtm_create_environment`), `shopify_adjust_inventory`, `shopify_product_set`, Klaviyo draft/upsert/event/catalog writes (`klaviyo_create_campaign`, `klaviyo_upsert_profile`, `klaviyo_create_event`, `klaviyo_upsert_catalog_items`), Merchant Center ProductInput writes (`mc_create_data_source`, `mc_upsert_product_input`, `mc_delete_product_input`, `mc_fetch_data_source`), and Ads / Meta mutate + create tools are registered **writes**. Repeating a **read** call is safe (**idempotent** as HTTP GET/list/query). Write tools are **not** idempotent. Read results are **not bit-stable** (GA4 processing, GSC data_state, GTM workspace edits).

## Mutate honesty (Wave 0)

### ACTIVE / ENABLED only on confirm

- `dry_run` **defaults true**. Omitted or `true` → proposed payload, **zero** mutate HTTP.
- Live (`dry_run=false`) requires `confirm_phrase` containing the resource IDs for that tool (Ads: digits-only `customer_id`; Meta: `act_{ad_account_id}` plus child ids; TikTok: `advertiser_id` plus `campaign_id` / `catalog_id` / `pixel_code` when those tools use them; Consent W: container `publicId`; Shopify writes: shop domain `*.myshopify.com`; Merchant Center writes: digits `merchant_id`; Klaviyo writes: account id from `klaviyo_get_account`).
- **Harness:** a **user** message this turn must contain those IDs. List-tool output is not the user message (`harnessUserMessageContainsCustomerId` in `src/ads/gads-write.ts`).
- Campaign / RSA / Meta **creates** default **PAUSED**.
- **ACTIVE** (Meta) / **ENABLED** (Google Ads) only when the caller passes **explicit** `status` **and** live confirm. Do not infer ENABLED/ACTIVE from a dry-run or from a PAUSED parent.

### Standalone keywords vs Search / Display-create children

| Path | Omitted `status` | Notes |
| --- | --- | --- |
| `gads_add_keywords` (standalone) | **PAUSED** | ENABLED only with explicit `status` + confirm. |
| `gads_create_search_campaign` children (ad group + stub keywords) | **ENABLED** under a **PAUSED** campaign | Intentional Google pattern. Do **not** pause children in Wave 0. |
| `gads_create_display_campaign` child ad group | **ENABLED** under a **PAUSED** campaign | Same. |

### Keyword match type

Omitted `match_type` → **BROAD** (`gads_add_keywords` and Search-create stub keywords). Documented; **do not flip** to PHRASE. Status is the spend gate, not match type.

### Dual-gate flag matrix

Live Ads / Meta / TikTok mutate requires **plugin AND Worker**. Plugin Ads / Meta / TikTok mutate flags **stay default on** so Pro tools remain listed. Worker flags are **fail-closed** (unset / unknown → no live hop). Do **not** flip plugin defaults as safety theater.

| Surface | Plugin default | Worker default | Live mutate |
| --- | --- | --- | --- |
| Ads mutate (`DGTL_ADS_MUTATE_ENABLED` / `ADS_MUTATE_ENABLED`) | **on** | fail-closed (`false` until health `ads_mutate_enabled=true`) | both true |
| Meta mutate (`DGTL_META_MUTATE_ENABLED` / `META_MUTATE_ENABLED`) | **on** | fail-closed | both true |
| Meta CAPI (`DGTL_META_CAPI_ENABLED` / `META_CAPI_ENABLED`) | **on** | fail-closed (`meta_capi_enabled`, **not** `META_MUTATE_ENABLED`) | both true |
| TikTok mutate (`DGTL_TIKTOK_MUTATE_ENABLED` / `TIKTOK_MUTATE_ENABLED`) | **on** | fail-closed (`tiktok_mutate_enabled`) | both true |
| TikTok Events (`DGTL_TIKTOK_EVENTS_ENABLED` / `TIKTOK_EVENTS_ENABLED`) | **on** | fail-closed (`tiktok_events_enabled`, **not** `TIKTOK_MUTATE_ENABLED`) | both true |
| Ads Data Manager (`DGTL_ADS_DATA_MANAGER_ENABLED` / `ADS_DATA_MANAGER_ENABLED`) | **on** (status / dual-gate only; **no** plugin send tool) | fail-closed (`ads_data_manager_enabled`) | stamp `FundedUploadSink` + Worker |
| sGTM apply ingest test (`DGTL_SGTM_INGEST_TEST_ENABLED` / `SGTM_INGEST_TEST_ENABLED`) | **off** | fail-closed (`sgtm_ingest_enabled`) | both true + host `DGTL_SGTM_APPLY_KEY` |
| Consent W writes (`DGTL_WRITES_ENABLED`) | **off** | n/a (local `GoogleWriteHttp`) | flag on + Consent W token |
| Shopify writes (`DGTL_WRITES_ENABLED`) | **off** | n/a (local `ShopifyHttp` mutation) | flag on + merchant `write_inventory` / `write_products` + shop-domain confirm |
| Klaviyo writes (`DGTL_WRITES_ENABLED`) | **off** | n/a (local `KlaviyoHttp` POST) | flag on + local `pk_` + confirm_phrase containing the Klaviyo account id |
| GBP (`DGTL_GBP_ENABLED`) | **off** | n/a | flag on + Consent B token → GET hop (no stamp) |

`support_packet` / `doctor` print this matrix (booleans only; never tokens).

### GBP live HTTP (Wave 5)

GBP tools (`gbp_list_accounts`, `gbp_list_locations`, `gbp_get_location`, `gbp_performance`, `gbp_search_keywords`) hop Google APIs when `DGTL_GBP_ENABLED=true` **and** Consent B is connected. Fail order: `GBP_NOT_ENABLED` (flag off) → `GBP_NOT_CONNECTED` → `GBP_SCOPE_MISSING` → hop. Direct Google (Account Management / Business Information / Performance). **Not** stamp. **Never** Consent A. Tools are GET-only even though `business.manage` is write-capable. Posts/replies are not registered (`UNSUPPORTED_OPERATION` if asked). Live quota (Basic API Access) is a **Noel gate**; without it Google returns `ACCESS_NOT_CONFIGURED`.

## Universal rules

1. **No silent default resource.** Required IDs are required. Reject `""`, `"default"`, `"first"`, `"0"`, and omitted fields with `RESOURCE_REQUIRED`.
2. **Do not invent tools** at runtime (`gtm_publish_tag` must not appear).
3. **Never return tokens** or `Authorization` headers.
4. **Map Google errors** to [ERRORS.md](ERRORS.md) codes. Pass through `google_status`, `google_reason`, `api`.
5. **Pagination:** list/query tools take `page_size` / `page_token` or `start_row` as specified. Do not auto-walk unbounded pages in one call.
6. **Granular consent:** missing scope → `CONSENT_MISSING` with the scope string, not a generic 401.

### Common error codes (every tool)

`UNAUTHENTICATED`, `REAUTH_REQUIRED`, `CONSENT_MISSING`, `ACCESS_NOT_CONFIGURED`, `PERMISSION_DENIED`, `NOT_FOUND`, `RESOURCE_REQUIRED`, `INVALID_ARGUMENT`, `QUOTA_EXCEEDED`, `RATE_LIMITED`, `GOOGLE_UNAVAILABLE`, `UNSUPPORTED_OPERATION`.

### Envelope

Success:

```json
{ "ok": true, "tool": "ga4_run_report", "data": { } }
```

Failure:

```json
{
  "ok": false,
  "tool": "gtm_list_accounts",
  "error_code": "ACCESS_NOT_CONFIGURED",
  "message": "The Tag Manager API is not enabled on the OAuth client's Google Cloud project.",
  "google_status": 403,
  "google_reason": "accessNotConfigured",
  "api": "tagmanager.googleapis.com",
  "hint": "If you are using the published plugin, this is a publisher defect. If you are using a local OAuth client, enable Tag Manager API in that Cloud project."
}
```

`message` is user-visible. `hint` is user-visible. Neither contains tokens.

Success envelopes may include `hint` when a list/report is **ok with zero rows** (empty is not `UNAUTHENTICATED`). Typical copy: “No rows is not an auth failure; check date range, filters, and property ID.”

---

## Identity (1)

### 1. `google_whoami`

**Why:** Support and picker need to know *which Google user* and *which scopes* actually landed.

| | |
| --- | --- |
| Google | `GET https://openidconnect.googleapis.com/v1/userinfo` |
| Scope | `openid` + `userinfo.email` (product scopes unused) |
| Params | none |
| Idempotent | yes |

**Returns (no tokens):** `email`, `sub`, `granted_scopes` (array of strings; host-provided or tokeninfo), `expires_in` (seconds, if known), `token_source`, `connections`, `license` (`ok`, `features`, `exp`, `jti`), `plugin_version`, `host` (string when known via `DGTL_HOST` / host heuristics, else `null`), `gateway.reachable` (`GET /v1/health` when `DGTL_GATEWAY_URL` is set; `false` if unset or probe fails — never `true` from URL alone).

If email scope was denied: `email` is null, `error_code` is not set; include `CONSENT_MISSING` only when the host has no access token at all.

---

## GA4 Admin (5)

Resource IDs: `account_id` like `accounts/123456`; `property_id` like `properties/123456789`. Accept with or without the prefix; normalize in the tool; **echo the canonical form** in the response.

### 2. `ga4_list_accounts`

| | |
| --- | --- |
| Google | Admin v1beta `accounts.list` |
| Scope | `analytics.readonly` |
| Params | `page_size` (optional, default 50, max 200), `page_token` (optional) |
| Idempotent | yes |

**Returns:** accounts (`name`, `displayName`, `regionCode`, `deleted`). Empty array is success (`ok: true`), not an error.

### 2b. `ga4_list_account_summaries`

| | |
| --- | --- |
| Google | Admin v1beta `accountSummaries.list` |
| Scope | `analytics.readonly` |
| Params | `page_size`, `page_token` |
| Idempotent | yes |

One-call agency picker: accounts with nested `propertySummaries`. **Does not select a property.** Never use index 0 from this list as a default `property_id`.

**Returns:** `account_summaries` (account `name` / `displayName` + `propertySummaries[]` with `property`, `displayName`, `propertyType`, `parent`).

### 3. `ga4_list_properties`

| | |
| --- | --- |
| Google | Admin v1beta `properties.list` with `filter=parent:accounts/{id}` |
| Scope | `analytics.readonly` |
| Params | **`account_id` required**, `page_size`, `page_token` |
| Idempotent | yes |

Do **not** offer a global “list every property in the universe” in v1. Agency accounts are walked **per parent account** so the picker stays labeled.

**Returns:** properties (`name`, `displayName`, `propertyType`, `timeZone`, `currencyCode`, `industryCategory`, `parent`).

If `account_id` omitted → `RESOURCE_REQUIRED`.

### 4. `ga4_get_property`

| | |
| --- | --- |
| Google | Admin v1beta `properties.get` |
| Scope | `analytics.readonly` |
| Params | **`property_id` required** |
| Idempotent | yes |

**Returns:** full property resource (timezone and currency **must** be present when Google returns them; skills use these in report headers).

### 5. `ga4_list_data_streams`

| | |
| --- | --- |
| Google | Admin v1beta `properties.dataStreams.list` |
| Scope | `analytics.readonly` |
| Params | **`property_id` required**, `page_size`, `page_token` |
| Idempotent | yes |

**Returns:** streams (`name`, `displayName`, `type`, `webStreamData.measurementId`, `webStreamData.defaultUri`, app IDs when present).

### 6. `ga4_list_key_events`

| | |
| --- | --- |
| Google | Admin v1beta `properties.keyEvents.list` |
| Scope | `analytics.readonly` |
| Params | **`property_id` required**, `page_size`, `page_token` |
| Idempotent | yes |

**Returns:** key events (`name`, `eventName`, `countingMethod`). If Google still serves conversionEvents on some properties, map into this shape; do not expose a second tool.

## GA4 Data (2)

### 7. `ga4_get_metadata`

| | |
| --- | --- |
| Google | Data v1beta `properties.getMetadata` (`properties/{id}/metadata`) |
| Scope | `analytics.readonly` |
| Params | **`property_id` required**; optional `query` (substring), `kind` (`dimension`\|`metric`\|`all`), `custom_only` |
| Idempotent | yes |

**Returns:** filtered `dimensions[]` / `metrics[]` with `apiName`, `uiName`, `description`, `customDefinition`, plus `property_id`, counts, and `filtered`. This is the anti-hallucination catalog for **this** property (includes custom dimensions/metrics). Prefer `query` / `kind` over dumping the full catalog when searching for a name.

Cap: if Google returns an oversized catalog, still return it; do not silently drop custom definitions.

### 8. `ga4_run_report`

The only report tool. Not batch, not realtime, not funnel, not pivot.

| | |
| --- | --- |
| Google | Data v1beta `properties.runReport` |
| Scope | `analytics.readonly` |
| Params | see table |
| Idempotent | yes (same request → eventually-consistent rows) |

| Param | Required | Rules |
| --- | --- | --- |
| `property_id` | yes | `properties/{id}` |
| `date_ranges` | yes | 1 or 2 ranges; each `{start_date, end_date}` as `YYYY-MM-DD` or `NdaysAgo` / `yesterday` / `today` |
| `metrics` | yes | 1–10 API names |
| `dimensions` | no | 0–9 API names |
| `dimension_filter` | no | Pass-through FilterExpression JSON (Google shape). No mini-SQL. |
| `metric_filter` | no | Pass-through FilterExpression JSON |
| `order_bys` | no | Google `OrderBy` array |
| `limit` | no | Default **50**, max **1000** per call |
| `offset` | no | Default 0 |
| `keep_empty_rows` | no | Default false |
| `currency_code` | no | ISO 4217; otherwise property currency |

**Always** set Google `returnPropertyQuota: true`. Echo `propertyQuota` in `data` so quota failures are diagnosable.

**Hard denylist (do not send to Google):** dimension names `searchQuery`, `query`, `searchTerm`, `keyword` (case-insensitive). Return `UNSUPPORTED_DIMENSION` with hint: use `gsc_query_search_analytics` with dimension `query`. This is a product rule, not a Google error.

**Closed Ads-id MTA recipes (optional `recipe`):** `ads_mta_campaign_ids`, `ads_mta_adgroup_ids`, `ads_mta_creative_ids`, `ads_mta_customer_ids`, `ads_mta_ids`. These fill session- + key-event-scoped Google Ads **id** dimensions from a closed allowlist. `ads_mta_keyword_ids` is named and **refused** — GA4 Data API v1beta has no keyword *id* (only keyword text; text stays denied). Ads-looking dimension names not on the allowlist → `UNSUPPORTED_DIMENSION`.

**conversionSpec:** Data API **v1beta `RunReportRequest` has no `conversionSpec`** (v1alpha only). Do not add `ga4_run_conversion_report`. Optional `key_event_names` expands to `keyEvents:{name}` metrics. See [ops/GA4-CONVERSIONSPEC-SPIKE.md](ops/GA4-CONVERSIONSPEC-SPIKE.md).

Other unknown names: send to Google; map `INVALID_ARGUMENT` and hint `ga4_get_metadata`.

**Empty rows:** `ok: true`, `row_count: 0`, plus a short `hint` that empty is not an auth failure. This is **not** `NOT_FOUND`. Skills distinguish empty property vs wrong ID (wrong ID is 403/404 from get_property).

**Does not exist:** `searchQuery` in GA4. Documented non-bug.

---

## Search Console (7)

`site_url` is the Search Console property URL: `https://example.com/` or `sc-domain:example.com`. Trailing slash matters for URL-prefix properties; do not “fix” it silently. If Google 404s, return `NOT_FOUND` and tell the user to copy the URL from `gsc_list_sites`. Call `gsc_describe_schema` before inventing dimension names.

### 9. `gsc_list_sites`

| | |
| --- | --- |
| Google | `sites.list` |
| Scope | `webmasters.readonly` |
| Params | none |
| Idempotent | yes |

**Returns:** `siteUrl`, `permissionLevel`. Empty list is success.

### 9b. `gsc_describe_schema`

| | |
| --- | --- |
| Google | none (local catalog) |
| Scope | none |
| Params | none |
| Idempotent | yes |

**Returns:** `dimensions[]` / `metrics[]` with `api_name` + `description`, plus `site_url_notes` and `data_state_notes`. Anti-hallucination for Search Analytics — call before `gsc_query_search_analytics`.

### 10. `gsc_get_site`

| | |
| --- | --- |
| Google | `sites.get` |
| Scope | `webmasters.readonly` |
| Params | **`site_url` required** |
| Idempotent | yes |

**Returns:** `siteUrl`, `permissionLevel`. Use this after list when the agent needs to confirm the user can actually read the site they named.

### 11. `gsc_query_search_analytics`

| | |
| --- | --- |
| Google | `searchanalytics.query` |
| Scope | `webmasters.readonly` |
| Params | see table |
| Idempotent | yes |

| Param | Required | Rules |
| --- | --- | --- |
| `site_url` | yes | Exact GSC property |
| `start_date` | yes | `YYYY-MM-DD` |
| `end_date` | yes | `YYYY-MM-DD` |
| `dimensions` | no | Subset of `query`, `page`, `country`, `device`, `searchAppearance`, `date`, `hour` |
| `row_limit` | no | Default **50**, max **1000** |
| `start_row` | no | Default 0 |
| `search_type` | no | `web` (default), `image`, `video`, `news`, `discover`, `googleNews` |
| `data_state` | no | `final` (default) or `all` |
| `aggregation_type` | no | Google enum if provided |
| `dimension_filter_groups` | no | Google `dimensionFilterGroups` JSON |

**Returns:** `rows` with keys, clicks, impressions, ctr, position; `responseAggregationType`. Empty rows → `ok: true`.

**This is the tool for search queries.** Not `ga4_run_report`.

### 12. `gsc_inspect_url`

Proven in the Installed App harness.

| | |
| --- | --- |
| Google | `urlInspection.index.inspect` |
| Scope | `webmasters.readonly` |
| Params | **`site_url` required**, **`inspection_url` required**, `language_code` optional (default `en-US`) |
| Idempotent | yes (index state can change) |

`inspection_url` must be a full URL the site property can cover. Do not inspect a URL under site B while passing site A's `site_url`.

**Returns:** inspectionResult (index status, covering page, last crawl, robots, page fetch). Read-only; **no** request-indexing tool.

Quota: URL Inspection is tighter than searchanalytics. Map 429 to `RATE_LIMITED` with a “try fewer URLs” message.

### 13. `gsc_list_sitemaps`

Proven: `sitemaps.list`.

| | |
| --- | --- |
| Google | `sitemaps.list` |
| Scope | `webmasters.readonly` |
| Params | **`site_url` required**, `sitemap_index` optional |
| Idempotent | yes |

**Returns:** sitemap entries (path, lastSubmitted, lastDownloaded, warnings, errors, isPending, isSitemapsIndex).

### 14. `gsc_get_sitemap`

| | |
| --- | --- |
| Google | `sitemaps.get` |
| Scope | `webmasters.readonly` |
| Params | **`site_url` required**, **`feedpath` required** |
| Idempotent | yes |

`feedpath` is the sitemap URL as GSC knows it (from list). Do not guess.

---

## Tag Manager v2 (10)

GTM is **in v1**. Do not defer.

IDs are strings as Google returns them (`account_id`, `container_id`, `workspace_id`). Path form `accounts/{a}/containers/{c}` is accepted and normalized.

Workspace lists show **draft** config. Live production config is `gtm_get_live_container_version`. Skills must say which.

### 15. `gtm_list_accounts`

| | |
| --- | --- |
| Google | Tag Manager v2 `accounts.list` |
| Scope | `tagmanager.readonly` |
| Params | none |
| Idempotent | yes |

Classic failure: `ACCESS_NOT_CONFIGURED` if Tag Manager API is not Enabled.

### 16. `gtm_list_containers`

| | |
| --- | --- |
| Google | `accounts.containers.list` |
| Scope | `tagmanager.readonly` |
| Params | **`account_id` required** |
| Idempotent | yes |

**Returns:** containers including `publicId` (e.g. `GTM-XXXX`), `name`, `usageContext`.

### 17. `gtm_get_container`

| | |
| --- | --- |
| Google | `accounts.containers.get` |
| Scope | `tagmanager.readonly` |
| Params | **`account_id` required**, **`container_id` required** |
| Idempotent | yes |

### 18. `gtm_list_workspaces`

| | |
| --- | --- |
| Google | `accounts.containers.workspaces.list` |
| Scope | `tagmanager.readonly` |
| Params | **`account_id` required**, **`container_id` required** |
| Idempotent | yes |

If more than one workspace, **do not** default to “Default Workspace.” Ask. If exactly one, the skill may use it after stating its name and ID.

### 19. `gtm_list_tags`

Proven: list tags.

| | |
| --- | --- |
| Google | `workspaces.tags.list` |
| Scope | `tagmanager.readonly` |
| Params | **`account_id`**, **`container_id`**, **`workspace_id`** all required |
| Idempotent | yes |

**Returns:** Tag resources (name, type, firing trigger IDs, paused, parameter). This is the audit payload; no separate `gtm_get_tag` in v1.

### 20. `gtm_list_triggers`

Proven: list triggers.

| | |
| --- | --- |
| Google | `workspaces.triggers.list` |
| Scope | `tagmanager.readonly` |
| Params | **`account_id`**, **`container_id`**, **`workspace_id`** all required |
| Idempotent | yes |

### 21. `gtm_list_variables`

| | |
| --- | --- |
| Google | `workspaces.variables.list` |
| Scope | `tagmanager.readonly` |
| Params | **`account_id`**, **`container_id`**, **`workspace_id`** all required |
| Idempotent | yes |

Included because marketing audits need “where does this GA4 ID live,” not only tag names.

### 22. `gtm_get_live_container_version`

| | |
| --- | --- |
| Google | `accounts.containers.versions.live` |
| Scope | `tagmanager.readonly` |
| Params | **`account_id` required**, **`container_id` required** |
| Idempotent | yes |

**Returns:** the **published** container version (tags, triggers, variables, fingerprint). No workspace id. If the container was never published, map Google’s error to `NOT_FOUND` with a clear message.

This is what you cite for “what is on the site.”

### 22b. `gtm_list_clients`

| | |
| --- | --- |
| Google | `workspaces.clients.list` |
| Scope | `tagmanager.readonly` (Consent A — official list also accepts `tagmanager.edit.containers`; we use A) |
| Params | **`account_id`**, **`container_id`**, **`workspace_id`** all required |
| Idempotent | yes |

**Returns:** workspace draft clients (`source=workspace`). sGTM adapters on **server** containers. Web containers are often empty. Not stamp ingest (Wave 20). Spike: [GTM-CLIENTS-SPIKE.md](ops/GTM-CLIENTS-SPIKE.md).

### 22c. `gtm_list_environments`

| | |
| --- | --- |
| Google | `accounts.containers.environments.list` |
| Scope | `tagmanager.readonly` (Consent A) |
| Params | **`account_id` required**, **`container_id` required** |
| Idempotent | yes |

**Returns:** container environments (`user` / `live` / `latest` / `workspace`). Not workspace-scoped.

---

## License (1)

### `license_status`

**Why:** Support and paid-lane intake need local JWT status without key material.

| | |
| --- | --- |
| Google | none (local verify only) |
| Scope | none |
| Params | none |
| Idempotent | yes |

**Returns (no tokens / no JWT):** `ok`, `features`, `exp`, `sub`, `jti`, `reason`, `plugin_version`, `latest_version`, `update_available`, optional `update_hint`, `host` (when known), `gateway` (`reachable` from health probe when URL set; `false` + `note` if unset/down). Latest-version probe is soft-fail (skip when `DGTL_SKIP_UPDATE_CHECK` is `1`/`true`; never throws offline). Never the JWT string.

### `support_packet`

**Why:** Support intake without asking for tokens. Local only — no Google call. Gated diagnostic (not one of the 26 Consent A tools).

| | |
| --- | --- |
| Google | none |
| Scope | none |
| Params | optional `last_tool`, `error_code`, `resource_id` |
| Idempotent | yes |

**Returns (never tokens / never JWT / never gateway URL):** `plugin_version`, `host` (when known), echoed `last_tool` / `error_code` / `resource_id` when they are safe identifiers, `flags.plugin` (Ads/Meta/TikTok mutate + CAPI/Events/Ads Data Manager default **on**; sGTM ingest test / writes / GBP default **off**), `flags.worker` (booleans from `GET /v1/health`, else `null`), `dual_gate` (live mutate = plugin AND Worker; Ads/Meta/TikTok/CAPI/Events/Ads Data Manager/sGTM ingest lanes), `gateway` (`configured`, `reachable`, hostname only), `license` (`present`, `ok`, feature names, `ads`/`meta`/`tiktok`/`sgtm` booleans — never the JWT; Polar `sgtm` is reserved, default-off, not minted), `stores` (Consent A/C/W/G/S/MC/B + Meta + TikTok + Shopify + Klaviyo file existence), `conversion_fabric` (`polar_sgtm` reserved/off/not-minted + `apply_key_present` boolean only — never the apply key), `runbook` + `next_human_step` (docs-relative, from `docs/ops/RUNBOOKS.md` when `error_code` maps). Token-shaped strings are dropped. Worker mutate flags stay fail-closed until health reports them. Full sink rows stay on `conversion_fabric_status`.

Named MCP tools are permanent. Wave 9 generates stamp allowlists from `src/gateway/hop-catalog.json`. There is no agent-facing `gads_mutate` / `meta_mutate`. `tools/list` must not shrink.

### `feedback_prepare`

**Why:** Approve-before-send plugin feedback. Builds a draft from `support_packet` fields plus the user’s message. Does **not** send.

| | |
| --- | --- |
| Google | none |
| Scope | none |
| Params | `message` (required), `reply_to` (required email), optional `kind` (`bug` \| `feature` \| `other`), optional `last_tool` / `error_code` / `resource_id` |
| Idempotent | yes |

**Returns:** `draft_text`, short `draft_id` (hash the send step must echo), `sent: false`. Destination mailbox is always `support@dgtlsunrise.com`. Token-shaped strings are stripped; a message that is only secrets is refused.

### `feedback_send`

**Why:** POST an approved draft to the hosted feedback endpoint. Requires exact `confirm: true` and the `draft_id` (or the full draft fields).

| | |
| --- | --- |
| Google | none |
| Scope | none |
| Endpoint | `POST ${DGTL_FEEDBACK_URL or DGTL_GATEWAY_URL}/v1/feedback` |
| Params | `confirm: true` (required), `draft_id` and/or the prepare fields |
| Idempotent | no |

JSON body includes `to` (`support@dgtlsunrise.com`), `reply_to`, `kind`, `message`, `draft_id`, `draft_text`, and the support-packet fields. No Authorization header, no Google tokens, no license JWT. Unset gateway → `GATEWAY_UNAVAILABLE` pointing at `DGTL_FEEDBACK_URL` / `DGTL_GATEWAY_URL`. Missing `confirm: true` → `INVALID_ARGUMENT` (no HTTP).

### `conversion_fabric_status`

**Why:** Operators need sink / flag health for Wave 20 conversion fabric without key material. Replaces the product story of `NoNetworkUploadSink`. Stamp implements `FundedUploadSink`.

| | |
| --- | --- |
| Google | none (optional `GET /v1/health` when `DGTL_GATEWAY_URL` is set) |
| Scope | none |
| Params | none |
| Idempotent | yes |

**Returns (never keys / never JWT / never `user_data`):** `wave: 20`, `replaces_product_story`, `stamp_interface`, Polar `sgtm` `{reserved, default:"off", mint:false, present}`, `gateway` host only, plugin/worker flags, dual-gate lanes for CAPI / TikTok Events / Ads Data Manager / sGTM ingest, sink rows from `conversion_fabric` (exact `stamp_sink` / `stamp_hop` names), ingest contract, `send_tools` (`meta_send_capi_events`, `tiktok_track_events`, Ads Data Manager `null`). Prefer Google Data Manager `IngestEvents` — not deprecated `UploadClickConversions`. Reuse Wave 16–17 send tools; do not duplicate CAPI/Events from the browser with secrets.

### `sgtm_ingest_test`

**Why:** Thin apply-path HTTP ingest test against stamp `POST /v1/sgtm/ingest`. Not a hop-catalog MCP hop. Not a funded upload.

| | |
| --- | --- |
| Google | none |
| Scope | none |
| Endpoint | `POST ${DGTL_GATEWAY_URL}/v1/sgtm/ingest` |
| Params | `event_name` (`apply` only), `event_id`, `application_id`, `client_id`; `dry_run` default **true**; live needs `confirm: true` |
| Header | `X-DGTL-Apply-Key` from host env `DGTL_SGTM_APPLY_KEY` / `DGTL_APPLY_KEY` |

Plugin flag **defaults off**. Live also needs Worker `SGTM_INGEST_ENABLED` (health `sgtm_ingest_enabled===true`, fail-closed). Never send `X-DGTL-Ingest-Key`. Never `Authorization`. Never `user_data`. Never put apply or funded keys in **web** GTM variables. Polar `sgtm` is reserved, default-off, **not minted**. Flag off / missing apply key / worker off → `SGTM_NOT_ENABLED` / `SGTM_APPLY_KEY_MISSING` / `GATEWAY_UNAVAILABLE` with **zero** ingest POST.

---

## Consent W — GTM write (flag-gated; family on Free Google)

Flag `DGTL_WRITES_ENABLED` defaults **false** → `WRITE_NOT_ENABLED` (zero HTTP). When on, tools use **`GoogleWriteHttp`**. Token order: legacy Consent W store (`GOOGLE_WRITE_ACCESS_TOKEN` / `google-oauth-write.json`), then Free Google when the token lists `tagmanager.edit.containers` + `tagmanager.publish`. `auth login-write` aliases `auth login` and does **not** flip `DGTL_WRITES_ENABLED`.

| Tool | Notes |
| --- | --- |
| `gtm_create_tag` | Workspace tag create. `dry_run` **defaults true**. Live (`dry_run=false`) requires `confirm_phrase` containing the resolved container `publicId`. |
| `gtm_update_tag` | Workspace tag update. Same dry-run / publicId confirm rules. |
| `gtm_create_trigger` | Workspace trigger create. Same dry-run / publicId confirm rules. |
| `gtm_update_trigger` | Workspace trigger update. Same dry-run / publicId confirm rules. |
| `gtm_create_variable` | Workspace variable create. Optional closed `parameter` `{type,key,value}`. Same dry-run / publicId confirm. |
| `gtm_update_variable` | Workspace variable update. Same dry-run / publicId confirm rules. |
| `gtm_publish_container` | Highest risk: `create_version` then `:publish`. **Publish last.** Same dry-run / publicId confirm. No hosted Approval. **No live publish in CI** (fixtures only). |
| `gtm_create_client` | Workspace sGTM client create. Closed `type` enum: `gaawp`, `googtag`, `gclidw`, `flc`, `ua`, `mp`. Live confirm = `publicId` **or** `accounts/{id}/containers/{id}`. Ingest-key parameter keys refused. |
| `gtm_update_client` | Workspace sGTM client update. Same closed type + confirm rules. |
| `gtm_create_container` | Account-level container create. Closed `usage_context`: `server` (sGTM) plus locked `web` / `android` / `ios` / `amp`. Live confirm = `accounts/{account_id}`. |
| `gtm_create_environment` | USER environment create. Live confirm = `publicId` or container path. No reauthorize. |

Marketplace / shipped default: `DGTL_WRITES_ENABLED` is **false** (`mcp.json` does not set it; `.env.example` is `false`). Flag on is **local only**. Do **not** put the expected confirm phrase or an example `GTM-XXXX` value in the tool description. Skill: live mutate only after a **user** message this turn containing that publicId (list-tool output ≠ user message).

**Live disposable container is a Noel gate.** Prefer fixtures in CI. Do not run live create/publish against customer properties.

---

## Consent G — GA4 Admin writes (Wave 11)

Writes use **`GoogleGa4AdminHttp`**. Token order: legacy Consent G store (`GOOGLE_GA4_ADMIN_ACCESS_TOKEN` / `google-oauth-ga4-admin.json`), then Free Google when the token lists `analytics.edit`. `auth login-ga4-admin` aliases `auth login`. Login does **not** flip `DGTL_WRITES_ENABLED`. Named tools only — no mega-mutate / raw Admin dump.

Spike: Admin **GET** `googleAdsLinks.list` and v1alpha `getAttributionSettings` accept `analytics.readonly` → those two reads use Consent A HTTP. Measurement Protocol secret list/create stay on Consent G. `secretValue` is never written to call/audit logs; list envelopes redact it.

| Tool | Notes |
| --- | --- |
| `ga4_list_google_ads_links` | Consent A GET. `property_id` required. |
| `ga4_create_google_ads_link` / `ga4_delete_google_ads_link` | Consent G. `dry_run` default true. Live `confirm_phrase` must include `properties/{id}`. |
| `ga4_get_attribution_settings` | Consent A GET on **v1alpha** (v1beta has no this RPC). |
| `ga4_update_attribution_settings` | Consent G PATCH v1alpha. Closed enums. Same confirm rule. |
| `ga4_create_data_stream` / `ga4_update_data_stream` | Consent G. Web stream only on create. |
| `ga4_create_key_event` / `ga4_update_key_event` | Consent G. |
| `ga4_create_custom_dimension` / `ga4_create_custom_metric` | Consent G. Closed scope/unit enums. |
| `ga4_list_mp_secrets` | Consent G read (flag not required). `secretValue` redacted. |
| `ga4_create_mp_secret` | Consent G write. `secretValue` returned in data once; never logged. |
| `ga4_create_property` | Consent G. Live confirm must include `accounts/{id}`. Ordinary property only. |

Not registered: `ga4_update_property`. GSC sitemap submit/delete is Wave 12 (Consent S).

| Lane | CLI | Store | Scopes | Error when missing |
| --- | --- | --- | --- | --- |
| **G** (GA4 Admin) | `auth login` (alias `login-ga4-admin`) | Primary `google-oauth.json`; legacy `google-oauth-ga4-admin.json` | `analytics.edit` | `CONSENT_G_REQUIRED` |
| **S** (GSC write) | `auth login` (alias `login-gsc-write`) | Primary `google-oauth.json`; legacy `google-oauth-gsc-write.json` | `webmasters` (write) | `CONSENT_S_REQUIRED` |

`google_whoami` may report `consent_g` / `consent_s` connection booleans (never tokens). Doctor / `support_packet` report whether those stores **exist** (boolean only).

## Consent S — GSC sitemap writes (Wave 12)

Sitemap submit/delete use **`GoogleGscWriteHttp`**. Token order: legacy Consent S store (`GOOGLE_GSC_WRITE_ACCESS_TOKEN` / `google-oauth-gsc-write.json`), then Free Google when the token lists `webmasters` (write). `auth login-gsc-write` aliases `auth login`. Login does **not** flip `DGTL_WRITES_ENABLED`. Named tools only — no Indexing API / `gsc_request_indexing`, no add/remove site.

Reads (`gsc_list_sitemaps`, `gsc_get_sitemap`, inspect, search analytics) stay on Consent A (`webmasters.readonly`).

| Tool | Notes |
| --- | --- |
| `gsc_submit_sitemap` | PUT `sitemaps.submit`. Params: exact `site_url` + `feedpath`. `dry_run` default true. Live `confirm` / `confirm_phrase` must include that `site_url`. |
| `gsc_delete_sitemap` | DELETE the same path. Same confirm / flag / Consent S rules. |

Wrong `site_url` (trailing slash / `sc-domain:` mismatch, or confirm that names a different property) is a clear `INVALID_ARGUMENT` / `NOT_FOUND` — copy the URL from `gsc_list_sites`. Flag off → `WRITE_NOT_ENABLED` (zero HTTP). Flag on without Consent S → `CONSENT_S_REQUIRED`.

### Consent W E2E order (Wave 6)

1. Flag off → any write tool `WRITE_NOT_ENABLED` (zero HTTP).
2. Local only: `DGTL_WRITES_ENABLED=true` + Consent W token (`auth login-write` or `GOOGLE_WRITE_ACCESS_TOKEN`).
3. Dry-run create tag / trigger / variable → proposed + `publicId`, GET-only.
4. User message this turn contains that `publicId` → live create (`dry_run=false`, `confirm_phrase` includes publicId).
5. Consent A `gtm_list_*` can read the workspace draft.
6. **Publish last:** dry-run `gtm_publish_container` then live once Noel confirms with publicId.

---

## Gated Ads / Meta DX (paid; not free kernel)

Consent A kernel stays **26**. These are Polar-gated; local describe tools need license only (no gateway/token). Live list/report tools still use stamp gateway + Consent C / Meta token.

| Tool | Notes |
| --- | --- |
| `gads_list_accessible_customers` | Use first for customer ids (digits, no hyphens). |
| `gads_describe_recipes` | Local closed-recipe catalog — call before `gads_search`. No GAQL. |
| `gads_get_customer` / `gads_search` / `gads_campaign_performance` | Closed recipes; cite `data.cited.customer_id`. |
| `gads_add_keywords` | Standalone criterion add. Omitted `status` → **PAUSED**. ENABLED only with explicit `status` + confirm. Omitted `match_type` → **BROAD** (do not flip). |
| `gads_create_search_campaign` | Closed Search create: budget + campaign + ad group + ≥1 keyword stub; optional RSA. Campaign defaults **PAUSED**. Child ad group + stub keywords stay **ENABLED** under that PAUSED campaign (intentional). |
| `gads_create_display_campaign` | Display foundation: budget + DISPLAY campaign + DISPLAY_STANDARD ad group. Campaign defaults **PAUSED**; child ad group **ENABLED**. Add RDA with `gads_create_responsive_display_ad`. |
| `gads_create_responsive_search_ad` / `gads_set_*` / `gads_update_campaign_budget` | Creates default PAUSED; status/budget updates are confirm-gated. ENABLED only with explicit `status` + confirm. |
| `meta_list_ad_accounts` | Use first for `ad_account_id`. |
| `meta_describe_insights_schema` | Local levels / date_presets / breakdowns / fields — call before `meta_insights`. |
| `meta_insights` | `date_preset` or dates; optional `breakdowns` / `fields` / `time_increment`; cite `data.cited`. ads_read only. |
| `meta_list_*` / `meta_get_creative` | Read lists + creative metadata (URLs, not bytes). |
| `meta_list_pixels` / `meta_get_pixel` | Pixel read (id, name, last_fired_time). CAPI upload is `meta_send_capi_events`. |
| `meta_list_catalogs` / `meta_list_catalog_products` | Catalog read. Writes: `meta_create_catalog` / `meta_catalog_items_batch`. |
| `meta_catalog_items_batch` | Marketing API `items_batch` upsert. dry_run default; live confirm `act_{ad_account_id}` AND `catalog_id`. HTTPS `image_link` / `link` only. `ads_management` or `catalog_management` when detectable. Worker `META_MUTATE_ENABLED`. |
| `meta_get_batch_status` | Read `check_batch_request_status` for a batch `handle`. ads_read. |
| `meta_create_catalog` | Confirm-gated owned catalog create (`act_{ad_account_id}/owned_product_catalogs`). Closed `vertical`. |
| `meta_send_capi_events` | Closed `event_name` enum; SHA-256 `user_data`; required `event_id`. Confirm `act_` AND `pixel_id`. Dual-gate Worker `META_CAPI_ENABLED` (fail-closed, not ads mutate). Never unhashed PII in logs. |
| `meta_list_custom_audiences` | List custom audiences for attach / lookalike origin. |
| `meta_update_campaign` / `meta_update_adset` / `meta_update_ad` | Confirm-gated status/name/ad-set budget updates; dry-run default; `ads_management` required. |
| `meta_create_campaign` | Closed Outcome-objective campaign create; defaults **PAUSED**; **ACTIVE** only with explicit `status` + confirm with `act_{ad_account_id}`. |
| `meta_create_adset` | Existing campaign + named targeting packs (countries required; age/genders/locales/interests/behaviors/custom audiences/placements) + capped budget cents; optional `pixel_id`/`catalog_id` promoted_object. Defaults PAUSED. Never send a `targeting` JSON bag. |
| `meta_update_adset_targeting` | Replace ad set targeting from the same named packs. Countries required (replace, not merge). |
| `meta_create_custom_audience` | Website custom audience from `pixel_id`. No hashed PII / Customer Match. |
| `meta_create_lookalike_audience` | Lookalike from `origin_audience_id` + country. Server-built `lookalike_spec`. |
| `meta_attach_audience` | Attach `custom_audience_ids` to an ad set (replaces targeting; countries required). |
| `meta_create_ad` | Existing ad set + existing `creative_id` (from `meta_create_ad_creative`); defaults PAUSED; ACTIVE only with explicit status + confirm with act + ad set + creative ids. |
| `meta_upload_ad_image` | Base64 image upload → `image_hash`; confirm-gated; dry_run default. |
| `meta_upload_ad_video` | https `file_url` video upload → `video_id` (media source, not hop proxy); confirm-gated. |
| `meta_create_ad_creative` | `image_hash` XOR `video_id` + `page_id` + https `link` → `creative_id`; server-built object_story_spec. |
| `gads_upload_asset` | IMAGE asset via stamp AssetService (`bytes` XOR https `file_url`). dry_run default; live confirm with customer_id. Returns resource_name for PMax. |
| `gads_create_performance_max_campaign` | PMax with uploaded images (`file_url`/`bytes`) **or** existing marketing/square/logo asset RNs from `gads_upload_asset`. Defaults **PAUSED**. |
| `gads_create_shopping_campaign` | Shopping when `merchant_center_id` known; else `MERCHANT_CENTER_REQUIRED`. Discover ids via `gads_list_merchant_center_links` or `mc_list_accounts`. Listing groups: `gads_add_shopping_listing_groups`. Product readiness: `mc_list_product_statuses`. |
| `gads_list_merchant_center_links` | Read MC **product_link** discovery for Shopping create. Not product data — use `mc_list_products`. |
| `gads_create_responsive_display_ad` | RDA on an existing Display ad group. Marketing + square images (`gads_upload_asset` RNs or `file_url`/`bytes`). Defaults **PAUSED**. |
| `gads_add_shopping_listing_groups` | Shopping listing groups (`ALL_PRODUCTS` UNIT, or `BRAND`/`ITEM_ID` subdivision). New shopping ad group **ENABLED** under a PAUSED campaign. |
| `gads_create_video_campaign` | VIDEO campaign + VIDEO_RESPONSIVE ad group. Optional `youtube_video_id` adds a PAUSED video ad. Campaign **PAUSED**. Live smoke blocked until Noel pastes Intended-use. |
| `gads_create_demand_gen_campaign` | DEMAND_GEN campaign + ad group. Optional multi-asset ad when images supplied. Defaults **PAUSED**. |
| `gads_create_app_campaign` | MULTI_CHANNEL `APP_CAMPAIGN` with `app_id` + `app_store`. Defaults **PAUSED**. |
| `gads_create_hotel_campaign` | HOTEL campaign with `hotel_center_id` + HOTELS_ADS ad group. Defaults **PAUSED**. |
| `gads_create_local_campaign` | Named tool. Google sunset Local campaigns → `NOT_IMPLEMENTED` (zero hop). Use PMax. Smart create is **not** advertised. |
| `gads_add_negative_keywords` | Campaign or ad-group negatives. Standalone criterion add defaults **PAUSED**. |
| `gads_attach_audience` | Attach audience/user-list RN to campaign or ad group. Defaults **PAUSED**. |
| `gads_add_geo_targets` / `gads_add_languages` / `gads_add_demographics` / `gads_set_ad_schedule` | Closed criteria. Defaults **PAUSED**. Geo ids from `gads_search` recipe=geo. |
| `gads_set_campaign_bid_strategy` | Closed-enum bidding (MANUAL_CPC, TARGET_CPA, TARGET_ROAS, …) or portfolio RN. |
| `gads_create_shared_budget` / `gads_create_portfolio_bidding_strategy` | Shared budget (`explicitlyShared`) and portfolio BiddingStrategy (closed enum). |
| `gads_create_conversion_action` | Conversion action create (tracking, not spend). |
| `gads_apply_recommendation` | Apply **one** recommendation RN from `gads_search` recipe=recommendations. Confirm-gated. **ENABLED is not a side effect.** No apply-all. |
| `gads_apply_recommendations` | Wave 22 batch. Explicit `recommendation_resource_names[]` in the call **and** in `confirm_phrase` (plus `customer_id`). One mutate HTTP for that named list. Refuse `apply_all` / `*` / empty list. Never sets `status=ENABLED`. |
| `gads_link_merchant_center` / `gads_unlink_merchant_center` | ProductLink create/remove (not MCC; not Merchant API). Confirm-gated. |
| `gads_create_experiment` | Experiment in **SETUP** (not live) with control arm on an existing campaign. |

`gads_search` closed recipes now include assets, asset_groups, audiences, shared_sets, bidding_strategies, geo, demographics, shopping_performance, recommendations, change_event, account_budget (billing **read**), negatives, experiments, plus Wave 21 **`click_view`**, **`keyword_performance`**, **`ad_performance`**. Still **no raw GAQL**. Stamp compiles those three (ClickView / keyword_view / ad_group_ad). `click_view` is single-day; **gclid is not a GA4 dimension**. Meta pixel/catalog/audience **reads** and named targeting/audience mutates are Wave 3. Wave 16 adds catalog `items_batch` + CAPI. Lift, activity logs, Advantage+ shopping create, Customer Match hashed PII lists, and Meta hosted `ads_mcp_management` remain **deferred**. Meta live mutates fail closed with `META_SCOPE_MISSING` until `ads_management` / `catalog_management` Advanced Access and a reauthorized token are present. See [ops/META-CREATE-SPEEDRUN-2026-09-11.md](ops/META-CREATE-SPEEDRUN-2026-09-11.md) and [ops/ADS-META-FOUNDATIONS-2026-09-11.md](ops/ADS-META-FOUNDATIONS-2026-09-11.md). No agent-facing `meta_mutate`.

---

## Merchant Center — Merchant API reads + ProductInput writes (Wave 4 / Wave 14; direct Google; not stamp)

**Hop decision:** plugin-direct `merchantapi.googleapis.com` with Consent MC. **Not** stamp. Content API for Shopping sunset **2026-08-18**; Merchant API v1 (`products`, `accounts`, `datasources`, `productInputs`). Ads developer-token is the wrong secret. Same hop class as GA4/GSC (`direct_google`). Polar has no `mc` bit — tools require Pro (`ads`) **and** Consent MC. Never Consent A. Never guess `merchant_id`.

Auth: `GOOGLE_MC_ACCESS_TOKEN` or `dgtl-connector-mcp auth login-mc` (`GOOGLE_OAUTH_MC_CLIENT_ID` → `PLUGIN_DATA/google-oauth-mc.json`). Scope `https://www.googleapis.com/auth/content` (Google has no readonly content scope). **Reads** stay GET-only on `GoogleHttp`. **Writes** use `GoogleMcWriteHttp` (same Consent MC — no extra MC OAuth bit, no Consent A). Fail `LICENSE_REQUIRED` → `MC_NOT_CONNECTED` → `MC_SCOPE_MISSING`. Live writes also need `DGTL_WRITES_ENABLED` + `confirm_phrase` containing digits `merchant_id`. **No** `GATEWAY_UNAVAILABLE` (no Worker hop). Live API enablement on the MC OAuth client's GCP project is a **Noel gate** (`ACCESS_NOT_CONFIGURED`).

`merchant_id` is required on product/issue/feed/write tools. Discover via `mc_list_accounts` or Ads `gads_list_merchant_center_links`. `product_id` is `contentLanguage~feedLabel~offerId`. Product **writes** are `ProductInput` + `dataSource` (API data source). Do not POST processed `Product`.

| Tool | Notes |
| --- | --- |
| `mc_list_accounts` | List Merchant Center accounts (`merchant_id`). |
| `mc_list_products` | Processed products (Merchant API `products.list`). |
| `mc_get_product` | One product including nested `productStatus`. |
| `mc_list_product_statuses` | Readiness view: `shopping_ads_ready` when `SHOPPING_ADS` has `approvedCountries`; `item_level_issues` block ads. |
| `mc_list_account_issues` | Account/feed/website diagnostics. |
| `mc_list_data_sources` | Feeds (primary/supplemental). Pair with account issues. |
| `mc_create_data_source` | API-type primary/supplemental create (`ONLINE_PRODUCTS`). No `fileInput`. `dry_run` default; live confirm `merchant_id`. |
| `mc_upsert_product_input` | `productInputs.insert` (default) or `patch` when `update_mask` is set. Requires `data_source`. Closed Shopping attributes. |
| `mc_delete_product_input` | `productInputs.delete` from that API `data_source`. |
| `mc_fetch_data_source` | Immediate fetch on a **FILE** data source (operator). Not Product insert. |

Skill: [`skills/shopping-mc-readiness/`](../skills/shopping-mc-readiness/SKILL.md). Shopping **campaign** create still uses stamp `gads_create_shopping_campaign` + product_link id. Product inventory for ads is `mc_*` ProductInput. No data-source delete/patch, promotions, or reviews in this wave.

---

## Google Business Profile — GET-only (Wave 5; direct Google; not stamp)

**Hop decision:** plugin-direct GBP APIs with Consent B. **Not** stamp. **Not** Consent A. Same hop class as GA4/GSC/MC (`direct_google`). Commercially free-local when the flag is on — no Polar bit.

Auth: `GOOGLE_GBP_ACCESS_TOKEN` or `dgtl-connector-mcp auth login-gbp` (`GOOGLE_OAUTH_GBP_CLIENT_ID` → `PLUGIN_DATA/google-oauth-gbp.json`). Scope `https://www.googleapis.com/auth/business.manage` (Google has no readonly GBP scope; **tools are GET-only**). Fail `GBP_NOT_ENABLED` (flag off) → `GBP_NOT_CONNECTED` → `GBP_SCOPE_MISSING`. **No** `GATEWAY_UNAVAILABLE` (no Worker hop). Live Basic API Access quota on the GBP OAuth client's GCP project is a **Noel gate** (`ACCESS_NOT_CONFIGURED`). `auth login-gbp` does **not** flip `DGTL_GBP_ENABLED`.

`account_name` / `location_name` are required on location/performance/keyword tools. Never guess. Discover via `gbp_list_accounts` then `gbp_list_locations`. Location names are `locations/{id}`.

| Tool | Notes |
| --- | --- |
| `gbp_list_accounts` | Account Management API `accounts.list`. |
| `gbp_list_locations` | Business Information API `accounts.locations.list` (`readMask` closed). Requires `account_name`. |
| `gbp_get_location` | Business Information API `locations.get`. Requires `location_name`. |
| `gbp_performance` | Performance API `fetchMultiDailyMetricsTimeSeries`. Requires `location_name` + `start_date` + `end_date`. Does not list locations. |
| `gbp_search_keywords` | Performance API monthly search-keyword impressions. Requires `location_name`. Optional `month` (`YYYY-MM`). |

No posts, replies, Q&A, or location mutate in this wave.

---

## Out of v1 (do not add quietly)

| Request | Response |
| --- | --- |
| GTM write when flag off / no Consent W | `WRITE_NOT_ENABLED` / `CONSENT_W_REQUIRED` |
| GA4 Admin writes when flag off / no Consent G | `WRITE_NOT_ENABLED` / `CONSENT_G_REQUIRED` |
| GSC sitemap write when flag off / no Consent S | `WRITE_NOT_ENABLED` / `CONSENT_S_REQUIRED` |
| Merchant Center ProductInput live without flag / confirm | `WRITE_NOT_ENABLED` / `INVALID_ARGUMENT` (confirm must include `merchant_id`) |
| Request indexing | No tool |
| Create GA4–GSC link | No tool; `analytics.readonly` cannot |
| Google Ads / Meta (live HTTP) | Tools are registered; fail closed: `LICENSE_REQUIRED` → `GATEWAY_UNAVAILABLE` → `ADS_SCOPE_MISSING` / `META_NOT_CONNECTED`. Consent C via `auth login-ads` / `auth login-meta --code` or host-injected tokens. No developer-token in this plugin. |
| GBP write (posts / replies) | No tool. Scope is write-capable; Wave 5 tools are GET-only. |
| GA4 realtime, funnel, pivot, batch | No tool |
| GTM users / folders / built-in variables / environment reauthorize | No tool (Wave 16+) |
| MC data-source delete/patch, promotions, reviews | No tool (Wave 16+) |
| Meta catalog / CAPI | Wave 16 named tools (`meta_catalog_items_batch`, `meta_get_batch_status`, `meta_create_catalog`, `meta_send_capi_events`). No open Graph proxy. |
| Stamp conversion ingest / CAPI sinks | Wave 20: `conversion_fabric_status` + apply-only `sgtm_ingest_test`. Ads Data Manager `IngestEvents` is stamp-internal (`AdsDataManagerIngestEventsSink` / `ads_data_manager_ingest_events`). Reuse `meta_send_capi_events` / `tiktok_track_events`. Never put funded or apply keys in web GTM. |
| Gmail / Drive | No tool |
| Mega `run_any_google_json` | Forbidden |

## Count check

Identity 1 + GA4 8 + GSC 7 + GTM 10 = **26**.

| Group | Tools |
| --- | --- |
| identity | `google_whoami` |
| ga4-admin | `ga4_list_accounts`, `ga4_list_account_summaries`, `ga4_list_properties`, `ga4_get_property`, `ga4_list_data_streams`, `ga4_list_key_events` |
| ga4-data | `ga4_get_metadata` (optional query/kind), `ga4_run_report` |
| gsc | `gsc_list_sites`, `gsc_describe_schema`, `gsc_get_site`, `gsc_query_search_analytics`, `gsc_inspect_url`, `gsc_list_sitemaps`, `gsc_get_sitemap` |
| gtm | `gtm_list_accounts`, `gtm_list_containers`, `gtm_get_container`, `gtm_list_workspaces`, `gtm_list_tags`, `gtm_list_triggers`, `gtm_list_variables`, `gtm_get_live_container_version`, `gtm_list_clients`, `gtm_list_environments` |


## Shopify — products/orders/inventory + publications/feeds read + confirm-gated inventory / productSet write (local; not Consent A)

Merchant-held Admin API credentials on the Bot computer. **No Polar. No stamp hop. No multi-store vault.** Fail closed `SHOPIFY_NOT_CONNECTED` without `SHOPIFY_STORE` + `SHOPIFY_ACCESS_TOKEN` (or `PLUGIN_DATA/shopify-oauth.json`). Admin GraphQL API version **2026-04** (not bumped). Closed free Google count stays **26**.

**Consent decision:** Shopify is not Google OAuth. Default reads stay **LOCAL_FREE** with `read_products` + `read_orders` + `read_inventory` + `read_locations`. **Explicit expand** (reinstall; never silent on an existing app): `read_publications`, `read_product_listings`, `write_inventory`, `write_products`. Writes use the **same** merchant token after the matching write scope **and** `DGTL_WRITES_ENABLED` (default **false**). There is no second Shopify OAuth family and no Worker vault.

| Tool | Notes |
| --- | --- |
| `shopify_get_shop` | Confirm shop domain + name. |
| `shopify_list_products` | Paginated; title/handle/status/id. |
| `shopify_get_product` | Requires `product_id` (gid or numeric). Variants include `sku`, `barcode` (GTIN), `inventoryItem.id`. Also `featuredImage.url` + `onlineStoreUrl` for catalog fan-out. |
| `shopify_list_orders` | Paginated; closed `status` / `financial_status` / `fulfillment_status` / date filters. |
| `shopify_get_order` | Requires `order_id` (gid or numeric); line items. |
| `shopify_list_locations` | Paginated locations. `read_locations`. |
| `shopify_list_inventory_levels` | Requires `location_id`. `read_inventory`. |
| `shopify_list_publications` | Paginated publications. **`read_publications`** (explicit expand). Optional `catalog_type` APP\|COMPANY_LOCATION\|MARKET\|NONE. |
| `shopify_list_catalogs` | Paginated Shopify catalogs. Existing **`read_products`**. Optional `catalog_type`. Not Meta catalog. |
| `shopify_list_product_feeds` | Paginated product feeds. **`read_product_listings`** (explicit expand). |
| `shopify_adjust_inventory` | Write. `inventoryAdjustQuantities` delta. `dry_run` default true. Live: `confirm_phrase` must contain the shop domain. Flag off → `WRITE_NOT_ENABLED` (zero HTTP). Missing `write_inventory` → `SHOPIFY_SCOPE_MISSING`. |
| `shopify_product_set` | Write. Allowlisted `productSet` GraphQL only (title/handle/status/description_html/vendor/product_type/tags/product_options/variants). `dry_run` default true. Live: `confirm_phrase` or `confirm` must contain the shop domain. `DGTL_WRITES_ENABLED` + **`write_products`**. Variants/tags **replace** omitted entries. No raw GraphQL. No customers. |

Fail order for writes: `WRITE_NOT_ENABLED` → `SHOPIFY_NOT_CONNECTED` → `SHOPIFY_SCOPE_MISSING` → dry-run (shop domain, zero mutation HTTP) → live needs shop domain in `confirm_phrase` / `confirm`.

**Out of this wave:** customers dump, ShopifyQL, raw GraphQL, themes, Multipass, stamp multi-store vault, draft orders, collections/metafields/files on productSet. Meta catalog/CAPI is Wave 16 (`meta_catalog_items_batch` / `meta_send_capi_events`), not Shopify.

Skills: `shopify-ads-mc-join` joins Shopify SKU → MC `offerId` → Ads listing groups. `catalog-fan-out` maps Shopify → MC / Meta / TikTok / Klaviyo (per-network tools; Google omits missing GTIN / missing image). `shopify-readonly` covers list/get.

## TikTok Ads (Polar `tiktok` + stamp hop)

**Stamp hop** (`POST /v1/tiktok/{tool}`). App id + secret stay on the Worker (same class as Meta). Plugin holds only the advertiser user token (`TIKTOK_ACCESS_TOKEN` / `PLUGIN_DATA/tiktok-oauth.json`). JWT must include feature **`tiktok`** — Polar Pro mint today is `ads`+`meta` only until Noel sets `POLAR_MINT_TIKTOK`. Do not overload ads/meta bits.

Fail order (reads): `LICENSE_REQUIRED` → `GATEWAY_UNAVAILABLE` → `TIKTOK_NOT_CONNECTED` → hop.

| Tool | Notes |
| --- | --- |
| `tiktok_list_advertisers` | Discover `advertiser_id`. Worker injects app_id+secret on `oauth2/advertiser/get`. |
| `tiktok_list_campaigns` | Requires `advertiser_id`. |
| `tiktok_insights` | Requires `advertiser_id` + `date_start`/`date_stop` (YYYY-MM-DD). Optional `level`: advertiser/campaign/adgroup/ad. Closed BASIC metrics. |
| `tiktok_update_campaign` | Mutate. Status `ENABLE`/`DISABLE` (`ACTIVE`→ENABLE, `PAUSED`→DISABLE). `dry_run` default true. Live: `confirm_phrase` must contain `advertiser_id` AND `campaign_id`. Plugin flag default **on**; Worker `TIKTOK_MUTATE_ENABLED` default **off**. No DELETE. Budget is `tiktok_update_campaign_budget`. |
| `tiktok_update_campaign_budget` | Mutate. Campaign `budget` + `BUDGET_MODE_DAY` / `BUDGET_MODE_TOTAL` via stamp `campaign/update`. `dry_run` default true. Live confirm `advertiser_id` AND `campaign_id`. Spend cap $100,000. Dual-gate `TIKTOK_MUTATE_ENABLED`. Stamp hop row must stay byte-identical. No mega `allocate_budgets`. |
| `tiktok_list_catalogs` | Read hop. Requires `advertiser_id`. Optional `bc_id` / `catalog_id`. Not Shopify catalogs. |
| `tiktok_create_catalog` | Mutate. Closed `catalog_type` (default `ECOM`). Confirm `advertiser_id`. Catalog API often needs `bc_id`. Dual-gate `TIKTOK_MUTATE_ENABLED`. |
| `tiktok_upload_catalog_products` | Mutate. JSON upload. `sku_id` **is** the Events API `content_id`. HTTPS `image_url` / `landing_page_url` only. Confirm `advertiser_id` AND `catalog_id`. |
| `tiktok_bind_catalog_eventsource` | Mutate. `pixel_code` XOR `app_id`. Confirm `advertiser_id` AND `catalog_id`. |
| `tiktok_list_pixels` | Read hop. Copy `pixel_code` for Events API `event_source_id`. |
| `tiktok_track_events` | Events API 2.0. Closed `event_name`; SHA-256 email/phone; required `event_id`. `content_id` must match catalog `sku_id`. Confirm `advertiser_id` AND `pixel_code`. Dual-gate Worker `TIKTOK_EVENTS_ENABLED` (fail-closed, **not** status mutate). Never unhashed PII. |
| `tiktok_create_campaign` | Mutate. Defaults **DISABLE** (`PAUSED`→DISABLE). Closed `objective_type`. Confirm `advertiser_id`. Spend cap $100,000. Dual-gate `TIKTOK_MUTATE_ENABLED`. |

Live TikTok app + Marketing API + secrets + Polar `tiktok` mint are **Noel gates**. Code lands with fixtures. Never Axos.

Skill: `tiktok-ads`.

## Klaviyo — local `pk_` lane (Waves 18–19; not Consent A)

Merchant-held **private** API key on the Bot computer. **No Polar. No stamp hop. No Polar `klaviyo` OAuth.** Fail closed `KLAVIYO_NOT_CONNECTED` without `KLAVIYO_API_KEY` (or `PLUGIN_DATA/klaviyo.json`). Revision header **`2026-07-15`**. Host `a.klaviyo.com`. Closed free Google count stays **26**. Never log the key.

**Consent decision:** Klaviyo is not Google OAuth. Reads stay **LOCAL_FREE**. Writes use the **same** `pk_` after `DGTL_WRITES_ENABLED` (default **false**) + `confirm_phrase` containing the account id from `klaviyo_get_account`.

| Tool | Notes |
| --- | --- |
| `klaviyo_get_account` | Account whoami. Copy the account id for write confirms. |
| `klaviyo_list_profiles` | Sparse (`email`, `created`, `updated`, `external_id`). Optional email filter. `extra_fields` may add `first_name` / `last_name` only. Never dumps phone, location, or properties. |
| `klaviyo_get_profile` | Requires `profile_id`. Same sparse fieldset. |
| `klaviyo_list_lists` | Paginated lists. No CSV import mega-tool. |
| `klaviyo_list_segments` | Paginated segments. |
| `klaviyo_list_flows` | Paginated flows. |
| `klaviyo_get_flow` | Requires `flow_id`. |
| `klaviyo_list_campaigns` | Channel filter required by the API (default `email`). Closed `email` / `sms` / `mobile_push`. |
| `klaviyo_list_metrics` | Metrics catalog. Not an open Metric Aggregates passthrough. |
| `klaviyo_list_catalog_items` | Paginated custom catalog items. Sparse fields. Do not invent `$shopify:::$default:::` ids. |
| `klaviyo_list_catalog_categories` | Paginated catalog categories. |
| `klaviyo_list_catalog_variants` | Paginated catalog variants. |
| `klaviyo_list_reviews` | Paginated reviews. Sparse — email / author stripped. Optional closed `status`. |
| `klaviyo_get_review` | Requires `review_id`. Same sparse fieldset. |
| `klaviyo_create_campaign` | Write. **Draft email only** (`POST /api/campaigns`). `dry_run` default true. Live: `confirm_phrase` must include the account id. **Never** `POST /api/campaign-send-jobs`. |
| `klaviyo_create_campaign_send_job` | Write. **Send an existing draft** (`POST /api/campaign-send-jobs`). `dry_run` default true. Live: `confirm_phrase` must include the account id, `campaign_id`, and the token **`SEND`**. Cannot fire from draft create. |
| `klaviyo_upsert_profile` | Write. `POST /api/profile-import`. Closed fields (`email` / `external_id` / `profile_id` + optional names). No properties bag. |
| `klaviyo_create_event` | Write. `POST /api/events` backfill. `backfill` defaults **true** (flows do not re-fire). Closed flat properties. |
| `klaviyo_upsert_catalog_items` | Write. Closed bulk create/update jobs (`POST /api/catalog-item-bulk-create-jobs` or `…-update-jobs`). Cap 20. `$custom` / `$default` only. `dry_run` default true. Live: account-id confirm. **Not** a mega upsert-all across MC / Meta / TikTok. |

Fail order for writes: `WRITE_NOT_ENABLED` → `KLAVIYO_NOT_CONNECTED` → dry-run (GET account, zero mutate POST) → live needs account id in `confirm_phrase`.

**Out of this wave:** Polar `klaviyo` OAuth (Wave 19b), stamp hop, Consent A kernel membership. Wave 20 conversion fabric is a separate diagnostic (`conversion_fabric_status` / `sgtm_ingest_test`) — not a Klaviyo tool. Wave 22 adds `klaviyo_create_campaign_send_job` (SEND token; never from draft create).

Skills: `klaviyo-readonly`, `catalog-fan-out` (Shopify → MC / Meta / TikTok / Klaviyo; Google payload omits missing GTIN / missing image; refuse unnamed `merchant_id`), `recs-approve-push` (Ads recs / MC issues / GTM workspace diff / Klaviyo flows / missing GA4 Ads link; one mutate per confirm).

