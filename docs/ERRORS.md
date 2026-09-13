# Errors

User-visible copy. Tools return `error_code` from this file. Skills do not invent a friendlier lie that hides the code.

Tokens, cookie headers, and HAR files do **not** belong in messages, logs, or support threads.

Ops next-step copy lives in [ops/RUNBOOKS.md](ops/RUNBOOKS.md). `support_packet` returns `runbook` + `next_human_step` for mapped codes. Codes in this file stay stable — do not rename `ADS_MUTATE_NOT_ENABLED`, `MERCHANT_CENTER_REQUIRED`, `META_SCOPE_MISSING`, `GBP_NOT_ENABLED`, `SHOPIFY_NOT_CONNECTED`, `KLAVIYO_NOT_CONNECTED`, `LICENSE_REQUIRED`, `WRITE_NOT_ENABLED`, `CONSENT_G_REQUIRED`, `CONSENT_S_REQUIRED`, `MC_*`, `TIKTOK_*`.

## Envelope

See [TOOLS.md](TOOLS.md). Always include `error_code` and `message`. Include `google_status`, `google_reason`, `api`, and `hint` when known.

## Error codes

### `UNAUTHENTICATED`

No access token from the host.

**User-visible:**  
“Google is not connected. For Cursor and Grok Build stdio, set a host-injected access token (`GOOGLE_ACCESS_TOKEN`) or run `dgtl-connector-mcp auth login` (installed-app PKCE). There is no Gmail-style Connect card for local stdio MCP.”

### `REAUTH_REQUIRED`

Token revoked, expired refresh, or host `connectors_needing_reauth`.

**User-visible:**  
“Google access expired or was revoked. Reconnect with AuthPort: set a host-injected access token (`GOOGLE_ACCESS_TOKEN`) or run `dgtl-connector-mcp auth login` again. There is no Gmail-style Connect card for local stdio. You can also revoke this app under Google Account → Third-party access, then reconnect.”

### `CONSENT_MISSING`

Granular consent: the user unchecked a scope, or identity-only token.

**User-visible (example, GTM):**  
“This Google login did not grant Tag Manager readonly (`https://www.googleapis.com/auth/tagmanager.readonly`). Re-run AuthPort (`auth login` or host re-inject) and allow all three Consent A scopes: Analytics, Search Console, and Tag Manager. There is no Connect card for local stdio. This plugin uses one consent for all three — it will not ask for a second Google login just for GTM.”

Include the missing scope string in `hint`.

### `ACCESS_NOT_CONFIGURED`

Google `403` with `reason=accessNotConfigured` (or equivalent “API has not been used in project … or it is disabled”).

**User-visible:**  
“Google returned 403 accessNotConfigured for `{api}`. That means the API is not Enabled on the **OAuth client's** Google Cloud project — not that your GA4 property is empty.”

**Hint, published plugin:**  
“You cannot enable this yourself on DGTL's project. Email noel@dgtlsunrise.com with the plugin version, the `api` name, and the error_code — not tokens. This is a publisher defect.”

**Hint, local/dev OAuth client:**  
“In that Cloud project, enable: Analytics Admin API, Analytics Data API, Search Console API, Tag Manager API. GTM 403s are usually Tag Manager API left off. Merchant API 403s are Products / Accounts / DataSources left off on the **Consent MC** project — not Consent A.”

### `PERMISSION_DENIED`

The Google user is connected but cannot see **that** resource (or Admin API `caller does not have permission`).

**User-visible:**  
“This Google account cannot access `{resource_id}`. In GA4: Admin → Property access. In Search Console: Settings → Users. In GTM: Account user management. Being signed into Google is not the same as being a user on that property.”

### `NOT_FOUND`

Unknown property, site URL mismatch (trailing slash / `sc-domain:` vs URL-prefix), GTM container, or never-published live version.

**User-visible:**  
“Google does not know `{resource_id}`. Copy the ID from the list tools. Search Console URL-prefix properties must match, including the trailing slash. Domain properties look like `sc-domain:example.com`.”

### `RESOURCE_REQUIRED`

Caller omitted a required ID or passed `default` / `first`.

**User-visible:**  
“This tool will not guess a property. Name the GA4 property ID, Search Console site, or GTM account/container/workspace. If you are not sure, ask me to list them.”

### `INVALID_ARGUMENT`

Bad dates, too many dimensions, malformed filter JSON, incompatible GA4 dimension+metric combo.

**User-visible:**  
“Google rejected the request (`INVALID_ARGUMENT`). Check dates (`YYYY-MM-DD`), GA4 limits (≤9 dimensions, ≤10 metrics), and names from `ga4_get_metadata`. I will not invent a replacement metric.”

### `UNSUPPORTED_DIMENSION`

Plugin denylist (GA4 `searchQuery` / `query` / `searchTerm` / `keyword`).

**User-visible:**  
“The GA4 Data API has no search-query dimension. Search queries stay in Search Console search analytics. I can run `gsc_query_search_analytics` with dimension `query` for the Search Console site you pick. Linking GSC in the GA4 UI does not add `searchQuery` to this API.”

### `UNSUPPORTED_OPERATION`

Write/publish/index request on a surface that has **no** registered write tool (or Consent A cannot do it).

**User-visible:**  
“This Consent A tool cannot publish Tag Manager containers, create tags, submit sitemaps, request indexing, or create GA4–Search Console links (`analytics.readonly` cannot create those links). Use the Google UI. GTM write stubs exist behind Consent W (`WRITE_NOT_ENABLED` until flagged on). Ads/Meta mutates are separate Pro tools — not all tools are read.”

### `QUOTA_EXCEEDED` / `RATE_LIMITED`

Data API property tokens, GSC daily quotas, URL Inspection limits, GTM quota, 429.

**User-visible:**  
“Google quota or rate limit hit (`{api}`). GA4 Data API uses tokens per property (standard properties: 200,000 core tokens/day; hourly caps also apply). I cap reports at 1,000 rows per call. Wait, narrow the date range, or inspect fewer URLs. If `propertyQuota` is present, I will show remaining tokens.”

### `EMPTY_RESULT` (optional, success preferred)

Prefer `ok: true` with empty rows and a short success `hint` (“No rows is not an auth failure; check date range, filters, and property ID.”). If a skill needs a code for copy:

**User-visible:**  
“The request succeeded and returned no rows. That is not a failed login. Typical causes: date range with no data, a newly created property, filters that match nothing, GSC `data_state=final` while data is still processing, or the wrong property among many. Confirm the ID and timezone (`ga4_get_property`).”

### `LICENSE_REQUIRED`

Paid Google Ads / Meta tool called without a valid DGTL license JWT.

**User-visible:**  
“This tool needs DGTL Pro ($19/mo flat, unlimited) for Google Ads / Meta Ads (and a separate Polar `tiktok` feature for TikTok Ads). Free GA4, Search Console, Tag Manager, and local Shopify / Klaviyo tools still work. Get Pro at https://www.dgtlsunrise.com/ then paste a license JWT via DGTL_LICENSE_JWT or PLUGIN_DATA/license.jwt — never a Google Ads developer-token.”

Do not ask for a Google Ads developer-token.

### `GBP_NOT_ENABLED`

GBP feature flag off (`DGTL_GBP_ENABLED` default false). Not a missing Consent A reconnect. Consent B is a separate grant.

**User-visible:**  
“Google Business Profile tools are flagged off (DGTL_GBP_ENABLED=false). They are not on the free GA4/GSC/GTM consent screen. Consent B (business.manage) is a separate grant. Enable the flag only after GBP Basic API Access quota is non-zero.”

### `GBP_NOT_CONNECTED`

Flag is on, but Consent B token is missing. Direct GBP hop — not stamp, not Polar.

**User-visible:**  
“Google Business Profile is a separate OAuth grant (scope business.manage). It is not part of free Consent A. With DGTL_GBP_ENABLED=true, set GOOGLE_GBP_ACCESS_TOKEN or run `dgtl-connector-mcp auth login-gbp` (separate Consent B client). Never reuse Consent A.”

### `GBP_SCOPE_MISSING`

Consent B token present but missing `https://www.googleapis.com/auth/business.manage`. Do not add that scope to Consent A. Tools stay GET-only.

**User-visible:**  
“This Google Business Profile login did not grant https://www.googleapis.com/auth/business.manage. Re-authorize Consent B (`auth login-gbp` or GOOGLE_GBP_ACCESS_TOKEN). Do not add business.manage to Consent A. Tools are GET-only even though the scope is write-capable.”

### `GATEWAY_UNAVAILABLE`

Valid paid license (`ads` / `meta`), but `DGTL_GATEWAY_URL` is unset, the Worker is down, or the gateway is paused.

**User-visible:**  
“The DGTL Ads/Meta gateway is not reachable. Set `DGTL_GATEWAY_URL` to a live Worker, or wait until the hosted gateway is up. Free GA4, Search Console, and Tag Manager tools still work. This is not a missing Ads OAuth reconnect.”

Do **not** tell the user to “Reconnect Ads” for this code — that is `ADS_SCOPE_MISSING`.

The same code is used when `feedback_send` has no hosted endpoint (`DGTL_FEEDBACK_URL` and `DGTL_GATEWAY_URL` both unset). The message then points at those env vars and **support@dgtlsunrise.com** — not Ads reconnect, and not “email a token.”

### `SHOPIFY_NOT_CONNECTED` / `SHOPIFY_SCOPE_MISSING`

Shopify tools are **local merchant credentials** (not Polar, not stamp).

- Missing `SHOPIFY_STORE` / `SHOPIFY_ACCESS_TOKEN` / `shopify-oauth.json` → `SHOPIFY_NOT_CONNECTED` (zero Admin HTTP).
- Detectable or GraphQL-denied missing `read_products` / `read_orders` / `read_inventory` / `read_locations` / `read_publications` / `read_product_listings` / `write_inventory` / `write_products` → `SHOPIFY_SCOPE_MISSING`.
- Shopify writes with flag off → `WRITE_NOT_ENABLED` (zero HTTP) **before** connected/scope checks.
- Live `shopify_adjust_inventory` / `shopify_product_set` without the shop domain in `confirm_phrase` (or `confirm`) → `INVALID_ARGUMENT` (no mutation HTTP).
- Support never collects Shopify tokens. Default install is the original read_* set. `read_publications`, `read_product_listings`, `write_inventory`, and `write_products` are **explicit** merchant-app expansions (not Polar, not stamp vault). Never silently expand scopes on an existing app.

### `ADS_SCOPE_MISSING` / `META_NOT_CONNECTED`

License **and** gateway are ok, but the second OAuth (Ads `adwords` / Meta `ads_read`) is not connected. Consent C / Meta tokens never come from Consent A (`GOOGLE_ACCESS_TOKEN`).

- Ads: set `GOOGLE_ADS_ACCESS_TOKEN` or run `dgtl-connector-mcp auth login-ads` (requires `GOOGLE_OAUTH_ADS_CLIENT_ID` — separate Consent C client; never add `adwords` to Consent A). No developer-token in this plugin.
- Meta: set `META_ACCESS_TOKEN` or run `dgtl-connector-mcp auth login-meta --code <grant>` (redeems hosted Login via `POST /v1/meta/exchange`; long-lived token returns **to the plugin**; Worker stores nothing). Support never collects Meta tokens.

### `CONSENT_G_REQUIRED` / `CONSENT_S_REQUIRED`

GA4 Admin writes (Consent G) and Search Console writes (Consent S) use **separate** OAuth clients and token stores. They are **never** granted on free Consent A.

- `CONSENT_G_REQUIRED` — GA4 Admin writes (and MP secret list) need `analytics.edit` via `auth login-ga4-admin` → `PLUGIN_DATA/google-oauth-ga4-admin.json` (or `GOOGLE_GA4_ADMIN_ACCESS_TOKEN`). Do not add `analytics.edit` to the Desktop readonly client.
- `CONSENT_S_REQUIRED` — GSC sitemap submit/delete need `webmasters` (write) via `auth login-gsc-write` → `PLUGIN_DATA/google-oauth-gsc-write.json` (or `GOOGLE_GSC_WRITE_ACCESS_TOKEN`). Do not add `webmasters` write to Consent A.

Wave 11 ships named Admin tools. Wave 12 ships `gsc_submit_sitemap` / `gsc_delete_sitemap`. Writes still require `DGTL_WRITES_ENABLED` (login does **not** flip it). Live GSC confirm must include the exact `site_url`. Measurement Protocol `secretValue` is never written to logs.

**User-visible (G):**  
“This GA4 Admin write path needs Consent G (separate OAuth client with analytics.edit). It is not part of free Consent A. Do not add analytics.edit to the Desktop readonly client. Run `dgtl-connector-mcp auth login-ga4-admin`.”

**User-visible (S):**  
“This Search Console write path needs Consent S (separate OAuth client with webmasters write). It is not part of free Consent A. Do not add webmasters (write) to the Desktop readonly client. Run `dgtl-connector-mcp auth login-gsc-write`.”

### `GOOGLE_UNAVAILABLE`

500/503 from Google.

**User-visible:**  
“Google’s API returned a server error. Retry once. If it keeps failing, it is on Google’s side, not your property picker.”

---

### Unverified / testing-mode Google app

Google may show “This app isn’t verified” or block sign-in while DGTL Sunrise’s OAuth client is in Testing — that is Google’s allowlist, not a broken plugin. Continue only for your own Google account (or a tester the publisher added); other accounts stay stranded until Google verification.

This is **not** `UNAUTHENTICATED` from a missing token and **not** a Gmail-style Connect card failure. Marketplace listing while the client is still Testing will strand strangers — see [MARKETPLACE.md](MARKETPLACE.md).

## Non-bugs (do not “fix” these in code)

Documented product facts. Skills treat them as explanations, not defects.

### 1. Each Google API must be Enabled or 403 `accessNotConfigured`

The OAuth **client's** Cloud project needs Analytics Admin, Analytics Data, Search Console, and Tag Manager APIs. Missing Tag Manager API is the usual GTM-only 403 after GA4 already worked.

### 2. `analytics.readonly` cannot create GSC–GA4 links

Linking Search Console to a GA4 property is an Admin **edit** in the Google UI (and would need `analytics.edit` if an API ever exposes create). v1 will not grow a `ga4_create_search_console_link` tool. Users link in GA4 Admin → Search Console links. Even after linking, see (3).

### 3. GA4 Data API has no `searchQuery` dimension

Queries stay in **GSC** `searchanalytics`. The GA4 UI Search Console reports (after a link) are **not** the Data API. Do not scrape the UI. Do not hallucinate `searchQuery`.

### 4. GSC-into-GA4 import lags

If the user compares GA4’s Search Console collection to GSC searchanalytics: expect lag (often ~48 hours), timezone mismatch (GSC daily data is not the GA4 property TZ), and different definitions (GSC clicks ≠ GA4 sessions). This is not a plugin bug.

### 5. Empty property vs broken OAuth

Zero rows with `ok: true` after `ga4_get_property` succeeded means no events in range. Failed OAuth is `UNAUTHENTICATED` / `REAUTH_REQUIRED`. Do not tell a connected user with an empty new property to “reconnect Google” as the first hint.

### 6. Workspace ≠ live in GTM

Listing tags (or sGTM **clients**) in a workspace can show unpublished drafts. Production is `gtm_get_live_container_version`. Users who say “GTM is wrong” may be looking at the draft. Clients exist on **server** containers; an empty `gtm_list_clients` on a web container is not an auth failure.

Unknown `gtm_create_client` `type` (for example a tag type like `html`) is `INVALID_ARGUMENT` with the closed enum listed — zero HTTP. Flag off write tools stay `WRITE_NOT_ENABLED` (zero HTTP).

### 7. GSC site URL is exact

`https://www.example.com/` and `sc-domain:example.com` and `https://example.com/` are different properties. Do not coerce.

### 8. AuthPort vs imaginary Connect card

stdio auth is AuthPort (host-injected / Desktop PKCE). There is no Gmail-style Connect card for this plugin. Do not debug “Connect card failed” tickets as a plugin defect. Do not ask for `client_secret.json` in chat — Desktop secret stays in gitignored `.env` only.

---

## Agency 40-property scenario (copy)

“Your Google account can see **{n}** GA4 properties. I will not use the first one. Tell me the client name or the property ID (`properties/…`). I can list them grouped by Analytics account.”

## Expired consent scenario (copy)

Use `REAUTH_REQUIRED`. After reconnect, call `google_whoami` and confirm email **before** pulling a report, so an agency user does not silently switch to a personal Gmail.

## “Publish this tag” scenario (copy)

On Consent A / flag off: refuse (`UNSUPPORTED_OPERATION` or `WRITE_NOT_ENABLED`). Add: “I can show the live container and the workspace draft so you can see the diff. Publishing needs Consent W (separate OAuth client) when that path is enabled — not the free readonly consent. Trigger/variable create uses the same flag + publicId confirm; publish last.”

## “Search queries in GA4” scenario (copy)

Use `UNSUPPORTED_DIMENSION`. Offer GSC after they pick `site_url`.


### `ADS_MUTATE_NOT_ENABLED`

Google Ads mutate tools opted out (`DGTL_ADS_MUTATE_ENABLED=false`). Plugin defaults **on**; unset or set `true` to re-enable. Live hop still needs Worker `ADS_MUTATE_ENABLED=true`.

**User-visible:**  
"Google Ads mutate tools are opted out (`DGTL_ADS_MUTATE_ENABLED=false`). Plugin defaults on; unset the env or set true to re-enable. Live hop still needs Worker `ADS_MUTATE_ENABLED=true`. Reads still work with Pro + Consent C — never on Consent A."

### `META_MUTATE_NOT_ENABLED`

Meta mutate tools opted out (`DGTL_META_MUTATE_ENABLED=false`). Plugin defaults **on**; live hop still needs Worker `META_MUTATE_ENABLED=true` after `ads_management` Advanced Access. Catalog items_batch / create catalog use this flag (not CAPI).

### `META_CAPI_NOT_ENABLED`

Meta CAPI event send opted out, or Worker `META_CAPI_ENABLED` is off / unknown. Plugin `DGTL_META_CAPI_ENABLED` defaults **on**. Live hop dual-gates Worker `META_CAPI_ENABLED` (fail-closed, **separate** from `META_MUTATE_ENABLED`). Polar Pro `meta` bit. App secret stays on the Worker. Never unhashed PII.

**User-visible:**  
"Meta CAPI event send is opted out or the Worker META_CAPI_ENABLED flag is off. Plugin defaults on; set DGTL_META_CAPI_ENABLED=false to opt out. Live hop needs Worker META_CAPI_ENABLED=true (fail-closed, separate from META_MUTATE_ENABLED). Polar Pro meta bit. App secret stays on the Worker. Never send unhashed PII."

### `META_SCOPE_MISSING`

Meta token lacks `ads_management` (or `catalog_management` for catalog writes), or Graph denied the mutate. Re-authorize after App Review Advanced Access. Do not silently retry.

### `SPEND_CAP_EXCEEDED`

Requested budget exceeds the product sanity cap ($100,000/day equivalent). Google Ads uses micros; Meta uses **cents**. No mutate HTTP was sent.

**User-visible:**  
"Requested budget exceeds the product sanity cap ($100,000/day equivalent). Google Ads: lower amount_micros / daily_budget_dollars (micros). Meta: lower daily_budget / lifetime_budget (cents, not micros). No mutate HTTP was sent."



### `NOT_IMPLEMENTED`

Used when the Google Ads API cannot create the requested type. Wave 2: `gads_create_local_campaign` (Google sunset Local campaigns — use Performance Max). Smart create is not advertised. Missing images return `INVALID_ARGUMENT`, not this code.

### `MERCHANT_CENTER_REQUIRED`

Shopping create or MC link called without `merchant_center_id`. Discover ids via `gads_list_merchant_center_links` or `mc_list_accounts`. No Ads mutate was sent.

**User-visible:**  
"Shopping campaign create needs a linked Merchant Center (shoppingSetting.merchantCenterId). Discover ids via gads_list_merchant_center_links or mc_list_accounts. No Ads mutate HTTP was sent."

### `MC_NOT_CONNECTED`

Merchant Center tools without Consent MC token. Separate from Consent A / Ads. Direct Merchant API hop — not stamp. Wave 14 ProductInput writes use the same Consent MC grant (no extra MC OAuth client).

**User-visible:**  
"Merchant Center is a separate OAuth grant (scope content). It is not part of free Consent A. After a valid DGTL license, set GOOGLE_MC_ACCESS_TOKEN or run `dgtl-connector-mcp auth login-mc` (separate Consent MC client). Never reuse Consent A."

### `MC_SCOPE_MISSING`

Consent MC token present but missing `https://www.googleapis.com/auth/content`. Do not add that scope to Consent A.

**User-visible:**  
"This Merchant Center login did not grant https://www.googleapis.com/auth/content. Re-authorize Consent MC (`auth login-mc` or GOOGLE_MC_ACCESS_TOKEN). Do not add content scope to Consent A."

Wave 14 ProductInput writes: missing `merchant_id` is `RESOURCE_REQUIRED` (never guess). Missing `data_source` on insert/update/delete/fetch is `RESOURCE_REQUIRED`. Live confirm must include digits `merchant_id` or `INVALID_ARGUMENT`. Live HTTP also needs `DGTL_WRITES_ENABLED` (`WRITE_NOT_ENABLED` otherwise). Writes are `productInputs` + API `dataSource`, not processed `Product`.

### `TIKTOK_NOT_CONNECTED`

TikTok Ads tools without an advertiser user token. Polar feature `tiktok` + gateway are not enough. App secret stays on the Worker.

**User-visible:**  
"TikTok Ads is a separate OAuth (Marketing API advertiser grant). After a valid DGTL license with feature `tiktok` + gateway, set TIKTOK_ACCESS_TOKEN or PLUGIN_DATA/tiktok-oauth.json. Support never collects TikTok tokens; the app secret is never in this plugin."

### `TIKTOK_MUTATE_NOT_ENABLED`

Plugin TikTok mutate opted out, or Worker `TIKTOK_MUTATE_ENABLED` is off. Catalog create/upload/bind and campaign create use this flag. Reads still work with the tiktok license.

**User-visible:**  
"TikTok Ads mutate tools are opted out (DGTL_TIKTOK_MUTATE_ENABLED=false). Plugin defaults on; unset the env or set true to re-enable. Live hop still needs Worker TIKTOK_MUTATE_ENABLED=true after Marketing API write access. Catalog create/upload/bind and campaign create use this flag. Reads still work with Pro + tiktok feature."

### `TIKTOK_EVENTS_NOT_ENABLED`

TikTok Events API send opted out, or Worker `TIKTOK_EVENTS_ENABLED` is off / unknown. Plugin `DGTL_TIKTOK_EVENTS_ENABLED` defaults **on**. Live hop dual-gates Worker `TIKTOK_EVENTS_ENABLED` (fail-closed, **separate** from `TIKTOK_MUTATE_ENABLED`). Polar `tiktok` bit. App secret stays on the Worker. Never unhashed PII. `content_id` must match catalog `sku_id`.

**User-visible:**  
"TikTok Events API send is opted out or the Worker TIKTOK_EVENTS_ENABLED flag is off. Plugin defaults on; set DGTL_TIKTOK_EVENTS_ENABLED=false to opt out. Live hop needs Worker TIKTOK_EVENTS_ENABLED=true (fail-closed, separate from TIKTOK_MUTATE_ENABLED). Polar tiktok bit. App secret stays on the Worker. Never send unhashed PII. content_id must match catalog sku_id."

### `TIKTOK_SCOPE_MISSING`

TikTok token lacks Marketing API permission for this advertiser (or TikTok denied the mutate). Re-authorize after app review. Do not silently retry.

**User-visible:**  
"This TikTok login did not grant Marketing API access for this advertiser (or TikTok denied the mutate). Re-authorize after app review. Do not silently retry. Reads may still work."

### `KLAVIYO_NOT_CONNECTED`

Klaviyo tools without a local private `pk_` key. Not Polar. Not Consent A. Never log the key.

**User-visible:**  
"Klaviyo is not connected. Set KLAVIYO_API_KEY (private pk_ key) or PLUGIN_DATA/klaviyo.json. Local-free — no Polar license, no stamp hop, not Consent A. Support never collects Klaviyo keys. Never log the key."

### `KLAVIYO_SCOPE_MISSING`

Private key present but Klaviyo returned 403 (missing accounts/profiles/lists/flows/campaigns/metrics/events scope). Generate a new `pk_`. Not Polar OAuth.

**User-visible:**  
"This Klaviyo private key is missing a required API scope (accounts, profiles, lists, segments, flows, campaigns, metrics, or events). Generate a new pk_ with those scopes. Not Polar OAuth. Not Consent A."

### `SGTM_NOT_ENABLED`

sGTM apply ingest test opted out, or Worker `SGTM_INGEST_ENABLED` is off / unknown. Plugin `DGTL_SGTM_INGEST_TEST_ENABLED` defaults **off**. Live POST dual-gates Worker `SGTM_INGEST_ENABLED` (fail-closed). Polar `sgtm` is reserved, default-off, and **not minted**. Apply-path only.

**User-visible:**  
"sGTM apply ingest test is opted out or the Worker SGTM_INGEST_ENABLED flag is off. Plugin DGTL_SGTM_INGEST_TEST_ENABLED defaults off. Live POST needs the plugin flag on AND Worker SGTM_INGEST_ENABLED=true (fail-closed). Polar sgtm is reserved, default-off, and not minted. Apply-path only — never a funded ingest key, never web GTM variables."

### `SGTM_APPLY_KEY_MISSING`

Live `sgtm_ingest_test` without host `DGTL_SGTM_APPLY_KEY` / `DGTL_APPLY_KEY`. No ingest HTTP was sent. Never put apply or funded keys in web GTM.

**User-visible:**  
"sGTM apply ingest test is live but DGTL_SGTM_APPLY_KEY (or DGTL_APPLY_KEY) is unset on this plugin host. Set the apply key in server env only. Never put apply or funded ingest keys in web GTM variables. No ingest HTTP was sent."

