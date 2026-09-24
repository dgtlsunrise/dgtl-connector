# dgtl-muse-api

Cloudflare Worker for the DGTL Sunrise Muse connector (Raw API + OpenAPI).

`GET /openapi.json` is an OpenAPI 3.1 document. `GET /healthz` returns `200`. `GET /connect` starts Google sign-in and the callback shows a Bearer token once. `GET /v1/ga4/properties/{property_id}/sessions` reads the GA4 sessions metric for a linked grant. Other `/v1/*` routes still return `501`.

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

Open `https://muse-api.dgtlsunrise.com/connect` and choose Connect Google Analytics. The callback stores the grant and shows a `dgtl_muse_` token once. Paste that token into Muse as the Bearer token.

The Google web client is asked only for `openid`, `https://www.googleapis.com/auth/userinfo.email`, and `https://www.googleapis.com/auth/analytics.readonly`. The refresh token is encrypted with AES-256-GCM before it is stored. `GET /v1/ga4/properties/{property_id}/sessions` returns `{property_id, start_date, end_date, sessions}`. `start_date` defaults to `28daysAgo` and `end_date` defaults to `yesterday`. A grant with `google: null` returns `403` `{"error":"google_not_linked"}`.

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
