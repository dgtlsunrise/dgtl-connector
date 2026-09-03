# Architecture

**Lock:** `ARCHITECTURE-LOCK.md` and `SECOND-OPINION.md` override this file on auth, paid topology, and packaging. stdio auth is **AuthPort** (host-injected token, then installed-app PKCE). There is no Gmail-style Connect card for stdio. Paid Ads/Meta use a DGTL allowlisted gateway (not in this package). This file is the vendored cloud spec; keep it for the 22-tool kernel and error/non-bug discussion.

v1 is a **local MCP server** packaged as an **Agent Plugin**. Google API calls for GA4 / GSC / GTM leave the **user's** computer **directly to Google**. DGTL Sunrise is not on that path.

## Why local

Locked: no DGTL data plane, no DGTL token vault.

If v1 were a DGTL-hosted Streamable HTTP MCP, DGTL would see access tokens and marketing payloads. That is a different product (closer to Ryze) and is **out of v1**.

Grok Bot gives each member a dedicated computer (managed Linux VM). Cursor and Grok Build can run stdio MCP. The portable package is Agent Plugins 1.0:

- `plugin.json` at repo root
- `mcp.json` declaring a **stdio** server
- `skills/*/SKILL.md`

Agent Plugins 1.0 **defines no portable OAuth fields**. Authentication is **client-managed**. That matches the locked transport: **platform connect card / MCP OAuth**, not a client-secret in `mcp.json`.

## Building blocks

```text
 User
   │  install plugin (git / marketplace)
   │  Connect card → Google consent (one screen, three product scopes)
   v
 Host connector store   (Cursor / Grok Bot / Grok Build)
   │  refresh token  — user-owned, never DGTL, never git
   │  short-lived access token injected into MCP process
   v
 stdio MCP on the user's computer
   │  tools from docs/TOOLS.md (22, closed)
   v
 Google APIs (OAuth client project's APIs must be Enabled)
   ├── analyticsadmin.googleapis.com   GA4 Admin v1beta
   ├── analyticsdata.googleapis.com    GA4 Data v1beta
   ├── searchconsole.googleapis.com    Search Console + URL Inspection
   └── tagmanager.googleapis.com       Tag Manager v2
```

DGTL's Google Cloud project may **own the OAuth client ID** (so Google shows a DGTL Sunrise consent screen and DGTL can complete verification). That is **not** a data plane. The client ID is a public identifier. The client secret, if the platform requires a confidential web client, lives in the **publisher console / Google Cloud**, not in this repo, not in the plugin package.

## Token flow (published plugin)

1. User installs the plugin.
2. Host shows **Authorize / Connect**. User completes Google OAuth in the browser.
3. Redirect URI is a **platform** callback (Cursor / Grok Bot), not `localhost` from `run_local_server`.
4. Google returns an authorization code to the **host**. Host exchanges it (PKCE and/or platform-held client secret).
5. **Refresh token** is stored in the **user's connector store**.
6. On tool call, host attaches a fresh **access token** to the MCP process. Exact injection is host-defined (env, MCP auth context). Implementers follow the host; they do **not** invent a DGTL exchange endpoint.
7. MCP calls Google with `Authorization: Bearer <access_token>`.
8. Tool results return to the agent. Payloads do not transit DGTL.

### Forbidden published path

`google_auth_oauthlib.flow.InstalledAppFlow.run_local_server` (or any loopback PKCE the **plugin** opens itself) is **not** the marketplace auth path. It already worked as a **test harness** for proving GSC/GTM/GA4 reads. Keep that story in “Proven”; do not package it.

### Granular consent

Google may let the user uncheck a scope. `google_whoami` reports granted scopes. A GTM tool with only GA4+GSC granted returns `CONSENT_MISSING` for `tagmanager.readonly`, not a generic 401. Do not start a second OAuth dance per product; send the user back to the **same** connect card to re-grant.

### Expired / revoked consent

Refresh token revoked, password change, or unused-token expiry → host marks the connector as needing reauth. Tools return `REAUTH_REQUIRED`. Skill tells the user to use the Connect card again. Support never asks for the refresh token.

## What runs where

| Component | Where | Notes |
| --- | --- | --- |
| Skills | Loaded by the host from `skills/` | No network |
| MCP stdio process | User's Grok Bot computer or local Cursor/Grok Build | Placeholder command in `mcp.json` |
| Google OAuth client ID | DGTL GCP project (likely) | Public; placeholder in spec stubs |
| OAuth client secret | Google Cloud / publisher settings **if** required | **Never** in git |
| Refresh token | User connector store | **Never** in git, PLUGIN_DATA, support tickets |
| Access token | Memory of host + MCP process | Never logged |
| Property picker state | Conversation + explicit tool params | **Not** a hidden default in PLUGIN_DATA across clients |

### PLUGIN_DATA

Hosts provide `PLUGIN_DATA`. v1 **may** cache metadata (dimension catalogs) keyed by `properties/{id}` with a short TTL. v1 **must not** persist “active client = first property” across sessions. Resource IDs are required parameters on every data tool.

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

Closed list: [TOOLS.md](TOOLS.md). Machine copy: `schemas/v1/catalog.json` (`count`: **22**).

## How v2 hosted Ads plugs in without rewriting GA4

v2 adds a **second** MCP server (or a second plugin) for credentials a public plugin cannot hold.

```text
 mcp.json (future, illustrative — not v1)
   dgtl-google-marketing     stdio, local, GA4/GSC/GTM (unchanged)
   dgtl-google-ads-hosted    streamable-http, optional, user opt-in
```

- GA4/GSC/GTM tools keep the same names and IDs.
- Ads tools are new names (`gads_*`), never overloads of `ga4_run_report`.
- Skills learn: if the user asks for spend/ROAS and the hosted server is absent, say so; still offer GA4/GSC.
- The local server must not start requiring a DGTL account.

See [V2_HOSTED.md](V2_HOSTED.md).

## Secrets and logging

Never:

- Commit client secrets, refresh tokens, service account JSON, or `token.json`
- Return tokens from any tool (including `google_whoami`)
- Log `Authorization` headers
- Write tokens into `PLUGIN_DATA`

`google_whoami` may return email, granted scopes, and `expires_in` seconds.

## Extension point for implementers

When a runtime is written (later):

- Language is not locked here. Prefer whatever the marketplace runner can execute without a DGTL service.
- Map each tool in [TOOLS.md](TOOLS.md) 1:1 to a Google method. Do not add undeclared tools in the same version.
- Auth: consume host-injected access token; refresh is the host's job.
- Tests: replay `fixtures/google/**` — [TEST_PLAN.md](TEST_PLAN.md).

Label any exploratory `googleapiclient` snippet **NOT FOR SHIP**. This spec repo should not contain that snippet.
