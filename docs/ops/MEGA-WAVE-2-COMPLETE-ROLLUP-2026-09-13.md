# Mega-wave 2 complete rollup — Waves 10–23

Date: 2026-09-13  
Repo: `noel-churchill/dgtl-marketing`  
This note lists what shipped in mega-wave 2. **Live Noel hangover gates remain external** (Google verification, marketplace submit, Worker publish, Polar mint, Ads/Meta/TikTok app review). Agents do not publish.

Consent A kernel stayed **26** for the entire wave. Marketplace / public copy stayed **Consent A readonly**. Writes used named closed tools + separate consents / flags. Never Axos. No Polar checkout URLs invented here.

## Waves

| Wave | What shipped | Proof |
| --- | --- | --- |
| 10 | Consent G / S plumbing (scopes, login CLIs, stores, doctor/packet booleans). No Admin mutate yet. | [WAVE10-PROOF-2026-09-13.md](WAVE10-PROOF-2026-09-13.md) |
| 11 | GA4 Admin writes on Consent G; Ads-id report recipes on Consent A reads | [WAVE11-PROOF-2026-09-13.md](WAVE11-PROOF-2026-09-13.md) |
| 12 | GSC sitemap submit/delete on Consent S | [WAVE12-PROOF-2026-09-13.md](WAVE12-PROOF-2026-09-13.md) |
| 13 | sGTM clients + environments list on A; client/container/environment create on W. Kernel 24→**26**. | [WAVE13-PROOF-2026-09-13.md](WAVE13-PROOF-2026-09-13.md) |
| 14 | Merchant API ProductInput writes (Consent MC, not stamp) | [WAVE14-PROOF-2026-09-13.md](WAVE14-PROOF-2026-09-13.md) |
| 15 | Shopify publications/feeds read + confirm-gated `productSet` | [WAVE15-PROOF-2026-09-13.md](WAVE15-PROOF-2026-09-13.md) |
| 16 | Meta catalog `items_batch` + CAPI (`META_CAPI_ENABLED` dual-gate) | [WAVE16-PROOF-2026-09-13.md](WAVE16-PROOF-2026-09-13.md) |
| 17 | TikTok catalog + Events API + campaign create (DISABLE default) | [WAVE17-PROOF-2026-09-13.md](WAVE17-PROOF-2026-09-13.md) |
| 18 | Klaviyo local `pk_` lane (account/profiles/lists/flows/campaigns/metrics + draft/upsert/event) | [WAVE18-PROOF-2026-09-13.md](WAVE18-PROOF-2026-09-13.md) |
| 19 | Catalog fan-out skill; Klaviyo catalog + reviews | [WAVE19-PROOF-2026-09-13.md](WAVE19-PROOF-2026-09-13.md) |
| 20 | Conversion fabric status + apply-only `sgtm_ingest_test`. Polar `sgtm` reserved, not minted. | [WAVE20-PROOF-2026-09-13.md](WAVE20-PROOF-2026-09-13.md) |
| 21 | MTA/LTV budget recipes + per-platform confirm-gated budget tools. No mega allocate. | [WAVE21-PROOF-2026-09-13.md](WAVE21-PROOF-2026-09-13.md) |
| 22 | Recs → approve → push; `gads_apply_recommendations` (explicit RNs); Klaviyo send-job (`SEND`). | [WAVE22-PROOF-2026-09-13.md](WAVE22-PROOF-2026-09-13.md) |
| 23 | Support/doctor/runbook gaps; marketplace honesty; agency isolation; this rollup. **FINAL.** | [WAVE23-PROOF-2026-09-13.md](WAVE23-PROOF-2026-09-13.md) |

## Honest counts (tip after Wave 23)

```
SPEC OK  tools=26 (Consent A kernel)  local_free=36  skills=21
```

- Consent A kernel: 26 (identity + GA4 + GSC + GTM, including Wave 13 clients/environments).
- Local-free: Shopify + Klaviyo reads/writes (writes fail `WRITE_NOT_ENABLED`) + GBP GET-only when flagged.
- Skills: 21 (Wave 23 added none).
- `tools/list` freeze: **164** (Wave 22). Wave 23 added **zero** MCP tools.

## What operators can do in-repo (not listing copy)

Operator docs ([TOOLS.md](../TOOLS.md), [PERMISSIONS.md](../PERMISSIONS.md), [RUNBOOKS.md](RUNBOOKS.md)) cover Consent W/G/S/MC, Shopify/Klaviyo writes, Ads/Meta/TikTok Polar tools, and conversion fabric. **Marketplace listing still says read-only GA4 / GSC / GTM.**

## Still Noel / external (not this mega-wave)

- Google OAuth verification + unlisted demo for Consent A.
- Cursor marketplace submit + public git when ready.
- Worker / stamp publish and hop-catalog parity PRs already called out per wave (Wave 23 has none).
- Polar Pro mint; do **not** mint `sgtm`.
- Ads developer token, Meta App Review (`ads_management` / catalog), TikTok Marketing API + Polar `tiktok` bit.
- GBP Basic API Access quota.
- Live mutates only on disposable DGTL/test resources — fixtures preferred.

## Locks that survive the rollup

- Do not change Consent A Data Access / write scopes.
- Do not publish site, Worker, or marketplace from an agent PR.
- Named closed tools only. No mega-mutate.
- Never Axos.
