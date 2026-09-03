# Demo video script — Google OAuth verification (unlisted YouTube)

English. Unlisted YouTube. About 4 to 6 minutes. One take is fine if the address bar stays readable.

This is the video Google's sensitive-scope review asks for. See docs/PERMISSIONS.md. It is not a marketplace promo.

Auth on camera is Manual / PKCE, not a Connect card. Agent Plugins 1.0 and today's Cursor / Grok Bot stdio MCP do not give this plugin a Gmail-style Connect card. Show the installed-app login URL and the Google consent screen.

Do not show Ads, Gmail, Drive, write scopes, a client secret, or token files.

---

## Before you record

- OAuth app: External / Testing; you are a test user.
- Desktop client ID is in `.env` as `GOOGLE_OAUTH_CLIENT_ID`.
- Four APIs enabled on that GCP project.
- Browser zoom so the address bar and consent app name are readable.
- Use a Google account that can see at least one GA4 property, one GSC site, and one GTM container (DGTL's own properties; no client data).
- Terminal in the plugin directory. Build already done.
- If a previous grant exists, log out of the plugin store and revoke DGTL Sunrise under Google Account, Third-party access, so consent is not skipped.

---

## Shot 0 — Title (optional, 5 seconds)

On-screen text: DGTL Sunrise, local read-only GA4 / Search Console / Tag Manager, package dgtl-marketing 0.1.0, publisher Sunrise Consulting LLC.

Voice: "This demo shows DGTL Sunrise reading Google Analytics, Search Console, and Tag Manager after the user signs in on their own computer. The plugin cannot publish tags or change campaigns."

---

## Shot 1 — Consent with client ID in the URL (required)

1. In the terminal, run the plugin PKCE login (stdio Manual path; not a Connect card).
2. The binary prints: "Open this URL in a browser (installed-app PKCE; not a Gmail Connect card):" plus an accounts.google.com URL.
3. Open the URL. **Hold the address bar** long enough to read:
   - host is accounts.google.com
   - query contains `client_id=` equal to the Desktop OAuth client
   - query contains the three product scopes (analytics.readonly, webmasters.readonly, tagmanager.readonly) plus openid / userinfo.email
4. Consent screen must show app name **DGTL Sunrise**.
5. Show the three product scopes (See and download your Google Analytics data; View Search Console data; View your Google Tag Manager data — wording may vary).
6. Click Allow. Do not uncheck GTM.
7. Browser lands on loopback with the success sentence: authorization saved on this computer.

Voice: "This is an installed-app PKCE login, not a Gmail Connect card. The client ID in the address bar is DGTL's public Desktop client. Tokens stay on this computer."

If Google skips the consent screen, you are already granted. Revoke and re-record Shot 1. Verification reviewers need the scopes and the client ID.

---

## Shot 2 — Whoami

In the agent (or `auth status`), show `google_whoami`: email, granted scopes, no access token on screen.

Voice: "Whoami returns the Google account and scopes. It never returns the bearer token."

---

## Shot 3 — List, pick, report (GA4)

1. Call `ga4_list_account_summaries` (or list accounts then properties).
2. If more than one property, **stop and pick one out loud**. Do not use the first row silently. Say the property ID (`properties/…`) and display name.
3. Call `ga4_run_report` on that ID (simple: last 7 days, `sessions`, dimension `sessionDefaultChannelGroup`, limit 10).
4. Show numbers in the answer **and** the property ID in the header.

Voice: "The plugin lists properties, I pick one, then runReport. It never guesses the first of forty clients."

---

## Shot 4 — GSC queries

1. `gsc_list_sites`. Pick one site URL exactly as listed (`https://…/` or `sc-domain:…`).
2. `gsc_query_search_analytics` with dimension `query` (and dates).
3. Show query rows: query text, clicks, impressions.

Voice: "Search queries live in Search Console, not in GA4. There is no searchQuery dimension in the Data API."

Do not attempt `ga4_run_report` with `searchQuery` except as a later optional refusal (denylist). Keep this shot on GSC.

---

## Shot 5 — GTM live

1. `gtm_list_accounts` → pick an account → `gtm_list_containers` → pick a container.
2. `gtm_get_live_container_version` (published version). Optionally contrast with workspace tags and say workspace is draft.
3. Name the container public ID (`GTM-…`) in the answer.

Voice: "This is the live container version — what is published. Workspace lists can include unpublished drafts."

---

## Shot 6 — Refuse publish (required)

User (you): "Publish this GTM tag to production."

Agent must decline. There is no publish tool. Readonly scope cannot publish. Point at the Google Tag Manager UI.

Voice: "Publishing is out of scope. The plugin is read-only. I will not invent a publish tool."

---

## What not to film

- Ads, Meta, GBP, Gmail, Drive
- A Connect card or "Authorize Google" marketplace button presented as if stdio had one
- `.env`, `google-oauth.json`, refresh tokens, HAR files
- Client secret dialog
- Any write: create tag, submit sitemap, request indexing
- Client names from the book of business

---

## Upload

1. YouTube → Unlisted (not Private; Google reviewers need the link without a Google login wall if possible; Unlisted is what Google asks for).
2. Title: `DGTL Sunrise OAuth verification — GA4 GSC GTM readonly`
3. Description: homepage https://www.dgtlsunrise.com/ — privacy https://www.dgtlsunrise.com/privacy — support noel@dgtlsunrise.com
4. Paste the URL into the Google verification form. Do not tweet it.

If Google asks to re-shoot because the client ID was cropped, re-do Shot 1 only and splice, or re-record the whole take.
