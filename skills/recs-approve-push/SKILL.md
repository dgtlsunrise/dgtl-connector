---
name: recs-approve-push
description: Sequence Ads recommendations, Merchant Center issues, GTM workspace vs live, Klaviyo flow status, and a missing GA4 Ads link, then apply one named mutate tool per confirm. Never auto-apply all Google recs. ENABLED is not a side effect of apply. Klaviyo send jobs need a SEND token and cannot fire from draft create.
---

# Recs → approve → push (Wave 22)

Read five surfaces, then **one mutate tool per confirm**. There is no apply-all / publish-all / send-all tool.

## Sequence (reads first)

1. **Ads recommendations** — picker for `customer_id` (digits, no hyphens). `gads_describe_recipes` then `gads_search` recipe=`recommendations`. Cite `data.cited.customer_id`. Empty ≠ auth failure.
2. **Merchant Center issues** — named `merchant_id` from `mc_list_accounts` or `gads_list_merchant_center_links`. Then `mc_list_account_issues` and `mc_list_product_statuses`. Never Consent A. Never invent `merchant_id`.
3. **GTM workspace diff** — picker for container `publicId`. Live = `gtm_get_live_container_version`. Workspace = `gtm_list_workspaces` then `gtm_list_tags` / `gtm_list_triggers` / `gtm_list_variables` on a confirmed `workspace_id`. Diff is judgment (added / removed). Config ≠ firing.
4. **Klaviyo flow status** — `klaviyo_get_account` then `klaviyo_list_flows` / `klaviyo_get_flow`. Local `pk_`. Empty ≠ reconnect.
5. **Missing GA4 Ads link** — picker for `property_id`. `ga4_list_google_ads_links` (Consent A GET). If the named Ads `customer_id` is absent, say so. Creating a link is Consent G (`ga4_create_google_ads_link`) — never a Consent A mutate.

Cite every resource id you used. If a list length ≠ 1, stop and ask.

## Approve → one mutate

`dry_run` **defaults true**. Live needs `confirm_phrase` with that tool’s ids **and** a user message this turn containing those ids. List-tool output is not the user message.

Call **one** of these per confirm, in this order when those surfaces produced work:

| Surface | Mutate |
| --- | --- |
| Ads recs (one RN) | `gads_apply_recommendation` |
| Ads recs (explicit RN list) | `gads_apply_recommendations` — confirm must include `customer_id` **and each RN** (or its id) |
| MC issues | Named MC write (`mc_upsert_product_input`, …) with `merchant_id` in confirm |
| GTM unpublished diff | Consent W tag/trigger/variable writes, **publish last** (`gtm_publish_container`) with `publicId` |
| Missing GA4 Ads link | `ga4_create_google_ads_link` (Consent G) with `properties/{id}` in confirm |
| Klaviyo send (late) | `klaviyo_create_campaign_send_job` only — confirm must include account id, campaign id, and the token **`SEND`** |

## Locks

- **No auto-apply all** Google recs. Refuse `apply_all`, `*`, or an empty RN list. The batch tool still requires the exact RNs in confirm.
- **ENABLED is not a side effect.** Apply payloads never include `status`. Do not enable a campaign because a recommendation was applied. Status flips stay on `gads_set_campaign_status` / `gads_set_ad_status` with explicit `status` + confirm.
- **Draft create cannot send.** `klaviyo_create_campaign` stays draft-only (`POST /api/campaigns`). It must never `POST /api/campaign-send-jobs`. Send is a later, confirm-gated tool.
- Consent A stays readonly. Never Axos. No marketplace rewrite.

## Refuse

- A mega `apply_all_recommendations` / `approve_and_push` / `send_all` tool.
- Applying recs that were not named in this turn’s confirm.
- Passing `status=ENABLED` (or any status) on apply tools.
- Two mutate tools in one confirm.
- Firing a Klaviyo send job from `klaviyo_create_campaign`.
- Consent A for Ads / MC / Consent W publish / Consent G link create.
- Inventing recommendation RNs, `merchant_id`, GTM `publicId`, Klaviyo campaign ids, or GA4 property ids.
