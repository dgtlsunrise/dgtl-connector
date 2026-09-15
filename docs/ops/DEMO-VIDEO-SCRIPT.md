# Demo video script — Google OAuth verification (unlisted YouTube)

English. Unlisted YouTube. The historical readonly take is about 4 to 6 minutes. The 2026-09-15 Action Needed appendix is longer because it must show live GA4 and GTM UI impact. One take is fine if the address bar stays readable.

This is the video Google's sensitive-scope review asks for. See docs/PERMISSIONS.md. It is not a marketplace promo.

Auth on camera is Manual / PKCE, not a Connect card. Agent Plugins 1.0 and today's Cursor / Grok Bot stdio MCP do not give this plugin a Gmail-style Connect card. Show the installed-app login URL and the Google consent screen.

Do not show Ads, Meta, Gmail, Drive, a client secret, or token files. The 2026-09-15 Action Needed video must show the Free Google manage scopes and live GA4/GTM UI impact. See the appendix.

Shots 0–6 below are the historical readonly take. After Free full Connect, also film the appendix **Manage-scope verification**.

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

On-screen text: DGTL Sunrise, local read-only GA4 / Search Console / Tag Manager, package dgtl-connector 0.1.0, publisher Sunrise Consulting LLC.

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

## Shot 6. Refuse publish (historical readonly take only)

Do **not** film this shot for the 2026-09-15 Action Needed. Google now asks for a live GTM publish with source-account impact. Use appendix shots M4–M5.

This shot belongs only to the earlier readonly video (`https://youtu.be/1HLqQDRKmM0`). That take asked the agent to refuse publish because Consent A was still readonly. Free Google now requests `tagmanager.publish` on the same Connect.

---

## What not to film

- Ads, Meta, GBP, Gmail, Drive
- A Connect card or "Authorize Google" marketplace button presented as if stdio had one
- `.env`, `google-oauth.json`, refresh tokens, HAR files
- Client secret dialog
- Client names from the book of business
- For the historical readonly take only: any write. The Action Needed appendix requires the named live mutates.

---

## Upload

1. YouTube → Unlisted (not Private; Google reviewers need the link without a Google login wall if possible; Unlisted is what Google asks for).
2. Title: `DGTL Sunrise OAuth verification — GA4 GSC GTM readonly`
3. Description: homepage https://www.dgtlsunrise.com/ — privacy https://www.dgtlsunrise.com/privacy — support noel@dgtlsunrise.com
4. Paste the URL into the Google verification form. Do not tweet it.

If Google asks to re-shoot because the client ID was cropped, re-do Shot 1 only and splice, or re-record the whole take.

---

## Appendix. Manage-scope verification (2026-09-15 Action Needed)

Film this as the verification video Google asked for on 2026-09-15. Do not splice the historical readonly take (`https://youtu.be/1HLqQDRKmM0`) and call it done. That video does not show why `analytics.edit`, `tagmanager.edit.containers`, or `tagmanager.publish` are required, and it does not show source-account impact in the GA4 or GTM UI.

Use a disposable DGTL property and a disposable GTM container. No client book of business. Unlisted YouTube. Do not show Ads, Meta, GBP, Merchant Center, Gmail, Drive, tokens, or secrets. Do not mention or toggle `DGTL_WRITES_ENABLED`. Free Google mutates are Connect plus in-chat confirm only.

`dry_run` defaults true on every named mutate. A live call needs `dry_run=false` and `confirm_phrase` that includes the resource id (`properties/{id}` for GA4 Admin, container publicId such as `GTM-XXXX` for GTM). Zod rejects a live call with an empty confirm. The handler also rejects a confirm that omits that id.

Revoke DGTL Sunrise under Google Account, Third-party access, before Shot M1. If a prior readonly grant remains, Google incremental consent (`include_granted_scopes=true`) can show only leftover scopes. Reviewers must see edit and publish on this screen.

Voice language Google invited: say this is an integration platform. The user authorizes their own Google account on their computer. Free Google uses a least-privilege auth model. This client requests only GA4, Search Console, and Tag Manager read and manage. It does not request Google Ads, Merchant Center, or Business Profile.

Operator packet: [OAUTH-ACTION-NEEDED-2026-09-15.md](OAUTH-ACTION-NEEDED-2026-09-15.md).

### Shot M1. Consent shows edit and publish

1. Run `dgtl-connector-mcp auth login` (stdio Manual path; not a Connect card).
2. Open the printed `accounts.google.com` URL.
3. Hold the address bar until a reviewer can read:
   - host is `accounts.google.com`
   - `client_id=` equals the Desktop OAuth client
   - `scope=` includes the exact strings `https://www.googleapis.com/auth/analytics.edit`, `https://www.googleapis.com/auth/tagmanager.edit.containers`, `https://www.googleapis.com/auth/tagmanager.edit.containerversions`, `https://www.googleapis.com/auth/tagmanager.publish`, and `https://www.googleapis.com/auth/webmasters`
   - `scope=` also includes the readonly trio (`analytics.readonly`, `webmasters.readonly`, `tagmanager.readonly`) plus `openid` and `userinfo.email`
   - `scope=` does not include `adwords`, `content`, or `business.manage`
4. Consent screen must show app name **DGTL Sunrise** and the manage scopes (wording may vary: Manage your Google Analytics data; Edit your Google Tag Manager containers; Publish your Google Tag Manager containers).
5. Click Allow. Do not uncheck Tag Manager.

Voice: "This is installed-app PKCE for an integration platform. The user grants read and manage for Analytics, Search Console, and Tag Manager on one least-privilege screen. Ads stay off this client."

### Shot M2. GA4 Admin dry_run, then live confirm

Use a disposable DGTL GA4 property. Name the property id out loud (`properties/{id}`).

1. Call `ga4_create_custom_dimension` with `dry_run` omitted or true. Show the proposed `parameter_name` / `display_name` and `properties/{id}`. No Admin write yet.
2. Call the same tool with `dry_run=false` and `confirm_phrase` that includes that `properties/{id}`. Example display name: `DGTL OAuth verify dim`.
3. Switch to `https://analytics.google.com` while signed in as the same Google account. Open Admin, Data display, Custom definitions on that property. Show the new dimension.

Voice: "Dry-run defaults true. Live mutate needs confirm_phrase with the property id. Here is the same change in the Analytics Admin UI."

### Shot M3. GTM container edit with confirm

Use a disposable DGTL GTM container. Name the publicId out loud (`GTM-…`).

1. Call `gtm_create_tag` with `dry_run` true. Show the proposed tag name and the publicId. No workspace write yet.
2. Call the same tool with `dry_run=false` and `confirm_phrase` that includes that publicId. Example name: `DGTL OAuth verify tag`. Type can be `html`.
3. Switch to `https://tagmanager.google.com` on that container workspace. Show the new tag in the workspace list.

Voice: "tagmanager.edit.containers is for workspace edits the user confirms. Here is the tag in Tag Manager."

### Shot M4. GTM publish with confirm

Same container. Publish is irreversible. Use the disposable container only.

1. Call `gtm_publish_container` with `dry_run` true. Show `create_version_then_publish` and the publicId. No publish yet. Live `create_version` needs `tagmanager.edit.containerversions` on the same grant.
2. Call the same tool with `dry_run=false`, `confirm_phrase` that includes that publicId, and a `version_name` such as `DGTL OAuth verify publish`.
3. Stay in `https://tagmanager.google.com`. Open Versions. Show the new published version as the live version.

Voice: "tagmanager.publish is only for a confirmed publish. Here is the published version in Tag Manager."

### Shot M5. Optional refuse without confirm

If time remains, call one of the live tools with `dry_run=false` and no `confirm_phrase` (or a phrase that omits the resource id). The plugin must refuse (`INVALID_ARGUMENT`). Then continue with the confirmed live call. Do not end the video on the refusal. Google asked to see source-account impact.

### What this appendix must not show

- Ads, Meta, GBP, Merchant Center, Gmail, Drive
- A Connect card presented as if stdio had one
- `.env`, `google-oauth.json`, refresh tokens, HAR files, client secrets
- `DGTL_WRITES_ENABLED`
- Client names from the book of business

### Upload (Action Needed video)

1. YouTube, Unlisted. Reviewers need the link without a login wall if possible.
2. Title: `DGTL Sunrise OAuth verification - Free Google manage scopes`
3. Description: homepage https://www.dgtlsunrise.com/ , privacy https://www.dgtlsunrise.com/privacy , support noel@dgtlsunrise.com
4. Reply on the existing Google verification thread with the new unlisted URL. Do not open a new case. Google used that thread for this Action Needed.
5. Do not tweet the video.
