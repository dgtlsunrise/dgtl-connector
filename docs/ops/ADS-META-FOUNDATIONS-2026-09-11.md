# Ads / Meta foundations — creative upload + PMax/Shopping (2026-09-11)

## Stamp (Worker)

| Item | Value |
|------|--------|
| PR | https://github.com/dgtlsunrise/dgtl-stamp/pull/15 — **merged** |
| Deploy | `npx wrangler deploy` from `/workspace/dgtl-planning/services/stamp` |
| Worker version | `75d87226-a4dc-406a-a914-6a96add7a0ee` |
| Hosts | https://stamp.dgtlsunrise.com · https://dgtl-stamp.noel-4ea.workers.dev |
| Flags | `ADS_MUTATE_ENABLED=true` · `META_MUTATE_ENABLED=true` (wrangler `[vars]`) |

Allowlisted tools on Worker:

- Meta: `meta_upload_ad_image`, `meta_upload_ad_video`, `meta_create_ad_creative`
- Ads: `gads_create_performance_max_campaign`, `gads_create_shopping_campaign`, `gads_list_merchant_center_links`

## Connector (plugin)

| Item | Value |
|------|--------|
| Branch | `feat/ads-meta-foundations-creative-pmax` off latest `github/main` |
| Shopify PR #21 | Left alone on `feat/shopify-readonly-products-orders` (not merged into this branch) |

Plugin tools matching stamp allowlist (confirm-gated / dry_run default; Meta fail-closed without `ads_management` when scopes detectable):

- `meta_upload_ad_image`, `meta_upload_ad_video`, `meta_create_ad_creative`
- `gads_create_performance_max_campaign`, `gads_create_shopping_campaign`, `gads_list_merchant_center_links`

Gateway client fix: `postGateway` allows closed https fields `final_url` / `file_url` / `link` (and path-only `path1`/`path2`) while still stripping open proxy URL hops / client-supplied hop URLs. Regression tests in `tests/gateway-client.test.ts`.

## Locks honored

- Consent A readonly; never Axos
- Confirm-gated live mutates; `dry_run` default true
- META fail-closed without `ads_management` when scopes detectable
- No client `mutateOperations` / open Graph proxy

## Remaining gaps

- Google Ads **image asset upload** still out of product (PMax needs existing asset resource names)
- Shopping: no product groups / listing groups in this slice
- Meta `ads_management` Advanced Access still external (App Review) for live Graph mutates
- Image bytes size / video file_url fetch limits are Worker-side; plugin only validates shapes
