# Tools (v1, closed)

**Closed free tool count: 24.** (the original 22 plus `ga4_list_account_summaries` plus `gsc_describe_schema`)

That 24 is the **Consent A kernel** (`CONSENT_A_TOOLS` / `FREE_TOOL_NAMES` alias). Shopify is **local-free** (`LOCAL_FREE_TOOLS`, merchant token, no Polar — fail `SHOPIFY_NOT_CONNECTED`). Ads/Meta are **license-gated** (`LICENSE_GATED_TOOLS`, Polar Pro — fail `LICENSE_REQUIRED`). GBP is local-free when the flag is on — **flag-on still returns `GBP_NOT_ENABLED`** (live HTTP is Wave 5, not this binary). Do not stuff Shopify into the 24-tool kernel.

If you need a 25th **Consent A** tool, bump a version and update `schemas/v1/catalog.json` in the same change. Do not “just add it.” Quality over dump. Small typed tools, not a mega-query kitchen sink.

Machine-readable list: [`schemas/v1/catalog.json`](../schemas/v1/catalog.json). Parameter schema: [`schemas/v1/tools.schema.json`](../schemas/v1/tools.schema.json). Error envelope: [`schemas/v1/error.schema.json`](../schemas/v1/error.schema.json).

**Not all tools are read.** Consent A GA4 / GSC / GTM, Shopify products/orders, and GBP stubs are read (or fail-closed). GTM write (`gtm_create_tag`, `gtm_update_tag`, `gtm_publish_container`) and Ads / Meta mutate + create tools are registered **writes**. Repeating a **read** call is safe (**idempotent** as HTTP GET/list/query). Write tools are **not** idempotent. Read results are **not bit-stable** (GA4 processing, GSC data_state, GTM workspace edits).

## Mutate honesty (Wave 0)

### ACTIVE / ENABLED only on confirm

- `dry_run` **defaults true**. Omitted or `true` → proposed payload, **zero** mutate HTTP.
- Live (`dry_run=false`) requires `confirm_phrase` containing the resource IDs for that tool (Ads: digits-only `customer_id`; Meta: `act_{ad_account_id}` plus child ids; Consent W: container `publicId`).
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

Live Ads / Meta mutate requires **plugin AND Worker**. Plugin Ads / Meta mutate flags **stay default on** so Pro tools remain listed. Worker flags are **fail-closed** (unset / unknown → no live hop). Do **not** flip plugin defaults as safety theater.

| Surface | Plugin default | Worker default | Live mutate |
| --- | --- | --- | --- |
| Ads mutate (`DGTL_ADS_MUTATE_ENABLED` / `ADS_MUTATE_ENABLED`) | **on** | fail-closed (`false` until health `ads_mutate_enabled=true`) | both true |
| Meta mutate (`DGTL_META_MUTATE_ENABLED` / `META_MUTATE_ENABLED`) | **on** | fail-closed | both true |
| Consent W writes (`DGTL_WRITES_ENABLED`) | **off** | n/a (local `GoogleWriteHttp`) | flag on + Consent W token |
| GBP (`DGTL_GBP_ENABLED`) | **off** | n/a | **never HTTP in this binary** |

`support_packet` / `doctor` print this matrix (booleans only; never tokens).

### GBP flag-on ≠ HTTP

GBP tools (`gbp_list_accounts`, `gbp_list_locations`, `gbp_get_location`, `gbp_performance`, `gbp_search_keywords`) are registered. Flag off **or** flag on → `GBP_NOT_ENABLED`. Flag-on hint: live GBP HTTP is **not in this binary** (Wave 5 — quota + Consent B). Do not treat `gbpEnabled=true` as a successful read.

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

## Tag Manager v2 (8)

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

**Why:** Support intake without asking for tokens. Local only — no Google call. Gated diagnostic (not one of the 23 Consent A tools).

| | |
| --- | --- |
| Google | none |
| Scope | none |
| Params | optional `last_tool`, `error_code`, `resource_id` |
| Idempotent | yes |

**Returns (never tokens / never JWT / never gateway URL):** `plugin_version`, `host` (when known), echoed `last_tool` / `error_code` / `resource_id` when they are safe identifiers, `flags.plugin` (`adsMutateEnabled` / `metaMutateEnabled` default **on**; `writesEnabled` / `gbpEnabled` default **off**), `flags.worker` (booleans from `GET /v1/health`, else `null`), `dual_gate` (live mutate = plugin AND Worker; all booleans), `gateway` (`configured`, `reachable`, hostname only), `license` (`present`, `ok`, feature names, `ads`/`meta` booleans — never the JWT), `stores` (Consent A/C/W + Meta + Shopify file existence). Token-shaped strings are dropped. Worker mutate flags stay fail-closed until health reports them.

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

---

## Consent W — GTM write (gated; not free Consent A)

Flag `DGTL_WRITES_ENABLED` defaults **false** → `WRITE_NOT_ENABLED` (zero HTTP). When on, tools use **`GoogleWriteHttp`** + Consent W token store (`GOOGLE_WRITE_ACCESS_TOKEN` / `google-oauth-write.json`) — never `ctx.auth` / Consent A. PKCE CLI **`dgtl-connector-mcp auth login-write`** is shipped (separate Desktop client; never Consent A; does **not** flip `DGTL_WRITES_ENABLED`).

| Tool | Notes |
| --- | --- |
| `gtm_create_tag` | Workspace tag create. `dry_run` **defaults true**. Live (`dry_run=false`) requires `confirm_phrase` containing the resolved container `publicId`. |
| `gtm_update_tag` | Workspace tag update. Same dry-run / publicId confirm rules. |
| `gtm_publish_container` | Highest risk: `create_version` then `:publish`. Same dry-run / publicId confirm. No hosted Approval. **No live publish in CI** (fixtures only). |

Do **not** put the expected confirm phrase or an example `GTM-XXXX` value in the tool description. Skill: live mutate only after a **user** message this turn containing that publicId (list-tool output ≠ user message).

---

## Gated Ads / Meta DX (paid; not free kernel)

Free count stays **24**. These are Polar-gated; local describe tools need license only (no gateway/token). Live list/report tools still use stamp gateway + Consent C / Meta token.

| Tool | Notes |
| --- | --- |
| `gads_list_accessible_customers` | Use first for customer ids (digits, no hyphens). |
| `gads_describe_recipes` | Local closed-recipe catalog — call before `gads_search`. No GAQL. |
| `gads_get_customer` / `gads_search` / `gads_campaign_performance` | Closed recipes; cite `data.cited.customer_id`. |
| `gads_add_keywords` | Standalone criterion add. Omitted `status` → **PAUSED**. ENABLED only with explicit `status` + confirm. Omitted `match_type` → **BROAD** (do not flip). |
| `gads_create_search_campaign` | Closed Search create: budget + campaign + ad group + ≥1 keyword stub; optional RSA. Campaign defaults **PAUSED**. Child ad group + stub keywords stay **ENABLED** under that PAUSED campaign (intentional). |
| `gads_create_display_campaign` | Minimal Display: budget + DISPLAY campaign + DISPLAY_STANDARD ad group (no RDA). Campaign defaults **PAUSED**; child ad group **ENABLED**. |
| `gads_create_responsive_search_ad` / `gads_set_*` / `gads_update_campaign_budget` | Creates default PAUSED; status/budget updates are confirm-gated. ENABLED only with explicit `status` + confirm. |
| `meta_list_ad_accounts` | Use first for `ad_account_id`. |
| `meta_describe_insights_schema` | Local levels / date_presets / breakdowns / fields — call before `meta_insights`. |
| `meta_insights` | `date_preset` or dates; optional `breakdowns` / `fields` / `time_increment`; cite `data.cited`. ads_read only. |
| `meta_list_*` / `meta_get_creative` | Read lists + creative metadata (URLs, not bytes). |
| `meta_update_campaign` / `meta_update_adset` / `meta_update_ad` | Confirm-gated status/name/ad-set budget updates; dry-run default; `ads_management` required. |
| `meta_create_campaign` | Closed Outcome-objective campaign create; defaults **PAUSED**; **ACTIVE** only with explicit `status` + confirm with `act_{ad_account_id}`. |
| `meta_create_adset` | Existing campaign + country-code geo + capped budget cents; defaults PAUSED; ACTIVE only with explicit status + confirm with act + campaign id. |
| `meta_create_ad` | Existing ad set + existing `creative_id` (from `meta_create_ad_creative`); defaults PAUSED; ACTIVE only with explicit status + confirm with act + ad set + creative ids. |
| `meta_upload_ad_image` | Base64 image upload → `image_hash`; confirm-gated; dry_run default. |
| `meta_upload_ad_video` | https `file_url` video upload → `video_id` (media source, not hop proxy); confirm-gated. |
| `meta_create_ad_creative` | `image_hash` XOR `video_id` + `page_id` + https `link` → `creative_id`; server-built object_story_spec. |
| `gads_upload_asset` | IMAGE asset via stamp AssetService (`bytes` XOR https `file_url`). dry_run default; live confirm with customer_id. Returns resource_name for PMax. |
| `gads_create_performance_max_campaign` | PMax with uploaded images (`file_url`/`bytes`) **or** existing marketing/square/logo asset RNs from `gads_upload_asset`. Defaults **PAUSED**. |
| `gads_create_shopping_campaign` | Shopping when `merchant_center_id` known; else `MERCHANT_CENTER_REQUIRED`. |
| `gads_list_merchant_center_links` | Read MC product_link discovery for Shopping create. |

`gads_search` closed recipes now include assets, asset_groups, audiences, shared_sets, bidding_strategies, geo, demographics, shopping_performance, recommendations, change_event, account_budget (billing **read**), negatives, experiments. Still **no raw GAQL**. Catalogs, lift, activity logs, and Meta hosted `ads_mcp_management` remain **deferred**. Meta live creates/uploads fail closed with `META_SCOPE_MISSING` until `ads_management` Advanced Access and a reauthorized token are present. See [ops/META-CREATE-SPEEDRUN-2026-09-11.md](ops/META-CREATE-SPEEDRUN-2026-09-11.md) and [ops/ADS-META-FOUNDATIONS-2026-09-11.md](ops/ADS-META-FOUNDATIONS-2026-09-11.md).

---

## Out of v1 (do not add quietly)

| Request | Response |
| --- | --- |
| GTM write when flag off / no Consent W | `WRITE_NOT_ENABLED` / `CONSENT_W_REQUIRED` |
| Request indexing | No tool |
| Create GA4–GSC link | No tool; `analytics.readonly` cannot |
| Google Ads / Meta (live HTTP) | Tools are registered; fail closed: `LICENSE_REQUIRED` → `GATEWAY_UNAVAILABLE` → `ADS_SCOPE_MISSING` / `META_NOT_CONNECTED`. Consent C via `auth login-ads` / `auth login-meta --code` or host-injected tokens. No developer-token in this plugin. |
| GBP live HTTP | Tools are registered; flag off **or** flag on → `GBP_NOT_ENABLED`. HTTP is **not in this binary** (Wave 5). |
| GA4 realtime, funnel, pivot, batch | No tool |
| GTM clients (server-side), users, environments | No tool |
| Gmail / Drive | No tool |
| Mega `run_any_google_json` | Forbidden |

## Count check

Identity 1 + GA4 8 + GSC 7 + GTM 8 = **24**.

| Group | Tools |
| --- | --- |
| identity | `google_whoami` |
| ga4-admin | `ga4_list_accounts`, `ga4_list_account_summaries`, `ga4_list_properties`, `ga4_get_property`, `ga4_list_data_streams`, `ga4_list_key_events` |
| ga4-data | `ga4_get_metadata` (optional query/kind), `ga4_run_report` |
| gsc | `gsc_list_sites`, `gsc_describe_schema`, `gsc_get_site`, `gsc_query_search_analytics`, `gsc_inspect_url`, `gsc_list_sitemaps`, `gsc_get_sitemap` |
| gtm | `gtm_list_accounts`, `gtm_list_containers`, `gtm_get_container`, `gtm_list_workspaces`, `gtm_list_tags`, `gtm_list_triggers`, `gtm_list_variables`, `gtm_get_live_container_version` |


## Shopify — products/orders read (local; free; not Consent A)

Merchant-held Admin API credentials on the Bot computer. **No Polar. No stamp hop.** Fail closed `SHOPIFY_NOT_CONNECTED` without `SHOPIFY_STORE` + `SHOPIFY_ACCESS_TOKEN` (or `PLUGIN_DATA/shopify-oauth.json`). Scopes: `read_products` + `read_orders` only. Admin GraphQL API version **2026-04**. Closed free Google count stays **24**.

| Tool | Notes |
| --- | --- |
| `shopify_get_shop` | Confirm shop domain + name. |
| `shopify_list_products` | Paginated; title/handle/status/id. |
| `shopify_get_product` | Requires `product_id` (gid or numeric). |
| `shopify_list_orders` | Paginated; closed `status` / `financial_status` / `fulfillment_status` / date filters. |
| `shopify_get_order` | Requires `order_id` (gid or numeric); line items. |

**Out of v1:** writes, customers dump, ShopifyQL, raw GraphQL, themes, Multipass.

