# `bin/dgtl-connector-mcp`

Plugin-relative stdio entry. Hosts spawn this with `cwd` = plugin root.

```
./bin/dgtl-connector-mcp           # MCP stdio
./bin/dgtl-connector-mcp --help    # exits 0
./bin/dgtl-connector-mcp doctor    # checklist, no secrets (also: auth doctor)
./bin/dgtl-connector-mcp auth login
```

`doctor` requires `dist/` (same as other bin commands). During development, `npm run doctor` runs via tsx and still reports a missing build.
