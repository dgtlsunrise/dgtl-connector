# Full-stack accelerate — locked 2026-09-03 (PT)

Publisher: Sunrise Consulting LLC / DGTL Sunrise  
Decision: Noel chose **full stack now** — paid hosting + write tools on a **separate** consent + sGTM. Free Consent A stays **readonly**.

## Pricing lock

| Lane | Where it runs | What |
| --- | --- | --- |
| **Free** | User's Bot computer | GA4 / GSC / GTM **readonly** (Consent A). User's Google tokens stay local. |
| **Paid** | DGTL-hosted | Anything that needs our infrastructure: Polar license, Ads/Meta gateway, server-side GTM / delayed conversions, token vault. |

Do not charge for local free tools.

## Consent split (hard rule)

### Consent A — free Desktop client (existing)

Project of record: `dgtl-marketing-oauth-20260903` (559563115308).

Scopes **only**:
- `analytics.readonly`
- `webmasters.readonly`
- `tagmanager.readonly`
- `openid` + `userinfo.email`

No write. No `adwords`. No `business.manage`. No `tagmanager.publish`.  
Tomorrow's demo + Google verification apply to **this** client only.

### Consent W — writes (new client, later verification)

Separate OAuth client (and likely separate Cloud consent app or clearly separated scope set). Candidate scopes (pick per tool, do not request unused):

- GTM: `tagmanager.edit.containers`, `tagmanager.publish` (publish is highest risk — approval-gated)
- GSC: `webmasters` (not `.readonly`) for sitemap submit / inspect mutations we explicitly tool
- GA4: `analytics.edit` only if we ship Admin mutations; never blanket `analytics`

Product rules for writes:
- Explicit tools only (no silent autopilot)
- Require human/agent confirmation for publish/delete
- Property/container must be named in the call (list → pick → mutate)
- Skills refuse inventing publish when Consent W absent

### Consent C — Ads / Meta (hosted)

`adwords` and Meta Ads scopes live on the **hosted gateway**, not in the free plugin binary. Free install never embeds Ads developer-token or Meta app secret.

## Paid products (hosted)

1. **Polar Pro** — merchant of record. Mints Ed25519 `DGTL_LICENSE_JWT` with `features: ["ads","meta"]` (extend with `sgtm` / `writes` as needed). See POLAR-LICENSE-PLAN.md.
2. **Ads/Meta gateway Worker** — allowlisted; attaches DGTL or customer credentials server-side; plugin calls gateway only when license valid.
3. **sGTM / delayed conversions** — first-party endpoint + server-side container (or Worker equivalent). Case study: apply in browser, fund days later via Prelim → GTM → Google Ads + Meta CAPI. Axos is internal case study only; do not contact Axos from this workstream.

## Delivery order (accelerate)

1. Spec + Noel gates (this doc) — **now**
2. Free path still: OAuth demo → Google verification Consent A → public `dgtlsunrise/dgtl-marketing` → marketplace
3. Polar org + Pro product (Noel dashboard)
4. Worker: webhook mint JWT + stub Ads/Meta routes
5. Plugin: Consent W auth path + write tool stubs behind flags; license features gate hosted calls
6. sGTM MVP: ingest → map `funded`-class events → Ads/Meta conversion APIs
7. GTM write/publish tools with approval gates; then GSC/GA4 writes as needed

## Explicit non-goals this week

- Put write scopes on Consent A Desktop client
- Charge for `ga4_run_report` / free GSC / free GTM read
- Contact Axos / Arah / Lewis from this lane
- Deploy production sGTM without Noel publish / spend approval

## Artifacts to produce

- This lock
- Updated NOEL-ONLY-CHECKLIST (Polar + Consent W + Ads/Meta + sGTM)
- Plugin PR: Consent W scaffold + write tool registry (flagged off until scopes exist)
- New hosted repo or Worker tree for gateway + sGTM

---

## Canonical design (locked)

Implement against [`PRODUCT-DESIGN.md`](PRODUCT-DESIGN.md) and [`OPEN-QUESTIONS.md`](OPEN-QUESTIONS.md). This accelerate note remains the short lock; the product design is the full contract.
