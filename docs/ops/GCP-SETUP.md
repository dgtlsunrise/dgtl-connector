# GCP setup — DGTL Sunrise Desktop OAuth (Consent A)

**Who:** Noel, signed in as `noel@dgtlsunrise.com`  
**Package:** `dgtl-connector` 0.1.0  
**Publisher:** Sunrise Consulting LLC / DGTL Sunrise  
**This session does not:** call Google APIs, create Polar products, invent secrets, or spend money.

stdio auth is **AuthPort** (host-injected token, then installed-app PKCE). There is **no** Gmail-style Connect card. The OAuth client is a **Desktop** client. Put the Client ID in gitignored `.env`. Put `GOOGLE_OAUTH_CLIENT_SECRET` in the same gitignored `.env` for token exchange. Never commit either secret file; never put the secret in `mcp.json` or the binary.

Paste-ready brand strings live in [OAUTH-CONSENT-COPY.md](OAUTH-CONSENT-COPY.md). Personal clicks only: [NOEL-ONLY-CHECKLIST.md](NOEL-ONLY-CHECKLIST.md).

---

## What you are creating

| Item | Value |
| --- | --- |
| GCP project | New or existing under Sunrise Consulting LLC |
| User type | **External** |
| Publishing status | **Testing** (do not Publish until Google verification) |
| OAuth client type | **Desktop app** (installed app, loopback PKCE) |
| Secret | Gitignored `.env` only (`GOOGLE_OAUTH_CLIENT_SECRET`). Never git, chat, or `mcp.json`. |
| Env vars | `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in gitignored `.env`. Project of record: `dgtl-marketing-oauth-20260903` (559563115308). |
| Consent A scopes | `analytics.readonly`, `webmasters.readonly`, `tagmanager.readonly`, `openid`, `userinfo.email` |
| Not on this client | Ads (`adwords`), GBP (`business.manage`), Gmail, Drive, write/edit/publish GTM |

---

## 1. Sign in and pick the project

1. Open [Google Cloud Console](https://console.cloud.google.com/) in a browser **as `noel@dgtlsunrise.com`**.
2. Confirm the account chip is `noel@dgtlsunrise.com`, not a personal Gmail or an Axos/work identity.
3. Project picker (top bar) → **New Project** *or* select an existing Sunrise Consulting LLC project you already intend for this OAuth client.
   - Suggested name: `dgtl-sunrise-marketing`
   - Organization: Sunrise Consulting LLC if it appears. Otherwise No organization is acceptable for a personal Google account.
4. Note the **Project ID** (not only the display name). You will need it when enabling APIs.

Billing: Google may ask you to attach a billing account before some APIs enable. That is a **you** click. This plugin session does not attach billing or spend.

---

## 2. Enable the APIs

On **this** project (the one that will own the OAuth client). End users do not enable these on their own GCP projects.

Open the API Library: [console.cloud.google.com/apis/library](https://console.cloud.google.com/apis/library) with the project selected.

Enable these APIs (search the display name, open it, click **Enable**):

| Console name | Service name | Used by |
| --- | --- | --- |
| Google Analytics Admin API | `analyticsadmin.googleapis.com` | list/get GA4 accounts, properties, streams, key events |
| Google Analytics Data API | `analyticsdata.googleapis.com` | `ga4_run_report`, `ga4_get_metadata` |
| Search Console API | `searchconsole.googleapis.com` | sites, searchanalytics, sitemaps, URL Inspection |
| Tag Manager API | `tagmanager.googleapis.com` | GTM accounts, containers, workspaces, tags, live version |
| People API | `people.googleapis.com` | required for Desktop Sign-In; without it Google returns `invalid_client` |

Do **not** enable Google Ads API, My Business / Business Profile APIs, Gmail, or Drive on this client "for later." Ads/Meta go through a later Polar + Worker gateway on a **different** OAuth client (Consent C). GBP is Consent B and stays off until quota is non-zero.

Confirm on [Enabled APIs](https://console.cloud.google.com/apis/dashboard) that all five show Enabled.

If a later smoke test returns `403 accessNotConfigured`, the missing API is a **publisher defect** on this project, not an end-user GA4 permission problem.

---

## 3. OAuth consent screen — External / Testing

Google Auth Platform (2025–2026 console): [APIs & Services → Google Auth Platform](https://console.cloud.google.com/auth/overview).

Older label: **OAuth consent screen**. New UI splits into **Branding**, **Audience**, **Data Access**, **Clients**.

### 3a. Branding — paste from OAUTH-CONSENT-COPY.md

Fill **exactly**:

| Field | Value |
| --- | --- |
| App name | `DGTL Sunrise` |
| User support email | `noel@dgtlsunrise.com` |
| App logo | optional; `assets/logo.svg` in the plugin repo if you upload a PNG/SVG Google accepts |
| Application home page | `https://www.dgtlsunrise.com/` |
| Privacy policy | `https://www.dgtlsunrise.com/privacy` |
| Terms of service | leave blank unless you later publish a ToS URL on the same domain |
| Authorized domains | `dgtlsunrise.com` (top private domain; no `www.`, no path) |
| Developer contact | `noel@dgtlsunrise.com` |

Authorized domains must be verified in [Google Search Console](https://search.google.com/search-console) for the Google account that owns this Cloud project (or an Owner on the project). Verify `dgtlsunrise.com` if the console blocks saving the domain.

Do not invent a second brand name on this screen. Package id `dgtl-connector` is not the consent-screen name.

### 3b. Audience — External + Testing

1. User type: **External** (anyone with a Google account; required for a public plugin later).
2. Publishing status: **Testing**. Stay here until Google verification (demo video + privacy + brand) is submitted and approved.
3. Test users → **Add users**:
   - `noel@dgtlsunrise.com` (required)
   - any named testers you actually intend to invite this week
4. Cap is 100 test users. Strangers not on the list get `access_denied` / "app is in testing." That is expected.

Do **not** click **Publish app** in this pass. Publishing with sensitive scopes without verification strands users and starts a review you are not ready for.

### 3c. Data Access — Consent A only

Add scopes (Data Access → Add or remove scopes). Add **all five on one consent**, not sequential clients.

**Sensitive (declare + justify later):**

- `https://www.googleapis.com/auth/analytics.readonly`
- `https://www.googleapis.com/auth/webmasters.readonly`
- `https://www.googleapis.com/auth/tagmanager.readonly`

**Non-sensitive identity (same screen):**

- `openid`
- `https://www.googleapis.com/auth/userinfo.email`

Justifications (paste-ready): [OAUTH-CONSENT-COPY.md](OAUTH-CONSENT-COPY.md).

**Never add on this client:**

- `https://www.googleapis.com/auth/adwords`
- `https://www.googleapis.com/auth/analytics` or `analytics.edit`
- `https://www.googleapis.com/auth/webmasters` (read/write)
- `https://www.googleapis.com/auth/tagmanager.edit.containers`
- `https://www.googleapis.com/auth/tagmanager.publish`
- `https://www.googleapis.com/auth/business.manage`
- Gmail, Drive, Calendar, People profile (`userinfo.profile` is not required)

Google rejects "future enhancement" scopes. Ads stays off this OAuth client.

---

## 4. Create the Desktop OAuth client (ID public; secret in gitignored `.env`)

1. Google Auth Platform → **Clients** → **Create client**  
   (or [Credentials](https://console.cloud.google.com/apis/credentials) → Create credentials → OAuth client ID).
2. Application type: **Desktop app**.  
   Not Web application. Not iOS. Not Chrome. Web clients expect a confidential secret and fixed redirect URIs; this plugin binds an **ephemeral** loopback port (`127.0.0.1:<random>/callback`) and exchanges the code with `client_secret` from gitignored `.env` (Google Desktop clients require it at `/token`).
3. Name (label only, not shown on consent): `dgtl-marketing-desktop`.
4. Create.
5. Copy **Client ID** only. Shape is `….apps.googleusercontent.com`.
6. Copy **Client secret** into gitignored `.env` as `GOOGLE_OAUTH_CLIENT_SECRET`. Do not paste it into chat, `mcp.json`, or git. `src/auth/pkce.ts` sends it only when that env var is set.

Redirect URIs: Desktop + loopback is the supported path for this binary (`http://127.0.0.1:<port>/callback`). You do **not** register a Cursor/Grok Connect-card callback on this client. stdio has no Connect card.

Download JSON if you want a local backup **outside git**. The repo gitignores `client_secret*.json`. Do not commit it.

---

## 5. Put the Client ID on the box

On the Grok Bot box, in the plugin root `/workspace/dgtl-google-plugin`:

1. Copy `.env.example` to `.env` if `.env` does not exist.
2. Set `GOOGLE_OAUTH_CLIENT_ID` to the Desktop client id (ends in `.apps.googleusercontent.com`).
3. Set `GOOGLE_OAUTH_CLIENT_SECRET` in the same gitignored `.env` (required for `/token`).
4. Leave `GOOGLE_ACCESS_TOKEN` empty for the PKCE path (host-injected is a different adapter).

Tell the agent the Client ID (it is a public identifier) or paste it into `.env` yourself. Do not send refresh tokens.

---

## 6. What the agent will do after you sign in on the box

After steps 1-5, you still complete Google's consent UI (password / 2FA / account picker). The agent cannot use your Google password.

Then a Grok Bot agent on this box will:

1. Confirm `.env` contains `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`, and does not contain a refresh token or Ads developer token. Confirm `.env` is gitignored.
2. From the plugin root, after a build if needed, run the documented PKCE subcommand: `dgtl-connector-mcp auth login`.
   The binary binds loopback, prints an accounts.google.com URL, and that URL must include `client_id=` matching the Desktop client (required for the verification demo video).
3. You open that URL in a browser on the box that can reach loopback on this machine. Sign in as a test user. Grant all three product scopes plus identity. Do not uncheck GTM if you want the live-version smoke.
4. Google redirects to loopback. The binary exchanges the code with PKCE and `GOOGLE_OAUTH_CLIENT_SECRET` from gitignored `.env` at `/token`, writes `PLUGIN_DATA/google-oauth.json` with mode 0600, and prints that authorization was saved without logging the refresh token.
5. The agent then, without printing tokens:
   - `dgtl-connector-mcp auth status` (email, token_source pkce, scopes; no bearer)
   - MCP `google_whoami` (email + granted scopes)
   - `ga4_list_account_summaries`, then ask you which property (never index 0)
   - one `ga4_run_report` on the ID you confirm
   - `gsc_list_sites` then `gsc_query_search_analytics` with dimension `query`
   - `gtm_list_accounts` then containers then `gtm_get_live_container_version`
   - confirm Consent A cannot publish; a "publish this tag" prompt is refused (write stubs, if any, are flagged off / different OAuth client)
6. The agent will not: commit `.env` or `google-oauth.json`, call Polar, create Cloud secrets, add Ads scopes, or email Google.

If login fails with `access_denied`, you are not a test user or the app is Internal. If `redirect_uri_mismatch`, the client is not Desktop. If `403 accessNotConfigured`, re-check the four APIs on this project.

Logout later: `dgtl-connector-mcp auth logout` (clears the store). Also revoke at Google Account, Third-party access.

---

## 7. Stay in Testing until verification

| Ready now | Not this pass |
| --- | --- |
| Test users on the allowlist | Publish app / In production |
| Desktop client ID in `.env` | Web client + Connect-card redirect |
| Consent A scopes only | Ads / GBP / Gmail scopes |
| Privacy + homepage live | Marketplace listing for strangers |

Google verification package (when you are ready): brand fields + [DEMO-VIDEO-SCRIPT.md](DEMO-VIDEO-SCRIPT.md) (unlisted YouTube) + scope justifications. Sensitive-scope review is separate from Cursor/xAI marketplace review.

---

## Pointers in this repo

- Scopes in code: `src/google/scopes.ts` (`CONSENT_A`)
- PKCE (public client): `src/auth/pkce.ts`, `src/auth/login-cli.ts`
- Env template: `.env.example`
- Product rules: `docs/PERMISSIONS.md`
