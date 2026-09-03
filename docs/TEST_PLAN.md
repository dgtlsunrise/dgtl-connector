# Test plan

**No live Google APIs in CI.** No network to `googleapis.com`, `accounts.google.com`, or token endpoints. Replay **recorded** (here: synthetic, Google-shaped) JSON from `fixtures/google/`.

The Installed App harness already proved GSC inspect + searchanalytics + sitemaps.list, GTM lists, GA4 list + runReport. CI does not rediscover that. CI locks **contracts**.

## What CI must prove

1. Required spec files exist (proof of done).
2. Closed tool count is **22** and matches `docs/TOOLS.md` headings + `schemas/v1/catalog.json`.
3. `plugin.json` / `mcp.json` match Agent Plugins 1.0 schemas (when schemas are vendored or fetched in a **non-Google** step; prefer vendored copies later).
4. Each skill in [SKILLS.md](SKILLS.md) has `skills/<name>/SKILL.md` with frontmatter.
5. Secret scan fails the build on credential patterns.
6. Fixture JSON parses and matches the success/error envelopes.
7. Unit tests (future runtime) map fixtures → tool outputs without calling Google.
8. Denylist: `ga4_run_report` with dimension `searchQuery` returns `UNSUPPORTED_DIMENSION` **without** a Google call.
9. Missing `property_id` returns `RESOURCE_REQUIRED` without a Google call.

## Layout

```text
fixtures/google/
  oauth/whoami.json
  ga4/accounts.list.json
  ga4/properties.list.json
  ga4/properties.get.json
  ga4/dataStreams.list.json
  ga4/keyEvents.list.json
  ga4/metadata.json
  ga4/runReport.json
  ga4/runReport.empty.json
  gsc/sites.list.json
  gsc/searchanalytics.query.json
  gsc/urlInspection.inspect.json
  gsc/sitemaps.list.json
  gtm/accounts.list.json
  gtm/containers.list.json
  gtm/workspaces.list.json
  gtm/tags.list.json
  gtm/triggers.list.json
  gtm/liveVersion.json
  errors/accessNotConfigured.tagmanager.json
  errors/consentMissing.json
```

All property names are **synthetic** (`Example Brand`, `properties/111111111`, `sc-domain:example.com`). Never replace these with Breakwater, SAM, or other client exports.

## Fixture rules

- Record from a **sandbox** Google account when a runtime exists; strip `Authorization`, cookies, and emails if they are not `user@example.com`.
- Keep Google field names so mapping tests fail when Google changes shapes.
- Each error fixture includes `google_status` and `google_reason` as Google returned them.

## Spec validation (this repo)

`python3 scripts/validate-spec.py` (stdlib only):

- Enumerate required files
- `catalog.json` `count` == `len(tools)` == 22
- Every catalog `name` appears in `docs/TOOLS.md` as `` `name` ``
- Every skill directory has `SKILL.md`
- `plugin.json` / `mcp.json` JSON parse; required keys present
- Secret heuristics (see script)

Run it in CI when CI exists. Run it locally before commit.

## Runtime tests (later, not in this revision)

When a server exists, same fixtures, plus:

| Test | Expect |
| --- | --- |
| Tool list | Exactly 22 names |
| Publish-shaped tool | Absent |
| `ga4_run_report` fixture | Rows + `propertyQuota` echoed |
| Empty report fixture | `ok: true`, `row_count: 0` |
| Tag Manager 403 fixture | `ACCESS_NOT_CONFIGURED`, api `tagmanager.googleapis.com` |
| Picker | No code path sets resource id to list[0] without a flag that tests must not use in prod |

**Forbidden in CI:** `InstalledAppFlow.run_local_server`, ADC against live properties, “just hit staging GA4.”

## Manual (not CI)

After connect-card exists, a human tester (allowlisted OAuth):

1. Connect → whoami email
2. List 2+ properties → confirm agent **asks**
3. Run a small report
4. GSC queries
5. GTM live version
6. Ask to publish a tag → refuse
7. Ask for GA4 search queries → GSC pointer
8. Disconnect / revoke → `REAUTH_REQUIRED`

No Breakwater properties. No production client data.

## Out of scope for tests

Live Ads, Meta, Gmail, Drive. Load tests against Google. Screenshot tests of the Google consent screen in CI (record a human video for Google verification instead).
