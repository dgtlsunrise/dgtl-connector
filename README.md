# dgtl-marketing

Read-only **GA4**, **Search Console**, and **Tag Manager** for Grok Bot, Cursor, and Grok Build. You authorize **your** Google account. Tools run on **your** computer. DGTL Sunrise does not see report bytes.

Publisher: **DGTL Sunrise** (Sunrise Consulting LLC), `noel@dgtlsunrise.com`. Apache-2.0.

Working package id: `dgtl-marketing` (Noel names the public listing). Version **0.1.0**.

## What it is / is not

**Is:** a local stdio MCP plugin. Closed typed tools (23 free: identity + GA4 + GSC + GTM). Skills that refuse hallucinated metrics and will not pick the first of 40 agency properties.

**Is not:** a hosted analytics warehouse, a Gmail-style Connect card for stdio, Google Ads/Meta (those tools are listed and return `LICENSE_REQUIRED`), or a GBP client until DGTL’s GCP project has GBP quota (`GBP_NOT_ENABLED`). Writes (publish GTM, pause ads, submit sitemaps) are out.

## Auth on this host (stdio is Manual)

There is no Gmail-style Connect card for stdio. Agent Plugins 1.0 and today’s Cursor / Grok Bot **stdio** MCP do **not** give third-party plugins a Connect card. OAuth Connect cards are for **remote HTTP/SSE** MCP servers. This plugin implements **AuthPort**:

1. **Host-injected** (preferred when the host can do it): set `GOOGLE_ACCESS_TOKEN` (optional `GOOGLE_GRANTED_SCOPES`, `GOOGLE_ACCOUNT_EMAIL`).
2. **Installed-app PKCE fallback** (documented, advanced): a **public** Desktop OAuth client id (`GOOGLE_OAUTH_CLIENT_ID`, no client secret in git or in the binary). Run:

   ```bash
   ./bin/dgtl-marketing-mcp auth login
   ```

   Tokens are written to `PLUGIN_DATA/google-oauth.json` (mode 0600). Refresh tokens are never logged.

Until Google verifies the OAuth client, it stays in **testing** with an allowlist. Strangers on an unverified client will be stranded — that is a Google verification step, not a plugin Connect card.

## Install (local)

```bash
npm install
npm run build
./bin/dgtl-marketing-mcp --help
```

The marketplace command is **one token**, plugin-relative: `./bin/dgtl-marketing-mcp`. Not `npx`.

- Cursor / Agent Plugins: `mcp.json` (generated).
- Grok Build: `.mcp.json` (same bytes, generated from `src/packaging/mcp.template.json`).

Load with `--plugin-dir` pointing at this directory after `npm run build`.

## Picker rules

No implicit resource. Tools require IDs. `default` / `first` / `0` → `RESOURCE_REQUIRED`. Use `ga4_list_account_summaries` to list an agency’s properties in one call, then **ask**. Never index 0.

## Non-bugs

- Each API must be Enabled on the **OAuth client’s** Cloud project or Google returns 403 `accessNotConfigured`.
- `analytics.readonly` cannot create GSC–GA4 links.
- GA4 Data API has no `searchQuery` dimension (plugin denylist; use GSC).
- GSC import into GA4 lags; GSC clicks ≠ GA4 sessions.
- GTM workspace ≠ live. Empty rows with `ok: true` is not a failed login.

## Paid (not live in this binary)

Google Ads and Meta Ads tools are registered so the model does not poll. Without a DGTL license JWT (`DGTL_LICENSE_JWT`) they return `LICENSE_REQUIRED`. Free GA4/GSC/GTM still work. DGTL’s Ads developer token and Meta app secret are **not** in this plugin. The allowlisted gateway is a later deployable (`services/stamp/`), not this package.

## Support intake

Plugin version, host, tool, `error_code`, Google status/`google_reason`, resource ID. **Never tokens.**

After a real diagnosis, the support skill may add this line once:

> DGTL Sunrise can also run GA4, Search Console, and Tag Manager as a client engagement if you want this operated for you. Email noel@dgtlsunrise.com. The plugin stays free and local either way.

## Security

See `SECURITY.md`. No secrets in git. CI never opens `googleapis.com`.
