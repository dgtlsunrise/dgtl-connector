# Shopify → TikTok next connectors — 2026-09-11 (PT)

> **SUPERSEDED (2026-09-11, W0.7):** the Shopify **Not started** row below is stale. Shopify **read** tools shipped (`shopify_get_shop`, `shopify_list_products`, `shopify_get_product`, `shopify_list_orders`, `shopify_get_order`) — see planning [SHOPIFY-READ-SLICE-SHIP-2026-09-11.md](https://github.com/dgtlsunrise/dgtl-connector/pull/21) (`dgtlsunrise/dgtl-connector` PR **21**, `feat/shopify-readonly-products-orders`). Live merchant-app smoke remains Noel-gated. **TikTok remains not started** (Wave 8). Keep the E2E / first-slice checklists below as history + remaining Noel steps. Do not delete this note.

Publisher: Sunrise Consulting LLC / DGTL Sunrise  
Priority lock (post Ads/Meta write ship): **finish Ads/Meta writes** → **Shopify** → **TikTok** → **review-app creative mining**.  
Consistency skim: `POST-POLAR-BACKLOG.md`, `SPEED-RUN.md`, `FULL-STACK-ACCELERATE.md`, `V2_HOSTED.md`, Meta/Ads create speedruns under `/workspace/dgtl-planning/ops/`.

---

## Context (what is already done vs next)

| Track | Status (as of 2026-09-11) |
| --- | --- |
| Free Consent A GA4/GSC/GTM readonly | Shipped; keep untouched |
| Polar Pro + stamp gateway | Live (`stamp.dgtlsunrise.com`); Ads/Meta hop pattern exists |
| Google Ads mutate/create | Largely shipped (Search/Display; PMax/Shopping typed gaps) |
| Meta mutate/create | Shipped code; **Noel gate:** `ads_management` Advanced Access + reauth + one non-Axos E2E |
| Consent W GTM writes | Code gated off; Noel OAuth client still required (see `CONSENT-W-READINESS-2026-09-11.md`) |
| Shopify | **SUPERSEDED 2026-09-11 (W0.7) — read slice shipped.** Five `shopify_*` tools in `dgtl-connector` (PR 21). Local merchant token; no Polar; fail `SHOPIFY_NOT_CONNECTED`. Writes still out (Wave 7). Historical claim (struck): *Not started in `dgtl-connector` — first net-new commerce connector.* Current readiness: planning `ops/SHOPIFY-READ-SLICE-SHIP-2026-09-11.md` + this repo’s `skills/shopify-readonly/SKILL.md`. |
| TikTok Ads | **Not started** — follows Shopify; stamp-hop like Meta/Google Ads |
| Review-app creative mining | After TikTok; depends on creative read surfaces |

Do not block Shopify scaffold on Meta Advanced Access or Consent W Console clicks — those are parallel Noel tracks.

---

## 1. Recommended first Shopify MCP/plugin slice

> **W0.7:** first read slice **shipped** (PR 21). This section is the original plan, kept as history. Remaining Noel work is live custom-app smoke on a non-Axos store — see planning `ops/SHOPIFY-READ-SLICE-SHIP-2026-09-11.md`.

### Fit to free-local vs Pro-hosted

| Lane | What belongs there | Why |
| --- | --- | --- |
| **Free / local (recommended first slice)** | Read-only Admin API against the **merchant’s** store using **merchant-held** credentials on the Bot computer | Mirrors Consent A: report bytes stay local; DGTL does not need a vault; no DGTL secret that a public plugin cannot hold (`V2_HOSTED.md`) |
| **Pro / hosted (later)** | Multi-store vault, staff ACL, write/mutations, webhook ingest, any DGTL-brokered app secret | Same reason Ads developer-token / Meta app secret live on stamp |

**First slice = local read-only products + orders** (not write). Writes (inventory adjust, draft order, price) wait until read path + confirm-gate patterns match GTM/Ads.

### Auth shape (v1 Shopify)

Prefer merchant custom app / Dev Dashboard credentials local to the user:

- `SHOPIFY_STORE` (or `*.myshopify.com`)  
- Either legacy `SHOPIFY_ACCESS_TOKEN` (`shpat_…`) **or** Dev Dashboard `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` with client_credentials refresh  
- Scopes on the **merchant app only**: `read_products`, `read_orders` (add `read_inventory` / `read_locations` only if a tool needs them)  
- **No** `write_*` scopes in v1 slice  
- Store tokens under `PLUGIN_DATA/` (e.g. `shopify-oauth.json`) mode 0600; never git  

Fail closed: missing store/token → `SHOPIFY_NOT_CONNECTED` (new code); do not call Admin API.

### Recommended closed tool set (first PR)

| Tool | Purpose |
| --- | --- |
| `shopify_whoami` / `shopify_get_shop` | Confirm shop domain + name (sanity) |
| `shopify_list_products` | Paginated products (title, handle, status, id); require explicit shop |
| `shopify_get_product` | One product by id |
| `shopify_list_orders` | Paginated orders; date/status filters closed enum |
| `shopify_get_order` | One order by id |

**Out of first PR:** customers PII-heavy lists (defer or tightly field-mask), writes, ShopifyQL analytics, themes, checkout, Multipass, bulk ops mega-query, raw GraphQL escape hatch.

### Product posture

- Same plugin package (`dgtl-connector`), gated family — not a second marketplace identity.  
- Marketplace listing copy remains Consent A Google-first until Shopify is intentionally marketed.  
- Do **not** charge for local Shopify read if it runs on the user’s computer with their token (same rule as free GA4).

---

## 2. TikTok Ads API access vs Meta / Google pattern

| Dimension | Google Ads (Consent C + stamp) | Meta Ads | TikTok Ads (planned) |
| --- | --- | --- | --- |
| User OAuth | Separate Desktop client (`adwords`); local token store | Meta Login / hosted exchange → local `meta-oauth.json` | TikTok for Business OAuth advertiser grant → local token store |
| Platform secret a public plugin cannot hold | **Developer token** on Worker | **App secret** on Worker | **App secret / client secret** on Worker (Marketing API) |
| Hop | Plugin → stamp allowlist → `googleads.googleapis.com` | Plugin → stamp → Graph | Plugin → stamp → TikTok Marketing API host (allowlisted paths only) |
| License | Polar JWT `ads` feature | JWT `meta` | New JWT feature e.g. `tiktok` (or extend Pro features) — Noel product decision |
| Review / access | Ads API Basic + MCC token | App Review + Advanced Access for client accounts | TikTok for Business developer app + **Marketing API** access; sandbox then app review; demo video / site / privacy like other platforms |
| Mutate posture | dry_run + confirm + Worker flag | Same | Same when writes ship — **read-only first** after Shopify |

**Stamp hop, not pure local:** TikTok Marketing API needs DGTL (or agency) app credentials that must not ship in the public binary — same class as Ads developer-token / Meta app secret. Local-only TikTok without a gateway would force every merchant to own a fully approved TikTok app (poor DX; not the Pro model).

**Sequence:** Scaffold Shopify local read **before** investing Noel time in TikTok developer app review. TikTok docs/work can start in parallel as Noel-only registration, but connector tools after Shopify slice.

---

## 3. Concrete first PR scope — Shopify in `dgtlsunrise/dgtl-connector`

**Title (suggested):** `feat: Shopify read-only products/orders (local merchant credentials)`

### Code

| Area | Scope |
| --- | --- |
| Auth | `src/shopify/auth.ts` (or under `auth/`): host-injected token + optional client_credentials refresh; `PLUGIN_DATA/shopify-oauth.json`; doctor env names only |
| HTTP | Thin Admin GraphQL or REST client; **allowlisted** operations only; pin API version (e.g. `2025-10` / `2026-04` — pick one and document) |
| Tools | `shopify_get_shop`, `shopify_list_products`, `shopify_get_product`, `shopify_list_orders`, `shopify_get_order` |
| Registry / catalog | New gated group `shopify` OR free-local always-on once connected — prefer **fail closed without credentials** without Polar (local free), distinct from Ads `LICENSE_REQUIRED` |
| Schemas | Closed input schemas; pagination cursors; no raw query string |
| Errors | `SHOPIFY_NOT_CONNECTED`, `SHOPIFY_SCOPE_MISSING`, map 401/403/429 |
| Flags | Optional `DGTL_SHOPIFY_ENABLED` default **true** once shipped, or register tools always and fail closed on auth — mirror GBP vs Ads patterns carefully; recommend **tools registered, auth fail-closed**, no Polar gate for read-local |
| Docs | `TOOLS.md`, `PERMISSIONS.md` (Shopify not Google Consent A), `.env.example` placeholders, skill stub `skills/shopify-readonly/` |
| Tests | Fixture HTTP; no live store in CI; token redaction; pagination; denylist write paths |

### Explicit non-goals in PR 1

- `write_products` / `write_orders` / draft orders  
- Stamp hop for Shopify (not needed for merchant-token local read)  
- Customers full PII dump  
- Charging / Polar feature bit for local read  
- TikTok tools in the same PR  

### Suggested follow-up PRs

1. Inventory/locations read if merchandising workflows need it.  
2. Write tools with dry_run + confirm (shop domain in confirm_phrase).  
3. Optional Pro vault for agency multi-store (stamp) — separate design.

---

## 4. Blocked on Noel vs buildable now

### Buildable now (agents / CloudAgent)

- Shopify read-only scaffold PR in `dgtlsunrise/dgtl-connector` (tools, auth port, fixtures, docs). **SUPERSEDED 2026-09-11 (W0.7) — shipped, PR 21.**  
- Consent W `auth login-write` CLI (small, unblocks W E2E after Noel client). **SUPERSEDED 2026-09-11 (W0.7) — shipped** (`src/auth/login-cli.ts`).  
- TikTok design doc + stamp allowlist sketch (no secrets, no live app).  
- Continue Ads/Meta DX polish that does not need Noel forms.

### Blocked on Noel

| Item | Why |
| --- | --- |
| Meta `ads_management` Advanced Access + reauth + live create E2E | App Review / token scopes (`META-CREATE-SPEEDRUN`) |
| Consent W Desktop client + scopes in Console | Checklist B1–B3; agents must not create OAuth clients |
| Google Ads developer-token / Basic access edge cases | MCC / Google forms |
| TikTok for Business developer app + Marketing API approval | Noel dashboard + review video/site |
| Polar feature string for `tiktok` (if priced) | Product dashboard |
| Merchant Shopify custom app install for **live** smoke | Noel (or named non-Axos store) must install app and hand scopes; agents use fixtures until then |
| Stamp secrets for TikTok app | `wrangler secret`; Noel publish |

### Parallelism note (SPEED-RUN / POST-POLAR)

Keep Track A trust (Consent A verification / marketplace) and Meta/Consent W Noel clicks parallel to Shopify code. Do not wait for Polar leftover Meta forms to start Shopify read scaffold.

---

## 5. After TikTok — review-app creative mining (placeholder)

Only after Shopify read + TikTok read hop exist:

- Mine approved ads/creatives metadata (URLs, names, performance joins) — **not** binary asset theft.  
- Prefer Meta `meta_get_creative` + future TikTok creative list; optional review-app upload later.  
- Out of scope until connectors above land.

---

## DONE WHEN (Shopify first PR)

- [x] Five read tools registered + documented; write scopes absent. **(W0.7 / PR 21)**  
- [x] Local credentials only; fail closed without them; no stamp required for Shopify read.  
- [x] CI fixtures green; no secrets in git.  
- [x] Consent A / Ads / Meta behavior unchanged.  
- [ ] Noel can later install a custom app with `read_products` + `read_orders` and smoke against a non-Axos store. **(keep — live E2E still Noel)**
