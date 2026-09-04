# Paid credentials clicks — Noel-only (Track B weekend)

Date: 2026-09-04 (PT)  
Publisher: Sunrise Consulting LLC / DGTL Sunrise  
Package: `dgtl-marketing` 0.1.0 · Contact: noel@dgtlsunrise.com

**Why this weekend:** Polar org / Pro / webhook is **blocked** (sandbox product + spend stay Noel-gated when Polar unblocks). Run **Track B credential stubs in parallel** so Ads developer-token lead time and Meta app scaffolding are not idle. Agents scaffold code and docs only — they do not create OAuth clients, Ads tokens, Meta apps, or paste secrets.

Canonical locks: [SPEED-RUN.md](SPEED-RUN.md) (B6), [FULL-STACK-ACCELERATE.md](FULL-STACK-ACCELERATE.md), [PRODUCT-DESIGN.md](PRODUCT-DESIGN.md) Consent C, [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) OQ 17 / 19 / 20.  
Consent A project of record: **`dgtl-marketing-oauth-20260903`** (559563115308) — see [GCP-SETUP.md](GCP-SETUP.md).

---

## Hard rules (read before any console click)

| Rule | Detail |
| --- | --- |
| **Never add scopes to Consent A** | Do **not** put `adwords`, write scopes, `business.manage`, Gmail, or Drive on the free Desktop client / Data Access list used for demo + Google verification. |
| **No secrets in git / chat** | Never commit or paste: Ads developer-token, Meta app secret, OAuth client secrets, refresh tokens, Polar secrets, mint keys. Client **IDs** / App **IDs** are public identifiers — OK to put in gitignored `.env` and to tell an agent the ID only. |
| **Consent C ≠ gateway** | Consent C is the **user’s** Ads/Meta grant. DGTL’s Ads developer-token and Meta app secret live on the **Worker** later — not in this plugin binary. |
| **Readonly paid v1** | Tools stay readonly; `adwords` OAuth looks read/write in Google’s UI — product readonly is tool + Reporting token + user role, not a narrower scope. |
| **No Axos contact** | Case study only. |

---

## 1. Consent C — Google Desktop OAuth client (Ads user grant)

Separate from Consent A and Consent W. CLI already exists: `dgtl-marketing-mcp auth login-ads` → `PLUGIN_DATA/google-oauth-ads.json` (fail-closed without client id).

### Recommended project (OQ 20)

| Choice | When |
| --- | --- |
| **Sibling GCP project** (same org as `dgtl-marketing-oauth-20260903`) | **Default if silent.** Isolates `adwords` verification / Data Access from the free Consent A client. |
| Same project, **second** client | Only if you explicitly want one project; still **never** add `adwords` to the Consent A client’s Data Access list. |

Do **not** edit Data Access on the existing Consent A Desktop client in `dgtl-marketing-oauth-20260903`.

### Noel clicks

1. Sign into [Google Cloud Console](https://console.cloud.google.com/) as **noel@dgtlsunrise.com**.
2. Create or select the Consent C project (sibling preferred). Note Project ID.
3. Enable **Google Ads API** on **that** project (not as a reason to touch Consent A APIs).
4. Google Auth Platform: branding can mirror DGTL Sunrise / noel@dgtlsunrise.com / dgtlsunrise.com privacy — keep it clearly a **paid / Ads** client label if the console allows (e.g. client name `dgtl-marketing-ads-desktop`).
5. Audience: External + **Testing**. Add test user `noel@dgtlsunrise.com`. Do not Publish until Ads path is ready for review.
6. Data Access on **this** client only: `https://www.googleapis.com/auth/adwords` (+ `openid` / `userinfo.email` if you want whoami parity). **Stop.** No GA4/GSC/GTM scopes here unless a later lock says otherwise.
7. Create OAuth client type **Desktop app**. Copy Client ID + Client secret into **gitignored** `.env` only:
   - `GOOGLE_OAUTH_ADS_CLIENT_ID=`
   - `GOOGLE_OAUTH_ADS_CLIENT_SECRET=`
8. Tell the agent the **Client ID** (public) when ready for a local `auth login-ads` smoke. You complete the Google consent UI; the agent does not use your password.
9. Confirm store path will be `PLUGIN_DATA/google-oauth-ads.json` (mode 0600) — not `google-oauth.json` (Consent A).

### Env names only (values never in this repo)

```text
GOOGLE_OAUTH_ADS_CLIENT_ID=
GOOGLE_OAUTH_ADS_CLIENT_SECRET=
# Optional host-injected:
# GOOGLE_ADS_ACCESS_TOKEN=
# GOOGLE_ADS_GRANTED_SCOPES=
```

---

## 2. Google Ads developer token — DGTL MCC (Reporting)

This is a **DGTL / Sunrise Consulting LLC** credential for the hosted gateway, **not** something end users paste into the free plugin.

| Item | Value |
| --- | --- |
| Account | DGTL **MCC** (manager), LLC — **not** Axos, not a personal throwaway |
| Permissible use (this pass) | **Reporting** (OQ 17 recommended later: Reporting + conversion upload, **no mutate** — do not apply as “manage campaigns”) |
| Where it lives later | Worker secret store only (`wrangler secret put` / equivalent). **Never** in plugin, git, JWT, chat, or support tickets |
| Power-user bypass | `DGTL_ADS_DEVELOPER_TOKEN` designed, **not implemented** — do not make user-held tokens the default SKU |

### Noel clicks

1. Sign into Google Ads as the LLC / DGTL MCC admin (same identity hygiene as GCP: not Axos).
2. Open API Center / developer-token application for that MCC.
3. Apply with permissible use focused on **Reporting** (readonly campaign/account performance via allowlisted gateway). If the form forces a longer description, stay aligned with OQ 17: reporting (+ conversion upload later), **no** campaign mutate.
4. Expect **Test** access first; production access can take days–weeks — that is why this runs while Polar is blocked.
5. When Google issues the token: store it only in a password manager / Worker secrets when the stamp Worker exists. Do **not** paste into chat or `.env` in this public plugin tree.
6. Do **not** put the developer-token in `GOOGLE_OAUTH_*` vars or in Consent A/C client JSON downloads.

Agent may list the **secret name** for Worker env later; agents must not invent or receive the token value in chat.

---

## 3. Meta Business app — stub only (this weekend)

Goal: create the **Meta app shell** under Sunrise Consulting LLC so App Review / Login for Business is not starting from zero when the gateway hostname exists (OQ 16). Full App Review and hosted clickable demo are **not** this weekend’s finish line.

| Piece | This weekend | Later (not blocked on Polar forever, but needs Worker hostname) |
| --- | --- | --- |
| Meta app + Business portfolio claim | **Yes — stub** | — |
| Public `META_APP_ID` in gitignored `.env` | Optional once created | Required for login URL |
| `META_APP_SECRET` | Create and store offline / password manager | Worker env only — never plugin |
| Permissions | Plan `ads_read` for v1 readonly; **no** `ads_management` for first paid readonly | App Review + PR-3b hosted Login + one live Graph read |
| Plugin path | `auth login-meta --code` already fail-closed without gateway / license | `POST /v1/meta/exchange` on Worker |

### Noel clicks

1. Sign into [Meta for Developers](https://developers.facebook.com/) / Business Suite as the LLC owner (noel@dgtlsunrise.com / Sunrise Consulting LLC Business Manager — not a personal-only app you cannot transfer).
2. Create a **Business** app (Login for Business capable). Display name consistent with **DGTL Sunrise** / paid Ads surface.
3. Note **App ID** (public). Put `META_APP_ID=` in gitignored `.env` only if you want local URL building later.
4. Create / rotate **App Secret** once — password manager + future Worker secret. **Never** commit, chat, or put in the plugin package.
5. Do **not** submit App Review this weekend unless the hosted demo hostname (OQ 16) is already live. Stub = app exists, privacy URL https://www.dgtlsunrise.com/privacy, contact email set.
6. Optional: add yourself as admin/tester. Skip production `ads_read` review until PR-3b.

Support never collects Meta user tokens. Loopback-only Meta login without hosted redirect is **not** the v1 default.

---

## 4. What agents do in parallel (no Noel password)

- Keep Consent A readonly; tests already lock W/C off A.
- Fail-closed `gads_*` / `meta_*` without license → gateway → Consent C / Meta user OAuth.
- Stamp Worker scaffold + secret **names** only when Cloudflare ids exist.
- Do **not** create Polar products, deploy Worker without Noel publish, or contact Axos.

---

## 5. Done when (weekend exit)

- [ ] Consent C Desktop client exists; Client ID in gitignored `.env` as `GOOGLE_OAUTH_ADS_CLIENT_ID` (secret too if Desktop).
- [ ] Confirmed **no** `adwords` (or other paid scopes) on Consent A Data Access in `dgtl-marketing-oauth-20260903`.
- [ ] Ads developer-token application submitted (or Test token recorded offline) for **DGTL MCC**, use = **Reporting**.
- [ ] Meta Business app stub exists; App ID noted; App Secret only in password manager / future Worker.
- [ ] Nothing from the above committed to git or pasted into chat.

Polar B4–B5 remains blocked until Noel unblocks Polar; then resume [SPEED-RUN.md](SPEED-RUN.md) Track B from webhook + sandbox purchase.

---

## Pointers

- Dual-track order → [SPEED-RUN.md](SPEED-RUN.md)
- Full Noel click list → [NOEL-ONLY-CHECKLIST.md](NOEL-ONLY-CHECKLIST.md)
- Consent A GCP → [GCP-SETUP.md](GCP-SETUP.md) (`dgtl-marketing-oauth-20260903`)
- Status → [STATUS.md](STATUS.md)
