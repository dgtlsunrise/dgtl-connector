# dgtl-muse-api

Cloudflare Worker for the DGTL Sunrise Muse connector (Raw API + OpenAPI).

This package is the S1 stub. `GET /openapi.json` is an OpenAPI 3.1 document. Every `/v1/*` route returns `501` with `{"error":"not_implemented"}`. `GET /healthz` returns `200`. It does not call Google, and it has no secrets.

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

## Deploy

Deploy is Noel-only. Do not run it from CI or from an agent. No DNS, custom domain, or secrets are part of this stub.

```bash
cd workers/dgtl-muse-api && npx wrangler deploy
```
