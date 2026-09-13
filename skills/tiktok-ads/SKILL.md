---
name: tiktok-ads
description: Use TikTok Ads tools via the DGTL stamp hop. Polar feature tiktok (not ads/meta). List advertisers first. Catalog + Events API + mutate are dry_run + confirm. content_id must match catalog sku_id. App secret never in the plugin.
---

# TikTok Ads

Stamp hop. App id + secret live on the Worker. This plugin holds only the advertiser user token (`TIKTOK_ACCESS_TOKEN` / `PLUGIN_DATA/tiktok-oauth.json`).

## Order

1. `tiktok_list_advertisers` — copy `advertiser_id`. Do not invent.
2. `tiktok_list_campaigns` with that id.
3. `tiktok_insights` with `advertiser_id` + `date_start`/`date_stop` (YYYY-MM-DD). Optional `level`: advertiser | campaign | adgroup | ad.
4. Catalog: `tiktok_list_catalogs` → optional `tiktok_create_catalog` → `tiktok_upload_catalog_products`. **`sku_id` is the Events API `content_id`.**
5. Pixels: `tiktok_list_pixels` — copy `pixel_code`. Bind with `tiktok_bind_catalog_eventsource` (`pixel_code` XOR `app_id`).
6. Events: `tiktok_track_events` **dry_run first**. `content_id` / `content_ids` **must match catalog `sku_id`**. Live needs `confirm_phrase` containing **advertiser_id AND pixel_code**.
7. Status mutate: `tiktok_update_campaign` **dry_run first**. Live needs `confirm_phrase` containing **advertiser_id AND campaign_id**.
8. Budget mutate: `tiktok_update_campaign_budget` **dry_run first**. `BUDGET_MODE_DAY` or `BUDGET_MODE_TOTAL`. Confirm `advertiser_id` AND `campaign_id`. One platform per confirm (`mta-ltv-budget`).
9. Optional create: `tiktok_create_campaign` defaults **DISABLE** (`PAUSED`→DISABLE). Confirm `advertiser_id`.

List-tool output is not the user message.

## Gates

| Missing | Code |
| --- | --- |
| JWT without feature `tiktok` (ads+meta is not enough) | `LICENSE_REQUIRED` |
| No `DGTL_GATEWAY_URL` / health fail | `GATEWAY_UNAVAILABLE` |
| No user token | `TIKTOK_NOT_CONNECTED` |
| Plugin mutate flag off | `TIKTOK_MUTATE_NOT_ENABLED` |
| Worker `TIKTOK_MUTATE_ENABLED` off | `TIKTOK_MUTATE_NOT_ENABLED` (from stamp) |
| Plugin Events flag off / Worker `TIKTOK_EVENTS_ENABLED` off | `TIKTOK_EVENTS_NOT_ENABLED` |

Plugin mutate + Events flags default **on**. Worker flags default **off** (fail-closed). Live needs both. Events is **separate** from status mutate.

Status / create: TikTok `ENABLE` / `DISABLE`. `ACTIVE`→ENABLE, `PAUSED`→DISABLE. **No DELETE.** Creates default DISABLE.

HTTPS only for catalog `image_url` / `landing_page_url` and Events `event_source_url`.

## Do not

- Overload Polar `ads` or `meta` bits.
- Send app secret, hop URLs, or unhashed email/phone.
- Invent `content_id` that does not match a catalog `sku_id`.
- Use Axos advertisers.
- Treat fixtures as live. Live app + Marketing API + Polar `tiktok` mint are **Noel gates**.
- Call Klaviyo tools (`klaviyo-readonly` — local `pk_`, not this Polar/stamp skill).
