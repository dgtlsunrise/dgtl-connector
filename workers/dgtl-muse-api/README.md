# dgtl-muse-api

Cloudflare Worker for the DGTL Sunrise Muse connector (Raw API + OpenAPI).

`GET /openapi.json` is an OpenAPI 3.1 document. `GET /healthz` returns `200`. Every `/v1/*` route requires a DGTL-issued Bearer token and, when that token is valid, returns `501` with `{"error":"not_implemented"}`. It does not call Google, and it has no secrets.

The stdio tip (`src/`) and stamp are separate. This directory installs and deploys on its own.

## Local

Requires Node 22.12 or newer.

```bash
cd workers/dgtl-muse-api
npm ci
npm test
npx wrangler dev
```

`wrangler dev` serves `http://127.0.0.1:8787/openapi.json`.

## Auth

`/healthz` and `/openapi.json` are public. Every `/v1/*` route requires:

```http
Authorization: Bearer dgtl_muse_...
```

The token is `dgtl_muse_` plus 43 base64url characters from 32 random bytes. It is not a Google token, an Ads dev token, a Meta secret, or a stamp license. The Worker stores only the sha256 hex of the full token in the `MUSE_TOKENS` KV namespace. The value is a grant record:

```json
{"v":1,"grant_id":"<uuid>","created_at":"<iso-8601>","status":"active","google":null}
```

`status` is `active` or `revoked`. `google` stays `null` in this step. A missing, malformed, unknown, or revoked token returns `401` with `WWW-Authenticate: Bearer` and `{"error":"unauthorized"}`. There is no public mint endpoint.

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

## Deploy

Deploy is Noel-only. Do not run it from CI or from an agent. The Worker serves on `https://muse-api.dgtlsunrise.com` via a Cloudflare custom domain on the DGTL account.

```bash
cd workers/dgtl-muse-api && npx wrangler deploy
```
