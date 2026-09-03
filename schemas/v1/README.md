# schemas/v1

Machine-readable contract for the closed tool list.

- `catalog.json` — 23 free tools (vendored 22 + `ga4_list_account_summaries`) plus gated families
- `tools.schema.json` — closed input schemas (`additionalProperties: false`)
- `error.schema.json` / `envelope.schema.json` — result envelope including `page.truncated`

Do not hand-edit `mcp.json`; generate it from `src/packaging/mcp.template.json`.
