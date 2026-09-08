# Meta + Google MCP DX — pass 2 (take / leave)

Overnight second pass: deeper re-read of official Google MCPs after PR #10, plus UX theft from Meta’s **hosted** Ads MCP (no public source under facebook/meta).

**Auth/install models stay out of scope.** Free GA4/GSC/GTM = user OAuth / host token. Ads/Meta = Polar + stamp gateway. Consent A stays honest (readonly free kernel). No secrets, no Axos/Breakwater, no user Ads developer-token, no ADC/pipx story.

## Sources

| Source | What we used | Notes |
| --- | --- | --- |
| Meta hosted MCP | `https://mcp.facebook.com/ads` | **OAuth required** — `tools/list` without Noel login → HTTP 401 + `www-authenticate` (scopes include `ads_mcp_management`, `ads_read`, …). Docs-only for tool inventory. |
| Meta docs | Overview, Get started, Available tools page, Jul 2026 blog | Categories + reporting DX (spend/CTR/ROAS, breakdowns, levels, date ranges). |
| Official GA4 | `googleanalytics/google-analytics-mcp` (`analytics_mcp`) | Re-read tools/resources; funnels/realtime still out of v1. |
| Official Ads | `googleads/google-ads-mcp` (`ads_mcp`) | Tools: `list_accessible_customers`, `search`, `get_resource_metadata`; resources: metrics/segments/discovery-document/release-notes. |
| Google hosted URL | `mcp.google.com` | **Does not resolve** — no public Google-hosted Ads/GA4 MCP URL. Self-host / Cloud Run / stdio only. |
| GSC/GTM | Community refs from PR #10 | No re-litigation; no concrete miss found. |

### Noel gate

Listing live tools on `mcp.facebook.com/ads` needs a Meta user OAuth (or system-user token with `ads_mcp_management` + `ads_read`/`ads_management`). **Not done this overnight** — treat as Noel gate if we ever want a golden `tools/list` dump.

## Take (integrated this PR)

### Meta (docs → our Polar+stamp Meta tools)

| Pattern | Why | Where |
| --- | --- | --- |
| Insights params: levels, date presets, age/gender/platform breakdowns, field list | Hosted MCP “comprehensive reporting” surface; stops invented Graph fields | `meta_insights` schema + gateway allowlist; validate before hop |
| Local insights catalog | Same anti-hallucination job as GSC `describe_schema` / Ads metadata | **Gated** `meta_describe_insights_schema` (license only; zero Graph/gateway) |
| Empty / NOT_FOUND hints | Empty ≠ auth; bad ids should not loop reconnect | Client enrich after gateway; stronger tool descriptions |
| `data.cited` | Agents must cite account/level/dates/breakdowns | Enrich ok envelopes for meta list/insights |
| “List accounts first” DX | Hosted prompts start with list ad accounts | `meta_list_ad_accounts` description |

**Product locks preserved:** Meta stays Polar+stamp; **ads_read only** for v1; **no** mutate / catalog / audience / lift / activity-log tools in this PR.

### Google Ads (official `ads_mcp` → closed recipes)

| Pattern | Why | Where |
| --- | --- | --- |
| “Use list customers first” | Official `list_accessible_customers` description | Stronger `gads_list_accessible_customers` copy |
| Resource-metadata / don’t-guess-fields | Highest leverage official DX | **Gated local** `gads_describe_recipes` (closed recipe catalog — not FieldService) |
| Clearer errors pointing at discovery | Official ToolError + metadata-before-search | INVALID_ARGUMENT on unknown recipe; NOT_FOUND hints cite list + describe |
| Cited customer ids on reports | Ground answers in real ids | Client `data.cited` on gads hops (strip hyphens) |

### Google Analytics (second pass)

| Pattern | Why | Where |
| --- | --- | --- |
| Metadata filter / relative dates / property RN | Already landed in PR #10 | No new free tool |
| Admin `list_google_ads_links` | Nice cross-link discovery | **Leave** for later (not required for v1 reports) |
| Funnel / realtime / custom-dim-only tool | Official has them | **Leave** (v1 lock) |

### Confirmed non-goals (doc)

- No `mcp.google.com` hosted Ads/GA4 URL (self-host only).
- No public Meta Ads MCP OSS under facebook/meta to clone.
- GSC/GTM: no official Google MCP; PR #10 Surendran/Stape choices stand.

## Leave (explicit)

| Item | Reason |
| --- | --- |
| Meta ad create/edit, catalogs, custom audiences, signals, help-center search, A/B & lift, activity logs | Writes / Advanced Access surface; v1 ads_read only |
| Shipping `ads_mcp_management` / connecting agents to Meta’s hosted MCP as our product path | Future backlog — we keep Polar+stamp |
| Raw GAQL `search`, live `get_resource_metadata`, metrics/segments MCP **resources** as agent tools | Closed recipes + local describe only; no user developer-token |
| ADC / pipx / `GOOGLE_ADS_DEVELOPER_TOKEN` on the user | Architecture lock |
| GA4 funnel / realtime | v1 lock (unchanged) |
| New free-kernel tools | Prefer gated Meta/Ads DX; **free count stays 24** |
| Re-opening GSC/GTM PR #10 choices | No concrete miss |

## Backlog notes (for POST-POLAR / product)

1. Noel OAuth → `tools/list` against `https://mcp.facebook.com/ads` for a golden inventory dump.
2. `ads_mcp_management` Advanced Access + whether to ever proxy/complement Meta hosted MCP.
3. Optional later read tools mirroring Meta categories we deferred (activity logs, help search) — still read-only / licensed.
4. Optional GA4 `list_google_ads_links` when we want Ads↔GA4 linking DX on free kernel.

## Free kernel count

**Still 24.** New tools are gated (`gads_describe_recipes`, `meta_describe_insights_schema`) under existing paid families — not Consent A listing promises.
