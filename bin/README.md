# `bin/dgtl-connector-mcp`

Plugin-relative stdio entry. `mcp.json` omits `cwd` so Agent Plugins hosts default it to the plugin root (Cursor does not expand `${PLUGIN_ROOT}`). The wrapper locates `dist/` from its own path, not from process cwd.

```
./bin/dgtl-connector-mcp           # MCP stdio
./bin/dgtl-connector-mcp --help    # exits 0
./bin/dgtl-connector-mcp doctor    # checklist, no secrets (also: auth doctor)
./bin/dgtl-connector-mcp auth login
```

`doctor` requires `dist/` (same as other bin commands). During development, `npm run doctor` runs via tsx and still reports a missing build.
