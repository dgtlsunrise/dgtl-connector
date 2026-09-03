# Product

Working title: **dgtl-google-marketing**. Publisher: **DGTL Sunrise** (Sunrise Consulting LLC). Contact: **noel@dgtlsunrise.com**. Author name on the plugin: **DGTL Sunrise**.

This document is the business spec. Architecture, tools, and marketplace process live in sibling docs.

## Locked decisions

These are not open questions. Implementation later must obey them.

1. **Grok Bot / Cursor plugin people install.** They authorize **their own** Google accounts. Tools run on **their** Grok Bot computer (or the equivalent Cursor host process). **No DGTL data plane in v1. No DGTL token vault.**
2. **Free:** everything that can run locally. **Paid hosted later only** for things a public plugin cannot hold (shared Google Ads developer token, Meta app secret, agency token vault). **Not a $5–10 SaaS.**
3. **v1 APIs (readonly):** GA4 Admin + Data v1beta (`analytics.readonly`), Search Console (`webmasters.readonly`), Tag Manager v2 (`tagmanager.readonly`). **GTM is in v1. Do not defer.**
4. **v1 must not include** Google Ads, Meta Ads, GBP, write/publish, Gmail, Drive.
5. **One Google consent** with all three readonly product scopes. Not sequential per-product tokens.
6. **Published auth transport** is a **platform connect card / MCP OAuth**. `google-auth-oauthlib` local-server PKCE is a **test harness only**.
7. **OAuth client ID** may belong to DGTL's Google Cloud project. **Refresh tokens stay in the user's connector store.** Never commit secrets.
8. **Explicit picker** for property / site / GTM account (and container/workspace). Never silently pick the first of 40 clients.
9. **Skills refuse hallucinated metrics.** Document non-bugs (see [ERRORS.md](ERRORS.md)).
10. **Support skill:** diagnose OAuth / empty property / quota; after a real answer, **one optional line** that DGTL can run this as a client. Never pitch on every how-to. Never collect refresh tokens.
11. **Marketplace:** public git when submitting; Cursor at `cursor.com/marketplace/publish`; Grok Build PR to `xai-org/plugin-marketplace` later. Format: **Agent Plugin first** (portable), Cursor extras only if they help Grok Bot.
12. **Do not clone Ryze.** Ship the missing first-party-shaped Google marketing connector.

## Goals

### User goal

Ask an agent, in plain language, for marketing facts that already live in **their** GA4, Search Console, and Tag Manager — sessions, channels, landing pages, search queries, URL index state, which tags are actually published — without exporting CSVs or granting a third-party hosted brain write access to ads accounts.

### DGTL Sunrise goal

A **calling card**. Inbound clients can install the same plugin DGTL talks about. The product demonstrates how DGTL thinks about Google marketing data: first-party, least privilege, no silent client mixing, honest about API limits.

Inbound is a consequence of being useful and public, not of wrapping every support reply in a sales paragraph.

### Non-goals (v1)

- Autopilot bid changes, budget pacing, or multi-network ads.
- Becoming the system of record for tokens or client lists.
- A usage-based $5–10/month “pro” gate in front of GA4/GSC/GTM reads.
- A kitchen-sink “query Google” mega-tool.

## Parties

| Party | Role | Does not |
| --- | --- | --- |
| **Noel / DGTL Sunrise (Sunrise Consulting LLC)** | Spec owner, publisher of record, Google Cloud project owner for the OAuth **client ID**, future marketplace submitter, future support agent | Hold user refresh tokens; proxy v1 Google traffic; mix Axos or Breakwater data into this repo |
| **End user** | Installs plugin, authorizes **their** Google account, picks properties, asks questions | Need a DGTL account; need to enable APIs on DGTL's Cloud project (publisher does that) |
| **Agency end user** | Same, but the Google account may see 40 properties across clients | Get a default “first property”; have DGTL infer the client |
| **xAI / Cursor review** | Marketplace security and quality bar | Operate Google OAuth verification |
| **Google OAuth verification** | Brand + sensitive-scope review for the OAuth client | Review the Cursor plugin git (separate) |
| **Future support agent** (human or Grok, following [SUPPORT_AND_CLIENTS.md](SUPPORT_AND_CLIENTS.md)) | Diagnose install/API failures from **non-secret** intake fields | Collect tokens; pitch on every ticket |
| **Future paid hosted** (v2) | Optional Ads/Meta/vault plane the user can ignore | Rewrite or replace local GA4/GSC/GTM |

## Touch points and approvals

Order is product logic, not a calendar.

| # | Touch point | Who approves | Exit criterion |
| --- | --- | --- | --- |
| 1 | This spec repo (private) | Noel | Files in the proof-of-done list exist; tool list closed; scopes exact |
| 2 | Runtime implementation (later commit / later repo) | Noel | Fixture tests pass; no live Google in CI; connect-card auth, not local-server PKCE |
| 3 | Google Cloud: enable four APIs + OAuth consent screen (External) with **only** v1 scopes | Noel | APIs enabled on the **OAuth client's** project; no extra scopes “for later” |
| 4 | Platform redirect URIs registered on the OAuth client (Cursor / Grok Bot callbacks) | Noel + platform docs | Connect card completes without `redirect_uri_mismatch` |
| 5 | Google brand verification + sensitive-scope verification | Google | Production users beyond the testing cap; demo video of **read** flows only |
| 6 | Public git + LICENSE | Noel | Repo public **only** when ready to submit; still no secrets |
| 7 | Cursor Marketplace submit (`cursor.com/marketplace/publish`) | Cursor review | Listed; connect card works in Grok Bot and Cursor |
| 8 | Grok Build catalog PR (`xai-org/plugin-marketplace`) | xAI review | Pinned SHA; remote source |
| 9 | Optional v2 hosted Ads/Meta | Noel + Google Ads API / Meta App Review | Separate MCP server; local v1 unchanged |

Noel does not need Cursor or Google approval to **write this spec**. Those approvals gate **publish**, not planning.

## Positioning vs Ryze

Ryze (`connector.get-ryze.ai`) is a hosted MCP: Google Ads, Meta, TikTok, GA4, GSC, Shopify; approval-gated writes; roughly $89 autopilot.

We are not a cheaper Ryze.

| | Ryze | dgtl-google-marketing v1 |
| --- | --- | --- |
| Where tools run | Their host | User's Grok Bot computer |
| Who holds tokens | Their connector | User's platform connector store |
| Ads networks | In scope | Out of v1; hosted later if ever |
| Writes | Approval-gated | None |
| GTM | Not the differentiator | In v1, readonly |
| Price | Hosted product | Free local; hosted only when unavoidable |

The product sentence: **your Google marketing properties, in your agent, with your consent, without a DGTL proxy.**

## Success (v1, after runtime)

- A user with 1 GA4 property can get a channel report and a GSC query report in one conversation, with resource IDs visible in the answer.
- A user with 40 properties is **stopped and asked** which client, every time the resource is ambiguous.
- Asking “what are my search queries in GA4?” is refused with the GSC path, not a hallucinated dimension.
- Asking “publish this GTM tag” is refused; live vs workspace is explained.
- 403 `accessNotConfigured` names **which API** to enable (dev) or tells the user it is a publisher defect (prod).
- Support can diagnose from plugin version + API error + property ID **without** a refresh token.
- Secret scan of the git repo is clean.

## Internal constraints

- **Off the Axos Bank clock.** Do not use Axos time, hardware policy, or data for this product.
- **Never** include Breakwater client data, SAM, or site copy. Fixtures are synthetic (`Example Brand`, `sc-domain:example.com`).
- Do not put client names from DGTL's book of business into skills, README, or error examples.

## Rename

`dgtl-google-marketing` is a working title. If renamed, change `plugin.json` `name`, MCP server key, skill text, and marketplace id together. Do not leave a second plugin id.
