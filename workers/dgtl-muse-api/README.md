# dgtl-muse-api

Cloudflare Worker for the DGTL Sunrise Muse connector (Raw API + OpenAPI).

`GET /openapi.json` is an OpenAPI 3.1 document. `GET /healthz` returns `200`. `GET /connect` starts Google sign-in and the callback shows a Bearer token once. `GET /v1/ga4/properties/{property_id}/sessions` reads the GA4 sessions metric for a linked grant. `POST /v1/writes/preview` and `POST /v1/writes/confirm` are a confirm gate that does not mutate Google. `GET /v1/ga4/properties/{property_id}` still returns `501`.

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

It does not request `https://www.googleapis.com/auth/adwords`, `https://www.googleapis.com/auth/content`, or `https://www.googleapis.com/auth/business.manage`. Google must return every requested scope. A partial grant is not stored. The callback writes the granted scope list on the grant next to the sealed refresh token. The refresh token is encrypted with AES-256-GCM before it is stored. `GET /v1/ga4/properties/{property_id}/sessions` returns `{property_id, start_date, end_date, sessions}` and still works for an older grant that only has `analytics.readonly`. `start_date` defaults to `28daysAgo` and `end_date` defaults to `yesterday`. A grant with `google: null` returns `403` `{"error":"google_not_linked"}`.

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
