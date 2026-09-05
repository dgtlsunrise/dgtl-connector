# dgtl-connector

Read-only **GA4**, **Search Console**, and **Tag Manager** for Grok Bot, Cursor, and Grok Build. You authorize **your** Google account. Tools run on **your** computer. DGTL Sunrise does not see report bytes.

Publisher: **DGTL Sunrise** (Sunrise Consulting LLC), `noel@dgtlsunrise.com`. Apache-2.0.  
Homepage: https://www.dgtlsunrise.com/ · Privacy: https://www.dgtlsunrise.com/privacy

Working package id: `dgtl-connector`. Version **0.1.0**. Marketplace listing copy = **Consent A readonly** only (title/description can still say marketing/Ads for discovery).

## What it is / is not

**Is:** a local stdio MCP plugin. Closed typed tools (23 free: identity + GA4 + GSC + GTM). Skills that refuse hallucinated metrics and will not pick the first of 40 agency properties.

**Is not:** a hosted analytics warehouse, a Gmail-style Connect card for stdio, Google Ads/Meta (those tools are listed and return `LICENSE_REQUIRED` until a paid license + Worker), or a GBP client until DGTL’s GCP project has GBP quota (`GBP_NOT_ENABLED`). GTM write/publish stubs (if registered) are **flagged off** on a **separate Consent W** OAuth client — not on free Consent A, and not marketplace listing promises.

## Auth on this host (stdio is Manual)

There is no Gmail-style Connect card for stdio. Agent Plugins 1.0 and today’s Cursor / Grok Bot **stdio** MCP do **not** give third-party plugins a Connect card. OAuth Connect cards are for **remote HTTP/SSE** MCP servers. This plugin implements **AuthPort**:

1. **Host-injected** (preferred when the host can do it): set `GOOGLE_ACCESS_TOKEN` (optional `GOOGLE_GRANTED_SCOPES`, `GOOGLE_ACCOUNT_EMAIL`).
2. **Installed-app PKCE fallback** (documented, advanced): Desktop OAuth client id (`GOOGLE_OAUTH_CLIENT_ID`) plus `GOOGLE_OAUTH_CLIENT_SECRET` in **gitignored** `.env` for `/token` (never git, chat, `mcp.json`, or the binary). Run:

   ```bash
   ./bin/dgtl-connector-mcp auth login
   ```

   Tokens are written to `PLUGIN_DATA/google-oauth.json` (mode 0600). Refresh tokens are never logged.

Until Google verifies the OAuth client, it stays in **testing** with an allowlist. Strangers on an unverified client will be stranded — that is a Google verification step, not a plugin Connect card.

## Install (local)

```bash
npm install
npm run build
./bin/dgtl-connector-mcp --help
```

The marketplace command is **one token**, plugin-relative: `./bin/dgtl-connector-mcp`. Not `npx`.

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

Google Ads and Meta Ads tools are registered so the model does not poll. Without a DGTL license JWT (`DGTL_LICENSE_JWT` or `PLUGIN_DATA/license.jwt`) they return `LICENSE_REQUIRED`. Free GA4/GSC/GTM still work. License delivery (when Polar is live) is portal / `POST /v1/license`, not emailing the bearer. DGTL’s Ads developer token and Meta app secret are **not** in this plugin. The allowlisted gateway is a later deployable (`services/stamp/`), not this package.

## Support intake

Plugin version, host, tool, `error_code`, Google status/`google_reason`, resource ID. **Never tokens.**

After a real diagnosis, the support skill may add this line once:

> DGTL Sunrise can also run GA4, Search Console, and Tag Manager as a client engagement if you want this operated for you. Email noel@dgtlsunrise.com. The plugin stays free and local either way.

## Security

See `SECURITY.md`. No secrets in git. CI never opens `googleapis.com`.
