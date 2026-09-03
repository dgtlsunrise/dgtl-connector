# Architecture lock — DGTL marketing plugin

Status: locked for Phase 0–6 implementation (2026-09-02).
Sources: `SECOND-OPINION.md` (architecture), `SCOPE-AND-PLAN.md` (commercial tiers).
Cloud spec vendored from Cursor agent `bc-a4346943` into `docs/`, `schemas/v1/`, `skills/`, `fixtures/google/`, `scripts/validate-spec.py`.

This file is the one-page lock. Do not relitigate it in code review.

## Names

- Package / plugin id: `dgtl-marketing` (survives a display-name change; Noel names the listing).
- Tool names: **underscore**, family prefix (`ga4_run_report`). Never dotted.
- Closed free kernel: the **22** tools named in SECOND-OPINION plus **`ga4_list_account_summaries`** (23). Version `0.1.0`.

## Auth (AuthPort)

Cursor / Grok Bot **stdio MCP auth is Manual**. Connect cards are for remote HTTP MCP. Agent Plugins 1.0 has no portable OAuth fields.

Adapters, interface `AccessTokenSource`, first match wins:

1. **Host-injected** access token (env / future MCP auth context).
2. **Installed-app PKCE** fallback (public Desktop client, loopback, tokens in `PLUGIN_DATA`). Documented advanced path. Never a fake vault.
3. **Never** embed a confidential web-client secret in the binary or git.

README must tell this truth. Do not describe a Gmail-style Connect card for stdio.

Consent A (this listing): `analytics.readonly` + `webmasters.readonly` + `tagmanager.readonly` + `openid` + `userinfo.email`.

Consent B (`business.manage`) and Consent C (`adwords`) are **not** on Consent A.

## Paid topology (gateway Option A — not in this package)

Google Ads developer token is a static `developer-token` header (a password). Meta `appsecret_proof` needs the app secret. Default paid path is a DGTL **allowlisted gateway** (`services/stamp/`, deployable, not a plugin folder, no secrets in git).

This session: **no gateway**. Paid tools are registered and fail `LICENSE_REQUIRED`. License JWT is verified **locally** (Ed25519 public key in the plugin). User-supplied Ads developer token is a power-user bypass of the gateway, still license-gated; not implemented live here.

GA4 / GSC / GTM never send report bytes to DGTL.

## GBP

Commercially free, technically gated (Basic API Access; quota 0 until approved). Feature flag `gbp.enabled` default **off**. Tools return `GBP_NOT_ENABLED`. Readonly only. Scope `business.manage` is Consent B.

## Packaging

- TypeScript + official MCP SDK + REST `fetch`. One Node bin: `./bin/dgtl-marketing-mcp`. Plugin-relative. **No npx** as the marketplace command. No Python `googleapiclient` runtime.
- Dual-emit `mcp.json` (Agent Plugins / Cursor) and `.mcp.json` (Grok Build) from **one** source: `src/packaging/mcp.template.json`.
- Apache-2.0.
- Public git; no secrets; no `developer-token` in fixtures.

## Envelope

Every tool result:

```
ok, tool, resource { type, id, display_name }, data, page { next_page_token, truncated, row_count }, quota,
error_code, message, hint, google_status, google_reason, api
```

Closed JSON Schema (`additionalProperties: false`). Pagination + `truncated` are the contract.

## Invariants

- No implicit resource. No `default` / `first` / index 0. Required IDs or `RESOURCE_REQUIRED`.
- `ga4_run_report` denylists `searchQuery` / `query` / `searchTerm` / `keyword` with **zero HTTP**.
- Empty rows are `ok: true`.
- Paid tools stay in `tools/list` and fail closed.

## Out of this session (Phase 7+)

GBP live (after quota), Ads recipes + user token, gateway, Meta live, marketplace PR, Google verification video. Noel’s paperwork, not this binary.
