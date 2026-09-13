# GTM clients spike — readonly vs edit (Wave 13)

Date: 2026-09-13  
Live Google: **not called**. Official Tag Manager API v2 docs + container-export type strings + fixtures.

## List clients / environments — Consent A

Official `accounts.containers.workspaces.clients.list` authorization scopes:

- `https://www.googleapis.com/auth/tagmanager.edit.containers`
- `https://www.googleapis.com/auth/tagmanager.readonly`

Official `accounts.containers.environments.list` uses the same pair.

**Decision:** list tools use Consent A (`tagmanager.readonly` + `GoogleHttp` GET). Do not require Consent W just to audit sGTM clients. Consent A never receives write scopes.

If a future Google change rejects readonly on clients.list, fail `CONSENT_MISSING` / `PERMISSION_DENIED` — do not silently fall back to Consent W.

## Writes — Consent W only

`clients.create` / `clients.update`, `containers.create`, `environments.create` document **`tagmanager.edit.containers`**. They go through `GoogleWriteHttp` + `DGTL_WRITES_ENABLED`. Publish remains existing `gtm_publish_container` (Consent W `tagmanager.publish`).

## Closed `Client.type` (API has no enum)

Official `Client.type` is a free `string`. These built-in ids are attested in sGTM container exports / compiled client names (not invented):

| Type | Role |
| --- | --- |
| `gaawp` | Google Analytics: GA4 client (default on new server containers; compiled `__gaaw_client`) |
| `googtag` | Google Tag client |
| `gclidw` | Conversion Linker (also a web **tag** type; appears as a client type in server exports) |
| `flc` | Floodlight |
| `ua` | Universal Analytics (legacy) |
| `mp` | Measurement Protocol client (community exports; Google does not publish an enum) |

Unknown values (including tag types `html` / `gaawc` / `gaawe` and `cvt_*` custom templates) → `INVALID_ARGUMENT` listing the closed enum. Zero HTTP.

## Closed `usageContext`

Official `UsageContext` enum: `usageContextUnspecified`, `web`, `android`, `ios`, `androidSdk5`, `iosSdk5`, `amp`, `server`.

Wave 13 tools: `web`, `android`, `ios`, `amp`, `server`. **Locked** = existing non-sGTM contexts stay in the closed enum so we do not invent values. `server` is the sGTM path. `androidSdk5` / `iosSdk5` / unspecified are **not** tooled (clear error).

## Not this spike / wave

- Stamp ingest / CAPI conversion sinks (Wave 20). Ingest-key parameter keys are refused on client create/update.
- Folders, built-in variables, users, environment reauthorize, client delete/revert.
- Axos / customer property `2859537899`.
