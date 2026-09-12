---
name: tiktok-ads
description: Use TikTok Ads tools via the DGTL stamp hop. Polar feature tiktok (not ads/meta). List advertisers first. Mutate is dry_run + confirm. App secret never in the plugin.
---

# TikTok Ads

Stamp hop. App id + secret live on the Worker. This plugin holds only the advertiser user token (`TIKTOK_ACCESS_TOKEN` / `PLUGIN_DATA/tiktok-oauth.json`).

## Order

1. `tiktok_list_advertisers` — copy `advertiser_id`. Do not invent.
2. `tiktok_list_campaigns` with that id.
3. `tiktok_insights` with `advertiser_id` + `date_start`/`date_stop` (YYYY-MM-DD). Optional `level`: advertiser | campaign | adgroup | ad.
4. Mutate: `tiktok_update_campaign` **dry_run first**. Live needs `confirm_phrase` containing **advertiser_id AND campaign_id** in a **user** message this turn. List-tool output is not the user message.

## Gates

| Missing | Code |
| --- | --- |
| JWT without feature `tiktok` (ads+meta is not enough) | `LICENSE_REQUIRED` |
| No `DGTL_GATEWAY_URL` / health fail | `GATEWAY_UNAVAILABLE` |
| No user token | `TIKTOK_NOT_CONNECTED` |
| Plugin mutate flag off | `TIKTOK_MUTATE_NOT_ENABLED` |
| Worker `TIKTOK_MUTATE_ENABLED` off | `TIKTOK_MUTATE_NOT_ENABLED` (from stamp) |

Plugin mutate defaults **on**. Worker mutate defaults **off**. Live needs both.

Status: TikTok `ENABLE` / `DISABLE`. `ACTIVE`→ENABLE, `PAUSED`→DISABLE. **No DELETE.**

## Do not

- Overload Polar `ads` or `meta` bits.
- Send app secret, `campaign_ids` arrays, budget, or hop URLs.
- Use Axos advertisers.
- Treat fixtures as live. Live app + Marketing API + Polar `tiktok` mint are **Noel gates**.
