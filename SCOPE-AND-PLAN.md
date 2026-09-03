# DGTL Google Marketing plugin — complete scope and development plan

Status: planning. No implementation until Noel says Grok Build go.
Owner: DGTL Sunrise / Sunrise Consulting LLC (`noel@dgtlsunrise.com`)
Clock: DGTL product, never Axos.
Token split: this chat = product/review. Grok Build (Heavy) = code/tests. No more Cursor cloud agents unless Noel asks.
Date locked: 2026-09-02

## 1. Product

A Grok Bot / Cursor / Grok Build plugin. User installs it, signs into their own Google (and later Meta) accounts, and their **own bot computer** calls the APIs. DGTL does not see report bytes.

Two tiers:

| Tier | What | Why it is this tier |
| --- | --- | --- |
| Free | GA4, Search Console, Tag Manager, Google Business Profile. All readonly. | GA4/GSC/GTM: user OAuth, no DGTL secret. GBP: same OAuth model, but DGTL’s GCP project must be approved for GBP API access (quota 0 until then). |
| Paid | Google Ads readonly + Meta Ads readonly | Needs DGTL's Google Ads **developer token** and DGTL's **Meta app**. Intent: credential stamp, not an analytics warehouse. See §12 for how that is actually implemented. |

Writes (pause campaign, change budget, publish GTM, submit sitemap) are **out of v1**. Paid unlock is access, not autopilot.

Not in v1: TikTok, Shopify, HubSpot, Gmail, Sheets, ClickUp, organic Instagram, LinkedIn Ads, Microsoft Ads. Gmail/Sheets already have first-party plugins.

Name (working): `dgtl-google-marketing`. Rename before submit.

## 2. Bar (xAI-shaped, not startup-shaped)

- Closed tool list, typed JSON, versioned (`ga4_run_report`, not `queryAnything`). Names are underscore, matching the 22-tool catalog. Do not use dotted names.
- One consent for **GA4 + GSC + GTM** readonly. GBP is a **second**, optional Google grant (`business.manage`) even though GBP is free-tier commercially. Paid Google Ads is extra Ads scope + license. Meta is a second OAuth.
- Property/account picker. Never "first of 40 clients."
- Skills refuse hallucinated metrics. GSC holds search queries; GA4 does not.
- Errors are codes (`ACCESS_NOT_CONFIGURED`, `LICENSE_REQUIRED`, `REAUTH_REQUIRED`) plus a human line.
- Fixture tests from recorded API JSON. No live Google in CI.
- Public git for marketplace review. No secrets in git.
- Easy to extend: new API = new tool family + skill, not a rewrite.

Existing 22-tool spec (cloud agent bc-a4346943) is the free-tier baseline. It is **not** the full product. Ads/Meta/GBP/license still need spec + code in Grok Build.

## 3. Parties and approvals

| Party | Touch | Gate |
| --- | --- | --- |
| Noel / DGTL | Product, GCP project, Ads developer token application, Meta Business app, Stripe/license, marketplace PR, support agent | Spend, publish, legal |
| End user | Install, Google OAuth, optional Meta OAuth, optional paid license, their bot computer | Their Google/Meta admin |
| xAI / Cursor | Public repo, plugin.json, no secrets, honest README | Marketplace listing |
| Google Cloud | OAuth verification, sensitive scopes | Branding + verification |
| Google Ads API | Developer token (test then basic/standard) | Token application; weeks |
| Meta | App + Marketing API + App Review (ads_read) | Business verification |
| Support agent | How-to, Enable APIs, property IDs | Never tokens, never mutate |
| Paying subscriber | License key → DGTL stamp service | Billing |

## 4. Architecture

```
FREE
  User computer: plugin MCP
    Google OAuth (connect card)
    --> GA4 / GSC / GTM / GBP APIs

PAID
  User computer: same MCP
    Google Ads OAuth + Meta OAuth
    --> DGTL stamp service (license check, attach Ads developer token / Meta app proof)
    --> Ads / Meta APIs from the user computer
```

Stamp service is small: authz, not analytics. No storage of GA4/GSC/Ads report payloads. License miss → `LICENSE_REQUIRED` and the free tools still work.

User-supplied Ads developer token can remain as a power-user escape (fully offline paid-equivalent). Not the default.

**Implementers:** the Ads developer token is a static header; Google documents no “stamp” other than holding it on infrastructure DGTL controls. See §12 and `SECOND-OPINION.md` (gateway vs token-on-the-box). Do not ship DGTL’s developer token inside the plugin or to `PLUGIN_DATA`.

## 5. Permissions (v1)

Free Google consent (one screen):

- `https://www.googleapis.com/auth/analytics.readonly`
- `https://www.googleapis.com/auth/webmasters.readonly`
- `https://www.googleapis.com/auth/tagmanager.readonly`

GBP (free commercially, **not** on the GA4/GSC/GTM consent screen):

- There is no GBP read-only OAuth scope. Account Management, Business Information, and Performance all require `https://www.googleapis.com/auth/business.manage` (user-visible: manage Business Profile). Performance API does **not** list locations.
- DGTL’s GCP project must be approved for GBP **Basic API Access**; until then quota is 0. Feature-flag GBP off until quota is non-zero.
- Tools stay readonly; refuse posts/replies/edits. Closed set (~3–5), not the whole My Business API.

Paid Google Ads (second grant):

- Google Ads API has **one** OAuth scope: `https://www.googleapis.com/auth/adwords` (“See, edit, create, and delete”). There is no reporting-only OAuth scope (Ad Manager `admanager.readonly` is a different product).
- Readonly is enforced by: no mutate tools; developer token permissible use **Reporting**; the user’s Ads role; MCP `readOnlyHint: true`.

Paid Meta:

- `ads_read` (and `business_management` only if required to list ad accounts). No `ads_management` in v1.

## 6. Closed tool families (v1)

**Free (already specified, 22 tools):** whoami, GA4 list/get/metadata/runReport, GSC list/query/inspect/sitemaps, GTM list accounts/containers/workspaces/tags/triggers/variables/live version.

**Free add:** GBP list locations + performance (small closed set, ~3–5 tools). Do not dump the whole My Business API.

**Paid Google Ads (new, closed, ~10 tools):** list accessible customers, list campaigns, campaign performance, ad groups, keywords, search terms, conversion actions, change history read, account warnings/policy. No mutate.

**Paid Meta Ads (new, closed, ~8 tools):** list ad accounts, campaigns, ad sets, ads, insights, creatives (read). No mutate.

Skills to add: `gsc-vs-ads-keywords` (cannibalization join), `ga4-vs-ads-conversions` (do not pick a "true" attribution), `license-and-reconnect`, keep `no-hallucinated-metrics` and `agency-property-isolation`.

## 7. Development sequence (Grok Build)

Do not start all APIs at once. Each phase has a proof.

1. **Scaffold** Agent Plugin: `plugin.json`, local stdio MCP hello, fixture test runner, `validate-spec.py` equivalent.
2. **Free Google OAuth** on the bot computer (connect card or documented fallback). Proof: whoami returns the signed-in email.
3. **GA4 + GSC + GTM** implementing the existing 22 tools against fixtures, then a live smoke on DGTL's own Google login. Proof: `SPEC` tests green; one live runReport + searchanalytics + gtm list.
4. **GBP** readonly. Proof: list locations for the test login.
5. **License stamp service** (minimal: signed license, expiry, no PII). Proof: free tools work with no license; Ads tools return `LICENSE_REQUIRED`.
6. **Google Ads readonly** using DGTL developer token stamp. Proof: list campaigns on a DGTL test MCC/account.
7. **Meta Ads readonly**. Proof: list ad accounts on DGTL test BM.
8. **Marketplace packaging**: README, security review checklist, Cursor submit + Grok Build `xai-org/plugin-marketplace` PR (Noel publishes).
9. **Support agent skill** only after 4. Do not staff it before users.

Each API is a folder. Adding LinkedIn later must not touch GA4.

## 8. What "easy to modify" means in the repo

- `packages/mcp` tools as one file per tool family
- `packages/google` and `packages/meta` clients behind interfaces
- `packages/license` isolated
- `fixtures/` recorded JSON
- `skills/` independent of tool code
- Feature flags: `paid.ads`, `paid.meta` default off until license verifies

## 9. Support and clients

- Support diagnoses Enable-API 403s, missing property ID, expired consent, license not activating.
- After a real fix, one line: DGTL can run this as an engagement.
- Intake: plugin version, error code, property/account ID. Never refresh tokens, never Ads MCC passwords.
- Paid subscribers are not automatically consulting clients.

## 10. Still open (do not block spec; block publish)

- Public product name
- Google Cloud project under Sunrise Consulting LLC
- Ads developer token application (start early; Google is slow)
- Meta Business verification
- License billing (Stripe vs invoice vs plugin store). Not $5–10.
- Whether Grok third-party plugins get a platform connect card (as of this date, Cursor documents stdio MCP auth as Manual; Connect/OAuth is for remote HTTP MCP)

## 11. Done when (before Grok Build)

- This file + the 22-tool spec agree on free tier
- Ads/Meta/GBP tool names listed (section 6) — **names exist; JSON schemas still to be written in Grok Build phase 1, not guessed here**
- Noel has agreed the paid unlock is Ads+Meta only

JSON schemas for Ads/Meta/GBP are the first Grok Build task, not a second Cursor cloud agent.

## 12. Errata (second opinion, 2026-09-02)

Factual corrections. Commercial lock in §§1–3 is unchanged. Full argument: `SECOND-OPINION.md`.

1. **22-tool split** is 1 identity + 7 GA4 + 6 GSC + 8 GTM (not 8/6/7). Names live in the cloud spec catalog (`google_whoami`, `ga4_*`, `gsc_*`, `gtm_*`). Vendor that spec before coding.
2. **Cursor/Grok Bot stdio MCP auth is Manual.** OAuth Connect cards apply to **remote HTTP/SSE** MCP servers (`auth.CLIENT_ID`). Agent Plugins 1.0 has no portable OAuth fields. Grok Build wants **`.mcp.json`** (dotfile) in addition to Agent Plugins `mcp.json`. Dual-emit from one source.
3. **Google Ads developer token is a static `developer-token` header**, treated by Google as a password. There is no HMAC stamp. Putting the token on the user computer is credential distribution (ToS/security). Policy-correct default paid path is a DGTL **allowlisted gateway** that attaches the token; Ads bytes transit DGTL and are not stored. User-supplied token remains a power-user bypass. End-advertisers must not be required to apply for their own developer token.
4. **Meta `Require App Secret` / `appsecret_proof`** likewise requires a backend. Same gateway.
5. **GBP APIs are access-request-gated** on the GCP project (Basic API Access; quota 0 until approved). Not “just OAuth.”
6. Implementers follow this errata + `SECOND-OPINION.md` for API facts, packaging, and paid topology. Do not chase a narrower Ads OAuth scope or a Performance-only GBP scope.
