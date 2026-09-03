# Launch-assets status — dgtl-marketing 0.1.0

Date: 2026-09-03 (PT)  
Publisher: Sunrise Consulting LLC / DGTL Sunrise  
This pass: docs only. No Google API calls. No Polar products. No secrets invented. No spend.

---

## Done (this pass)

- GCP-SETUP.md — Noel@dgtlsunrise.com: project, four APIs, External/Testing consent, Desktop public client, test users, Client ID into .env as GOOGLE_OAUTH_CLIENT_ID. After Noel consents on the box, the agent runs PKCE login, whoami, list then pick then report, GSC queries, GTM live, refuse publish.
- OAUTH-CONSENT-COPY.md — paste-ready app name, emails, homepage, privacy URL, authorized domain, Consent A justifications.
- DEMO-VIDEO-SCRIPT.md — unlisted YouTube script matching PERMISSIONS.md. stdio is Manual/PKCE, not a Connect card. Client id in the URL.
- POLAR-LICENSE-PLAN.md — Phase 8 design: Polar Pro checkout, webhook, Worker mints Ed25519 JWT for DGTL_LICENSE_JWT. Fields, minting not in the plugin, Worker outline. No products created.
- NOEL-ONLY-CHECKLIST.md — numbered logins / form submits / approvals only Noel can do.
- docs/MARKETPLACE.md — stale 22-tools / Connect-card-only stdio lines updated to 23 tools plus AuthPort. Package id and bin path aligned to dgtl-marketing.

Prior binary (not this pass): plugin 0.1.0, 23 free tools, PKCE Desktop OAuth, 48 tests passing, Apache-2.0, privacy live at https://www.dgtlsunrise.com/privacy.

---

## Blocked on Noel (cannot be done by an agent)

Done 2026-09-03: GCP project `dgtl-marketing-oauth-20260903`, APIs including People, Desktop client + gitignored secret, PKCE consent, Breakwater read-smoke.

Still Noel:
1. Unlisted YouTube demo plus Google verification submit.
2. Cursor marketplace submit (after this Origin repo).
3. Polar org / Pro product / webhook (held).
4. Ads developer token, GBP quota form, Meta App Review (later).

---

## Not blocked

Local tests, copy edits, and Worker design only. No Polar API. No live Google.

## This pass did not

Call Google, create Polar products, generate secrets, or contact anyone.


## 2026-09-03 update

GCP OAuth Desktop client created for `dgtl-marketing-507517`. Client ID stored in gitignored `.env` / `.env.local`.

## 2026-09-03 live smoke (PT)

- Publisher project of record: `dgtl-marketing-oauth-20260903` (559563115308). Ignore `dgtl-marketing-507517` for the plugin client.
- People API must be enabled or Sign-In returns `invalid_client` for Desktop clients.
- Desktop token exchange requires the client secret in gitignored `.env` as `GOOGLE_OAUTH_CLIENT_SECRET` (never commit).
- PKCE login succeeded for `noel@dgtlsunrise.com` with Consent A.
- Breakwater Viewer/Read grant used only for smoke: GA4 549346832, GSC `sc-domain:breakwatercybercorp.com`, GTM-MJ975G9M live v4.

