# Errors

User-visible copy. Tools return `error_code` from this file. Skills do not invent a friendlier lie that hides the code.

Tokens, cookie headers, and HAR files do **not** belong in messages, logs, or support threads.

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
“In that Cloud project, enable: Analytics Admin API, Analytics Data API, Search Console API, Tag Manager API. GTM 403s are usually Tag Manager API left off.”

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

Write/publish/index request.

**User-visible:**  
“v1 is read-only. I cannot publish Tag Manager containers, create tags, submit sitemaps, request indexing, or create GA4–Search Console links (`analytics.readonly` cannot create those links). Use the Google UI, or wait for a later product that is explicitly scoped for writes.”

### `QUOTA_EXCEEDED` / `RATE_LIMITED`

Data API property tokens, GSC daily quotas, URL Inspection limits, GTM quota, 429.

**User-visible:**  
“Google quota or rate limit hit (`{api}`). GA4 Data API uses tokens per property (standard properties: 200,000 core tokens/day; hourly caps also apply). I cap reports at 1,000 rows per call. Wait, narrow the date range, or inspect fewer URLs. If `propertyQuota` is present, I will show remaining tokens.”

### `EMPTY_RESULT` (optional, success preferred)

Prefer `ok: true` with empty rows. If a skill needs a code for copy:

**User-visible:**  
“The request succeeded and returned no rows. That is not a failed login. Typical causes: date range with no data, a newly created property, filters that match nothing, GSC `data_state=final` while data is still processing, or the wrong property among many. Confirm the ID and timezone (`ga4_get_property`).”

### `LICENSE_REQUIRED`

Paid Google Ads / Meta tool called without a valid DGTL license JWT.

**User-visible:**  
“This tool needs DGTL Pro ($19/mo flat, unlimited) for Google Ads / Meta Ads. Free GA4, Search Console, and Tag Manager tools still work. Get Pro at https://www.dgtlsunrise.com/ then paste a license JWT via DGTL_LICENSE_JWT or PLUGIN_DATA/license.jwt — never a Google Ads developer-token.”

Do not ask for a Google Ads developer-token.

### `GBP_NOT_ENABLED`

GBP feature flag off (default) or project quota still 0.

**User-visible:**  
“Google Business Profile tools are flagged off until DGTL's GCP project has non-zero GBP API quota. They are not on the free GA4/GSC/GTM consent screen.”

### `GATEWAY_UNAVAILABLE`

Valid paid license (`ads` / `meta`), but `DGTL_GATEWAY_URL` is unset, the Worker is down, or the gateway is paused.

**User-visible:**  
“The DGTL Ads/Meta gateway is not reachable. Set `DGTL_GATEWAY_URL` to a live Worker, or wait until the hosted gateway is up. Free GA4, Search Console, and Tag Manager tools still work. This is not a missing Ads OAuth reconnect.”

Do **not** tell the user to “Reconnect Ads” for this code — that is `ADS_SCOPE_MISSING`.

### `ADS_SCOPE_MISSING` / `META_NOT_CONNECTED`

License **and** gateway are ok, but the second OAuth (Ads `adwords` / Meta `ads_read`) is not connected. Consent C / Meta tokens never come from Consent A (`GOOGLE_ACCESS_TOKEN`).

- Ads: set `GOOGLE_ADS_ACCESS_TOKEN` or run `dgtl-connector-mcp auth login-ads` (requires `GOOGLE_OAUTH_ADS_CLIENT_ID` — separate Consent C client; never add `adwords` to Consent A). No developer-token in this plugin.
- Meta: set `META_ACCESS_TOKEN` or run `dgtl-connector-mcp auth login-meta --code <grant>` (redeems hosted Login via `POST /v1/meta/exchange`; long-lived token returns **to the plugin**; Worker stores nothing). Support never collects Meta tokens.

### `GOOGLE_UNAVAILABLE`

500/503 from Google.

**User-visible:**  
“Google’s API returned a server error. Retry once. If it keeps failing, it is on Google’s side, not your property picker.”

---

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

Listing tags in a workspace can show unpublished drafts. Production is `gtm_get_live_container_version`. Users who say “GTM is wrong” may be looking at the draft.

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

On Consent A / flag off: refuse (`UNSUPPORTED_OPERATION` or `WRITE_NOT_ENABLED`). Add: “I can show the live container and the workspace draft so you can see the diff. Publishing needs Consent W (separate OAuth client) when that path is enabled — not the free readonly consent.”

## “Search queries in GA4” scenario (copy)

Use `UNSUPPORTED_DIMENSION`. Offer GSC after they pick `site_url`.
