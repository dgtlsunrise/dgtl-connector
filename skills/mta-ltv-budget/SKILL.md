---
name: mta-ltv-budget
description: Compare GA4 data-driven attribution (Ads-id dimensions) to Ads last-click recipes, optionally LTV when metadata lists it, then propose budgets and call confirm-gated per-platform budget tools one at a time. Never allocate_budgets. Never invent userLifetimeValue. gclid is not a GA4 dimension.
---

# MTA / LTV → budget (Wave 21)

Two series, **no winner**. Propose spend from GA4 DDA / Ads-id key events (and metadata LTV only when present). Google Ads last-click recipes are a **second** series — not sole truth.

There is **no** `allocate_budgets` tool. Sequence the named budget tools **one platform per confirm**.

## Grants

| Surface | Grant |
| --- | --- |
| GA4 reports + metadata + attribution GET | Consent A |
| `gads_search` / `gads_update_campaign_budget` | Consent C + Polar `ads` + stamp |
| `meta_insights` / `meta_update_adset` | Polar `meta` + stamp |
| TikTok insights / `tiktok_update_campaign_budget` | Polar `tiktok` + stamp |

Never Consent A for Ads/Meta/TikTok hops. Never Axos.

## Sequence

1. Confirm `property_id` (picker). Never index 0. Header: property + timezone + date range.
2. `ga4_get_attribution_settings` — cite `PAID_AND_ORGANIC_CHANNELS_DATA_DRIVEN` vs `*_LAST_CLICK`. Do not flip settings here (`ga4_update_attribution_settings` is Consent G and a different skill).
3. `ga4_get_metadata` **before** any unfamiliar metric. **Refuse missing apiNames.** Do **not** invent `userLifetimeValue`. If metadata lacks it, skip LTV and say so.
4. `ga4_run_report` Ads-id recipes (`ads_mta_campaign_ids` / `ads_mta_ids`). Defaults `sessions`, `keyEvents`. Optional `key_event_names` → `keyEvents:{name}`. v1beta has **no** `conversionSpec`.
5. Paid last-click series (when licensed): `gads_describe_recipes` then `gads_search` `click_view` (single-day), `keyword_performance`, `ad_performance`, and/or `performance`. Cite `data.cited.customer_id`. Empty ≠ auth failure.
6. Optional Meta / TikTok insights on **named** account ids.
7. Propose daily budgets (show GA4 DDA share **and** Ads last-click share). `dry_run` **defaults true** on every write.
8. Call **one** named tool per confirm, in this order when those platforms were proposed:
   - Google Ads: `gads_update_campaign_budget` (`customer_id` + `campaign_budget_id`; `amount_micros` or `daily_budget_dollars`)
   - Meta: `meta_update_adset` (`act_{ad_account_id}` + `adset_id`; `daily_budget` in **cents**)
   - TikTok: `tiktok_update_campaign_budget` (`advertiser_id` + `campaign_id`; `budget` + `BUDGET_MODE_DAY` / `BUDGET_MODE_TOTAL`)
9. Live mutate still needs `confirm_phrase` with that platform’s ids **and** a user message this turn containing those ids. List-tool output is not the user message.

## Isolation

- Refuse unnamed `property_id` / `customer_id` / `ad_account_id` / `advertiser_id`. `""`, `"default"`, `"first"`, `"0"` → stop.
- Join Ads-id **campaign / ad group / creative / customer ids**. **gclid is not a GA4 dimension** — it lives on `gads_search` recipe=`click_view` only.
- `ads_mta_keyword_ids` refuses (GA4 has no keyword *id*). Keyword ids come from `gads_search` recipe=`keyword_performance` / `keywords`.

## Refuse

- A mega `allocate_budgets` / `apply_all_budgets` tool.
- Treating Ads last-click (`click_view` / `keyword_performance` / `ad_performance` / Ads `metrics.conversions`) as the only truth.
- Inventing `userLifetimeValue` (or any LTV name) when `ga4_get_metadata` does not list it.
- Sending `gclid` on `ga4_run_report`.
- Raw GAQL / invented `metrics.*` / `segments.*`.
- Confirming two platforms in one turn.
- Live budget on ACTIVE/ENABLED production campaigns from this skill’s proof path — fixtures first; disposable DGTL/test **PAUSED** campaigns only if Noel names them.
- Consent A for Ads/Meta/TikTok. Axos. Wave 22 recommendation polish.

## Empty / license

`LICENSE_REQUIRED` on Ads/Meta/TikTok: still show the GA4 DDA series and stop on that paid side (`pro-upgrade` / `license-and-reconnect`). Empty rows are not reconnect.
