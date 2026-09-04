# Architecture

**Lock:** `ARCHITECTURE-LOCK.md`, `SECOND-OPINION.md`, and [ops/PRODUCT-DESIGN.md](ops/PRODUCT-DESIGN.md) override this file on auth, paid topology, and packaging. stdio auth is **AuthPort** (host-injected token, then installed-app PKCE). There is no Gmail-style Connect card for stdio. Paid Ads/Meta use a DGTL allowlisted gateway in the **same** plugin (not a second MCP; not in this package yet). This file is the vendored cloud spec; keep it for the **23**-tool free kernel and error/non-bug discussion.

v1 is a **local MCP server** packaged as an **Agent Plugin**. Google API calls for GA4 / GSC / GTM leave the **user's** computer **directly to Google**. DGTL Sunrise is not on that path.

## Why local

Locked: no DGTL data plane, no DGTL token vault.

If v1 were a DGTL-hosted Streamable HTTP MCP, DGTL would see access tokens and marketing payloads. That is a different product (closer to Ryze) and is **out of v1**.

Grok Bot gives each member a dedicated computer (managed Linux VM). Cursor and Grok Build can run stdio MCP. The portable package is Agent Plugins 1.0:

- `plugin.json` at repo root
- `mcp.json` declaring a **stdio** server
- `skills/*/SKILL.md`

Agent Plugins 1.0 **defines no portable OAuth fields**. Authentication is **client-managed**. Locked transport for stdio is **AuthPort** (host-injected token, then installed-app PKCE). Do **not** put a client secret in `mcp.json` or the binary; Desktop `/token` uses gitignored `.env` `GOOGLE_OAUTH_CLIENT_SECRET` only.

## Building blocks

```text
 User
   │  install plugin (git / marketplace)
   │  AuthPort: host-injected token  OR  Desktop PKCE (auth login)
   │  Google consent = Consent A (one screen, three readonly product scopes)
   v
 Token store (host-injected  OR  PLUGIN_DATA/google-oauth.json mode 0600)
   │  refresh token  — user-owned, never DGTL, never git
   │  short-lived access token in MCP process
   v
 stdio MCP on the user's computer
   │  free tools from docs/TOOLS.md / schemas/v1/catalog.json (23, closed)
   v
 Google APIs (OAuth client project's APIs must be Enabled)
   ├── analyticsadmin.googleapis.com   GA4 Admin v1beta
   ├── analyticsdata.googleapis.com    GA4 Data v1beta
   ├── searchconsole.googleapis.com    Search Console + URL Inspection
   └── tagmanager.googleapis.com       Tag Manager v2
```

DGTL's Google Cloud project may **own the OAuth client ID** (so Google shows a DGTL Sunrise consent screen and DGTL can complete verification). That is **not** a data plane. The client ID is a public identifier. For Desktop PKCE, Google still issues a client secret used at `/token` — put it only in gitignored `.env` as `GOOGLE_OAUTH_CLIENT_SECRET` (never git, chat, `mcp.json`, or the binary).

## Token flow (published plugin — AuthPort)

1. User installs the plugin.
2. **Preferred:** host injects a short-lived access token (`GOOGLE_ACCESS_TOKEN`, optional granted-scopes / email env).
3. **Fallback:** user runs `dgtl-marketing-mcp auth login` (installed-app PKCE, Desktop client, loopback `127.0.0.1:<port>/callback`).
4. Google returns an authorization code to loopback (or the host). Exchange uses PKCE; Desktop clients also send `GOOGLE_OAUTH_CLIENT_SECRET` from gitignored `.env` at `/token`.
5. **Refresh token** stays user-owned: host connector store **or** `PLUGIN_DATA/google-oauth.json` (mode 0600) for the PKCE path.
6. On tool call, MCP uses the access token. Implementers do **not** invent a DGTL Google-token exchange endpoint for Consent A.
7. MCP calls Google with `Authorization: Bearer <access_token>`.
8. Tool results return to the agent. Consent A payloads do not transit DGTL.

### Not a Connect card

There is **no** Gmail-style Connect card for third-party **stdio** MCP on today's Cursor / Grok Bot hosts. Do not document or demo a Connect card for this package. Remote-HTTP Connect cards are a later **host** feature, not this plugin’s identity.

### Granular consent

Google may let the user uncheck a scope. `google_whoami` reports granted scopes. A GTM tool with only GA4+GSC granted returns `CONSENT_MISSING` for `tagmanager.readonly`, not a generic 401. Do not start a second OAuth dance per product; re-run AuthPort (`auth login` or host re-inject) and grant all three Consent A product scopes on the **same** Desktop client.

### Expired / revoked consent

Refresh token revoked, password change, or unused-token expiry → tools return `REAUTH_REQUIRED`. Skill tells the user to reconnect via AuthPort (host-injected token or `auth login`), not a Connect card. Support never asks for the refresh token.

## What runs where

| Component | Where | Notes |
| --- | --- | --- |
| Skills | Loaded by the host from `skills/` | No network |
| MCP stdio process | User's Grok Bot computer or local Cursor/Grok Build | Placeholder command in `mcp.json` |
| Google OAuth client ID | DGTL GCP project (likely) | Public; placeholder in spec stubs |
| OAuth client secret | Gitignored `.env` (`GOOGLE_OAUTH_CLIENT_SECRET`) for Desktop `/token` | **Never** in git, chat, `mcp.json`, or binary |
| Refresh token | Host connector store **or** `PLUGIN_DATA/google-oauth.json` (PKCE) | **Never** in git or support tickets |
| Access token | Memory of host + MCP process | Never logged |
| Property picker state | Conversation + explicit tool params | **Not** a hidden default in PLUGIN_DATA across clients |

### PLUGIN_DATA

Hosts provide `PLUGIN_DATA`. **Allowed:** PKCE token store `google-oauth.json` (mode 0600); later Consent W/C stores; optional `license.jwt`; optional local audit jsonl. **Never-list as sticky defaults:** do not persist “active client = first property” across sessions. Resource IDs are required parameters on every data tool. v1 **may** cache metadata (dimension catalogs) keyed by `properties/{id}` with a short TTL.

## If a host cannot run stdio

Some custom-connector UIs only accept a public HTTPS MCP URL. That does **not** authorize a DGTL proxy.

Allowed adaptations without changing the product:

1. Host runs the same stdio server **on the Bot computer** and exposes it to the agent (marketplace plugin path).
2. User (or their IT) hosts the MCP themselves.

Not allowed in v1: DGTL-operated `https://mcp.dgtlsunrise…` that takes user Google tokens.

If marketplace review requires Streamable HTTP, the URL still must terminate on **user-controlled** infrastructure, or the host's own managed runner — not DGTL.

## Google project vs user properties

`403` `accessNotConfigured` is about APIs **Enabled on the OAuth client's Cloud project**, not “the user forgot to turn on GA4.”

| Project | Who | Must enable |
| --- | --- | --- |
| DGTL OAuth client project (production) | Noel | All four APIs **before** publish |
| User's own GCP project (dev harness) | Whoever created that OAuth client | Same four APIs, or Tag Manager/GSC/GA4 calls 403 |

Users do **not** enable APIs on DGTL's project. If production users hit `accessNotConfigured`, it is a **publisher defect**.

User **property** access is separate: they need Viewer (or equivalent) on the GA4 property, a Search Console permission on the site, and a GTM account permission. Missing those is `PERMISSION_DENIED` / empty lists, not `accessNotConfigured`.

## Tool design

Small typed tools. No `google_query({sql})`. No “fetch everything for this brand.”

Rules:

- Every GA4 data/admin-beyond-list tool requires `property_id` (`properties/{number}`).
- Every GSC tool except `gsc_list_sites` requires `site_url`.
- Every GTM tool except `gtm_list_accounts` requires `account_id`; container-level tools require `container_id`; workspace-level tools require `workspace_id`.
- List tools exist so the agent can **show a picker**. Skills forbid auto-selecting index 0 when `length != 1`.
- `ga4_run_report` is the only GA4 report tool. No batch, funnel, or realtime in v1 (quota + complexity).
- Read calls are **retry-safe**. They are not snapshot-stable (processing lag).

Closed free list: [TOOLS.md](TOOLS.md). Machine copy: `schemas/v1/catalog.json` (`count`: **23**). Write/publish stubs (if registered) are gated (`WRITE_NOT_ENABLED` / Consent W) and are **not** Consent A listing promises.

## How paid hosted Ads plugs in without rewriting GA4

**PRODUCT-DESIGN + ARCHITECTURE-LOCK win:** paid Ads/Meta are tools in the **same** plugin that call a DGTL Worker — **not** a second MCP server. (Older “second MCP” wording in [V2_HOSTED.md](V2_HOSTED.md) is superseded.)

- GA4/GSC/GTM tools keep the same names and IDs on Consent A.
- Ads/Meta tools are new names (`gads_*`, `meta_*`), never overloads of `ga4_run_report`.
- Skills: if the user asks for spend/ROAS and license/Worker is absent, say so; still offer GA4/GSC.
- The local free path must not start requiring a DGTL account.

See [V2_HOSTED.md](V2_HOSTED.md) and [ops/PRODUCT-DESIGN.md](ops/PRODUCT-DESIGN.md).

## Secrets and logging

Never:

- Commit client secrets, refresh tokens, service account JSON, or `token.json`
- Return tokens from any tool (including `google_whoami`)
- Log `Authorization` headers
- Persist sticky “default property” picker state in `PLUGIN_DATA`

PKCE may write `PLUGIN_DATA/google-oauth.json` (mode 0600). That is the AuthPort fallback store, not a picker default.

`google_whoami` may return email, granted scopes, and `expires_in` seconds.

## Extension point for implementers

When a runtime is written (later):

- Language is not locked here. Prefer whatever the marketplace runner can execute without a DGTL service.
- Map each tool in [TOOLS.md](TOOLS.md) 1:1 to a Google method. Do not add undeclared tools in the same version.
- Auth: AuthPort — host-injected access token preferred; else PKCE store. Refresh is host or local PKCE refresh, never DGTL.
- Tests: replay `fixtures/google/**` — [TEST_PLAN.md](TEST_PLAN.md).

Label any exploratory `googleapiclient` snippet **NOT FOR SHIP**. This spec repo should not contain that snippet.
