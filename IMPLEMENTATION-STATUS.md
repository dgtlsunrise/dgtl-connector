# Implementation status — Phase 0–6

Date: 2026-09-02  
Package: `dgtl-connector` 0.1.0  
License: Apache-2.0  
Publisher: DGTL Sunrise (`noel@dgtlsunrise.com`)

This session implemented the **runnable free plugin** (architecture one-shot, listing incremental). Nobody was contacted. No live Google/Meta APIs. No secrets in git. No gateway service.

## What shipped

### Phase 0 — Import and lock

- Vendored cloud spec `bc-a4346943` into `docs/`, `schemas/v1/`, `skills/` (original 7), `fixtures/google/`.
- `ARCHITECTURE-LOCK.md`: underscore names, AuthPort, gateway Option A (not in package), dual `mcp.json` / `.mcp.json`, 23rd tool, license JWT, TypeScript+REST.

### Phase 1 — Scaffold

- Agent Plugin `plugin.json` (closed-ish top level; DGTL data under `extensions.com.dgtlsunrise`).
- `src/packaging/mcp.template.json` → generated `mcp.json` and `.mcp.json` (identical).
- `bin/dgtl-connector-mcp` (plugin-relative, no npx).
- `scripts/validate-spec.py`.
- Error envelope module (`src/envelope.ts`, `src/errors.ts`).

### Phase 2 — AuthPort + `google_whoami`

- Host-injected token (`GOOGLE_ACCESS_TOKEN` and aliases).
- Installed-app PKCE fallback (`auth login`, public client, `PLUGIN_DATA`, refresh token never logged).
- `google_whoami` returns email, scopes, `expires_in`, license features — never the bearer.

### Phase 3–5 — 23 tools + skills + envelope

Free kernel (23):

| Group | Tools |
| --- | --- |
| identity | `google_whoami` |
| GA4 | `ga4_list_accounts`, `ga4_list_account_summaries`, `ga4_list_properties`, `ga4_get_property`, `ga4_list_data_streams`, `ga4_list_key_events`, `ga4_get_metadata`, `ga4_run_report` |
| GSC | `gsc_list_sites`, `gsc_get_site`, `gsc_query_search_analytics`, `gsc_inspect_url`, `gsc_list_sitemaps`, `gsc_get_sitemap` |
| GTM | `gtm_list_accounts`, `gtm_list_containers`, `gtm_get_container`, `gtm_list_workspaces`, `gtm_list_tags`, `gtm_list_triggers`, `gtm_list_variables`, `gtm_get_live_container_version` |

Gated (schemas + flags only):

- GBP (5) → `GBP_NOT_ENABLED`
- Google Ads (4) + `license_status` → `LICENSE_REQUIRED` without JWT
- Meta (6) → `LICENSE_REQUIRED` without JWT

Envelope: `ok`, `tool`, `resource`, `data`, `page.{next_page_token,truncated,row_count}`, `quota`, error fields. Closed JSON Schema. Pagination on lists. `ga4_run_report` denylist + 366-day cap + closed FilterExpression subset.

Skills (10): original 7 plus `license-and-reconnect`, `gsc-vs-ads-keywords`, `ga4-vs-ads-conversions`. Support skill ships with the verbatim DGTL engagement line.

### Phase 6 — Free-tier packaging

- README tells the truth: stdio auth is Manual / host-injected / PKCE, **not** a Gmail Connect card.
- `SECURITY.md`, Apache-2.0 `LICENSE`, logo placeholder `assets/logo.svg`.
- License JWT verified locally (Ed25519 public key embedded). No gateway.

## Proof (this session)

`npm test` — **48 tests, 0 fail**. `python3 scripts/validate-spec.py` — `SPEC OK tools=23 skills=10`.

| Proof | Result |
| --- | --- |
| Tests pass with no network to googleapis.com | Pass (fixture `fetch`; global `fetch` guarded) |
| Binary speaks MCP `initialize` + `tools/list` | Pass (`tests/mcp-stdio.test.ts`) |
| `ga4_run_report` denylists `searchQuery` with zero HTTP | Pass (also `query` / `searchTerm` / `keyword`) |
| Missing `property_id` → `RESOURCE_REQUIRED` | Pass (`""`, `default`, `first`, `0`, omitted) |
| 40-property fixture never picks index 0 | Pass (`properties/2000000001` vs targeted `2000000040`) |
| `LICENSE_REQUIRED` for gads; GA4 still works | Pass (expired JWT too) |
| `mcp.json` and `.mcp.json` from one source | Pass |
| No secrets / no `developer-token` in fixtures | Pass |
| README: stdio is Manual/PKCE, not a Gmail Connect card | Pass |
| `./bin/dgtl-connector-mcp --help` exits 0 | Pass |

## How to run

```bash
npm install
npm run build
npm test
./bin/dgtl-connector-mcp --help
```

stdio MCP: hosts spawn `./bin/dgtl-connector-mcp` with `cwd` = plugin root. Set `GOOGLE_ACCESS_TOKEN` or run `auth login`.

## Remaining (Phase 7+)

| Phase | Work | Blocked on |
| --- | --- | --- |
| 7 | GBP live HTTP behind `gbp.enabled` once quota ≠ 0; Consent B docs | Noel: GBP Basic API Access |
| 8 | License minting UX (Stripe/invoice page that emails JWT) — verify already local | Noel: billing |
| 9 | Ads recipes → GAQL on **user-supplied** developer token + fixtures | Noel: test MCC / Test-access token |
| 10 | Allowlisted gateway: attach DGTL `developer-token`, no store | Noel: deploy + privacy policy paid paragraph |
| 11 | Meta family + `appsecret_proof` on the same gateway; App Review demo page | Noel: Meta app + Tech Provider |
| 12 | `paid.ads` / `paid.meta` flags after gateway exists | 10–11 |
| 13 | Marketplace PR / Cursor submit | Noel publishes; Google verification video |
| — | Product display name, homepage, privacy policy URL, logo for consent screen | Noel |

Not in v1: writes, TikTok, Shopify, HubSpot, token vault, hosted GA4, Stripe inside the MCP, staffed support bot.

## Noel checklist (not this binary)

- LLC GCP project; enable Admin, Data, Search Console, Tag Manager APIs
- Desktop OAuth client (public) for PKCE; testing-mode allowlist
- Google verification (demo video, privacy policy, homepage) before public listing
- Ads developer token application, permissible use **Reporting**
- GBP Basic API Access form
- Meta Business + app + App Review
- Do **not** put secrets in this git remote
