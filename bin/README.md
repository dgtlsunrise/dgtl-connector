# `bin/dgtl-marketing-mcp`

Plugin-relative stdio command. Hosts spawn this; they must not use `npx`.

```
./bin/dgtl-marketing-mcp           # MCP stdio
./bin/dgtl-marketing-mcp --help    # exits 0
./bin/dgtl-marketing-mcp auth login
```

Requires `npm run build` so `dist/index.js` exists. Node 20+. No Python `googleapiclient`.
