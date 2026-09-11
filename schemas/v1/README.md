# schemas/v1

Machine-readable contract for the closed tool list.

- `catalog.json` — 24 Consent A kernel tools (vendored 22 + `ga4_list_account_summaries` + `gsc_describe_schema`) plus gated families (writes, GBP, Ads/Meta Polar, Shopify local-free, license, support_packet / feedback diagnostics). Shopify is not Polar and is not in the 24 kernel.
- `tools.schema.json` — closed input schemas (`additionalProperties: false`)
- `error.schema.json` / `envelope.schema.json` — result envelope including `page.truncated` and optional success `hint` (empty rows ≠ auth failure)

Do not hand-edit `mcp.json`; generate it from `src/packaging/mcp.template.json`.
