# Second opinion — DGTL Google Marketing plugin

Status: review only. No MCP server was implemented. No Google or Meta APIs were called. Nobody was contacted. No secrets were invented.

Date: 2026-09-02
Reviewer: Grok Build (this pass)
Inputs: `SCOPE-AND-PLAN.md` (commercial lock), `STEP-0-PLAN.md` (earlier notes; SCOPE wins on conflict), and the Cursor cloud spec from agent `bc-a4346943` (22 closed tools, schemas, skills, error envelope). That spec is **not in this directory**. It must be vendored before any implementation, or the 22-tool baseline will be reinvented.

**Verdict:** The commercial lock is right. The quality bar is right. The 22-tool spec is the right free-tier kernel. The **paid stamp as drawn is not implementable** as a no-data-plane, no-secret-leak design. Cursor/Grok Bot **stdio MCP auth is manual**, not a Gmail-style connect card. GBP is **not** a free OAuth add-on; it is an access-request-gated API with a write-capable scope. Ship architecture once, **publish the free plugin without waiting for Ads/Meta paperwork**.

Commercial decisions that stay locked (do not relitigate):

- Publisher: DGTL Sunrise / Sunrise Consulting LLC (`noel@dgtlsunrise.com`). Off Axos. No Breakwater/SAM in the repo.
- Free local: GA4, GSC, GTM, and GBP *as a product tier*. All readonly at the tool layer.
- Paid: Google Ads readonly + Meta Ads readonly. Not TikTok/Shopify/HubSpot. Not $5–10 SaaS.
- No DGTL token vault for GA4/GSC/GTM. No report-byte analytics warehouse. Writes off in v1.
- Closed typed tools, fixture tests, skills that refuse hallucinated metrics, agency picker, public git, no secrets in git.

What must change is **how** paid Ads/Meta credentials exist, **how** OAuth is packaged across hosts, **when** marketplace submit happens, and a handful of API facts that would send an implementer down a dead end.

A short errata was added to `SCOPE-AND-PLAN.md` §12 for the API facts. The architecture and sequence recommendations in **this** file override SCOPE §§4 and 7 where they conflict. Commercial tiering in SCOPE §§1–3 is unchanged.

---

## 0. What the three documents actually say

| Topic | STEP-0 | Cloud spec (`bc-a4346943`) | SCOPE (locked) |
| --- | --- | --- | --- |
| v1 APIs | GA4 + GSC; GTM locked in at the end; GBP/Ads later | GA4 + GSC + GTM only. 22 tools. GBP/Ads/Meta out | Free: GA4+GSC+GTM+GBP. Paid: Ads+Meta via stamp |
| Ads | v2 hosted, because of the developer token | `adwords` never on the v1 OAuth client | Paid stamp; user-supplied token as power-user escape |
| Auth | Platform connect card; do not ship localhost OAuth | Same; Agent Plugins 1.0 has **no portable OAuth fields** | Connect card or documented fallback |
| Tool names | `ga4.run_report` (dotted, as an example) | `ga4_run_report` (underscore, 22 names in `catalog.json`) | Example still dotted; catalog is underscore |
| Package | Agent Plugin + later `xai-org/plugin-marketplace` PR | `plugin.json` + `mcp.json` + `skills/` | Same, plus `packages/*` layout |
| Publish | After GA4+GSC runtime | After runtime + Google verification | After Ads **and** Meta proofs |

SCOPE wins on product. The cloud spec wins on the 22 names, error envelope, and skills. This review wins on API facts, paid credential topology, host packaging, and ship sequence.

The 22 tools (count is 1+7+6+8, not the prompt’s 8/6/7):

| Group | Tools |
| --- | --- |
| Identity | `google_whoami` |
| GA4 | `ga4_list_accounts`, `ga4_list_properties`, `ga4_get_property`, `ga4_list_data_streams`, `ga4_list_key_events`, `ga4_get_metadata`, `ga4_run_report` |
| GSC | `gsc_list_sites`, `gsc_get_site`, `gsc_query_search_analytics`, `gsc_inspect_url`, `gsc_list_sitemaps`, `gsc_get_sitemap` |
| GTM | `gtm_list_accounts`, `gtm_list_containers`, `gtm_get_container`, `gtm_list_workspaces`, `gtm_list_tags`, `gtm_list_triggers`, `gtm_list_variables`, `gtm_get_live_container_version` |

---

## 1. Think-through (the whole path, not the happy path)

### 1.1 Three hosts, three plugin formats, one binary

This is not one plugin format with a README tweak.

| Host | Manifest | MCP config | OAuth / connect |
| --- | --- | --- | --- |
| Cursor IDE + Grok Bot | Agent Plugins `plugin.json` and/or `.cursor-plugin/plugin.json` | Root `mcp.json` | **stdio = Manual auth.** OAuth connect cards are for **remote HTTP/SSE** MCP (`auth.CLIENT_ID` + scopes). First-party Gmail/Drive/Calendar are special-cased Google Workspace MCP hosts, not a third-party stdio privilege. |
| Grok Build marketplace | Optional `plugin.json`; catalog PR to `xai-org/plugin-marketplace` with a **pinned 40-char SHA** | **`.mcp.json`** (dotfile), plus `skills/`, optional `commands/`, `agents/`, `hooks/` | Env vars / user config. No connect card. |
| Agent Plugins 1.0 portable | Root `plugin.json` | Root `mcp.json`; schema is **closed** (`additionalProperties: false`) | Spec text: *“defines no portable OAuth or credential-reference fields. Authentication remains client-managed.”* Cursor’s `auth` block is **not** portable. |

Grok Bot docs: plugin OAuth tokens for supported plugins live on **Cursor’s connector backend**; the bot invokes tools without seeing them. The in-catalog examples that get a Connect card (X, Customer.io, etoro) are **remote HTTP MCP servers**, not local stdio talking to Google.

**Implication:** “Install, Connect card, whoami returns email” is **not a guaranteed stdio path**. Designing only for a connect card, then discovering stdio is manual, is a rebuild of auth, README, skills, and Google OAuth client type.

One-shot shape:

```
src/          library (tools, clients, license verify, error map)
plugin/       ship unit
  plugin.json
  mcp.json          # Agent Plugins / Cursor
  .mcp.json         # generated copy for Grok Build
  skills/
  bin/dgtl-marketing-mcp
services/stamp/     NOT in the plugin package
```

Generate `mcp.json` and `.mcp.json` from one source. Do not hand-maintain two.

### 1.2 Google OAuth (free tier)

**Consent A (free, submit this):** one screen.

- `https://www.googleapis.com/auth/analytics.readonly`
- `https://www.googleapis.com/auth/webmasters.readonly`
- `https://www.googleapis.com/auth/tagmanager.readonly`
- `openid` + `https://www.googleapis.com/auth/userinfo.email` for `google_whoami`

Do **not** put Ads or GBP on this client “to save a round.” Google verification rejects future-enhancement scopes. The cloud spec was right.

**Auth adapters (interface `AccessTokenSource`, one of):**

1. **Host-injected** — env or MCP auth context. Used if a host ever grows stdio token injection.
2. **Documented installed-app PKCE** — public/Desktop OAuth client, loopback, tokens in `PLUGIN_DATA` (encrypted at rest if the host allows). Labeled advanced. This is how the existing DGTL Installed App harness already proved GA4/GSC/GTM. The cloud spec forbade shipping it; **ship it as the documented fallback**, not as a fake vault.
3. **Never** embed a confidential web-client secret in the plugin binary or git.

Until Google verification completes, the OAuth client stays in **testing** with an allowlist. A public marketplace listing that invites strangers onto an unverified client will strand them. Sequence: testers → verification (demo video, privacy policy URL, homepage, logo) → public listing.

APIs Enabled on **DGTL’s** GCP project, not the user’s: `analyticsadmin`, `analyticsdata`, `searchconsole`, `tagmanager`. Production `accessNotConfigured` is a publisher defect (`ACCESS_NOT_CONFIGURED`).

Granular consent: users can uncheck a scope. `google_whoami` reports granted scopes. A GTM call with only GA4 granted returns `CONSENT_MISSING`, not a generic 401. Re-grant is the **same** consent, not a second product login.

### 1.3 GBP (free commercially, gated technically)

GBP is **not** “User OAuth + APIs Google allows without a DGTL secret.”

Facts:

- GBP APIs are **not public**. DGTL’s GCP project must file **Application for Basic API Access**. Google’s FAQ says review within 14 days; in 2026 people report days to many weeks, and **quota stays 0** until approved (calls look like 429, not a clean “not enabled”).
- There is **no read-only OAuth scope**. Account Management, Business Information, and **Performance** all require `https://www.googleapis.com/auth/business.manage`. That scope can edit listings, posts, and reviews. Performance API **does not list locations**. Listing requires Account Management + Business Information.
- Putting `business.manage` on Consent A makes the free GA4/GSC/GTM screen say “manage your Business Profile” and couples verification of a write-capable scope to the read-only marketing connector.

**Product stays “GBP is free.” Implementation:**

- Consent B, incremental, optional. Feature flag `gbp.enabled` default **off** until the project’s GBP quota is non-zero.
- Tools stay readonly; skills refuse posts/replies/edits (`UNSUPPORTED_OPERATION`).
- Closed set (~5): `gbp_list_accounts`, `gbp_list_locations`, `gbp_get_location`, `gbp_performance`, `gbp_search_keywords`. No reviews-write, no posts, no dump of My Business v4.
- Do **not** block GA4 marketplace submit on GBP approval.

Noel paperwork, day one: GBP access form on the same LLC GCP project, with a verified profile ≥60 days if Google still wants that.

### 1.4 Google Ads (paid) — the landmine

**OAuth:** there is exactly one scope, `https://www.googleapis.com/auth/adwords`. User-visible string is *See, edit, create, and delete your Google Ads accounts and data*. Ad Manager’s `admanager.readonly` is a different product. SCOPE’s “use the narrowest Google documents for reporting” has nowhere to go. Readonly is enforced by:

1. No mutate tools in the catalog (hard).
2. Developer token **permissible use = Reporting** (Basic/Standard), which limits the token to `GoogleAdsService.Search` / `SearchStream` and other read calls.
3. The Google Ads **user role** on the account (readonly vs standard).
4. MCP annotations `readOnlyHint: true` on every Ads tool.

Consent C is a **second** Google grant, second OAuth client or incremental auth, **not** bolted onto Consent A.

**Developer token:** 22-char header on every call. Access ladder is Test → Explorer (2,880 production ops/day) → Basic (15k, ~5 business days review) → Standard. Test access **cannot** hit production accounts. Apply **the day Noel says go**, from the LLC MCC, with a live company URL.

**Why the stamp-as-drawn fails**

Google Ads has no HMAC, no proof, no short-lived developer-token mint. The token is a static header.

Google’s own docs: treat the developer token like a **password**; a compromised token can be used with *someone else’s* OAuth and the calls are **attributed to DGTL’s app**. Reset is the only recovery. Ads API policy also: if you provide a tool to end-advertisers you **must not require them to apply for their own token** (those apps are denied); and you **must not** let third parties use your token in a way that gives them programmatic Google Ads API access outside your tool.

Putting DGTL’s developer token on the user’s Grok Bot computer (even after a license check) is:

- Credential distribution, not a stamp.
- Visible in process memory, MCP debug logs, and any `GOOGLE_ADS_DEBUG`.
- One leaked license → token burned for every subscriber.
- The opposite of “secure your credentials.”

The power-user escape (user pastes **their already-issued** developer token) is valid for agencies who are themselves API developers. It **cannot** be the default paid SKU; Google will deny end-advertiser token apps, and DGTL cannot require customers to get one.

**Policy-correct paid Ads (pick one, lock it in phase 0):**

| Option | What it is | Data plane? | ToS |
| --- | --- | --- | --- |
| **A. Ads gateway (recommended)** | Local MCP sends the Ads HTTP request to `stamp.dgtlsunrise…`. Service checks license JWT, attaches `developer-token`, forwards to `googleads.googleapis.com`, returns the body. **No storage, no analytics warehouse, logs = request-id + status only.** | Ads **bytes** transit DGTL. GA4/GSC/GTM still do not. | Matches how Ads SaaS actually works. User still OAuths as themselves. |
| **B. Token lease** | Stamp returns the developer token to the MCP. | No Ads bytes on DGTL. | Treat as a known ToS/security exception. Assume leak. Per-license rate limit will not save a dumped token. **Do not pick this** unless a lawyer signs it. |
| **C. User token only** | No DGTL Ads SKU. | None | Honest, small market. |

SCOPE said “we stamp credentials, we do not proxy data.” For Ads, those two sentences cannot both be true. **Say: Ads/Meta paid is a credential plane. GA4/GSC/GTM are not. Ads report bytes transit DGTL and are not stored.** That is still not Ryze (no vault of GA4, no autopilot, no TikTok).

Gateway rules:

- Allowlist host `googleads.googleapis.com` (and Meta Graph). No open proxy.
- Strip mutate paths / reject GAQL that is not `SELECT` / `search` / `searchStream`.
- Attach token on the server. Client never sees it.
- License JWT in the request. Per-license QPS. One license, many IPs → tripwire.
- User OAuth access token is in `Authorization` for Google; it will be visible to the gateway for the hop. Do not persist it. Privacy policy must say this for **paid Ads/Meta only**.

### 1.5 Meta Ads (paid)

- App ID is public. App secret is not. **Require App Secret** (`appsecret_proof`) is the correct production setting; Meta’s own docs then say client calls **must be proxied through your backend**.
- `appsecret_proof = HMAC-SHA256(access_token, app_secret)`. Computing it without a gateway means either shipping the app secret or sending the user access token to DGTL for HMAC. Same topology as Ads: **gateway**.
- Permissions: `ads_read`. Add `business_management` only if listing BM-owned ad accounts requires it; verify at implementation, do not pre-request. No `ads_management` in v1.
- **Standard access** only works for people with a role on the app. Public users need **Advanced access** via App Review, plus **Tech Provider** verification for `ads_read` used by other businesses. App Review testers need a **clickable UI**, not an MCP. Budget a one-page read-only demo (list ad accounts → one insights table) or the submission dies.
- Facebook Login for Business / Marketing API product on a Business app claimed by Sunrise Consulting LLC.
- User tokens: short-lived from client-side login; long-lived needs app secret (gateway). Plan for reauth (`REAUTH_REQUIRED`).

Meta official MCP (`mcp.facebook.com/ads`) exists. Do not compete with it on surface area. The product is **one agency-safe marketing connector**, not a better Ads MCP.

### 1.6 License (paid unlock, not a data plane)

Split what SCOPE glued together:

1. **License** — signed JWT (issuer DGTL, `sub`, `exp`, `features: ["ads","meta"]`, `jti`). Verified **locally** with an embedded public key. No network for `LICENSE_REQUIRED`. Offline-friendly. Stripe/invoice is how Noel mints JWTs; the MCP does not speak Stripe.
2. **Gateway** — only for DGTL secrets (Ads developer token, Meta `appsecret_proof`). Checks the same JWT.

User-supplied Ads developer token: if present and valid-looking, Ads tools run **local** and skip the gateway. Still require a license if that is the SKU, or treat as a documented power-user override with `paid.ads_user_token` — pick one in phase 0 and put it in the README. Recommendation: license still required (you are selling the product); gateway skipped.

Do not hide paid tools from `list_tools`. Register them with descriptions that say they need a DGTL license. Fail closed with `LICENSE_REQUIRED` / `ADS_SCOPE_MISSING` / `META_NOT_CONNECTED` as distinct codes. A `whoami` that lists connections + license features stops the model from polling.

Billing: not $5–10, not in the plugin. Invoice or Stripe Checkout on a DGTL page that emails the JWT. Plugin store billing is a maybe; do not block code on it.

### 1.7 Agency, 40 properties

OAuth readonly sees **everything that Google user can already see**. The plugin cannot ACL Client C off an agency owner login. Isolation is operational:

- **No implicit resource.** Required IDs. No `default`. No “first of 40” in code (not only in a skill — skills are not a security boundary).
- **Picker API:** add `ga4_list_account_summaries` (Admin `accountSummaries.list`) so one call returns accounts + nested `propertySummaries`. The cloud spec’s `ga4_list_properties` requiring `account_id` makes a 15-account agency into a nested loop. That is a 23rd tool and a version bump; do it **now** or the picker gets rebuilt.
- Every success envelope includes `resource: { ga4_property_id | gsc_site_url | gtm_container_id | gads_customer_id | meta_ad_account_id, display_name }`.
- Cross-join skills (`gsc-vs-ads-keywords`, `ga4-vs-ads-conversions`) take **both** IDs and refuse if the user did not name both. They do not pick a “true” attribution.
- Do not persist “active client” in `PLUGIN_DATA` across sessions. Conversation-scoped confirmation only.
- Support copy: if they need employees to see one client, that is **Google permissions**, not a DGTL vault.

### 1.8 Marketplace, license file, support, future writes

**Submit free after the 22 tools + skills + fixture CI + Google verification (or testing-mode with honest README).** Do not hold the listing for Ads developer token, Meta App Review, or GBP quota. Paid families ship disabled / `LICENSE_REQUIRED`. SCOPE phase 8 as written waits on the slowest third-party review and is how the repo goes stale.

Public git, OSI license (Apache-2.0), author **DGTL Sunrise**, homepage + **privacy policy URL** (Google and Meta both need it; it does not exist in this repo). Rename **before** first listing. `dgtl-google-marketing` is the wrong name the day Meta is in the paid tier. Working suggestion: `dgtl-marketing` (Noel names it).

xAI catalog: remote source, pinned SHA, brand-scoped keywords (`dgtl`, `ga4`, `search-console`, `gtm` — not generic `api` / `marketing`). Run `validate-catalog.py`. Accept AS-IS / may execute code.

Cursor: `cursor.com/marketplace/publish`. Team MCP allowlists will block unknown stdio commands; document the command token.

**Support:** the `google-marketing-support` skill ships with the 22 tools (day one). A staffed support agent is after real users (SCOPE phase 9 is right for staffing, wrong if it means omitting the skill). Intake: plugin version, host, tool, `error_code`, Google status/`google_reason`, resource ID. Never tokens. One optional DGTL engagement line after a real diagnosis, verbatim from the cloud spec.

**Writes later:** GTM publish needs new scopes and a new Google verification. Ads writes do **not** need a new OAuth scope (`adwords` already writes) — that is why mutate tools must not exist and the token must be Reporting-only. Future writes = new tool family, `mutating: true`, `readOnlyHint: false`, user confirmation, feature flag off. Do not leave stub write tools in the catalog.

---

## 2. KEEP

From SCOPE:

- Two-tier product. Free local Google marketing reads. Paid = Ads + Meta only.
- No TikTok/Shopify/HubSpot/Gmail/Sheets. No $5–10. No Ryze clone. No Breakwater in the public plugin.
- Closed tools, typed JSON, versioned families. Property picker. Error codes + human line. Fixture tests, no live Google in CI. Public git, no secrets. One folder per API so LinkedIn later does not touch GA4.
- User-supplied Ads developer token as a power-user path (not the default SKU).
- Skills: `no-hallucinated-metrics`, `agency-property-isolation`, `gsc-vs-ads-keywords`, `ga4-vs-ads-conversions` (no “true” attribution), `license-and-reconnect`.
- Support diagnoses Enable-API 403s, missing IDs, expired consent, license miss. Paid subscribers are not automatically consulting clients.
- Paperwork that blocks **publish** (name, LLC GCP project, Ads token app, Meta verification, billing choice, connect-card question) does not block **spec and free-tier code**.

From the cloud spec (vendor this; do not rewrite):

- The 22 tool names, `schemas/v1/catalog.json`, `tools.schema.json`, `error.schema.json`.
- Error codes: `UNAUTHENTICATED`, `REAUTH_REQUIRED`, `CONSENT_MISSING`, `ACCESS_NOT_CONFIGURED`, `PERMISSION_DENIED`, `NOT_FOUND`, `RESOURCE_REQUIRED`, `INVALID_ARGUMENT`, `UNSUPPORTED_DIMENSION`, `UNSUPPORTED_OPERATION`, `QUOTA_EXCEEDED`, `GOOGLE_UNAVAILABLE`. Add `LICENSE_REQUIRED`, `ADS_SCOPE_MISSING`, `META_NOT_CONNECTED`, `GBP_NOT_ENABLED`.
- Non-bugs: API must be Enabled; `analytics.readonly` cannot create GSC–GA4 links; Data API has no `searchQuery`; GSC import lags; GTM workspace ≠ live; GSC site URL is exact; empty rows ≠ broken OAuth.
- Skills (7) and the support intake table / verbatim engagement line.
- `ga4_run_report` as the **only** GA4 report tool; cap 1,000 rows; echo `propertyQuota`; denylist `searchQuery` / `query` / `searchTerm` / `keyword` **without a Google call**.
- Google verification demo-video plan (three scopes visible, client ID in the address bar, picker, refuse publish).
- Secret scan in CI. Synthetic fixtures only (`Example Brand`, `sc-domain:example.com`).
- `validate-spec.py` as the ancestor of the runtime validator.

From STEP-0 (still true under SCOPE):

- Competing with a **hosted** Ryze by being first-party-shaped, not cheaper.
- Do not upsell “faster queries” or “AI insights.”
- Unattended writes are a weak need on Grok Bot computers that stay on.

---

## 3. CHANGE (concrete)

1. **Paid Ads/Meta topology.** Replace “stamp attaches token, user computer calls Google/Meta, no data plane” with **Option A: allowlisted gateway**. Local MCP calls DGTL only for Ads/Meta HTTP. DGTL holds the developer token and app secret. GA4/GSC/GTM never touch DGTL. Privacy policy has a paid-only paragraph. User-supplied Ads token remains a local bypass.

2. **Do not wait to list.** Marketplace submit is a free-tier event (22 tools + skills + CI + verification or an honest testing-mode README). GBP/Ads/Meta are version bumps behind flags. SCOPE §7.8 as a single gate after Meta is how this misses the market.

3. **Three consents, not one mega free consent.** A = GA4/GSC/GTM. B = GBP `business.manage` (optional, flagged). C = `adwords`. Meta is a separate OAuth. Incremental, not sequential token files per product inside A.

4. **GBP is flagged and access-request-gated.** Least-privilege Performance-only scope does not exist. Do not put `business.manage` on Consent A.

5. **Ads OAuth is `adwords`.** Document the scary consent copy. Enforce readonly in tools + Reporting permissible use. Apply for Reporting, not Ad creation.

6. **Lock tool names to underscore**, matching the 22-tool catalog (`ga4_run_report`, not `ga4.run_report`). MCP allows dots; hosts and the existing spec do not. Changing names later breaks skills, fixtures, and support.

7. **Dual-emit package.** One ship directory: `mcp.json` + generated `.mcp.json`. Cursor extras only under `extensions` / `.cursor-plugin/` if a connect path appears. Grok Build catalog is a later PR with a pinned SHA, not a second codebase.

8. **AuthPort, not “connect card or bust.”** Implement host-injected token + installed-app PKCE fallback. README tells the truth per host. If Cursor later adds stdio Google OAuth, it is an adapter, not a rewrite.

9. **Add `ga4_list_account_summaries` now** (closed-list bump 22 → 23). Agency picker depends on it.

10. **License JWT local; gateway separate.** `packages/license` verifies. `services/stamp` is a deployable, not a plugin folder, not in git with secrets.

11. **Ads tools: recipes, not 10 CRUD-shaped clones and not freeform GAQL.** See §5.

12. **Support skill ships in the free plugin.** Staffed support waits for users. Those are different.

13. **Rename before first listing.** Do not submit `dgtl-google-marketing` if Meta is on the roadmap. Name lock is Noel’s; Grok Build should use a package id that can survive a display-name change.

14. **Language lock:** TypeScript + official MCP SDK + REST (`fetch`) for all Google/Meta APIs, including Ads REST. One `bin` Node entry (or bun compile). Do not ship `google-ads` Python + `googleapiclient` + a second Meta SDK unless there is a proven gap. Python packaging on marketplace hosts is how stdio plugins fail to start.

15. **Noel paperwork parallel to code, not a phase inside Grok Build:** LLC GCP project, OAuth consent External, enable four APIs, Ads token application, GBP Basic API Access form, Meta Business + app + Tech Provider, privacy policy page, homepage, logo, product name.

---

## 4. Rebuild-forcing defects if ignored

These are not polish. Ignore them and the next agent rewrites auth, packaging, or paid.

| # | Defect | Why it rebuilds |
| --- | --- | --- |
| D1 | Stamp-as-drawn for Google Ads | No API support for a stamp. Token on the user box is a leaked developer token. Gateway vs local is a different network path, privacy policy, and MCP client. |
| D2 | Assuming Grok Bot Connect card for stdio | Cursor documents stdio auth as **Manual**. Connect cards are remote HTTP MCP. Building only for `connectors_needing_reauth` / host token injection leaves Grok Build and today’s Cursor with no login path. |
| D3 | One plugin layout | Agent Plugins `mcp.json` vs Grok Build `.mcp.json` vs Cursor `.cursor-plugin/`. Hand-writing one and bolting the other later duplicates manifests and breaks install. |
| D4 | Bundling `business.manage` or `adwords` onto the free OAuth client | New Google verification, scarier consent, and a failed GBP access request poisons the GA4 listing. |
| D5 | GBP treated as “just enable the API” | Quota 0 until Basic API Access. Feature will 429 in production for every user. Flag + paperwork, or omit from submit. |
| D6 | 22-tool spec not in this repo | SCOPE says “this file + the 22-tool spec agree.” The spec lives in another cloud workspace. Without vendoring, Grok Build will invent new names and schemas. |
| D7 | Dotted vs underscore tool names | Skills, catalog, fixtures, support all keyed one way. Pick underscore **before** code. |
| D8 | `ga4_list_properties` requires `account_id` as the only picker | Agencies cannot list 40 properties in one shot. Adding `accountSummaries` later is a closed-list bump and a skill rewrite. |
| D9 | Freeform `dimension_filter` / open GAQL / open Meta fields | Cloud `tools.schema.json` already has `"dimension_filter": { "type": "object" }`. That will ossify into garbage-in. Typed subset now, or a v2 incompatible schema. |
| D10 | Marketplace after Meta App Review | Months of idle public-git delay. Architecture can be one-shot; **listing cannot wait for Meta.** |
| D11 | Meta App Review against an MCP only | Reviewers cannot test. Need a trivial web demo or Advanced `ads_read` never ships. |
| D12 | Unbounded Google JSON as MCP output | GTM tag lists and GSC rows will blow tool-result limits and context. Pagination + `truncated` is a contract; retrofitting changes every fixture. |
| D13 | Write-shaped Ads OAuth without Reporting permissible use and without a hard mutate denylist | First “pause this campaign” that a model tries will mutate if a Mutate path exists. There is no second scope to hide behind. |
| D14 | Putting `services/stamp` secrets or Stripe keys in the plugin package | Marketplace security fail + token leak. Separate deployable from day one. |
| D15 | No privacy policy / terms / homepage | Google sensitive-scope verification and Meta App Review both stop. Not a code task; blocks publish. |

---

## 5. Work product that punches above a startup

### 5.1 Tool contract (every family)

```text
name: ga4_run_report          # underscore, family prefix, 1–64 chars
annotations:
  title: "GA4 run report"
  readOnlyHint: true
  destructiveHint: false
  idempotentHint: true        # retry-safe, not bit-stable
  openWorldHint: true
input: closed JSON Schema (additionalProperties: false)
output envelope:
  ok: boolean
  tool: string
  resource: { type, id, display_name }
  data: ...
  page: { next_page_token, truncated, row_count }
  quota: { ... }              # GA4 propertyQuota, Ads request-id, Meta usage if present
  error_code, message, hint, google_status, google_reason, api
```

No tokens in any payload. `google_whoami` returns email, granted scopes, `expires_in` — never the bearer.

**GA4:** keep the 22-set plus `ga4_list_account_summaries`. `ga4_run_report` metrics/dimensions are strings but **validated against `ga4_get_metadata` when present in cache**, and always against the search-query denylist. Replace freeform `dimension_filter` with a small FilterExpression subset: `and` / `or` / `not` / `string_filter` / `in_list` / `numeric_filter`. Date range max 366 days unless the user passes `allow_long_range: true`.

**GSC:** keep six. Always pass through `data_state`. Never coerce `sc-domain:` vs URL-prefix vs trailing slash.

**GTM:** keep eight. Live vs workspace is a skill **and** a field on tag/trigger/variable list output (`source: workspace | live`).

**GBP (~5):** list accounts, list locations, get location (name, place_id, website, labels — not the whole dump), performance time series, monthly search-keyword impressions.

**Google Ads (closed recipes, ~6 tools not 10):**

| Tool | Job |
| --- | --- |
| `gads_list_accessible_customers` | `customers:listAccessibleCustomers` |
| `gads_get_customer` | descriptive name, currency, time zone |
| `gads_search` | **required** `customer_id` + `recipe` enum: `campaigns` \| `ad_groups` \| `keywords` \| `search_terms` \| `conversion_actions` \| `change_status` \| `policy_topics` \| `performance`. Optional `date_range`, `where` as a closed map (status, campaign_id), `limit` ≤ 1000 |
| `gads_campaign_performance` | can be a recipe; a dedicated tool is fine if the schema is clearer for models |
| `license_status` | features, expiry, gateway reachable; no key material |

The MCP **compiles** the recipe to GAQL. The model never sends raw GAQL in v1. `login-customer-id` is an optional explicit param (MCC); never guessed as “first manager.”

**Meta (~6, not 8 kitchen-sink):** `meta_list_ad_accounts`, `meta_list_campaigns`, `meta_list_adsets`, `meta_list_ads`, `meta_insights` (recipe: account/campaign/adset/ad + date + level), `meta_get_creative` (metadata and image **URLs**, not bytes).

**Identity:** extend `google_whoami` to `whoami` with `connections: [{provider, email_or_id, scopes, expires_in}]` and `license: {ok, features, exp}` — or keep `google_whoami` and add `license_status` only. Do not grow three whoami tools.

### 5.2 Packaging

- Apache-2.0. `UNLICENSED` does not ship.
- `plugin.json` `$schema` Agent Plugins 1.0. Closed top level. DGTL-specific data under `extensions.com.dgtlsunrise`.
- `bin/dgtl-marketing-mcp` is a real executable (Node entry with vendored deps, or a compiled binary). `command` is **one token**, plugin-relative `./bin/...`.
- No `npx` as the marketplace command (network at runtime, supply chain).
- README sections: what it is, what it is not, which host, how to authorize **on that host**, picker rules, non-bugs, paid, support intake, security (tokens never to DGTL for free tier; Ads/Meta gateway for paid).
- `SECURITY.md` checklist matching the cloud `MARKETPLACE.md` plus: gateway allowlist, JWT public key pinning, secret scan, no `developer-token` in fixtures.
- Logo + wordmark for consent screen and marketplace. Commit assets; do not hotlink.

### 5.3 Tests (this is the xAI tell)

CI never opens `googleapis.com`, `graph.facebook.com`, or token endpoints.

| Layer | What |
| --- | --- |
| Spec | Catalog count, every tool name in TOOLS.md, every skill directory, Agent Plugins schemas vendored, secret heuristics |
| Contract | Each tool: JSON Schema in ↔ envelope out. Golden fixtures from synthetic Google/Meta JSON |
| HTTP fake | Mock server asserts **method, path, query, Authorization present, developer-token absent on the client** for Ads. Gateway tests assert the token is attached **only** on the server side |
| Denylist | `searchQuery` → `UNSUPPORTED_DIMENSION` with zero HTTP. Mutate GAQL → reject. Missing `property_id` → `RESOURCE_REQUIRED` |
| Isolation | Fixture with 40 properties; asserting any code path that picks index 0 fails the test |
| Truncation | Oversize GTM list → `truncated: true` + token |
| License | Expired JWT → `LICENSE_REQUIRED` and `ga4_run_report` still works |
| Packaging | `mcp.json` and `.mcp.json` identical modulo filename; `command` exists and `--help` exits 0 |

Record live smokes (Noel’s own login, never client data) into a **gitignored** `smokes/` folder; promote to fixtures only after stripping emails and tokens.

### 5.4 Skills quality

Short, trigger-rich descriptions. No sales copy except the support skill’s one line. Add:

- `license-and-reconnect` — maps `LICENSE_REQUIRED` / `REAUTH_REQUIRED` / `CONSENT_MISSING`
- `gsc-vs-ads-keywords` — join only on two named IDs
- `ga4-vs-ads-conversions` — two numbers, two definitions, no winner
- Keep `gtm-readonly-limits` even when Ads exists so “publish this tag” does not start looking like an Ads write

### 5.5 Observability without a data plane

Local: structured logs to stderr with `tool`, `error_code`, `api`, `duration_ms`, **no auth headers**. Gateway: `request-id` (Google returns one), license `jti`, status, byte count. No payload storage. That is enough to debug `QUOTA_EXCEEDED` without becoming Ryze.

---

## 6. One-shot implementation order (what I would actually run)

**Architecture is one-shot. Listing is incremental.** Grok Build does not wait on Google/Meta humans. Noel starts paperwork the same day.

### Parallel track N — Noel only (day 1, not code)

1. Product display name (or explicit “ship as `dgtl-marketing`, rename later”).
2. GCP project under Sunrise Consulting LLC. OAuth consent External. Enable Analytics Admin, Analytics Data, Search Console, Tag Manager.
3. Desktop **and** Web OAuth clients (Desktop for PKCE fallback; Web only if a gateway login page needs it). No secrets in git.
4. Ads API Center: developer token application, permissible use **Reporting**.
5. GBP Basic API Access form (project number, owner email on a ≥60-day verified profile if required).
6. Meta Business, app, Marketing API product, Tech Provider / Business verification start.
7. Privacy policy + terms + homepage URLs. Logo.
8. Decide billing: invoice vs Stripe Checkout that emails a JWT. Not in the MCP.

### Phase 0 — Import and lock (Grok Build, first session)

Proof: this repo contains the cloud spec (`docs/`, `schemas/v1/`, `skills/`, `fixtures/google/`, `scripts/validate-spec.py`) plus a one-page `ARCHITECTURE-LOCK.md` that states: underscore names, AuthPort, gateway Option A, dual `mcp.json`/`.mcp.json`, 23rd tool `ga4_list_account_summaries`, license JWT shape, TypeScript+REST.

Do not write runtime until that lock file exists. Vendor, don’t paraphrase.

### Phase 1 — Scaffold

- Agent Plugin skeleton, hello tool, fixture runner, vendored Agent Plugins schemas, secret scan, generated `.mcp.json`.
- Error envelope module.
- Proof: `python3 scripts/validate-spec.py` (or the TS equivalent) green; `./bin/dgtl-marketing-mcp` speaks MCP `initialize` + `tools/list`.

### Phase 2 — AuthPort + `google_whoami`

- Host-injected token adapter.
- PKCE fallback writing to `PLUGIN_DATA`, never logging the refresh token.
- Proof: fixture whoami; manual smoke on Noel’s allowlisted tester (email only).

### Phase 3 — 22 tools + 7 skills against fixtures

- Implement families as separate modules: `src/google/ga4`, `gsc`, `gtm`.
- HTTP fake + goldens.
- Proof: all 22 contract tests green; denylist tests green; 40-property isolation test green.

### Phase 4 — Envelope quality

- Pagination, truncation, `resource` block, quota echo, date-range cap.
- Proof: oversize fixture truncates; empty report is `ok: true`.

### Phase 5 — `ga4_list_account_summaries` + picker skill update

- Closed count 23. Version `0.1.0`.
- Proof: one-call agency list fixture.

### Phase 6 — Free-tier packaging for submit (can ship here)

- README per host, SECURITY.md, Apache-2.0, logo placeholder, support skill live.
- Honest auth story. Testing-mode OAuth called out until Google verifies.
- Proof: local Cursor install + Grok Build `--plugin-dir` both list tools.
- **Noel** submits Google verification when the demo video can be recorded. **Noel** opens public git when secret scan is clean. Marketplace PR is Noel’s, after a runtime exists.

### Phase 7 — GBP family, flag off

- Schemas + fixtures + tools. `gbp.enabled` false until quota ≠ 0.
- Consent B documented, not on Consent A.
- Proof: fixture list locations; live smoke only after Google approves the project.

### Phase 8 — License JWT (no gateway yet)

- Ed25519 (or similar) public key in the plugin. `license_status`. Paid tools registered, fail `LICENSE_REQUIRED`.
- Proof: GA4 works without a license; `gads_search` returns `LICENSE_REQUIRED`.

### Phase 9 — Google Ads tools on **user-supplied token** + fixtures

- Recipes compile to GAQL. Mutate denylist. `login-customer-id` explicit.
- Proof: fixture campaigns; live smoke on a **test account** with Test-access token (Noel’s). Production MCC waits on Basic/Explorer.

### Phase 10 — Gateway

- Tiny service: license check, allowlist, attach Ads developer token, forward, no store.
- MCP Ads client: if user token present → local; else → gateway.
- Proof: contract test that the **client** request to Google has no developer-token; gateway test that it does. Chaos: expired license, 429, mutate path rejected.

### Phase 11 — Meta family + same gateway for `appsecret_proof`

- Require App Secret on the Meta app.
- Proof: fixtures; live on DGTL test BM (Standard access, role on the app) until Advanced review lands.
- **Noel** records the App Review demo page (minimal HTML that uses the same read client).

### Phase 12 — Paid packaging

- Feature flags `paid.ads` / `paid.meta`. Skills for joins and license.
- Privacy policy paid paragraph.
- Proof: free tools unaffected if gateway is down.

### Phase 13 — Grok Build catalog PR + Cursor submit (Noel publishes)

- Pin SHA. Keywords scoped. Do not vendor into `xai-org/plugin-marketplace` unless they require it.

### Explicitly not in the one-shot

- Writes, TikTok, Shopify, HubSpot, benchmarks, token vault, hosted GA4, Stripe inside the MCP, staffed support bot, localhost OAuth as the **default** README path.

### Session slicing for Grok Build Heavy

If this is one long Grok Build run: Phase 0–6 in the first run (vendored spec + runnable free plugin + tests). Stop and hand Noel the verification/marketplace checklist. Second run: 7–12 after flags and paperwork exist. Do not cram Meta App Review into the first code session.

---

## 7. What I patched in SCOPE-AND-PLAN.md

Commercial lock left in place (tiers, no writes, no TikTok, stamp *intent*, sequence numbering).

**Patched because they are false as written and would mis-implement:**

- Tool name example is now `ga4_run_report` (underscore), matching the 22-tool catalog.
- Google Ads: there is no readonly OAuth scope; `adwords` is the scope; readonly is tools + Reporting permissible use + user role.
- GBP: only `business.manage`; Performance API does not list locations; project needs Basic API Access (quota 0 until approved).
- New §12 errata listing those facts plus: stdio Connect card is not a Cursor feature; Ads developer token is a static header; Grok Build wants `.mcp.json`.

**Not patched (recommendations live here, not as a silent SCOPE rewrite):**

- Gateway vs stamp (product/architecture; Noel should accept Option A).
- Submit-after-free-tier vs submit-after-Meta.
- 23rd GA4 summaries tool.
- TypeScript lock.

---

## 8. Open questions that still belong to Noel

These should not block Phase 0–6.

- Public product name.
- Accept Ads/Meta **credential plane** (Option A) vs drop default paid Ads to “bring your own developer token.”
- Stripe vs invoice.
- Whether to list on Cursor while the Google OAuth client is still in testing (honest README vs wait).
- Display name vs package id if Meta is in-scope (`dgtl-marketing` vs keep google in the id).

When Noel says Grok Build go: start at Phase 0 (vendor the 22-tool spec into this repo), not at a blank MCP.
