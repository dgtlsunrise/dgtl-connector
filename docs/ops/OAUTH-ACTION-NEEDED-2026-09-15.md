# Google Action Needed, 2026-09-15 (Consent A manage scopes)

How-to for the operator. Reply on the existing Google verification thread. Google used that thread for this Action Needed. Do not open a new case. Do not send this file to Google as the reply. Use it to film the video and write the thread reply.

Do not change Google Cloud Console from an agent. Do not send email from an agent. Never Axos.

## What Google asked

1. The demo video does not show why these scopes are needed:
   - `https://www.googleapis.com/auth/analytics.edit`
   - `https://www.googleapis.com/auth/tagmanager.edit.containers`
   - `https://www.googleapis.com/auth/tagmanager.publish`
   Write demos must show source-account impact in the GA4 UI and the GTM UI.
2. Scope discrepancy. Reviewers saw the app request only `analytics.readonly` and `tagmanager.readonly`. Cloud Console Data Access lists the three write scopes. They want a strict string match between the OAuth request and Console.

The prior unlisted video (`https://youtu.be/1HLqQDRKmM0`) is the historical readonly take. Do not resubmit it for this Action Needed.

## Current tip scope truth

Measured in this repo on `src/google/scopes.ts` `CONSENT_A` and `plugin.json` `com.dgtlsunrise.consentA`. Free Connect already requests the full set. `workspaces/{id}:create_version` needs `tagmanager.edit.containerversions` before publish. Live mutates stay confirm-gated. `dry_run` defaults true. The agent does not change Cloud Console.

`buildGoogleAuthUrl` in `src/auth/pkce.ts` defaults to `CONSENT_A`. `auth login` / `login-write` / `login-ga4-admin` / `login-gsc-write` pass that same set. Host-injected `GOOGLE_ACCESS_TOKEN` does not build a Google URL. It only carries whatever scopes the host already granted. Ads (`adwords`), Merchant Center (`content`), and GBP (`business.manage`) stay off Free Connect.

Exact Free Connect `scope` strings (one consent, this order):

1. `openid`
2. `https://www.googleapis.com/auth/userinfo.email`
3. `https://www.googleapis.com/auth/analytics.readonly`
4. `https://www.googleapis.com/auth/webmasters.readonly`
5. `https://www.googleapis.com/auth/tagmanager.readonly`
6. `https://www.googleapis.com/auth/analytics.edit`
7. `https://www.googleapis.com/auth/tagmanager.edit.containers`
8. `https://www.googleapis.com/auth/tagmanager.edit.containerversions`
9. `https://www.googleapis.com/auth/tagmanager.publish`
10. `https://www.googleapis.com/auth/webmasters`

`tests/free-full-connect.test.ts` parses the authorization URL `scope` query param and asserts those exact strings. It also asserts `adwords`, `content`, and `business.manage` are absent.

If reviewers still see readonly-only, the usual causes are the old video, a leftover readonly grant with incremental consent (`include_granted_scopes=true`), or a host-injected token that never requested manage scopes. Revoke DGTL Sunrise under Google Account, Third-party access, then run `dgtl-connector-mcp auth login` so the address bar shows the full `scope=` list.

## Demo shot list

Film per [DEMO-VIDEO-SCRIPT.md](DEMO-VIDEO-SCRIPT.md) appendix. Unlisted YouTube.

| Shot | What to show | Why it answers Google |
| --- | --- | --- |
| M1 | PKCE URL + consent. Address bar shows the five manage strings plus the readonly trio and identity. App name **DGTL Sunrise**. No Ads. | String match between OAuth request and Console. Consent shows edit/publish. |
| M2 | `ga4_create_custom_dimension`: dry_run default, then `dry_run=false` + `confirm_phrase` with `properties/{id}`. Then Admin, Custom definitions on `https://analytics.google.com`. | Why `analytics.edit` is needed. Source-account impact. |
| M3 | `gtm_create_tag`: dry_run default, then live confirm with container publicId. Then the tag in `https://tagmanager.google.com` workspace. | Why `tagmanager.edit.containers` is needed. Source-account impact. |
| M4 | `gtm_publish_container`: dry_run default, then live confirm with publicId. Then Versions, live version, in Tag Manager. | Why `tagmanager.publish` is needed. Source-account impact. |
| M5 (optional) | One live call without `confirm_phrase` refused, then the confirmed live call. | Least-privilege auth model. Confirm is the write gate. |

`dry_run` defaults true. Live mutates need `confirm_phrase` that includes the resource id. Use a disposable DGTL property and a disposable GTM container.

## Reply checklist

Reply on the existing thread. Google used it.

- [ ] Revoke the old grant. Run `auth login`. Confirm the printed URL `scope=` includes the ten strings above and omits `adwords` / `content` / `business.manage`.
- [ ] Film M1–M4 (M5 optional). Address bar readable. GA4 and GTM UIs show the change.
- [ ] Upload Unlisted YouTube. Title: `DGTL Sunrise OAuth verification - Free Google manage scopes`.
- [ ] Paste the new URL on the existing thread. State that the prior video was the readonly take and this video is the manage-scope evidence.
- [ ] Paste the ten scope strings and say they are the same strings Console Data Access lists for this Desktop client. Ask them to match the URL `scope=` query, not a host-injected leftover grant.
- [ ] Use the integration-platform / least-privilege wording Google invited: DGTL Sunrise is an integration platform. The user authorizes their own Google account on their computer. This client requests only GA4, Search Console, and Tag Manager read and manage. It does not request Google Ads, Merchant Center, or Business Profile. Live mutates need in-chat confirm. `dry_run` defaults true.
- [ ] Do not mention Ads tools, Meta, tokens, secrets, or `DGTL_WRITES_ENABLED`.
- [ ] Do not change Cloud Console from an agent. Stage `tagmanager.edit.containerversions` on Data Access in a separate operator pass. The binary already requests it. Live `create_version` fails with ACCESS_TOKEN_SCOPE_INSUFFICIENT without that Console grant.
- [ ] Do not send a new email thread.

Justifications to reuse: [OAUTH-CONSENT-COPY.md](OAUTH-CONSENT-COPY.md) (`analytics.edit`, `tagmanager.edit.containers`, `tagmanager.edit.containerversions`, `tagmanager.publish`, `webmasters`).
