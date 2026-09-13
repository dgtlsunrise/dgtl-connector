---
name: klaviyo-readonly
description: Inspect a Klaviyo account with a local private pk_ key (KLAVIYO_API_KEY or PLUGIN_DATA/klaviyo.json). Use when the user wants account, sparse profiles, lists, segments, flows, campaigns, or metrics. Fail closed without a key (KLAVIYO_NOT_CONNECTED). Free local lane — no Polar Pro, no stamp hop, not Consent A. Writes are draft/upsert/backfill only and flag-gated.
---

# Klaviyo (local pk_ lane)

## Auth

1. Merchant generates a **private API key** (`pk_…`) in Klaviyo with least-privilege scopes for the tools they need (`accounts:read`, `profiles:read`, `lists:read`, `segments:read`, `flows:read`, `campaigns:read`, `metrics:read`; write scopes only when those tools are used).
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
6. `klaviyo_list_metrics` — catalog only; not an open Metric Aggregates passthrough.
7. Writes (not this skill’s default path): `klaviyo_create_campaign` (**draft only**), `klaviyo_upsert_profile`, `klaviyo_create_event` (backfill defaults **true**). `DGTL_WRITES_ENABLED` + `confirm_phrase` containing the **account id**. `dry_run` defaults true.

Never invent list / flow / campaign / profile ids. Empty lists are not auth failures.

## Refuse

- Campaign **send jobs** (`/api/campaign-send-jobs`) — Wave 19/22.
- Catalog items / reviews — Wave 19.
- Polar `klaviyo` OAuth / stamp hop.
- Full profile PII dumps or a properties-bag upsert.
- Consent A reconnect. Axos. Logging the `pk_` key.
