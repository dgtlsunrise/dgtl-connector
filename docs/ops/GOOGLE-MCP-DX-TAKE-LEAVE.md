# Google MCP DX — take / leave

Overnight review of official Google MCPs plus best-known GSC/GTM community servers.
**Auth/install models are out of scope** (we keep user OAuth / host-injected token; Ads/Meta stay Polar + stamp gateway). This note is DX only: discovery, validation, empty results, errors, pagination, anti-hallucination.

Sources read via `gh api` (no clones):

| Source | Repo | Role |
| --- | --- | --- |
| Official GA4 | `googleanalytics/google-analytics-mcp` (`analytics_mcp`) | Primary GA4 DX |
| Official Ads | `googleads/google-ads-mcp` (`ads_mcp`) | Primary Ads DX (patterns only) |
| GTM (community) | `stape-io/google-tag-manager-mcp-server` | Best-known GTM MCP |
| GSC (community) | `surendranb/google-search-console-mcp` | **Chosen** GSC DX reference |
| GSC (community) | `Magdoub/awesome-gsc-mcp` | Compared; mostly rejected |
| Index only | `google/mcp` README | Confirms GA4 official OSS; no GSC/GTM official MCP |

## Choice: GSC reference

**Take Surendran over Magdoub** for DX:

- Surendran: `list_available_dimensions` / `list_available_metrics`, strict dimension validation before query, two-audience setup briefs that stress **exact** `siteUrl` (`https://…/` vs `sc-domain:`), empty/config errors that say retrying will not help.
- Magdoub: strong typed errors + recovery hints + rate limiter, but DX centers on SEO analysis engines, service-account-first install, and mutate tools (`add_property` / `delete_property`) that conflict with Consent A honesty.

## Take (integrated)

### From official GA4 (`analytics_mcp`)

| Pattern | Why | Where we put it |
| --- | --- | --- |
| Property-scoped metadata as anti-hallucination catalog | Agents invent metric names without `apiName` lookup | Already had `ga4_get_metadata`; **extended** with optional `query` / `kind` / `custom_only` filter so agents search instead of guessing |
| Relative dates (`today` / `yesterday` / `NdaysAgo`) | Official docs + examples; reduces date format errors | Already in `parseGa4Date` / `capDateRange` |
| Filter complexity notes (dim+metric combos) | Prevents futile report retries | Kept INVALID_ARGUMENT → hint `ga4_get_metadata`; no funnel/realtime tools (v1 lock) |
| Property RN normalization | Digits or `properties/{id}` | Already in `normalizeGa4Property` |

### From official Ads (`ads_mcp`)

| Pattern | Why | Where we put it |
| --- | --- | --- |
| “Do not guess fields — discover first” | Highest leverage anti-hallucination | Mirrored for GA4 via metadata search; Ads stay **closed recipes** (`gads_search`) — no raw GAQL, no user developer-token |
| Clear ToolError with request context | Better recovery copy | Already map Google errors; Ads path remains gateway |
| Customer id punctuation hygiene | Hyphenated ids break queries | Documented in Ads tool descriptions (gateway normalizes) |

**Rejected from Ads:** ADC / `GOOGLE_ADS_DEVELOPER_TOKEN` on the user, pipx install story, open GAQL `search` tool, field-service dump as user-facing mutate surface.

### From Surendran GSC

| Pattern | Why | Where we put it |
| --- | --- | --- |
| Explicit dimension/metric catalog tool | Stops invented dims (`hour` misuse, typos) | New free tool `gsc_describe_schema` (local, no Google call) |
| Validate dimensions before HTTP | Fail closed with valid list | `gsc_query_search_analytics` validates against catalog |
| Exact site URL briefs | Trailing slash / domain vs URL-prefix | Stronger `NOT_FOUND` / empty hints cite `site_url` + `gsc_list_sites` |
| Empty ≠ auth | Avoid reconnect loops | Already `HINT_EMPTY_ROWS`; enriched with `data_state` + cited dates |

**Rejected from Surendran:** `GSC_SITE_URL` single-site env lock, service-account-only setup, telemetry, write/delete site tools, row_limit up to 25k (we keep ≤1000).

### From Stape GTM

| Pattern | Why | Where we put it |
| --- | --- | --- |
| Account → container → workspace hierarchy clarity | Agents skip levels or invent workspace ids | Tool descriptions + RESOURCE_REQUIRED already; tightened copy |
| Draft workspace vs live published version | Agents report draft tags as “live on site” | Stronger `source=workspace` / `source=live` hints on list/live tools |
| Pagination caps on version payloads | Avoid truncation silence | Already paginate workspace lists; live version keeps `page.row_count` |

**Rejected from Stape:** Hosted OAuth at `gtm-mcp.stape.ai`, service-account CLI auth story, mega mutate surface (`gtm_version` publish/remove, workspace create/sync). Writes stay Consent W + dry_run + confirm_phrase.

### From Magdoub GSC (selective)

| Pattern | Why | Where we put it |
| --- | --- | --- |
| Recovery hints on errors | Actionable next step | Already in `ErrorExtra.hint` / MSG; GSC site-url hint strengthened |
| Reactive rate-limit awareness | 429 should not look like auth | Map 429 → RATE_LIMITED; **HTTP client retries 429/503** with backoff + Retry-After |

**Rejected from Magdoub:** Token-bucket limiter as default (stdio tools are sparse; reactive retry is enough), SEO opportunity/CTR engine, cache layer, property mutate tools, SA-first auth, 25k row caps.

### From `google/mcp` README

Pointers only: lists official Analytics MCP; **no** official GSC or GTM MCP under Google orgs — community refs above remain authoritative for those surfaces.

## Leave (explicit)

- ADC / `gcloud auth application-default` / pipx as the install story
- Service-account-first UX for free GA4/GSC/GTM
- Putting Ads **developer-token** on the user machine
- Open GAQL or Ads FieldService as free tools
- Magdoub analysis mega-tools / Surendran telemetry
- Stape hosted mutate-heavy GTM API surface on Consent A
- Raising row caps above 1000 per call
- New ad networks or ungated ads_management mutate

## Product locks preserved

- Free GA4+GSC+GTM: local Agent Plugin; user OAuth / host-injected token; no DGTL signup
- Ads/Meta: Polar + stamp gateway
- Consent A listing stays honest (readonly)
- No secrets in git; no Axos/Breakwater

## Closed free count

Bump **23 → 24** with `gsc_describe_schema` only. GA4 discovery is a parameter extension on `ga4_get_metadata`, not a 25th tool.
