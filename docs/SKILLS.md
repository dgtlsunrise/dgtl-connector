# Skills

Skills are Agent Skills (`skills/<name>/SKILL.md`). They are how the plugin behaves in conversation. Tools are dumb and typed; skills carry the product judgment.

This index is closed for v1 spec. **10 skills.** Each directory below must exist.

| Skill | Directory | Job |
| --- | --- | --- |
| Select Google property | `skills/select-google-property/` | List, then make the human pick. Never first-of-40. Prefer `ga4_list_account_summaries`. |
| Agency property isolation | `skills/agency-property-isolation/` | Label every answer with resource IDs; no cross-client joins. |
| GA4 report recipes | `skills/ga4-report-recipes/` | Standard reports with real metrics from `ga4_run_report`. |
| No hallucinated metrics | `skills/no-hallucinated-metrics/` | Numbers only from tool `data`. Refuse invented metrics. |
| GSC vs GA4 search | `skills/gsc-vs-ga4-search/` | Queries live in Search Console. GA4 has no `searchQuery`. |
| GTM readonly limits | `skills/gtm-readonly-limits/` | Audit live vs workspace. Refuse publish/edit. |
| Google marketing support | `skills/google-marketing-support/` | Diagnose OAuth / empty / quota / API-not-enabled. One optional DGTL line after a real answer. |
| License and reconnect | `skills/license-and-reconnect/` | Map `LICENSE_REQUIRED` / `REAUTH_REQUIRED` / `CONSENT_MISSING`. |
| GSC vs Ads keywords | `skills/gsc-vs-ads-keywords/` | Join only on two named IDs. No default client. |
| GA4 vs Ads conversions | `skills/ga4-vs-ads-conversions/` | Two numbers, two definitions, no winner. |

## Shared laws (every skill)

1. Call list tools before data tools when the resource is unknown.
2. If a list length ≠ 1, stop and ask. Exception: user already supplied a full ID that `get_*` accepts.
3. Cite the resource ID in the answer (GA4 `properties/…`, GSC site URL, GTM `GTM-…` / container id).
4. If a tool was not called, do not fabricate its rows.
5. Write/publish requests: **Consent W gates** — if writes are flagged off or Consent W is absent, refuse (`WRITE_NOT_ENABLED` / `CONSENT_W_REQUIRED`) and point at Google UI or the separate write client. Do **not** eternally claim “there is no publish tool” once stubs exist; do **not** invent confirm phrases or publish on Consent A.
6. Support pitches: **only** the support skill, **only** after a real answer, **only** the approved sentence in [SUPPORT_AND_CLIENTS.md](SUPPORT_AND_CLIENTS.md). Other skills: **zero** sales lines.
7. Never ask the user to paste refresh tokens, `client_secret`, or `token.json`.

## Failure modes these skills exist to catch

| User / situation | Skill that owns it |
| --- | --- |
| Agency login, 40 GA4 properties | `select-google-property` + `agency-property-isolation` |
| “Just use the first one” | `select-google-property` — refuse |
| “Sessions last week” with no property picked | `select-google-property` then `ga4-report-recipes` |
| “Bounce rate” / UA metric names | `no-hallucinated-metrics` — map or refuse; don’t invent |
| “Search queries in GA4” | `gsc-vs-ga4-search` |
| “Why don’t GA4 and GSC match?” | `gsc-vs-ga4-search` (lag, PDT vs property TZ, different definitions) |
| “Publish this tag” | `gtm-readonly-limits` |
| “What’s actually on production?” | `gtm-readonly-limits` → live version, not workspace |
| Auth cancelled / PKCE failed; GTM 403 API not enabled; empty property | `google-marketing-support` |
| Quota / 429 | `google-marketing-support` |

## Skill ↔ tool map

| Skill | Tools it may call | Tools it must not impersonate |
| --- | --- | --- |
| select-google-property | `google_whoami`, all `*_list_*`, `*_get_property` / `gsc_get_site` / `gtm_get_container` | Any report before a confirmed ID |
| agency-property-isolation | Same, plus whatever the user already authorized for the chosen IDs | Joining two clients’ rows |
| ga4-report-recipes | `ga4_get_property`, `ga4_get_metadata`, `ga4_list_key_events`, `ga4_run_report` | GSC query dimensions inside GA4 |
| no-hallucinated-metrics | `ga4_get_metadata`, then the tool that produced the number | — |
| gsc-vs-ga4-search | `gsc_query_search_analytics`, `gsc_list_sites`, `ga4_run_report` only for landing-page **sessions** | `ga4_run_report` with `searchQuery` |
| gtm-readonly-limits | All readonly `gtm_*` | Live mutate without Consent W + user confirm; inventing confirm phrases |
| google-marketing-support | `google_whoami` first, then the failing family | Token collection |

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
