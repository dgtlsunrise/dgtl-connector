# Post-Polar backlog

**Status:** AFTER Polar + stamp are LIVE. Prefer DGTL_GATEWAY_URL https://stamp.dgtlsunrise.com (backup https://dgtl-stamp.noel-4ea.workers.dev). auth redeem ships (AFTER-Polar plugin work).

This file is the concrete leftover list. Free GA4 / GSC / GTM, `npm run doctor`, first-run, empty-row hints, and `support_packet` are **not** Polar work.

Polar checkout + stamp unlocked. Pro stays **$19/mo flat**. Gateway: https://stamp.dgtlsunrise.com (backup https://dgtl-stamp.noel-4ea.workers.dev).

Owners: **Noel** = dashboard / spend / form submit / secrets. **Agent** = code + docs after Noel unblocks.

---

## Polar product + billing (Noel first)

| Item | Owner | Notes |
| --- | --- | --- |
| Polar org (Sunrise Consulting LLC / DGTL Sunrise); sandbox first | **Noel** | Agent must not create orgs or spend. |
| Polar **Pro $19/mo** product + hosted checkout | **Noel** | Not a $5–10 GA4 gate. Do not attach Ads scopes while creating it. |
| Polar webhook endpoint (`order.paid` / `subscription.active` / cycled / updated / refunded / revoked) | **Noel** creates the Polar endpoint; **agent** implements the Worker handler | Signing secret → Worker env only (`POLAR_WEBHOOK_SECRET`). Never this git. |
| JWT minting secret + public-key match | **Noel** stores mint secret on the Worker; **agent** confirms plugin embedded public key | Plugin verifies locally. Polar license-key strings are **not** `DGTL_LICENSE_JWT`. |
| Sandbox purchase + portal redeem smoke | **Noel** | Confirm `POST /v1/license` JSON body; do not email the bearer as the primary path. |

Design: [POLAR-LICENSE-PLAN.md](POLAR-LICENSE-PLAN.md). Noel clicks: [NOEL-ONLY-CHECKLIST.md](NOEL-ONLY-CHECKLIST.md) Phase 8.

---

## Stamp / gateway

| Item | Owner | Notes |
| --- | --- | --- |
| Stamp Worker secrets + publish | **Noel** puts secrets (`wrangler secret` / equivalent) and says publish; **agent** deploys code when asked | Ads `developer-token`, Meta app secret, mint key — never in this plugin. |
| `DGTL_GATEWAY_URL` live | **Documented** | Primary https://stamp.dgtlsunrise.com; backup https://dgtl-stamp.noel-4ea.workers.dev. Paid tools fail `GATEWAY_UNAVAILABLE` until set. |
| Allowlist `googleads.googleapis.com` + Meta Graph only | **Agent** (Worker) | No GA4/GSC/GTM report bytes. No payload storage. |

---

## Plugin work (Polar-unlocked)

| Item | Owner | Notes |
| --- | --- | --- |
| License redeem CLI (`auth redeem` against `POST /v1/license`) | **Agent** | **Shipped** — fail closed without gateway; never print JWT; write `PLUGIN_DATA/license.jwt`. |
| Polar checkout **deep link** in `skills/pro-upgrade/` | **Agent** | **Shipped** — Polar CTA + site. |
| `LICENSE_REQUIRED` ladder in `license-and-reconnect` | **Agent** | **Shipped** — buy → redeem → Ads/Meta OAuth → gateway. |
| Doctor / support copy that mentions Polar checkout | **Agent** | Keep $19 accurate. No Polar product IDs in git until Noel creates them. |

---

## Meta + Ads access (Noel forms; agent does not submit)

| Item | Owner | Notes |
| --- | --- | --- |
| Meta OAuth redirect URIs on the **stamp host** | **Noel** in Meta app dashboard; **agent** lists the intended paths | Hosted Login (PR-3b) is Noel-gated. App secret never in this plugin. |
| Pro Bot **screencast** + Meta `ads_read` **Advanced Access** submit | **Done 2026-09-07** | Review in progress. CLEAN screencast uploaded; Website platform added. Access Verification email may still arrive. |
| Google Ads API **Basic** access wait / developer-token on DGTL MCC | **Noel** | Reporting (no mutate). Token lives on the Worker only. See [PAID-CREDENTIALS-CLICKS.md](PAID-CREDENTIALS-CLICKS.md). |
| Consent C Desktop client (Ads user grant) | **Noel** | Separate from Consent A. Never add `adwords` to the free client. |
| GBP Basic API Access form | **Noel** | Quota 0 until approved. Not Polar, but still after-free-listing paperwork. |

---

## Explicitly not this backlog

- Free Consent A readonly (already shipped)
- `npm run doctor` / first-run / empty-row `hint` / `support_packet` (Polar-free UX)
- Inventing Polar checkout URLs (use live Polar CTA)
- Putting stamp secrets in this git
- Charging for `ga4_run_report`
