# schemas/v1

Machine-readable contract for the closed tool list.

- `catalog.json` — 23 free tools (vendored 22 + `ga4_list_account_summaries`) plus gated families (writes, GBP, Ads/Meta, license, support_packet / feedback diagnostics)
- `tools.schema.json` — closed input schemas (`additionalProperties: false`)
- `error.schema.json` / `envelope.schema.json` — result envelope including `page.truncated` and optional success `hint` (empty rows ≠ auth failure)

Do not hand-edit `mcp.json`; generate it from `src/packaging/mcp.template.json`.
