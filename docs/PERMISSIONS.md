# Permissions

Least privilege is a product feature. Free Google is **one** Connect for Analytics, Search Console, and Tag Manager **read and manage**. Ads, Merchant Center, and GBP stay off that screen. Live Free Google mutates need in-chat confirm (`dry_run` default). `DGTL_WRITES_ENABLED` is only for live Merchant Center ProductInput writes.

## Exact OAuth scopes

### Free Google (required, one consent)

Request **all of these** on a **single** Google consent screen. Do not run sequential per-product OAuth.

| Scope | API surface | User-visible meaning |
| --- | --- | --- |
| `https://www.googleapis.com/auth/analytics.readonly` | GA4 Admin API v1beta, GA4 Data API v1beta | See and download Google Analytics data |
| `https://www.googleapis.com/auth/webmasters.readonly` | Search Console API (sites, searchanalytics, sitemaps, URL Inspection) | View Search Console data for verified sites |
| `https://www.googleapis.com/auth/tagmanager.readonly` | Tag Manager API v2 | View Google Tag Manager accounts, containers, workspaces, tags/triggers/variables, **clients**, **environments**, and live versions |
| `https://www.googleapis.com/auth/analytics.edit` | GA4 Admin writes | Manage GA4 properties, streams, key events, custom defs (confirm) |
| `https://www.googleapis.com/auth/tagmanager.edit.containers` | Tag Manager writes | Create/update tags, triggers, variables, clients, containers, environments (confirm) |
| `https://www.googleapis.com/auth/tagmanager.edit.containerversions` | Tag Manager versions | Create a container version before publish (`create_version`). Confirm-gated. `dry_run` default. |
| `https://www.googleapis.com/auth/tagmanager.publish` | Tag Manager publish | Publish a container version (confirm) |
| `https://www.googleapis.com/auth/webmasters` | Search Console writes | Submit/delete sitemaps (confirm). No Indexing API. |

These strings are the source of truth in `src/google/scopes.ts` (`CONSENT_A`). Do not add `adwords`, `content`, or `business.manage`. Do not request blanket `analytics`.

### Identity scopes (same consent, not a fourth product)

So `google_whoami` can show **which Google account** connected, request these **on the same screen**:

| Scope | Why |
| --- | --- |
| `openid` | Subject identifier |
| `https://www.googleapis.com/auth/userinfo.email` | Email on the consent account |

Do **not** request `https://www.googleapis.com/auth/userinfo.profile` unless a later spec proves a need. Do not request Gmail, Drive, Calendar, or People.

### Explicitly never requested on Consent A (free listing / verification client)

These scopes are **never** on Free Google. Paid / GBP / MC stay on separate grants.

| Scope | Reason |
| --- | --- |
| `https://www.googleapis.com/auth/adwords` | Google Ads — Consent C (separate client). Pro + stamp. |
| `https://www.googleapis.com/auth/content` | Merchant Center / Merchant API — Consent MC (separate client). Never on Consent A. |
| `https://www.googleapis.com/auth/analytics` | Blanket Analytics read/write — never request this. Use `.readonly` + `.edit`. |
| `https://www.googleapis.com/auth/tagmanager.delete.containers` | Delete containers — not registered |
| `https://www.googleapis.com/auth/tagmanager.manage.users` | Manage GTM users — not registered |
| `https://www.googleapis.com/auth/gmail.*` | Restricted; not marketing reporting |
| `https://www.googleapis.com/auth/drive*` | Restricted; not in product |
| `https://www.googleapis.com/auth/business.manage` | Never on Consent A. Consent B + `DGTL_GBP_ENABLED` (GET-only tools) until Basic Access. |

Google Cloud **Data Access** for Consent A is a Noel-only change. This repo requests the Free Google set; do not flip Cloud Console from an agent PR.

## Google Cloud APIs to Enable

On the **OAuth client's** Cloud project (DGTL's production project, or a developer's harness project):

| API | Service name | If missing |
| --- | --- | --- |
| Google Analytics Admin API | `analyticsadmin.googleapis.com` | 403 `accessNotConfigured` on list/get property |
| Google Analytics Data API | `analyticsdata.googleapis.com` | 403 `accessNotConfigured` on `runReport` / metadata |
| Search Console API | `searchconsole.googleapis.com` | 403 `accessNotConfigured` on sites / searchanalytics / inspect / sitemaps |
| Tag Manager API | `tagmanager.googleapis.com` | 403 `accessNotConfigured` on GTM list calls |

Enabling APIs is **publisher/dev** work. End users grant OAuth and must have **product** access (GA4 property, GSC site, GTM account). Those are different systems.

## Property isolation (agencies)

A single Google login may see dozens of GA4 properties, GSC sites, and GTM accounts. v1 treats that as the default hard case.

### Rules

1. **No implicit resource.** Tools require IDs. There is no `property_id="default"`.
2. **List → ask → call.** If a list returns more than one item, skills stop and ask. Matching a name substring is allowed only after the user confirms the ID.
3. **Answer header.** Reports include the GA4 property ID, GSC site URL, and/or GTM container ID that produced the numbers.
4. **No cross-client join** unless the user named both IDs. Do not “helpfully” overlay Client A's GSC on Client B's GA4.
5. **Do not persist a sticky default client** in `PLUGIN_DATA` without an explicit user action in that conversation.
6. **Empty list ≠ pick nothing silently.** If `ga4_list_properties` is empty, say the account has no accessible properties (permission), not “no traffic.”

### What OAuth does not isolate

Readonly scopes see **everything that Google user can already see** in the Google UIs. The plugin cannot hide Client C from an agency login that already has Viewer on Client C. Isolation is **operational**: picker + labeled answers + skills, not a separate DGTL ACL.

If an agency needs employees to see only one client, that is a **Google permissions** problem (don't share the agency owner login). Support may explain that. DGTL does not collect a list of client properties into a vault in v1.

## Consent W / G / S (writes) — on Free Google, Connect + confirm only

Free Google (`CONSENT_A`) includes the W / G / S manage scopes. `auth login` writes `PLUGIN_DATA/google-oauth.json`. `login-write` / `login-ga4-admin` / `login-gsc-write` alias to that login. Legacy stores are still accepted if present.

| Env / flag | Meaning |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | Free Google Desktop client |
| Legacy `GOOGLE_WRITE_*` / `GOOGLE_GA4_ADMIN_*` / `GOOGLE_GSC_WRITE_*` | Still accepted when present |
| `DGTL_WRITES_ENABLED` | Default `false`. **Not** a Free Google / Shopify / Klaviyo gate. Still required for live Merchant Center ProductInput writes. Never ship `true` as the package default. |
| When write scopes missing | `CONSENT_W_REQUIRED` / `CONSENT_G_REQUIRED` / `CONSENT_S_REQUIRED` |
| Live mutate | Dedicated write HTTP clients; `dry_run` default true; `confirm_phrase` must include the resource id |

Wave 13: `gtm_list_clients` / `gtm_list_environments` use `tagmanager.readonly`. Create/update/publish tools need the matching write scopes plus confirm.

| Lane | Scopes | Login | Store (mode 0600) | Fail |
| --- | --- | --- | --- | --- |
| **W** | `CONSENT_W_GTM` = GTM edit + publish | `auth login` (alias `login-write`) | Primary `google-oauth.json`; legacy `google-oauth-write.json` | `CONSENT_W_REQUIRED` |
| **G** | `CONSENT_G` = `analytics.edit` only (never blanket `analytics`) | `auth login` (alias `login-ga4-admin`) | Primary `google-oauth.json`; legacy `google-oauth-ga4-admin.json` | `CONSENT_G_REQUIRED` |
| **S** | `CONSENT_S` = `webmasters` (write, not `.readonly`) | `auth login` (alias `login-gsc-write`) | Primary `google-oauth.json`; legacy `google-oauth-gsc-write.json` | `CONSENT_S_REQUIRED` |

Login does **not** set `DGTL_WRITES_ENABLED` (MC still uses that flag). Intersection tests lock `adwords` / `content` / `business.manage` off Free Google (`A ∩ {adwords, content, business.manage} = ∅`). `CONSENT_W` / `CONSENT_G` / `CONSENT_S` are subsets of `CONSENT_A`.

## Consent C (Ads / Meta user OAuth) — separate from Consent A

Paid Ads/Meta **user** grants use a **separate** Google OAuth client (`adwords`) plus Meta Login for Business. They are **never** bolted onto the free Desktop Consent A client.

| Path | How |
| --- | --- |
| Google Ads | `GOOGLE_ADS_ACCESS_TOKEN` or `dgtl-connector-mcp auth login-ads` → `PLUGIN_DATA/google-oauth-ads.json` (`GOOGLE_OAUTH_ADS_CLIENT_ID`) |
| Meta | `META_ACCESS_TOKEN` or `dgtl-connector-mcp auth login-meta --code <grant>` → `POST /v1/meta/exchange` → `PLUGIN_DATA/meta-oauth.json` |
| Secrets | Ads developer-token and Meta app secret stay on the Worker. This plugin never ships them. Support never collects Meta tokens. |

Live Ads/Meta hops still need `DGTL_LICENSE_JWT` + `DGTL_GATEWAY_URL`. Fail closed until those exist (`LICENSE_REQUIRED` / `GATEWAY_UNAVAILABLE` / `ADS_SCOPE_MISSING` / `META_NOT_CONNECTED`).

Wave 16 catalog writes and CAPI use the same Polar Pro **`meta`** bit (no extra Polar product). App Review needs **`ads_management` and/or `catalog_management`**. Plugin dual-gates CAPI via stamp health `meta_capi_enabled` (Worker `META_CAPI_ENABLED`, fail-closed, **not** `META_MUTATE_ENABLED`). Catalog items_batch / create catalog reuse the Meta mutate dual-gate. App secret stays on the Worker. Never Axos BM. Never unhashed PII in logs.

## Consent MC (Merchant Center) — separate from Consent A and Consent C

Merchant API reads use a **third Google Desktop client**. Not Consent A (no `content` on the free screen). Not Consent C (`adwords` is Ads, not Merchant Center). Not stamp (no DGTL secret).

| Path | How |
| --- | --- |
| Merchant Center | `GOOGLE_MC_ACCESS_TOKEN` or `dgtl-connector-mcp auth login-mc` → `PLUGIN_DATA/google-oauth-mc.json` (`GOOGLE_OAUTH_MC_CLIENT_ID`) |
| Scope | `https://www.googleapis.com/auth/content` only. Google has no readonly MC scope. Reads stay GET-only on `GoogleHttp`. Wave 14 writes use `GoogleMcWriteHttp` (same Consent MC). |
| License | Polar Pro `ads` feature (no separate `mc` bit). Direct hop — **no** `DGTL_GATEWAY_URL`. |
| Fail closed | `LICENSE_REQUIRED` → `MC_NOT_CONNECTED` → `MC_SCOPE_MISSING`. Live writes also `WRITE_NOT_ENABLED` until `DGTL_WRITES_ENABLED` + confirm containing `merchant_id`. |

Do **not** add `content` to Consent A verification. Merchant API Products / Accounts / DataSources must be Enabled on the **MC OAuth client's** GCP project (Noel gate). `ACCESS_NOT_CONFIGURED` is that enablement, not an empty catalog.

## Consent B (Google Business Profile) — separate from Consent A

GBP reads use a **separate Google Desktop client**. Not Consent A (no `business.manage` on the free screen). Not stamp (no DGTL secret). Commercially free-local when `DGTL_GBP_ENABLED=true`.

| Path | How |
| --- | --- |
| GBP | `GOOGLE_GBP_ACCESS_TOKEN` or `dgtl-connector-mcp auth login-gbp` → `PLUGIN_DATA/google-oauth-gbp.json` (`GOOGLE_OAUTH_GBP_CLIENT_ID`) |
| Scope | `https://www.googleapis.com/auth/business.manage` only. Google has no readonly GBP scope; Wave 5 tools are GET-only. |
| Flag | `DGTL_GBP_ENABLED` default **false**. `auth login-gbp` does not flip it. |
| Fail closed | `GBP_NOT_ENABLED` (flag off) → `GBP_NOT_CONNECTED` → `GBP_SCOPE_MISSING` |

Do **not** add `business.manage` to Consent A verification. Account Management / Business Information / Performance APIs must be Enabled on the **GBP OAuth client's** GCP project, and Basic API Access quota must be non-zero (Noel gate). `ACCESS_NOT_CONFIGURED` is that enablement / quota, not an empty location list.

### Google Cloud APIs to Enable (Consent B project)

| API | Host / path | If missing |
| --- | --- | --- |
| My Business Account Management API | `mybusinessaccountmanagement.googleapis.com/v1` | 403 `accessNotConfigured` on `gbp_list_accounts` |
| My Business Business Information API | `mybusinessbusinessinformation.googleapis.com/v1` | 403 on `gbp_list_locations` / `gbp_get_location` |
| Business Profile Performance API | `businessprofileperformance.googleapis.com/v1` | 403 on `gbp_performance` / `gbp_search_keywords` |

### Google Cloud APIs to Enable (Consent MC project)

| API | Host / path | If missing |
| --- | --- | --- |
| Merchant API (products) | `merchantapi.googleapis.com/products/v1` | 403 `accessNotConfigured` on `mc_list_products` / get / statuses / `mc_upsert_product_input` / `mc_delete_product_input` |
| Merchant API (accounts) | `merchantapi.googleapis.com/accounts/v1` | 403 on `mc_list_accounts` / `mc_list_account_issues` |
| Merchant API (data sources) | `merchantapi.googleapis.com/datasources/v1` | 403 on `mc_list_data_sources` / `mc_create_data_source` / `mc_fetch_data_source` |

## Least privilege in the tools

- Free GA4 / GSC / GTM tools are read/list/get on Consent A. GTM write/publish tools (`gtm_create_tag`, `gtm_update_tag`, `gtm_create_trigger`, `gtm_update_trigger`, `gtm_create_variable`, `gtm_update_variable`, `gtm_publish_container`, `gtm_create_client`, `gtm_update_client`, `gtm_create_container`, `gtm_create_environment`) are registered and use Consent W + `GoogleWriteHttp` after Free Google grants manage scopes — live mutate needs confirm, not `DGTL_WRITES_ENABLED`. GA4 Admin writes use Consent G + `GoogleGa4AdminHttp`. GSC sitemap submit/delete (`gsc_submit_sitemap`, `gsc_delete_sitemap`) use Consent S + `GoogleGscWriteHttp`. Merchant Center ProductInput writes (`mc_create_data_source`, `mc_upsert_product_input`, `mc_delete_product_input`, `mc_fetch_data_source`) use Consent MC + `GoogleMcWriteHttp` (same `content` grant as reads — never Consent A) and still need `DGTL_WRITES_ENABLED`. MC write tools are not on the free consent screen.
- `ga4_run_report` defaults to small row limits (see [TOOLS.md](TOOLS.md)) so one prompt cannot burn a property's daily Data API tokens.
- URL Inspection is read of index state, not request indexing (`webmasters.readonly` cannot submit anyway).
- Workspace GTM lists may include **unpublished drafts**. Live tags come from `gtm_get_live_container_version`. Skills must not imply a draft tag is in production.

## What we will request from Google verification

When the OAuth client goes **External / In production** with these sensitive scopes, DGTL will submit:

### Brand

- App name consistent with the plugin (DGTL Sunrise). Package id `dgtl-connector` is not the consent-screen name.
- Support email: `noel@dgtlsunrise.com`
- Authorized domain + homepage + **privacy policy URL** (must exist before this step; not invented in this spec repo)
- Logo that matches the consent screen

### Scopes to declare (exactly)

1. `https://www.googleapis.com/auth/analytics.readonly`  
   **Justification:** The app shows the user their own GA4 accounts, properties, streams, key events, and reports inside their agent. No write. No other users' Analytics.
2. `https://www.googleapis.com/auth/webmasters.readonly`  
   **Justification:** The app lists the user's Search Console sites, query/page performance, sitemaps, and URL inspection status. No add/remove site, no sitemap submit.
3. `https://www.googleapis.com/auth/tagmanager.readonly`  
   **Justification:** The app lists the user's GTM accounts, containers, workspaces, tags, triggers, variables, and the live container version for audits. No edit, no publish.

Plus `openid` and `userinfo.email` as non-sensitive identity.

### Demo video (plan)

For the 2026-09-15 Action Needed, do not follow the historical readonly take (refuse publish, hide manage scopes). Film [DEMO-VIDEO-SCRIPT.md](ops/DEMO-VIDEO-SCRIPT.md) appendix M1–M4 and reply from [OAUTH-ACTION-NEEDED-2026-09-15.md](ops/OAUTH-ACTION-NEEDED-2026-09-15.md). That packet requires edit/publish on the consent screen and live GA4/GTM UI impact. Do not show Ads, Meta, Gmail, tokens, or secrets.

### Sensitive vs restricted

v1 avoids **restricted** scopes (Gmail, Drive, etc.). Analytics / Search Console / Tag Manager readonly are treated as **sensitive** in Google's verification flow. Budget time for brand + data-access review. Do not request extra scopes to “save a round.”

### Testing mode

Until verified, the OAuth client stays in testing with an allowlist. Fine for Noel and named testers. Not fine for a public marketplace listing that invites strangers.

## Host / marketplace security bar

- Open source plugin package once public; this spec is already inspectable.
- No secrets in the repo (see [MARKETPLACE.md](MARKETPLACE.md)).
- Client ID in `mcp.json` / `plugin.json` is a placeholder until publish; even then it is not a secret.
- Users revoke access in [Google Account → Third-party access](https://myaccount.google.com/permissions). Skills should mention that when asked how to disconnect.

## Support and tokens

Support intake **never** includes refresh tokens, access tokens, cookie dumps, or HAR files with `Authorization`. See [SUPPORT_AND_CLIENTS.md](SUPPORT_AND_CLIENTS.md).

## Shopify (not Google Consent A)

Local merchant custom app / Dev Dashboard credentials:

- `SHOPIFY_STORE` (`*.myshopify.com`)
- `SHOPIFY_ACCESS_TOKEN` (`shpat_…`) and/or `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` (client_credentials)
- Default scopes on the **merchant app**: `read_products`, `read_orders`, `read_inventory`, `read_locations`
- **Explicit expand** (reinstall / request; **never silent** on an existing app): `read_publications`, `read_product_listings`, `write_inventory`, `write_products`. Same token, not a second OAuth family, not stamp vault. Missing detectable scope → `SHOPIFY_SCOPE_MISSING`.
- Catalogs list uses existing `read_products`. Publications need `read_publications`. Product feeds need `read_product_listings`. `shopify_adjust_inventory` needs `write_inventory`. `shopify_product_set` needs `write_products`.
- Writes need the matching `write_*` scope + `confirm_phrase` / `confirm` containing the shop domain. `DGTL_WRITES_ENABLED` is not a Shopify gate.
- Store under `PLUGIN_DATA/shopify-oauth.json` mode 0600; never git

Fail closed: `SHOPIFY_NOT_CONNECTED`. Free local lane (do not require Polar Pro). Support never collects Shopify tokens. Not part of Consent A verification / marketplace Google consent screen.

## TikTok Ads (not Consent A; stamp hop)

TikTok Marketing API app **id + secret** live on the stamp Worker only (like Meta). The plugin holds the **advertiser user token**:

- `TIKTOK_ACCESS_TOKEN` (host-injected) and/or `PLUGIN_DATA/tiktok-oauth.json`
- License JWT must include feature **`tiktok`** (Polar Pro does **not** mint this until Noel sets `POLAR_MINT_TIKTOK` — do not overload `ads`/`meta`)
- `DGTL_GATEWAY_URL` required

Fail closed: `LICENSE_REQUIRED` without `tiktok`; `TIKTOK_NOT_CONNECTED` without a user token; `GATEWAY_UNAVAILABLE` without Worker secrets / health. Support never collects TikTok tokens. App secret is never in this plugin.

Wave 17 catalog writes and campaign create reuse plugin/Worker **`TIKTOK_MUTATE_ENABLED`** (Worker fail-closed). Events API uses a **separate** Worker `TIKTOK_EVENTS_ENABLED` (fail-closed, **not** status mutate). Plugin `DGTL_TIKTOK_EVENTS_ENABLED` defaults on; live hop requires health `tiktok_events_enabled===true`. `content_id` must match catalog `sku_id`. Never Axos. Never unhashed PII in logs.

Wave 20 conversion fabric: plugin exposes `conversion_fabric_status` (never keys) and optional apply-only `sgtm_ingest_test`. Stamp implements `FundedUploadSink` — Ads Data Manager `IngestEvents` (`AdsDataManagerIngestEventsSink` / `ads_data_manager_ingest_events`), not deprecated `UploadClickConversions`. Meta CAPI / TikTok Events reuse Wave 16–17 named tools. Polar `sgtm` is reserved, default-off, **do not mint**. Funded ingest key (`X-DGTL-Ingest-Key`) and apply key never belong in **web** GTM variables. Never log `user_data` plaintext.

Live developer app + Marketing API access are **Noel gates**.

## Klaviyo (not Google Consent A)

Local private API key on the Bot computer:

- `KLAVIYO_API_KEY` (`pk_…`) and/or `PLUGIN_DATA/klaviyo.json`
- Revision header `2026-07-15`
- Reads stay local-free. Writes need `confirm_phrase` containing the account id. `DGTL_WRITES_ENABLED` is not a Klaviyo gate.
- **No** Polar `klaviyo` feature. **No** stamp hop. Campaign send is Wave 22 `klaviyo_create_campaign_send_job` (confirm-gated `SEND` token; **cannot** fire from draft create). Wave 19 adds `catalogs:read` / `catalogs:write` / `reviews:read` on the same local `pk_` (least privilege — only the scopes the merchant enables). Polar `klaviyo` OAuth is Wave 19b, not this plugin.

Fail closed: `KLAVIYO_NOT_CONNECTED`. Support never collects Klaviyo keys. Never log the key. Not part of Consent A verification / marketplace Google consent screen.

