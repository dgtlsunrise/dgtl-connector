---
name: klaviyo-readonly
description: Inspect a Klaviyo account with a local private pk_ key (KLAVIYO_API_KEY or PLUGIN_DATA/klaviyo.json). Use when the user wants account, sparse profiles, lists, segments, flows, campaigns, metrics, catalog items, or reviews. Fail closed without a key (KLAVIYO_NOT_CONNECTED). Free local lane — no Polar Pro, no stamp hop, not Consent A. Writes are draft/upsert/backfill/catalog only and flag-gated. Campaign send jobs belong to recs-approve-push (SEND token).
---

# Klaviyo (local pk_ lane)

## Auth

1. Merchant generates a **private API key** (`pk_…`) in Klaviyo with least-privilege scopes for the tools they need (`accounts:read`, `profiles:read`, `lists:read`, `segments:read`, `flows:read`, `campaigns:read`, `metrics:read`, `catalogs:read`, `reviews:read`; `catalogs:write` only when upsert is used).
2. Set `KLAVIYO_API_KEY` **or** `PLUGIN_DATA/klaviyo.json` (`{ "api_key": "pk_…" }`, mode 0600).
3. Missing / invalid key → **`KLAVIYO_NOT_CONNECTED`**. Do not call `a.klaviyo.com`. Support never collects Klaviyo keys. **Never log the key.**
4. **No Polar license. No stamp gateway. No Polar `klaviyo` OAuth.** Same free-local posture as Shopify.
5. **Never Consent A.** Do not stuff Klaviyo into the 26-tool Google kernel.

API revision pin: **`2026-07-15`** (`revision` header). Host: `https://a.klaviyo.com`.

## Tools

1. `klaviyo_get_account` — whoami. Copy the account id for write confirms.
2. `klaviyo_list_profiles` / `klaviyo_get_profile` — **sparse** (`email`, `created`, `updated`, `external_id`). Optional `extra_fields`: `first_name`, `last_name` only. Never dump phone, location, or the properties bag.
3. `klaviyo_list_lists`, `klaviyo_list_segments`.
4. `klaviyo_list_flows` → pick `flow_id` → `klaviyo_get_flow`.
5. `klaviyo_list_campaigns` (channel filter; default `email`).
6. `klaviyo_list_metrics` — metrics catalog only; not an open Metric Aggregates passthrough.
7. Catalog (Wave 19): `klaviyo_list_catalog_items` / `klaviyo_list_catalog_categories` / `klaviyo_list_catalog_variants`. `$custom` / `$default` only. Do not invent `$shopify:::$default:::` ids.
8. Reviews (Wave 19): `klaviyo_list_reviews` / `klaviyo_get_review`. Sparse — never dump reviewer email.
9. Writes (not this skill’s default path): `klaviyo_create_campaign` (**draft only**), `klaviyo_upsert_profile`, `klaviyo_create_event` (backfill defaults **true**), `klaviyo_upsert_catalog_items` (closed items; not a mega upsert-all). `confirm_phrase` containing the **account id**. `dry_run` defaults true.

Never invent list / flow / campaign / profile / catalog ids. Empty lists are not auth failures. Multi-network Shopify → ads/email mapping is `catalog-fan-out`.

## Refuse

- Campaign **send jobs** (`/api/campaign-send-jobs`) from this skill or from `klaviyo_create_campaign`. Wave 22 send is `klaviyo_create_campaign_send_job` via `recs-approve-push` (account id + campaign id + `SEND`).
- Polar `klaviyo` OAuth / stamp hop (Wave 19b deferred).
- Full profile PII dumps or a properties-bag upsert.
- Inventing `$shopify:::$default:::` catalog ids.
- Consent A reconnect. Axos. Logging the `pk_` key.
