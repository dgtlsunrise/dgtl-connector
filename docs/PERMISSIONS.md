# Permissions

Least privilege is a product feature. v1 asks Google for **read** access to Analytics, Search Console, and Tag Manager — nothing else.

## Exact OAuth scopes

### Product scopes (required, one consent)

Request **all three** on a **single** Google consent screen. Do not run sequential per-product OAuth.

| Scope | API surface | User-visible meaning |
| --- | --- | --- |
| `https://www.googleapis.com/auth/analytics.readonly` | GA4 Admin API v1beta, GA4 Data API v1beta | See and download Google Analytics data |
| `https://www.googleapis.com/auth/webmasters.readonly` | Search Console API (sites, searchanalytics, sitemaps, URL Inspection) | View Search Console data for verified sites |
| `https://www.googleapis.com/auth/tagmanager.readonly` | Tag Manager API v2 | View Google Tag Manager accounts, containers, and subcomponents |

These strings are the source of truth. Do not substitute `analytics`, `analytics.edit`, `webmasters`, `tagmanager.edit.containers`, or `tagmanager.publish`.

### Identity scopes (same consent, not a fourth product)

So `google_whoami` can show **which Google account** connected, request these **on the same screen**:

| Scope | Why |
| --- | --- |
| `openid` | Subject identifier |
| `https://www.googleapis.com/auth/userinfo.email` | Email on the consent account |

Do **not** request `https://www.googleapis.com/auth/userinfo.profile` unless a later spec proves a need. Do not request Gmail, Drive, Calendar, or People.

### Explicitly never requested (v1)

| Scope | Reason |
| --- | --- |
| `https://www.googleapis.com/auth/adwords` | Google Ads — v2 hosted |
| `https://www.googleapis.com/auth/analytics` | Read/write Analytics |
| `https://www.googleapis.com/auth/analytics.edit` | Would be needed to create some GA4 links; still not v1 |
| `https://www.googleapis.com/auth/webmasters` | Read/write Search Console |
| `https://www.googleapis.com/auth/tagmanager.edit.containers` | Edit GTM |
| `https://www.googleapis.com/auth/tagmanager.publish` | Publish GTM |
| `https://www.googleapis.com/auth/tagmanager.delete.containers` | Delete containers |
| `https://www.googleapis.com/auth/tagmanager.manage.users` | Manage GTM users |
| `https://www.googleapis.com/auth/gmail.*` | Restricted; not marketing reporting |
| `https://www.googleapis.com/auth/drive*` | Restricted; not in product |
| `https://www.googleapis.com/auth/business.manage` | GBP out of v1 |

Google verification rejects “future enhancement” scopes. Do not pre-declare Ads scopes on this OAuth client.

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

## Consent W (writes) — separate from free Consent A

Free Consent A stays **readonly** forever for the Desktop client used in demos and verification. Write/publish tools use a **separate** OAuth client (Consent W). Candidate scopes live in `src/google/scopes.ts` as `CONSENT_W` / `CONSENT_W_GTM` and are **never** merged into `CONSENT_A`.

| Env / flag | Meaning |
| --- | --- |
| `GOOGLE_OAUTH_WRITE_CLIENT_ID` / `GOOGLE_OAUTH_WRITE_CLIENT_SECRET` | Consent W client (gitignored `.env` only; placeholders in `.env.example`) |
| `DGTL_WRITES_ENABLED` | Default `false`. When off, GTM write stubs return `WRITE_NOT_ENABLED` |
| When flag on but Consent W missing | Tools return `CONSENT_W_REQUIRED` |
| Live mutate | `GoogleWriteHttp` only; `dry_run` default true; `confirm_phrase` must include resolved `GTM-XXXX` or `INVALID_ARGUMENT` |

Product rules: explicit tools only; publish requires confirmation (`dry_run` / `confirm_phrase`); property/container named in the call. Full lock: [ops/FULL-STACK-ACCELERATE.md](ops/FULL-STACK-ACCELERATE.md).

## Consent C (Ads / Meta user OAuth) — separate from Consent A

Paid Ads/Meta **user** grants use a **separate** Google OAuth client (`adwords`) plus Meta Login for Business. They are **never** bolted onto the free Desktop Consent A client.

| Path | How |
| --- | --- |
| Google Ads | `GOOGLE_ADS_ACCESS_TOKEN` or `dgtl-connector-mcp auth login-ads` → `PLUGIN_DATA/google-oauth-ads.json` (`GOOGLE_OAUTH_ADS_CLIENT_ID`) |
| Meta | `META_ACCESS_TOKEN` or `dgtl-connector-mcp auth login-meta --code <grant>` → `POST /v1/meta/exchange` → `PLUGIN_DATA/meta-oauth.json` |
| Secrets | Ads developer-token and Meta app secret stay on the Worker. This plugin never ships them. Support never collects Meta tokens. |

Live hops still need `DGTL_LICENSE_JWT` + `DGTL_GATEWAY_URL`. Fail closed until those exist (`LICENSE_REQUIRED` / `GATEWAY_UNAVAILABLE` / `ADS_SCOPE_MISSING` / `META_NOT_CONNECTED`).

## Least privilege in the tools

- Free GA4 / GSC / GTM tools are read/list/get on Consent A. GTM write/publish tools (`gtm_create_tag`, `gtm_update_tag`, `gtm_publish_container`) are registered, flagged off by default (`WRITE_NOT_ENABLED`), and use Consent W + `GoogleWriteHttp` when enabled — they are **not** on the free consent screen.
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

English, unlisted YouTube, showing:

1. **Manual / PKCE auth** (`dgtl-connector-mcp auth login` or host-injected token) — **not** a Gmail-style Connect card. Google consent with the **same** three Consent A scopes visible.
2. Address bar includes the OAuth **client ID**.
3. App name on the consent screen.
4. List GA4 properties → user picks one → `runReport` numbers appear.
5. GSC search analytics for **queries**.
6. GTM list tags or live version.
7. A refusal: user asks to publish a tag → agent declines (Consent A cannot publish; write stubs, if listed, are flagged off on a **different** OAuth client).

Do **not** show Ads, Gmail, Connect-card UI, or write scopes on the Consent A client in that video.

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
