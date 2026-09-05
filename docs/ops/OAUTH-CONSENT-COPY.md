# OAuth consent copy — paste-ready (Google verification)

**App / package:** `dgtl-connector` 0.1.0  
**Publisher:** Sunrise Consulting LLC / DGTL Sunrise  
**OAuth client:** public Desktop (Consent A only). No Ads scopes on this client.

Use these strings on Google Auth Platform → Branding, Audience, Data Access, and in the verification questionnaire. Do not paraphrase scopes.

---

## Brand fields

| Console field | Paste this |
| --- | --- |
| App name | DGTL Sunrise |
| User support email | noel@dgtlsunrise.com |
| Developer contact information | noel@dgtlsunrise.com |
| Application home page | https://www.dgtlsunrise.com/ |
| Application privacy policy link | https://www.dgtlsunrise.com/privacy |
| Application terms of service link | *(leave blank until a ToS URL exists on dgtlsunrise.com)* |
| Authorized domains | dgtlsunrise.com |
| App logo | optional PNG from `assets/logo.svg` (export if the console rejects SVG) |

Authorized domain is the **top private domain** only: `dgtlsunrise.com` (no `www`, no path). Homepage and privacy URLs must use that domain. Verify ownership in Search Console for the Google account that owns the Cloud project.

**Do not use:** `dgtl-connector` or `dgtl-marketing` as the consent-screen app name. Those are package / working titles. Google shows the App name to users.

---

## One-line product description (questionnaire / demo intro)

DGTL Sunrise is a local agent plugin. The user authorizes their own Google account so the plugin can read Google Analytics 4, Search Console, and Tag Manager on their computer. Sunrise Consulting LLC does not receive report bytes. This OAuth client (Consent A) is readonly only — it cannot create, update, publish, or delete. Separate write/publish tools, if present in the package, are flagged off and use a **different** OAuth client (Consent W), not this verification client.

---

## Scopes to declare (exactly Consent A)

Request all five on **one** consent screen. Do not add others on this client.

### Sensitive

1. `https://www.googleapis.com/auth/analytics.readonly`
2. `https://www.googleapis.com/auth/webmasters.readonly`
3. `https://www.googleapis.com/auth/tagmanager.readonly`

### Non-sensitive identity (same screen)

4. `openid`
5. `https://www.googleapis.com/auth/userinfo.email`

Do **not** declare `userinfo.profile`, `adwords`, `business.manage`, `analytics` (read/write), `webmasters` (read/write), `tagmanager.edit.containers`, `tagmanager.publish`, Gmail, or Drive.

---

## Scope justifications (paste into Google verification)

Google asks why each sensitive scope is required. Paste these verbatim. They match `docs/PERMISSIONS.md` and the 23 read-only tools.

### `https://www.googleapis.com/auth/analytics.readonly`

The app shows the signed-in user their own Google Analytics 4 accounts, properties, data streams, key events, metadata, and reports inside their local agent. Calls use Analytics Admin API and Analytics Data API. The app does not write, edit, or delete Analytics resources and does not access other users' Analytics data. Property IDs are chosen by the user; the app never silently picks a default property.

### `https://www.googleapis.com/auth/webmasters.readonly`

The app lists Search Console sites the signed-in user already has access to, reads query and page performance (search analytics), lists sitemaps, and inspects URL index status. The app does not add or remove sites, does not submit sitemaps, and does not request indexing. `webmasters.readonly` cannot perform those writes.

### `https://www.googleapis.com/auth/tagmanager.readonly`

The app lists the signed-in user's Tag Manager accounts, containers, workspaces, tags, triggers, variables, and the live (published) container version so they can audit what is on a site. This Consent A client does not create, edit, delete, or publish tags — `tagmanager.readonly` cannot publish. Publish/edit tools may exist in the package **flagged off** behind a **different** OAuth client (Consent W); they are not granted by this scope and are not part of this verification.

### `openid` (non-sensitive)

Used so `google_whoami` can return a stable subject identifier for the connected Google account. Not used to sign the user into DGTL services. No DGTL account is required.

### `https://www.googleapis.com/auth/userinfo.email` (non-sensitive)

Used so `google_whoami` can show which Google account connected (email only). The plugin does not request `userinfo.profile`. Email is displayed locally and is never sent to Sunrise Consulting LLC as part of a report payload.

---

## How Google user data is used (Limited Use paragraph)

DGTL Sunrise's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.

- Data is used only to provide the user-facing read features of the local plugin (list properties/sites/containers and show reports the user asked for).
- GA4 / Search Console / Tag Manager report bytes are fetched on the user's computer and are not stored on DGTL servers.
- We do not sell Google user data. We do not use it for advertising. We do not transfer it to third parties except as needed to complete a request the user initiated or as required by law.
- Full policy: https://www.dgtlsunrise.com/privacy

Paid Google Ads / Meta (later, not this OAuth client) will use a separate consent and an allowlisted gateway. Do not mention Ads scopes in this client's verification form.

---

## Demo video pointer

Unlisted YouTube script: [DEMO-VIDEO-SCRIPT.md](DEMO-VIDEO-SCRIPT.md). The video must show the consent URL including this client's `client_id`, the app name **DGTL Sunrise**, the three product scopes, list → pick → report, GSC queries, GTM live version, and a refused publish. Auth on camera is installed-app PKCE (`auth login`), not a Gmail Connect card.

---

## Checklist before hitting Submit for verification

- [ ] App name is DGTL Sunrise
- [ ] Support email is noel@dgtlsunrise.com
- [ ] Homepage and privacy URLs return 200
- [ ] Authorized domain `dgtlsunrise.com` is Search Console-verified for this Cloud project
- [ ] Only Consent A scopes are listed
- [ ] Publishing status still Testing until Google accepts the submission
- [ ] Demo video is unlisted and follows the script
