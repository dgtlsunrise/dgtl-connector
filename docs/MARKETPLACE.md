# Marketplace

Submit **only** when a runtime exists, the git is **public**, and the secret scan is clean. This spec repo may stay **private** until then. Do not publish this stub as a working plugin.

Format: **Agent Plugin first** (portable). Author name: **DGTL Sunrise**. Cursor-only extras (`.cursor-plugin/`, hooks, variables) only if they help **Grok Bot**. Grok Build catalog is a **later** PR to `xai-org/plugin-marketplace`.

## Pre-submit bar (security)

Reviewers will treat this as code that runs on a user's computer and talks to Google.

- [ ] Git history and HEAD contain **no** OAuth client secrets, refresh tokens, service account keys, `token.json`, `client_secret*.json`, or `.env` with credentials
- [ ] `mcp.json` has **no** `CLIENT_SECRET`, no `Authorization` header with a real token, no remote URL to a DGTL proxy
- [ ] `plugin.json` validates against Agent Plugins 1.0 (`$schema` + `name` constraints)
- [ ] `mcp.json` validates against Agent Plugins MCP schema (`$schema` + `mcpServers`, stdio `type`+`command`)
- [ ] Auth is **AuthPort**: host-injected token, then installed-app PKCE (public Desktop client). stdio is Manual — no Gmail-style Connect card. Do not embed a client secret.
- [ ] Tools: closed **23** free Consent A tools in the listing story; any write/publish stubs are gated off / Consent W (different OAuth client) — listing copy promises **Consent A readonly only**
- [ ] README explains who it's for, Consent A in/out, AuthPort, and that users authorize **their** Google accounts
- [ ] Skills refuse hallucinated metrics, silent property pick, Consent A publish, GA4 `searchQuery`; Consent W is gated, not eternal “no publish tool”
- [ ] License is a public OSI license (replace `UNLICENSED` before submit)
- [ ] Support email `noel@dgtlsunrise.com` is real
- [ ] Privacy policy URL exists (Google verification needs it; marketplace reviewers will look)
- [ ] Logo optional but preferred; commit a relative path when you have one — do not hotlink a secret bucket

Open source is the review bar. Do not ship a “contact us for the binary” plugin.

## Cursor Marketplace checklist

Source: Cursor plugins reference, submit at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish).

- [ ] Valid **root** `plugin.json` (Agent Plugin), not only `.cursor-plugin/plugin.json`
- [ ] `name` is unique, lowercase kebab-case: `dgtl-marketing` (working listing id; rename everywhere if Noel changes it)
- [ ] `description` explains readonly GA4 / GSC / GTM (Consent A only) and user-owned Google auth (remove “SPEC STUB” before submit)
- [ ] `homepage` is `https://www.dgtlsunrise.com/`
- [ ] `author.name` is **DGTL Sunrise**
- [ ] Skills have YAML frontmatter (`name`, `description`)
- [ ] `mcp.json` at plugin root; command is a real executable in the public repo (or documented package)
- [ ] All manifest paths relative; no `..`; no absolute paths
- [ ] README covers install, AuthPort (host-injected / PKCE), picker, and non-bugs
- [ ] Tested locally on Cursor **and** on Grok Bot Plugins (stdio Manual/PKCE, not a Connect card)
- [ ] Public Git repository URL ready
- [ ] Submit the repo link at `cursor.com/marketplace/publish`
- [ ] After listing: walk `auth login` (or host-injected token) → `google_whoami` → list properties → one `ga4_run_report` → one GSC query → one GTM live version

Do **not** add Cursor `variables` that ask the user to paste a refresh token.

## Grok Bot install story (what reviewers should see)

stdio MCP auth is **Manual** (AuthPort). There is no Gmail-style Connect card for this plugin. Host-injected `GOOGLE_ACCESS_TOKEN` is preferred when the host can do it; otherwise installed-app PKCE (`dgtl-marketing-mcp auth login`, public Desktop client). See README.

1. Install **dgtl-marketing** (plugin dir / marketplace once listed)
2. Set `GOOGLE_OAUTH_CLIENT_ID` (public) or a host-injected access token
3. If PKCE: run `auth login`, complete Google consent in the browser (client id in the URL)
4. `google_whoami` shows the connected email and scopes — never the bearer
5. Team admins: plugin must not be “Disabled by team admin” (allowlist the server if the team uses MCP allowlists)

Do not invent a second token vault. Do not ask users to paste a refresh token.

## Grok Build catalog checklist (later)

Catalog repo: [xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace). That repo is an **index**, not where our skills live.

- [ ] This plugin's own files live in **our public git**
- [ ] PR adds a **remote** entry to `.grok-plugin/marketplace.json` (do not vendor unless they require it)
- [ ] `source.source` / URL form as their README specifies
- [ ] **Pin a full 40-character commit SHA**
- [ ] `name`: `dgtl-marketing`
- [ ] `description`, `category` (e.g. `productivity` or `monitoring` — pick one that matches their list), `homepage`, `keywords` (`ga4`, `search-console`, `gtm`, `google-analytics`)
- [ ] `author` display: DGTL Sunrise
- [ ] Run their `generate-plugin-index.py` / `validate-catalog.py` as required by CI
- [ ] Third-party warning: we accept xAI's “AS-IS / may execute code” terms; our README states Google calls run on the user's computer

Grok Build also discovers `.mcp.json` in some layouts. **Only add a duplicate `.mcp.json` if review/install fails with root `mcp.json` alone.** Prefer one file.

## Agent Plugins conformance (portable)

- [ ] `plugin.json` `$schema` = `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`
- [ ] `mcp.json` `$schema` = `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`
- [ ] No unknown **required** fields at the top level; client-specific data under `extensions`
- [ ] Skills only as immediate children of `skills/` with `SKILL.md`
- [ ] stdio `command` is one token (`./bin/dgtl-marketing-mcp` or a PATH binary)
- [ ] Placeholders in `args` / `env` / `cwd` are only `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` (Agent Plugins). Host token injection is **not** encoded as a fake secret in headers

## Google verification vs marketplace

Two reviews, two owners:

| Review | Owner | Blocks |
| --- | --- | --- |
| Cursor / xAI marketplace | Plugin git, MCP, skills | Listing |
| Google OAuth sensitive scopes | Cloud consent screen, demo video, privacy policy | Strangers signing in |

A marketplace listing that still uses an unverified testing-mode OAuth client will strand users. Sequence: runtime + fixture tests → enable APIs → PKCE / host-injected against testers → Google verification → public git → marketplace submit.

## What not to submit

- This spec-only revision (`version` `0.0.0`, description contains `SPEC STUB`, `bin/` empty)
- Listing copy that promises Ads, GBP, or live writes (Consent A listing only)
- A remote MCP URL on DGTL infrastructure “just for Grok Bot”
- Docs that tell reviewers to use a Connect card for stdio or that “there is no publish tool” while gated stubs exist

## Rename

If Noel renames the product, change marketplace `name`, git repo name (if any), `plugin.json`, MCP server key, and this checklist together.
