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

DGTL Sunrise is a local agent plugin. The user authorizes their own Google account so the plugin can read and manage Google Analytics 4, Search Console, and Tag Manager on their computer. Sunrise Consulting LLC does not receive report bytes. Mutate tools stay flagged off until the user opts in. This OAuth client (Free Google / Consent A) does **not** request Google Ads, Merchant Center, or Business Profile. Those stay on separate grants / Pro.

**Noel RED:** do not change Consent A Data Access in Google Cloud from an agent PR. The plugin now requests the Free Google manage scopes. Adding them on the Cloud consent screen is a Noel console atom.

---

## Scopes the plugin requests (Free Google / CONSENT_A)

The binary requests these on **one** consent screen. **Noel RED:** adding them on Google Cloud Data Access is a console atom, not an agent PR.

### Identity

1. `openid`
2. `https://www.googleapis.com/auth/userinfo.email`

### Sensitive read

3. `https://www.googleapis.com/auth/analytics.readonly`
4. `https://www.googleapis.com/auth/webmasters.readonly`
5. `https://www.googleapis.com/auth/tagmanager.readonly`

### Sensitive manage (same screen; live mutates need in-chat confirm)

6. `https://www.googleapis.com/auth/analytics.edit`
7. `https://www.googleapis.com/auth/tagmanager.edit.containers`
8. `https://www.googleapis.com/auth/tagmanager.publish`
9. `https://www.googleapis.com/auth/webmasters`

Do **not** declare `userinfo.profile`, `adwords`, `business.manage`, blanket `analytics`, `content`, Gmail, or Drive on this client.

---

## Scope justifications (paste into Google verification)

Google asks why each sensitive scope is required. Paste these verbatim. They match `docs/PERMISSIONS.md` and the 23 read-only tools.

### `https://www.googleapis.com/auth/analytics.readonly`

The app shows the signed-in user their own Google Analytics 4 accounts, properties, data streams, key events, metadata, and reports inside their local agent. Calls use Analytics Admin API and Analytics Data API. The app does not write, edit, or delete Analytics resources and does not access other users' Analytics data. Property IDs are chosen by the user; the app never silently picks a default property.

### `https://www.googleapis.com/auth/webmasters.readonly`

The app lists Search Console sites the signed-in user already has access to, reads query and page performance (search analytics), lists sitemaps, and inspects URL index status. The app does not add or remove sites, does not submit sitemaps, and does not request indexing. `webmasters.readonly` cannot perform those writes.

### `https://www.googleapis.com/auth/tagmanager.readonly`

The app lists the signed-in user's Tag Manager accounts, containers, workspaces, tags, triggers, variables, and the live (published) container version so they can audit what is on a site. `tagmanager.readonly` cannot publish. Create/edit/publish tools on this same Free Google grant stay flagged off until the user sets `DGTL_WRITES_ENABLED` and confirms.

### `openid` (non-sensitive)

Used so `google_whoami` can return a stable subject identifier for the connected Google account. Not used to sign the user into DGTL services. No DGTL account is required.

### `https://www.googleapis.com/auth/userinfo.email` (non-sensitive)

Used so `google_whoami` can show which Google account connected (email only). The plugin does not request `userinfo.profile`. Email is displayed locally and is never sent to Sunrise Consulting LLC as part of a report payload.

### `https://www.googleapis.com/auth/analytics.edit`

The app lets the signed-in user manage their own GA4 properties, data streams, key events, custom definitions, and Measurement Protocol secrets on their computer. Calls use Analytics Admin API. Mutates stay flagged off until the user opts in (`DGTL_WRITES_ENABLED`) and confirms the target property. The app does not access other users' Analytics data. Property IDs are chosen by the user.

### `https://www.googleapis.com/auth/tagmanager.edit.containers`

The app lets the signed-in user create and update tags, triggers, variables, clients, containers, and environments in Tag Manager workspaces they already can access. Mutates stay flagged off until the user opts in and confirms the container publicId. The app does not access other users' Tag Manager accounts.

### `https://www.googleapis.com/auth/tagmanager.publish`

The app lets the signed-in user publish a Tag Manager container version they already can access. Publish stays flagged off until the user opts in and confirms the container publicId. Publish is irreversible; the app does not publish without that confirm.

### `https://www.googleapis.com/auth/webmasters`

The app lets the signed-in user submit and delete sitemaps for Search Console sites they already verify. Mutates stay flagged off until the user opts in and confirms the exact site URL. The app does not request indexing and does not add or remove sites.

---

## How Google user data is used (Limited Use paragraph)

DGTL Sunrise's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.

- Data is used only to provide the user-facing read and manage features of the local plugin (list properties/sites/containers, show reports the user asked for, and apply confirmed local mutates the user opted into).
- GA4 / Search Console / Tag Manager report bytes are fetched on the user's computer and are not stored on DGTL servers.
- We do not sell Google user data. We do not use it for advertising. We do not transfer it to third parties except as needed to complete a request the user initiated or as required by law.
- Full policy: https://www.dgtlsunrise.com/privacy

Paid Google Ads / Meta (later, not this OAuth client) will use a separate consent and an allowlisted gateway. Do not mention Ads scopes in this client's verification form.

---

## Demo video pointer

Unlisted YouTube script: [DEMO-VIDEO-SCRIPT.md](DEMO-VIDEO-SCRIPT.md). The video must show the consent URL including this client's `client_id`, the app name **DGTL Sunrise**, the Free Google scopes, list → pick → report, GSC queries, GTM live version, and a refused publish (flag off). Auth on camera is installed-app PKCE (`auth login`), not a Gmail Connect card.

---

## Checklist before hitting Submit for verification

- [ ] App name is DGTL Sunrise
- [ ] Support email is noel@dgtlsunrise.com
- [ ] Homepage and privacy URLs return 200
- [ ] Authorized domain `dgtlsunrise.com` is Search Console-verified for this Cloud project
- [ ] Only Consent A scopes are listed
- [ ] Publishing status still Testing until Google accepts the submission
- [ ] Demo video is unlisted and follows the script
