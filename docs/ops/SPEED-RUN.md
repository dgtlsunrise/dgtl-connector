# SPEED-RUN — dual-track accelerate (trust + revenue)

Date: 2026-09-04 (PT)  
Publisher: Sunrise Consulting LLC / DGTL Sunrise  
Tone: hard and fast without cutting quality. **Two tracks in parallel.** Plan/ops only — no secrets, no spend from agents.

Canonical locks: [FULL-STACK-ACCELERATE.md](FULL-STACK-ACCELERATE.md), [PRODUCT-DESIGN.md](PRODUCT-DESIGN.md), [POLAR-LICENSE-PLAN.md](POLAR-LICENSE-PLAN.md).  
Noel clicks: [NOEL-ONLY-CHECKLIST.md](NOEL-ONLY-CHECKLIST.md). Status: [STATUS.md](STATUS.md).

---

## Quality locks (do not break)

| Lock | Rule |
| --- | --- |
| Free Consent A | Readonly only (`analytics.readonly`, `webmasters.readonly`, `tagmanager.readonly` + openid/email). Demo + Google verification = this client only. |
| Paid = hosted | Ads/Meta/sGTM/license mint live on DGTL infrastructure, not in the free binary. |
| Separate W / C | Consent W (writes) and Consent C (Ads/Meta) never bolted onto Consent A Desktop client. |
| No secrets in git | No `.env`, client secrets, refresh tokens, Ads developer-token, Meta app secret, Polar secrets, mint keys, Cloudflare tokens. |
| Fail-closed gateway | Plugin calls hosted routes only with a valid Ed25519 JWT; otherwise LICENSE_REQUIRED / GATEWAY_UNAVAILABLE. |
| No Axos contact | Axos is case study only. Do not contact Axos / Arah / Lewis from this lane unless Noel says so. |

---

## Track A — Trust / scale (free listing)

Ordered. Noel clicks + agent support in parallel with Track B.

| # | Step | Noel | Agent |
| --- | --- | --- | --- |
| A1 | Consent A unlisted YouTube | Record + upload **Unlisted** per [DEMO-VIDEO-SCRIPT.md](DEMO-VIDEO-SCRIPT.md). Keep URL. | Keep script aligned to PERMISSIONS / 23 tools + AuthPort; no live API calls for the script itself. |
| A2 | Google verification submit | Auth Platform: brand + sensitive-scope verification. Paste [OAUTH-CONSENT-COPY.md](OAUTH-CONSENT-COPY.md) justifications + demo URL. Answer reviewer mail from **noel@dgtlsunrise.com**. | Prep copy only. Do not submit. Do not Publish app until Google approves. |
| A3 | Flip `dgtlsunrise/dgtl-connector` public | After PR-0 + PR-1 are in (already done in code): make GitHub remote **public**. Still no secrets. | Confirm tree clean of secrets; Apache-2.0 + privacy URL live. |
| A4 | Cursor marketplace + later xAI | Submit at cursor.com/marketplace/publish. Later: PR to `xai-org/plugin-marketplace` pinning a full commit SHA. | Package id / bin / MARKETPLACE.md stay accurate; draft PR text when Noel asks. |

**Do not** put write or Ads scopes on the Consent A client to “speed” verification.

---

## Track B — Revenue (paid hosted)

Ordered. Runs in parallel with Track A. Agents scaffold and wire; Noel creates accounts, secrets, and publish approvals.

| # | Step | Noel | Agent |
| --- | --- | --- | --- |
| B1 | Private GitHub `dgtlsunrise/dgtl-stamp` | Create org/repo visibility as private if not already; grant agent access. | Create / scaffold stamp Worker repo (private). No secrets in git. |
| B2 | Cloudflare real ids | In CF dashboard: create **D1 / KV / Queue** with real resource ids. Set `account_id`. `wrangler secret put` for each secret name (values never in chat/git). | List required binding names + secret **names only** (no values). Wire `wrangler.toml` placeholders → real ids after Noel pastes ids (not secret values). |
| B3 | Deploy stamp Worker | Say **publish** / approve deploy. Confirm hostname. | Build + deploy only after Noel publish. Fail closed until secrets present. |
| B4 | Polar org + Pro + webhook | Create Polar org (sandbox first). Create **Pro** product (hosted checkout — not a $5–10 GA4 gate). Point webhook to Worker `POST /webhooks/polar`. Store signing secret in Worker only. | Document event list + mint-audit shape per POLAR-LICENSE-PLAN. Do not create products or spend. |
| B5 | Sandbox purchase → license | Complete one sandbox purchase. Redeem via portal / `POST /v1/license` (JSON body). Set `DGTL_LICENSE_JWT` or `PLUGIN_DATA/license.jwt` locally. | Verify JWT locally (iss/kid/exp/features). No email-bearer primary path. |
| B6 | Consent C + Ads token + Meta | Separate Desktop client for Ads (`adwords`); Ads **developer token** (DGTL MCC, Reporting); Meta Business app stub. Never paste tokens into git/chat. **Never** add scopes to Consent A. Click detail: [PAID-CREDENTIALS-CLICKS.md](PAID-CREDENTIALS-CLICKS.md). | `auth login-ads` / `auth login-meta --code` paths fail closed without client id / gateway / license. |
| B7 | E2E smoke | Approve one readonly Ads or Meta call against a safe account. | JWT verify → gateway health → one Ads or Meta **readonly** call. Stop on fail-closed. |

**Secret names to put via `wrangler secret put` (values never documented here):** Polar webhook signing secret, JWT minting private key material, any gateway attach credentials Noel chooses. Agent may print the **list of names** only.

---

## Who does what this week

| Owner | This week |
| --- | --- |
| **Noel** | A1 YouTube; A2 Google verification submit; A3 flip repo public when ready; A4 marketplace submit. B1 repo access; B2 CF D1/KV/Queue ids + `account_id` + `wrangler secret put`; B3 publish/approve Worker deploy; B4 Polar org + Pro + webhook; B5 sandbox purchase + redeem; B6 Ads developer token + Meta app + Consent C login screens; B7 approve E2E readonly call. |
| **Agent** | Dual-track docs; stamp Worker scaffold; wrangler bindings from Noel’s **ids**; deploy **only** after Noel publish; Polar/webhook design (no products); license verify + gateway health tests; Consent W/C code paths fail-closed; keep Consent A readonly; no Axos contact; no secrets in git. |

Parallel rule: Noel does Track A clicks while agent works Track B scaffold; when Noel finishes B2 ids/secrets, agent deploys on B3 approval without waiting for marketplace.

---

## Explicit non-goals (this speed-run)

- Write scopes on Consent A
- Charge for free local GA4/GSC/GTM readonly
- Secrets, tokens, or mint keys in this repo or chat
- Production Polar spend from an agent session
- Contact Axos from this workstream
- Deploy Worker / sGTM without Noel publish

---

## Pointers

- Noel clicks detail → [NOEL-ONLY-CHECKLIST.md](NOEL-ONLY-CHECKLIST.md)
- **Weekend Track B (Polar blocked):** Consent C + Ads developer-token (DGTL MCC, Reporting) + Meta app stub → [PAID-CREDENTIALS-CLICKS.md](PAID-CREDENTIALS-CLICKS.md)
- Launch status → [STATUS.md](STATUS.md)
- Demo script → [DEMO-VIDEO-SCRIPT.md](DEMO-VIDEO-SCRIPT.md)
- GCP / Consent A → [GCP-SETUP.md](GCP-SETUP.md)
- Polar mint design → [POLAR-LICENSE-PLAN.md](POLAR-LICENSE-PLAN.md)
