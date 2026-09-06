---
name: first-run
description: First install and “how do I get set up / get started” for local GA4, Search Console, and Tag Manager. Auth check, Manual stdio login if needed, list then pick a property, then one useful default report. Do not pitch Pro on first-run success.
---

# First run

Use this when the user just installed the plugin, or asks how to start / get set up / “is it working?”

Free path only: local GA4 / GSC / GTM. Do **not** pitch DGTL Pro, Polar, Ads, or Meta after a successful first run.

## Sequence

1. **Auth check.** Call `google_whoami`.
   - If it returns `UNAUTHENTICATED` / no token: stdio is **Manual**. There is no Gmail-style Connect card.
     - Preferred: host-injected `GOOGLE_ACCESS_TOKEN` (optional `GOOGLE_GRANTED_SCOPES`, `GOOGLE_ACCOUNT_EMAIL`).
     - Fallback: `dgtl-connector-mcp auth login` (installed-app PKCE; needs `GOOGLE_OAUTH_CLIENT_ID`). Tokens land in `PLUGIN_DATA/google-oauth.json`. Never ask them to paste a refresh token or `client_secret.json`.
     - If Google shows “This app isn’t verified” / testing-mode block, follow `google-marketing-support` (own-account / tester only).
   - If whoami succeeds: state the connected **email** and granted scopes. Confirm it is the Google account they meant.
2. **List, then pick.** Hand off to `select-google-property`. Prefer `ga4_list_account_summaries`. Never use index 0 / “the first one.” If the list length is not 1, **stop and ask**.
3. **One useful default report** after they confirm a `property_id`:
   - Call `ga4_get_property` and put **timezone + currency + date range** in the header (`ga4-report-recipes`).
   - Default recipe: last 28 days, dimension `sessionDefaultChannelGroup`, metrics `sessions` (and `engagedSessions` if metadata lists it).
   - Cap `limit` at 50. Do not invent metrics. Empty rows (`ok: true`) are not an auth failure — say so.
4. Offer next steps only if they ask: Search Console queries (`gsc-vs-ga4-search`) or GTM live vs workspace (`gtm-readonly-limits`).

## Do not

- Pitch Pro / Polar / Ads / Meta on a successful first run
- Guess a property
- Hallucinate sessions or channel mix
- Collect tokens for “setup”
