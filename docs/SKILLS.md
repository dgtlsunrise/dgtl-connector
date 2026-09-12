# Skills

Skills are Agent Skills (`skills/<name>/SKILL.md`). They are how the plugin behaves in conversation. Tools are dumb and typed; skills carry the product judgment.

This index is closed for v1 spec plus Waves 4–8. **17 skills.** Each directory below must exist.

| Skill | Directory | Job |
| --- | --- | --- |
| First run | `skills/first-run/` | Just installed / get set up: whoami → Manual stdio auth if needed → list → pick → one default report. No Pro pitch on success. |
| Select Google property | `skills/select-google-property/` | List, then make the human pick. Never first-of-40. Prefer `ga4_list_account_summaries`. |
| Agency property isolation | `skills/agency-property-isolation/` | Label every answer with resource IDs; no cross-client joins. |
| GA4 report recipes | `skills/ga4-report-recipes/` | Standard reports with real metrics from `ga4_run_report`. |
| No hallucinated metrics | `skills/no-hallucinated-metrics/` | Numbers only from tool `data`. Refuse invented metrics. |
| GSC vs GA4 search | `skills/gsc-vs-ga4-search/` | Queries live in Search Console. GA4 has no `searchQuery`. |
| GTM readonly limits | `skills/gtm-readonly-limits/` | Audit live vs workspace. Consent W gates for write/publish. |
| Shopify readonly | `skills/shopify-readonly/` | Local merchant products/orders/locations/inventory; SHOPIFY_NOT_CONNECTED without token. |
| Shopify ↔ Ads/MC join | `skills/shopify-ads-mc-join/` | Join Shopify SKU/handle/inventory to MC offerId and Ads listing groups. Never invent SKUs. |
| Shopping ↔ MC readiness | `skills/shopping-mc-readiness/` | Merchant API products/status/issues then Shopping campaign create. Consent MC, not Consent A. |
| TikTok Ads | `skills/tiktok-ads/` | Stamp hop. Polar `tiktok` (not ads/meta). List advertisers first. Mutate dry_run + confirm. App secret never in the plugin. |
| Google marketing support | `skills/google-marketing-support/` | Diagnose OAuth / empty / quota / API-not-enabled. One optional DGTL line after a real answer. |
| Send feedback | `skills/send-feedback/` | After a hard-failure diagnosis, offer once to prepare a draft for support@dgtlsunrise.com. User must approve before `feedback_send`. |
| License and reconnect | `skills/license-and-reconnect/` | Map `LICENSE_REQUIRED` / `REAUTH_REQUIRED` / `CONSENT_MISSING`. |
| Pro upgrade | `skills/pro-upgrade/` | Ads / Meta / sGTM unlock at $19/mo flat. No nag on normal GA4. |
| GSC vs Ads keywords | `skills/gsc-vs-ads-keywords/` | Join only on two named IDs. No default client. |
| GA4 vs Ads conversions | `skills/ga4-vs-ads-conversions/` | Two numbers, two definitions, no winner. |

## Shared laws (every skill)

1. Call list tools before data tools when the resource is unknown.
2. If a list length ≠ 1, stop and ask. Exception: user already supplied a full ID that `get_*` accepts.
3. Cite the resource ID in the answer (GA4 `properties/…`, GSC site URL, GTM `GTM-…` / container id).
4. If a tool was not called, do not fabricate its rows.
5. Write/publish requests: **Consent W gates** — if writes are flagged off or Consent W is absent, refuse (`WRITE_NOT_ENABLED` / `CONSENT_W_REQUIRED`) and point at Google UI or the separate write client (`auth login-write` is shipped; it does not flip `DGTL_WRITES_ENABLED`). Tag / trigger / variable writes exist; **publish last**. Do **not** eternally claim “there is no publish tool”; do **not** invent confirm phrases or publish on Consent A. Marketplace default stays flag **off**.
6. Support pitches: **only** the support skill, **only** after a real answer, **only** the approved sentence in [SUPPORT_AND_CLIENTS.md](SUPPORT_AND_CLIENTS.md). Pro unlock ($19/mo): **only** `pro-upgrade`, and only on Ads / Meta / sGTM / `LICENSE_REQUIRED` / `GATEWAY_UNAVAILABLE` — never on a normal GA4 answer. Other skills: **zero** sales lines.
7. Never ask the user to paste refresh tokens, `client_secret`, or `token.json`.
8. **Not all tools are read.** Consent A + Shopify + GBP (when flag on) are read (or fail-closed). GTM write and Ads/Meta mutate/create are registered writes. See [TOOLS.md](TOOLS.md) Mutate honesty.
9. **ACTIVE / ENABLED on confirm only.** `dry_run` defaults true. Live needs `confirm_phrase` with resource IDs **and** a user message this turn containing those IDs. Meta **ACTIVE** / Ads **ENABLED** only with explicit `status` + confirm. Campaign/RSA/Meta creates default **PAUSED**. Standalone `gads_add_keywords` defaults **PAUSED**. Search/Display-create **children stay ENABLED** under a PAUSED campaign (intentional). Omitted keyword `match_type` is **BROAD** — do not flip.
10. **Dual-gate.** Plugin Ads/Meta/TikTok mutate flags default **on**; Worker flags fail-closed. Live hop needs both. Do not flip plugin defaults. GBP: flag off → `GBP_NOT_ENABLED`; flag on hops Consent B (never Consent A). TikTok JWT feature is `tiktok`, not ads/meta.

## Failure modes these skills exist to catch

| User / situation | Skill that owns it |
| --- | --- |
| Agency login, 40 GA4 properties | `select-google-property` + `agency-property-isolation` |
| “Just use the first one” | `select-google-property` — refuse |
| Just installed / “how do I start?” | `first-run` |
| “Sessions last week” with no property picked | `select-google-property` then `ga4-report-recipes` |
| “Bounce rate” / UA metric names | `no-hallucinated-metrics` — map or refuse; don’t invent |
| “Search queries in GA4” | `gsc-vs-ga4-search` |
| “Why don’t GA4 and GSC match?” | `gsc-vs-ga4-search` (lag, PDT vs property TZ, different definitions) |
| “Publish this tag” | `gtm-readonly-limits` |
| “List my Shopify products / orders / inventory” | `shopify-readonly` |
| “Which Shopify SKUs are in Merchant Center / Shopping ads?” | `shopify-ads-mc-join` |
| “Are my products ready for Shopping ads?” / feed issues | `shopping-mc-readiness` |
| “What’s actually on production?” | `gtm-readonly-limits` → live version, not workspace |
| Auth cancelled / PKCE failed; GTM 403 API not enabled; empty property | `google-marketing-support` |
| Quota / 429 | `google-marketing-support` |
| Ads / Meta / sGTM unlock, `LICENSE_REQUIRED`, `GATEWAY_UNAVAILABLE` | `pro-upgrade` (+ `license-and-reconnect`) |
| Hard plugin failure after a real diagnosis; user wants to tell DGTL | `send-feedback` (once; approve before send) |

## Skill ↔ tool map

| Skill | Tools it may call | Tools it must not impersonate |
| --- | --- | --- |
| first-run | `google_whoami`, then picker list tools, then one `ga4_run_report` after confirm | Paid Ads/Meta tools; Pro pitch |
| select-google-property | `google_whoami`, all `*_list_*`, `*_get_property` / `gsc_get_site` / `gtm_get_container` | Any report before a confirmed ID |
| agency-property-isolation | Same, plus whatever the user already authorized for the chosen IDs | Joining two clients’ rows |
| ga4-report-recipes | `ga4_get_property`, `ga4_get_metadata`, `ga4_list_key_events`, `ga4_run_report` | GSC query dimensions inside GA4 |
| no-hallucinated-metrics | `ga4_get_metadata`, then the tool that produced the number | — |
| gsc-vs-ga4-search | `gsc_query_search_analytics`, `gsc_list_sites`, `ga4_run_report` only for landing-page **sessions** | `ga4_run_report` with `searchQuery` |
| gtm-readonly-limits | All readonly `gtm_*` | Live mutate without Consent W + user confirm; inventing confirm phrases |
| shopify-readonly | `shopify_get_shop`, `shopify_list_*`, `shopify_get_*` | Calling Admin API without credentials; inventing ids; live writes without flag+confirm |
| shopify-ads-mc-join | `shopify_list_products`, `shopify_get_product`, `shopify_list_locations`, `shopify_list_inventory_levels`, `mc_*`, `gads_list_merchant_center_links`, `gads_add_shopping_listing_groups` | Inventing SKU/offerId; Consent A for MC; stamp Shopify hop |
| shopping-mc-readiness | `mc_*`, `gads_list_merchant_center_links`, `gads_create_shopping_campaign`, `gads_add_shopping_listing_groups` | Consent A for MC; stamp Merchant API hop; inventing merchant_id; MC mutates |
| google-marketing-support | `google_whoami` first, `support_packet` for intake, then the failing family; `feedback_prepare` only after a real hard-failure diagnosis | Token collection; `feedback_send` without user approval |
| send-feedback | `support_packet`, `feedback_prepare`, then `feedback_send` only after the user approves the draft | Sending without `confirm: true`; pitching on LICENSE_REQUIRED / empty rows / picker |
| pro-upgrade | `license_status` when explaining unlock | Pitching Pro after a normal GA4/GSC/web GTM answer |

## Frontmatter

Each `SKILL.md` uses:

```yaml
---
name: kebab-case-matching-directory
description: What it does and when to use it (trigger phrases).
---
```

Keep descriptions concrete so hosts can retrieve the right skill. Do not mention Axos, Breakwater, or SAM.

## Adding a skill later

New skill = new directory + row in this file + matching `SKILL.md`. Do not hide behavior only inside a mega “marketing-core” skill.
