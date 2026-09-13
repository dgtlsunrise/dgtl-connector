# schemas/v1

Machine-readable contract for the closed tool list.

- `catalog.json` — 26 Consent A kernel tools (vendored 22 + `ga4_list_account_summaries` + `gsc_describe_schema` + Wave 13 `gtm_list_clients` + `gtm_list_environments`) plus gated families (writes, GBP, Ads/Meta Polar, Shopify + Klaviyo local-free, license, support_packet / feedback diagnostics). Shopify and Klaviyo are not Polar and are not in the 26 kernel.
- `tools.schema.json` — closed input schemas (`additionalProperties: false`)
- `error.schema.json` / `envelope.schema.json` — result envelope including `page.truncated` and optional success `hint` (empty rows ≠ auth failure)

Do not hand-edit `mcp.json`; generate it from `src/packaging/mcp.template.json`.
