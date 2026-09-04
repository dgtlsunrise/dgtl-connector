# OPEN-QUESTIONS — Noel Churchill only

Status: Draft / Plan · Date: 2026-09-04 · DGTL Sunrise (Sunrise Consulting LLC)  
Revision: 2026-09-04 review pass 3 (OQ 15–20)

These are product / legal / spend / identity decisions. Engineering work is in `PRODUCT-DESIGN.md` § PR Plan, not here. Keep this file in sync with `PRODUCT-DESIGN.md` § Open Questions.

Recommended defaults apply **only if Noel is silent**; they do not invent prices, SLAs, or secrets.

---

1. **Public listing name**
   - **Decision:** What display name goes on Cursor Marketplace, Grok catalog, and (if different) the Google OAuth **App name**? Package id stays `dgtl-marketing`. Consent-screen copy today is **DGTL Sunrise**.
   - **Why it blocks:** Marketplace submit and Google verification both freeze a string. Renaming after listing is a coordinated break (`plugin.json`, MCP server key, skills, catalog).
   - **Recommended default if Noel is silent:** Keep Google App name **DGTL Sunrise**. Keep package / marketplace id **`dgtl-marketing`**. Do not ship `dgtl-google-marketing` as the listing id.

2. **Polar Pro packaging**
   - **Decision:** One Polar product (Pro) vs separate SKUs for Ads/Meta gateway, sGTM, vault, and writes?
   - **Why it blocks:** Worker maps Polar product id → JWT `features`. Unknown product = no mint. Packaging drives checkout copy and whether writes/sGTM can be sold without Ads.
   - **Recommended default if Noel is silent:** **One Pro product** that mints `features: ["ads","meta"]` only. Add Polar products later for sGTM / vault / writes. Do not kitchen-sink price infrastructure that is not live.

3. **JWT feature strings beyond `ads` / `meta`**
   - **Decision:** When (if ever) does the mint Worker emit `sgtm`, `writes`, and/or `vault`? `src/license/verify.ts` currently types `hasFeature` as `"ads" | "meta"` only. Accelerate said “extend as needed”; Polar plan said do not invent other strings in v1.
   - **Why it blocks:** Plugin gating, Polar product map, and marketplace honesty. Silently minting new strings is a lock violation.
   - **Recommended default if Noel is silent:** **Do not mint** extra strings until a Polar product exists for them. Treat `sgtm` / `writes` / `vault` as reserved names in docs only. Technical flag `DGTL_WRITES_ENABLED` remains independent of JWT for first Consent W ship (local user tokens).

4. **Polar price**
   - **Decision:** What does Pro cost? (Professional / agency infrastructure, **not** a $5–10 GA4 gate.)
   - **Why it blocks:** Noel must create the Polar product. Agents must not invent or publish a number.
   - **Recommended default if Noel is silent:** **Leave unpriced.** Do not put a dollar figure in README, marketplace listing, or skills. Polar product creation stays on the Noel-only checklist.

5. **Agency workspace ACL timing**
   - **Decision:** How long does isolation stay picker-only vs hosted `Workspace` / `ClientBinding` ACL (employee seats ≠ owner Google login)?
   - **Why it blocks:** Worker data model and whether the first paid SKU implies multi-seat. Wrong timing either ships a fake ACL in `PLUGIN_DATA` or forces a rewrite of tool params.
   - **Recommended default if Noel is silent:** **Picker-only** until a vault SKU exists. v1: **1 Polar customer = 1 workspace**. JWT `sub` = Polar customer = workspace owner. Do not block marketplace or Pro gateway on ACL.

6. **Spend dual-control default**
   - **Decision:** When Ads/Meta **mutate** (if ever) or sGTM-adjacent spend exists: dual-control off for solo operators, on for agency seats, or on globally?
   - **Why it blocks:** Approval UX and Worker policy. v1 paid is **readonly** Ads/Meta, so this does not block gateway launch, but it blocks any spend tool.
   - **Recommended default if Noel is silent:** **Off** for solo (owner seat). **On** for additional agency seats once ACL exists. Autopilot remains off for everyone. No spend mutate in the first gateway ship.

7. **Audit retention / data residency default**
   - **Decision:** How long does the Worker keep mint/gateway/sGTM audit logs? Is US Cloudflare acceptable, or must we document “no EU-only residency” explicitly?
   - **Why it blocks:** Bank-like clients and privacy-policy updates before gateway launch. Do not claim residency we do not have.
   - **Recommended default if Noel is silent:** **90 days** hosted audit (actor, tool, resource ids, `jti`, request id — not tokens or report rows). Document subprocessors as Polar + Cloudflare + Google + Meta, **US-centric**. Local `PLUGIN_DATA` audit is user-managed and never uploaded.

8. **Consent W: same GCP project vs sibling**
   - **Decision:** Create the write OAuth client on `dgtl-marketing-oauth-20260903` (559563115308) or a sibling project?
   - **Why it blocks:** Noel’s Cloud console click (checklist B1). Wrong choice couples W verification failure to A, or splits API enablement.
   - **Recommended default if Noel is silent:** **Same project, second client.** Keep Data Access / scopes strictly off the Consent A client. Revisit a sibling project only if Google review hygiene requires it.

9. **Writes local vs also vaulted**
   - **Decision:** First Consent W ship: user-held tokens on the Bot computer (separate store from Consent A), or DGTL vault holds write grants in the same paid SKU?
   - **Why it blocks:** Auth implementation (`PLUGIN_DATA/google-oauth-write.json` vs Worker vault) and whether writes require Polar.
   - **Recommended default if Noel is silent:** **Local user tokens first** (mirrors Consent A; DGTL still only ships OAuth app registration). Vaulted writes wait for the vault SKU. `DGTL_WRITES_ENABLED` is a technical flag, not a Polar feature, until question 3 is decided. Hosted `Approval` records are **not** required for local W.

10. **Marketplace: when to flip `dgtlsunrise/dgtl-marketing` public**
    - **Decision:** Public git after Consent A verification is **submitted**, or only after Google **approves**?
    - **Why it blocks:** Cursor marketplace requires public git + clean secret scan. Unverified External/Testing clients strand strangers.
    - **Recommended default if Noel is silent:** Flip public when verification is **submitted** (demo uploaded, questionnaire in) **and** README honestly says the OAuth client may still be in testing. Do not invite unlimited strangers until Google is In production.

11. **sGTM first-customer shape**
    - **Decision:** First delayed-conversion pipe: synthetic-only, DGTL’s own properties, or a specific engagement Noel names? Internal case-study pattern only — no outbound from this workstream to named institutions.
    - **Why it blocks:** Measurement binding, hostname, and whether P6 is a fixture or a live conversion action.
    - **Recommended default if Noel is silent:** **Synthetic events on DGTL-owned properties** until Noel names an engagement. No shared default pixel. No client names in fixtures. Event names in code/docs/fixtures: **`apply` / `funded` only**.

12. **Power-user local Ads developer-token bypass**
    - **Decision:** Ship `DGTL_ADS_DEVELOPER_TOKEN` (gateway skipped, **license still required**) later, or never? Designed in `ARCHITECTURE-LOCK.md`; not implemented now.
    - **Why it blocks:** Gateway vs local HTTP paths and Google ToS messaging. Default paid SKU must remain DGTL gateway (end-advertisers must not be required to apply for their own token).
    - **Recommended default if Noel is silent:** **Do not ship in the first gateway release.** Keep as documented future escape for agencies who already have a token. Never put DGTL’s token in the plugin.

13. **GBP: pursue Basic API Access or leave flagged off**
    - **Decision:** File GBP Basic API Access on the GCP project (quota is 0 until approved), or leave `DGTL_GBP_ENABLED` default false and tools `GBP_NOT_ENABLED`?
    - **Why it blocks:** Noel form submit; `business.manage` is a **separate** Consent B — must not land on Consent A. Marketplace must not promise live GBP.
    - **Recommended default if Noel is silent:** **Leave flagged off.** Do not block Consent A verification or marketplace on GBP. File the access form only when Noel wants GBP in the free commercial tier for real.

14. **SLA for paid hosted**
    - **Decision:** What support class / uptime language (if any) attaches to Polar Pro, gateway, and sGTM? “Later” is allowed.
    - **Why it blocks:** Polar checkout copy and bank-like contracts. Inventing 99.9% in this draft would be a lie.
    - **Recommended default if Noel is silent:** **No SLA in v1 hosted.** Support remains best-effort via `noel@dgtlsunrise.com` using the existing intake (no tokens, no `DGTL_LICENSE_JWT`). Revisit after a real paying customer.

15. **ToS URL on dgtlsunrise.com**
    - **Decision:** What Terms of Service URL (if any) goes on the Google brand questionnaire and Meta App Review? `docs/ops/OAUTH-CONSENT-COPY.md` currently leaves ToS blank. Privacy is live at https://www.dgtlsunrise.com/privacy.
    - **Why it blocks:** P1 Consent A verification. Google’s brand form commonly asks for a ToS link; Meta will too. Agents must not invent legal copy in this repo.
    - **Recommended default if Noel is silent:** **Do not invent a ToS in git.** Noel publishes a page on `dgtlsunrise.com` before verification submit. Until then the questionnaire field stays blank and P1 “verification submitted” waits on Noel’s URL.

16. **Meta App Review demo hostname**
    - **Decision:** Where does the **clickable** readonly Ads/Meta demo live (list ad accounts → one insights table)? MCP-only is not enough for App Review.
    - **Why it blocks:** P4 Meta App Review. PR-3b is a **hosted Login + live Graph read** (not fixture HTML); Noel must pick a hostname and publish it.
    - **Recommended default if Noel is silent:** Demo on the **Worker hostname after PR-3 exists**, unpublished until Noel says publish. Do not put the demo on the free plugin listing. Hostname is not invented here.

17. **Google Ads API permissible-use wording**
    - **Decision:** What exact permissible-use text goes on the developer-token application (Reporting vs conversion upload vs both; mutate never)?
    - **Why it blocks:** Noel checklist C1. Wrong wording (claiming mutate, or omitting conversion upload that sGTM needs) delays or denies the token.
    - **Recommended default if Noel is silent:** **Reporting + conversion upload, no mutate.** Readonly tools + sGTM `funded` uploads. Do not apply for a token whose permissible use is “manage campaigns.”

18. **License JWT delivery channel**
    - **Decision:** How does the customer get `DGTL_LICENSE_JWT` after Polar `order.paid` / `subscription.active`? Emailing a bearer is inbox-forwardable and will show up in support pastes.
    - **Why it blocks:** Worker mint delivery (PR-4) and support law. Polar license-key vs DGTL JWT confusion gets worse if the JWT is in email.
    - **Recommended default if Noel is silent:** Polar checkout success page → **`POST /v1/license`** with `{ checkout_id | code }` in JSON (`Cache-Control: no-store`). Worker **re-mints** from mint-audit (same `jti`/`exp`/`features`); hashes the **code**, not the JWT. TTL 15 min, single use. Email may say “your license is ready — open this link,” **not** the JWT. Support intake never collects `DGTL_LICENSE_JWT`.

19. **Consent C Google Ads user OAuth: local Desktop vs hosted**
    - **Decision:** Does the **user’s** Google Ads OAuth (`adwords`) live on a local Desktop client C (plugin holds refresh on box, sends hop-scoped access token to the gateway) or on a DGTL-hosted OAuth app (Worker sees Ads refresh tokens)?
    - **Why it blocks:** Separate OAuth client from Consent A is mandatory either way (`adwords` must never land on the free Desktop client). Hosted OAuth is a new data plane (DGTL holds Ads refresh). Local C matches A/W but Meta long-lived tokens still need Worker-side exchange (app secret).
    - **Recommended default if Noel is silent:** **Local Desktop Consent C** for Google Ads user OAuth (`GOOGLE_OAUTH_ADS_CLIENT_ID`, store `PLUGIN_DATA/google-oauth-ads.json`). **Worker-side Meta token exchange** (`POST /v1/meta/exchange` returns long-lived token **to the plugin**; Worker stores nothing). Do not host Ads refresh tokens until the vault SKU.

20. **Consent C GCP project (same vs sibling)**
    - **Decision:** Create the Google Ads OAuth client on `dgtl-marketing-oauth-20260903` (same as Consent A) or a **sibling** GCP project in the same org? (OQ 8 is Consent W only.)
    - **Why it blocks:** Ads verification, quota, and branding on the free client’s project couple a denial/re-review of C to the marketplace plugin. A sibling isolates `adwords` from Consent A Data Access.
    - **Recommended default if Noel is silent:** **Same org, sibling GCP project** for Consent C (`adwords`). Consent W stays OQ 8 (recommended same project, second client). Do not add `adwords` to the Consent A project’s Data Access list either way.

---

Do not add engineering TODOs to this file. Product/legal forks that appear later append here and in `PRODUCT-DESIGN.md` § Open Questions together.
