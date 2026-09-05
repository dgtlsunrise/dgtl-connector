# Security

## What this plugin never does

- Commit or embed OAuth client secrets, refresh tokens, Google Ads `developer-token`, Meta app secrets, or Stripe keys.
- Put DGTL’s Ads developer token on the user computer (default paid path is an allowlisted gateway, not in this package).
- Log `Authorization` headers or token query parameters (redacted).
- Proxy GA4 / GSC / GTM report bytes through DGTL.
- Open an HTTP proxy to arbitrary hosts (Google REST allowlist only).
- Ship `npx` as the marketplace command.

## Auth

stdio MCP auth is **Manual**: host-injected access token or installed-app PKCE into `PLUGIN_DATA`. There is no Gmail-style Connect card for this transport. PKCE uses a **public** Desktop client. Confidential web-client secrets stay in Google Cloud, never in git.

## License JWT

Paid unlock is a locally verified Ed25519 JWT (public key embedded). The private issuer key is not in this repo. Features are `ads` / `meta`. No network for `LICENSE_REQUIRED`.

## Fixtures and CI

Synthetic Google-shaped JSON only (`Example Brand`, `sc-domain:example.com`). Secret heuristics in `scripts/validate-spec.py` fail the build on access-token, refresh-token, `GOCSPX-`, API-key, PEM private-key, and `developer-token` shapes in fixtures. CI must not open `googleapis.com`, `graph.facebook.com`, or token endpoints.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on pull requests and pushes to `main`: `npm ci` and the existing test suite (fixtures only), `npm audit --omit=dev --audit-level=high` (fails on high/critical production advisories), and gitleaks (fails on findings). Allowlist an exception in `.gitleaks.toml` only with a one-line comment why. Local: `npm run secret-scan` (gitleaks when installed; otherwise the `validate-spec.py` heuristics). Spec secret heuristics stay in `scripts/validate-spec.py`.

## Marketplace checklist

- Public git, Apache-2.0, author DGTL Sunrise.
- `plugin.json` `$schema` Agent Plugins 1.0. DGTL fields under `extensions.com.dgtlsunrise`.
- `mcp.json` / `.mcp.json` generated from one source; command is `./bin/dgtl-connector-mcp`.
- Skills do not collect tokens. Support intake: version, host, tool, `error_code`, Google status/reason, resource ID.
- Gateway (later): allowlist `googleads.googleapis.com` and Meta Graph only; attach developer-token **only** on the server; no payload storage.

## Reporting

Email `noel@dgtlsunrise.com`. Do not attach `token.json` or HARs with Authorization.
