# Meta CREATE speed-run — 2026-09-11 (PT)

## Shipped surface

| Tool | Closed create shape | Live confirmation |
| --- | --- | --- |
| `meta_create_campaign` | `name`, closed `OUTCOME_*` objective, known `special_ad_categories`, status | `act_{ad_account_id}` |
| `meta_create_adset` | existing `campaign_id`, name, daily XOR lifetime budget (cents), closed billing/optimization/bid values, country-code geo only, optional end time | `act_{ad_account_id}` + `campaign_id` |
| `meta_create_ad` | existing `adset_id`, name, existing `creative_id` only, status | `act_{ad_account_id}` + `adset_id` + `creative_id` |

All three default `dry_run=true`; no Graph mutate request occurs until `dry_run=false` and the required identifiers are present in `confirm_phrase`. New objects default `PAUSED`. The existing plugin Meta mutate flag defaults on (explicit `DGTL_META_MUTATE_ENABLED=false` opts out), and the Worker still requires `META_MUTATE_ENABLED=true`.

## Safety locks

- Stamp owns the pinned Graph v26.0 host, POST method, and exact `act_{id}/campaigns|adsets|ads` paths.
- Client URLs, versions, raw form bodies, targeting/creative bags, `object_story_spec`, asset feeds, image/video upload, and raw mutate operations are rejected.
- Ad-set targeting is constructed server-side from ISO country codes only; no audience/custom-audience expansion in this slice.
- Ad create is **creative_id-only**. Creative/image/video upload remains out of scope.
- Ad-set `daily_budget` XOR `lifetime_budget` uses Meta account currency smallest units (cents for USD), not Google Ads micros. Product cap is 10,000,000 cents; Worker override remains `META_MUTATE_MAX_BUDGET_CENTS`.
- Meta login/token is separate from Google. Consent A is unchanged and readonly.
- No Axos account, data, or workflow was used.

## Permission fail-closed behavior

`ads_management` Advanced Access is not approved yet. Code ships before approval but does not claim successful live creates:

1. When granted scopes are detectable and omit `ads_management`, the connector returns `META_SCOPE_MISSING` before the create hop (zero mutate HTTP).
2. When scope metadata is unavailable, Stamp maps Meta Graph permission/OAuth denials to `META_SCOPE_MISSING` and does not retry.
3. Read tools can continue under `ads_read`.

## Verification

- Stamp: `npm test` — 163 pass; `npm run typecheck` green.
- Connector: `npm test` — 230 pass; TypeScript green; `npm run validate:spec` — `SPEC OK`.
- Focused tests cover exact allowlist paths, closed form bodies, PAUSED defaults, budget cap/XOR, creative_id-only ad shape, confirm gates, flag-off zero-hop, detectable missing scope zero-hop, and Graph permission mapping.

## Delivery

- Stamp PR: pending
- Connector PR: pending
- Stamp deployment: pending
- Connector Origin `main` sync: pending

## Remaining gaps / Noel gate

- Obtain Meta `ads_management` Advanced Access before production users can live-create outside app roles/test users.
- Re-authorize Meta after approval so the user token actually includes `ads_management`.
- Perform one non-Axos test-account E2E sequence: dry-run campaign → create PAUSED campaign → create PAUSED ad set within cap → create PAUSED ad from an existing creative ID.
- Creative upload, object story construction, audience/custom-audience targeting, catalog, boost, and unattended/autopilot spend remain out of scope.
