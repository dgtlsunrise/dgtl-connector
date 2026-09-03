# Noel-only checklist

Actions that require **Noel's** Google / Polar / marketplace login, a form submit, or an approval. Agents write files and run local tests. They do not sign in as Noel, do not submit Google verification, do not create Polar products, and do not spend money.

Package: `dgtl-marketing` 0.1.0. Contact: noel@dgtlsunrise.com.

---

## This week — GCP Desktop OAuth (blocks live smoke)

1. Sign into [Google Cloud Console](https://console.cloud.google.com/) as **noel@dgtlsunrise.com** (not Axos, not a personal Gmail unless that is the LLC owner).
2. Create or select the Sunrise Consulting LLC GCP project that will own this OAuth client.
3. If Google requires it, attach a billing account to that project (your click; this session does not).
4. Enable four APIs on that project: Google Analytics Admin, Google Analytics Data, Search Console, Tag Manager.
5. Open Google Auth Platform (Branding). Paste app name **DGTL Sunrise**, support email **noel@dgtlsunrise.com**, homepage **https://www.dgtlsunrise.com/**, privacy **https://www.dgtlsunrise.com/privacy**, authorized domain **dgtlsunrise.com**, developer contact **noel@dgtlsunrise.com**.
6. If the console requires domain verification, complete Search Console verification for **dgtlsunrise.com** on an account that is Owner of this Cloud project.
7. Audience: user type **External**, publishing status **Testing**. Do not Publish app yet.
8. Add test users, starting with **noel@dgtlsunrise.com**.
9. Data Access: add Consent A scopes only (`analytics.readonly`, `webmasters.readonly`, `tagmanager.readonly`, `openid`, `userinfo.email`). Do not add Ads, GBP, Gmail, Drive, or write scopes.
10. Create OAuth client type **Desktop app**. Copy the **Client ID** only. Do not put a client secret in git, chat, or `.env`.
11. Put `GOOGLE_OAUTH_CLIENT_ID=...` in `/workspace/dgtl-google-plugin/.env` (or hand the Client ID to the agent to write that gitignored file).
12. When the agent runs PKCE login, **you** open the printed accounts.google.com URL in a browser on the box, pick a test-user Google account, complete password / 2FA / consent, and grant the three product scopes. The agent cannot complete that screen.

13. Confirm the property / site / GTM container the agent should use for smoke (speak the IDs; do not paste tokens).
14. Optional: upload a consent-screen logo if you want the DGTL mark on Google's UI.

---

## Google verification (blocks strangers on this OAuth client)

15. Record the unlisted YouTube demo using [DEMO-VIDEO-SCRIPT.md](DEMO-VIDEO-SCRIPT.md) (you on camera / your Google login).
16. Upload to YouTube as **Unlisted** and keep the URL.
17. In Google Auth Platform, submit brand + sensitive-scope verification. Paste justifications from [OAUTH-CONSENT-COPY.md](OAUTH-CONSENT-COPY.md) and the demo URL.
18. Answer Google's reviewer email from **noel@dgtlsunrise.com**.
19. Only after Google approves: change publishing status from Testing to In production.

---

## Marketplace (blocks public listing)

20. Make the git remote **public** when you are ready (still no secrets). Apache-2.0 is already on the package.
21. Submit the repo at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish).
22. Later: open a PR to `xai-org/plugin-marketplace` pinning a full commit SHA.

---

## Phase 8 Polar (paid Ads/Meta billing — do not do this week)

23. Create a Polar organization for Sunrise Consulting LLC / DGTL Sunrise (sandbox first).
24. Create the Pro product and hosted checkout (your dashboard; agents must not create products or spend).
25. Create the Polar webhook endpoint and store the signing secret in the Worker env (not in this plugin).
26. Place the JWT minting secret in the Worker secret store (not in this git).
27. Complete a **sandbox** test purchase yourself and confirm the emailed JWT sets `DGTL_LICENSE_JWT`.

---

## Later paperwork (not free-plugin 0.1.0)

28. Google Ads API developer token application (permissible use: Reporting). Different OAuth client; do not add `adwords` to Consent A.
29. GBP Basic API Access form on the GCP project (quota is 0 until approved).
30. Meta Business app + App Review (`ads_read`) when the gateway exists.

---

## Never (agent or Noel)

- Commit `.env`, `google-oauth.json`, client secrets, refresh tokens, Ads developer-token, Meta app secret, Polar org tokens, or minting secrets.
- Pre-declare Ads / GBP / Gmail scopes on the Desktop client used for v1.
- Collect tokens in support tickets.
- Spend against Polar production from an agent session.
