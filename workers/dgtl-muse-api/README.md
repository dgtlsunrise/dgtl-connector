# dgtl-muse-api

Cloudflare Worker for the DGTL Sunrise Muse connector (Raw API + OpenAPI).

`GET /openapi.json` is an OpenAPI 3.1 document. `GET /healthz` returns `200`. `GET /connect` starts Google sign-in and the callback shows a Bearer token once. Free Google reads cover GA4, Search Console, and Tag Manager. `POST /v1/writes/preview` and `POST /v1/writes/confirm` are a confirm gate that does not mutate Google.

The stdio tip (`src/`) and stamp are separate. This directory installs and deploys on its own.

## Local

Requires Node 22.12 or newer.

```bash
cd workers/dgtl-muse-api
npm ci
npm test
npx wrangler dev
```

`wrangler dev` serves `http://127.0.0.1:8787/openapi.json`. OAuth and the sessions read need the three Worker secrets below. For local dev, put them in `.dev.vars` (gitignored). Do not commit values.

## Auth

`/healthz` and `/openapi.json` are public. Every `/v1/*` route requires:

```http
Authorization: Bearer dgtl_muse_...
```

The token is `dgtl_muse_` plus 43 base64url characters from 32 random bytes. It is not a Google token, an Ads dev token, a Meta secret, or a stamp license. The Worker stores only the sha256 hex of the full token in the `MUSE_TOKENS` KV namespace. The value is a grant record:

```json
{"v":1,"grant_id":"<uuid>","created_at":"<iso-8601>","status":"active","google":null}
```

`status` is `active` or `revoked`. `google` is `null` or a link `{sub, email, scopes, refresh_token: {alg: "A256GCM", iv, ct}, linked_at}`. Records with `google: null` still parse. A missing, malformed, unknown, or revoked token returns `401` with `WWW-Authenticate: Bearer` and `{"error":"unauthorized"}`. The operator mint script still writes `google: null`. A user gets a linked token from `/connect`.

### KV namespace

`MUSE_TOKENS` already exists. Its id is `0d402c45bb384f0081f5327556d05de7`, bound in `wrangler.jsonc`. A namespace id is not a secret. Do not commit a token.

Recreate it only if the namespace is gone:

```bash
cd workers/dgtl-muse-api
npx wrangler kv namespace create MUSE_TOKENS
```

Put the printed id on the `MUSE_TOKENS` binding.

### Mint

```bash
cd workers/dgtl-muse-api
node scripts/mint-token.mjs
```

Stdout is two lines. The first is the token, printed once. The second is the remote put command:

```bash
wrangler kv key put --binding MUSE_TOKENS <hash> '<json>' --remote
```

Run that command yourself. Keep the hash. The Worker does not store the token, so revocation needs the hash.

### Revoke

Revocation is deleting that sha256 hex key. A missing key and a grant whose `status` is `revoked` both return `401`. KV caches reads for about 60 seconds, so a revoke can lag by that long.

```bash
npx wrangler kv key delete --binding MUSE_TOKENS <hash> --remote
```

To revoke without deleting the record, put the same JSON with `"status":"revoked"`.

## Connect

Open `https://muse-api.dgtlsunrise.com/connect` and choose Connect Google. The callback stores the grant and shows a `dgtl_muse_` token once. Paste that token into Muse as the Bearer token.

`/connect` requests the Free Google set (the same strings as tip `CONSENT_A`):

- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/analytics.readonly`
- `https://www.googleapis.com/auth/webmasters.readonly`
- `https://www.googleapis.com/auth/tagmanager.readonly`
- `https://www.googleapis.com/auth/analytics.edit`
- `https://www.googleapis.com/auth/tagmanager.edit.containers`
- `https://www.googleapis.com/auth/tagmanager.edit.containerversions`
- `https://www.googleapis.com/auth/tagmanager.publish`
- `https://www.googleapis.com/auth/webmasters`

It does not request `https://www.googleapis.com/auth/adwords`, `https://www.googleapis.com/auth/content`, or `https://www.googleapis.com/auth/business.manage`. Google must return every requested scope. A partial grant is not stored. The callback writes the granted scope list on the grant next to the sealed refresh token. The refresh token is encrypted with AES-256-GCM before it is stored. A grant with `google: null` returns `403` `{"error":"google_not_linked"}`.

## Reads

Google-calling reads open the stored refresh token and mint an access token. `GET /v1/gsc/schema` is a local catalog and does not. A linked grant that is missing the readonly scope for that route returns `403` `{"error":"google_reconnect_required","missing_scopes":[...]}` and does not call Google. An older grant that only has `analytics.readonly` can still read GA4, including sessions. Search Console reads need `webmasters.readonly`. Tag Manager reads need `tagmanager.readonly`. These routes do not publish a container, submit a sitemap, or write GA4 Admin.

`GET /v1/ga4/properties/{property_id}/sessions` returns `{property_id, start_date, end_date, sessions}`. `start_date` defaults to `28daysAgo` and `end_date` defaults to `yesterday`. That path is a sessions convenience. The tip report tool is `POST /v1/ga4/properties/{property_id}/reports`.

| Tip tool | Muse path | Notes |
| --- | --- | --- |
| `ga4_list_accounts` | `GET /v1/ga4/accounts` | `page_token` is Google `nextPageToken`. |
| `ga4_list_account_summaries` | `GET /v1/ga4/account-summaries` | Response key `account_summaries`. |
| `ga4_list_properties` | `GET /v1/ga4/accounts/{account_id}/properties` | Path is the numeric id. Tip also accepts an `accounts/{id}` prefix. |
| `ga4_get_property` | `GET /v1/ga4/properties/{property_id}` | Admin resource is `resource` (`displayName`, `timeZone`, `currencyCode`). |
| `ga4_list_data_streams` | `GET /v1/ga4/properties/{property_id}/data-streams` | Response key `data_streams`. |
| `ga4_list_key_events` | `GET /v1/ga4/properties/{property_id}/key-events` | Response key `key_events`. |
| `ga4_get_metadata` | `GET /v1/ga4/properties/{property_id}/metadata` | Not cached. Query `query`, `kind`, `custom_only`. |
| `ga4_run_report` | `POST /v1/ga4/properties/{property_id}/reports` | Subset. No `recipe`, `dimension_filter`, `metric_filter`, or `order_bys`. Search-query and gclid names are rejected locally. |
| (sessions convenience) | `GET /v1/ga4/properties/{property_id}/sessions` | Not a tip tool. Sessions metric only. |
| `gsc_describe_schema` | `GET /v1/gsc/schema` | Local catalog. No Google call. |
| `gsc_list_sites` | `GET /v1/gsc/sites` | `page_token` is a numeric offset. Copy `siteUrl` exactly. |
| `gsc_get_site` | `GET /v1/gsc/site?site_url=` | Query, not a path, because the property string contains slashes. |
| `gsc_query_search_analytics` | `POST /v1/gsc/search-analytics` | `data_state` defaults to `final`. |
| `gsc_inspect_url` | `POST /v1/gsc/url-inspection` | No request-indexing route. |
| `gsc_list_sitemaps` | `GET /v1/gsc/sitemaps?site_url=` | Optional `sitemap_index`. Numeric `page_token`. |
| `gsc_get_sitemap` | `GET /v1/gsc/sitemap?site_url=&feedpath=` | `feedpath` is a query parameter. |
| `gtm_list_accounts` | `GET /v1/gtm/accounts` | Numeric `page_token`. |
| `gtm_list_containers` | `GET /v1/gtm/accounts/{account_id}/containers` | `publicId` (`GTM-XXXX`) is a field, not the path id. |
| `gtm_get_container` | `GET /v1/gtm/accounts/{account_id}/containers/{container_id}` | |
| `gtm_list_workspaces` | `GET .../workspaces` | Do not assume a default workspace. |
| `gtm_list_tags` | `GET .../workspaces/{workspace_id}/tags` | `source=workspace` drafts, not live. |
| `gtm_list_triggers` | `GET .../workspaces/{workspace_id}/triggers` | Drafts. |
| `gtm_list_variables` | `GET .../workspaces/{workspace_id}/variables` | Drafts. |
| `gtm_list_clients` | `GET .../workspaces/{workspace_id}/clients` | Drafts. Not stamp ingest. |
| `gtm_get_live_container_version` | `GET .../versions/live` | Google path is `versions:live`. Does not publish. |
| `gtm_list_environments` | `GET .../environments` | Container-level, not workspace-level. |

`...` is `/v1/gtm/accounts/{account_id}/containers/{container_id}`. Path ids are digits. Google list objects keep Google's field names.

## Writes

`POST /v1/writes/preview` accepts only `kind` `ga4_custom_dimension_create` with `property_id` and `dimension` (`parameter_name`, `display_name`, `scope`). The grant must have `google` linked, or the response is `403` `{"error":"google_not_linked"}`. GA4 manage also requires `https://www.googleapis.com/auth/analytics.edit`. A linked grant without that scope returns `403` `{"error":"google_reconnect_required","message":"This Google connection is missing https://www.googleapis.com/auth/analytics.edit. Reopen /connect and reconnect Google.","missing_scopes":["https://www.googleapis.com/auth/analytics.edit"]}` and the Worker does not store a preview. The same refusal on `POST /v1/writes/confirm` leaves an existing preview in place. It does not call Google and it does not mutate. When the scope is present, the Worker stores the preview in `MUSE_TOKENS` under `preview:<preview_id>` for 600 seconds and returns `status` `preview` with `confirm_required` true and `resource_ids` containing the property id.

`POST /v1/writes/confirm` loads that preview. A missing, expired, or already used preview is `400` `{"error":"preview_invalid"}`. A preview owned by another grant is `403` `{"error":"preview_forbidden"}`. `confirm_phrase` must contain every `resource_ids` entry (substring, case-sensitive) or the response is `400` `{"error":"confirm_refused","confirm_required":true}` and the preview stays usable. A matching phrase deletes the preview and returns `status` `confirmed`, `executed` false, `reason` `stub_no_mutate`.

## Deploy

Deploy is Noel-only. Do not run it from CI or from an agent. The Worker serves on `https://muse-api.dgtlsunrise.com` via a Cloudflare custom domain on the DGTL account.

Set these Worker secrets before the first OAuth or sessions call. Do not commit the values. `MUSE_TOKEN_ENC_KEY` is 32 bytes, base64-encoded (`openssl rand -base64 32`). `GOOGLE_WEB_CLIENT_ID` and `GOOGLE_WEB_CLIENT_SECRET` are the Google web OAuth client whose redirect URI is `https://muse-api.dgtlsunrise.com/oauth/google/callback`.

```bash
cd workers/dgtl-muse-api
npx wrangler secret put GOOGLE_WEB_CLIENT_ID
npx wrangler secret put GOOGLE_WEB_CLIENT_SECRET
npx wrangler secret put MUSE_TOKEN_ENC_KEY
npx wrangler deploy
```
