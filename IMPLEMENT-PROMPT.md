You are Grok Build implementing Phase 0-6 of the DGTL marketing plugin. One-shot architecture. Do not publish, do not contact anyone, do not call live Google/Meta APIs, do not put secrets in git.

Read SECOND-OPINION.md (architecture lock) and SCOPE-AND-PLAN.md (commercial lock). SECOND-OPINION wins on auth, gateway, GBP flag, dual mcp.json, underscore names, submit-free-first. SCOPE wins on product tiers.

GOAL this session: a runnable FREE plugin for GA4 + GSC + GTM (23 tools: the 22 named in SECOND-OPINION plus ga4_list_account_summaries), skills, fixture tests, error envelope, AuthPort (host-injected + PKCE fallback), dual mcp.json and .mcp.json, Apache-2.0. GBP/Ads/Meta: schemas and flags only; those tools return GBP_NOT_ENABLED or LICENSE_REQUIRED. No gateway service yet.

TypeScript + official MCP SDK + REST fetch. One bin command, plugin-relative. No npx as the marketplace command. No Python googleapiclient runtime.

Proof:
- tests pass with no network to googleapis.com
- binary speaks MCP initialize + tools/list
- ga4_run_report denylists searchQuery with zero HTTP
- missing property_id returns RESOURCE_REQUIRED
- 40-property fixture never picks index 0
- LICENSE_REQUIRED for gads tools but ga4 still works
- mcp.json and .mcp.json generated from one source
- no secrets, no developer-token in fixtures
- README tells the truth: stdio auth is manual/PKCE, not a Gmail connect card

Vendor the 22-tool catalog from SECOND-OPINION into schemas/v1/catalog.json. Closed JSON Schema additionalProperties false. Pagination + truncated in the envelope.

When done, write IMPLEMENTATION-STATUS.md with what shipped, test counts, and remaining Phase 7+.
