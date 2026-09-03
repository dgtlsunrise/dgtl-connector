# Polar license plan — Phase 8 (design only)

**Status:** design. Do not create Polar products, checkout links, or webhooks in this pass. Do not spend money. Do not put a private key in the plugin.

Free GA4 / GSC / GTM stays free and local. Paid unlock is Google Ads plus Meta Ads only. Those tools already exist in dgtl-marketing 0.1.0 and return LICENSE_REQUIRED until a locally verified Ed25519 JWT is present (DGTL_LICENSE_JWT or PLUGIN_DATA/license.jwt). See src/license/verify.ts.

This document is how Polar billing will mint that JWT. Implementation is a later Worker, not this package.

---

## Goal

Polar Pro checkout (paid) leads to a Polar webhook (order.paid / subscription.active). A DGTL Worker verifies the webhook, mints an Ed25519 JWT, and the customer sets DGTL_LICENSE_JWT. The plugin verifies locally with the embedded public key and does not call Polar.

Polar is merchant of record / billing. Polar's built-in license-key benefit is a Polar-format string. It will not verify as DGTL_LICENSE_JWT (alg must be EdDSA, issuer dgtl-sunrise). Do not feed Polar keys into the plugin. Optionally attach Polar's license-key benefit for the customer portal, but the plugin only accepts DGTL's JWT.

Ads developer token and Meta app secret never enter this plugin. They stay on the later allowlisted gateway. The JWT only unlocks features ads and meta so those tools stop returning LICENSE_REQUIRED. Gateway attach is Phase 10-11.

---

## What the plugin already verifies

See src/license/verify.ts. Local Ed25519 JWT only. Issuer name is dgtl-sunrise. Feature strings are ads and meta. Token comes from DGTL_LICENSE_JWT or PLUGIN_DATA/license.jwt. No network. Free GA4/GSC/GTM tools keep working if the license is missing or expired.

---

## JWT fields to mint

Header: alg EdDSA. typ JWT is optional.

Payload the Worker should issue:

- iss: dgtl-sunrise (verifier rejects a wrong issuer)
- sub: Polar customer id (stable). Email is optional extra, not required
- jti: unique id per mint (Polar order id or a new UUID). Support/correlation only in v1
- iat: unix seconds issued
- exp: unix seconds. Prefer Polar current_period_end for subscriptions. For a one-time purchase, a long dated exp Noel chooses later. Not a 5-10 dollar SaaS gate.
- features: the JSON array [ads, meta] for Pro. Do not invent other feature strings in v1

Unknown extra claims are ignored by the verifier as long as JSON parses. Useful extras not read by the plugin today: polar_order_id, polar_subscription_id, polar_product_id.

Do not put Google tokens, Ads developer tokens, or Meta app secrets in the JWT.

---

## Product shape (do not create yet)

One Polar product, working name DGTL Sunrise Pro. Recurring subscription (Polar hosted checkout). Price is professional/agency infrastructure, not a 5-10 dollar wedge in front of GA4. Success URL can be a static page that says: set DGTL_LICENSE_JWT to the token we email you.

---

## Where minting happens (not in the plugin)

The plugin only embeds the public verifier. Minting runs on DGTL-owned infrastructure (a Cloudflare Worker is the intended home). Polar never holds DGTL's minting secret. This git never holds it. This session does not create it.

---

## Worker outline (later deploy; not this package)

Intended home: a small Cloudflare Worker (or equivalent) on a DGTL hostname, not a folder inside the plugin. No GA4/GSC/GTM report bytes. No Google token vault.

Inbound:

- POST webhook from Polar, format Raw. Verify Standard Webhooks signature using POLAR_WEBHOOK_SECRET from the Worker env (Polar dashboard, later). Reject unsigned bodies.
- Subscribe (when Noel creates the endpoint later): order.paid, order.refunded, subscription.active, subscription.revoked, subscription.canceled. Prefer order.paid over order.created (created can still be pending).

On paid / active:

- Map Polar product id → features [ads, meta] for Pro. Unknown products: no mint.
- Mint JWT with the fields above. exp aligned to current_period_end when Polar sends it.
- Deliver the JWT by email to the Polar customer email (from DGTL, not from this plugin) and/or a success page Noel hosts. Customer pastes into DGTL_LICENSE_JWT or PLUGIN_DATA/license.jwt.
- Idempotent on polar order id / jti so Polar retries do not spam inboxes.

On refunded / revoked:

- Stop minting. Local JWT verify cannot pull a revocation list in v1 (by design: Ads tools fail closed when exp lapses). Short exp plus remint on subscription.cycled is the v1 control. A later Worker denylist is optional and not required for launch of the free plugin.

Do not: call Polar checkout APIs from the plugin, store report payloads, attach Ads developer-token here, or expose a public "mint any JWT" route.

---

## Polar dashboard steps (Noel, later — not this session)

When Phase 8 starts, Noel (not an agent spending money) will:

1. Create a Polar organization for Sunrise Consulting LLC / DGTL Sunrise (sandbox first: sandbox-api.polar.sh).
2. Create one Pro product + hosted checkout. Do not attach Ads scopes to Google OAuth while doing this.
3. Add a webhook endpoint pointing at the Worker, secret in Worker env, events listed above.
4. Put minting secret and POLAR_WEBHOOK_SECRET in the Worker. Confirm the public verifier in the plugin matches.
5. Buy the sandbox product himself as a test customer (Polar sandbox; no live charge required for that path).
6. Confirm LICENSE_REQUIRED flips to ADS_SCOPE_MISSING / META_NOT_CONNECTED once the JWT is set (gateway still Phase 10).

This session does none of those.

---

## Out of scope

- Creating Polar products or checkout links from an agent
- Putting Polar license-key strings into DGTL_LICENSE_JWT
- Charging for ga4_run_report
- Stripe inside the MCP
- Network license checks on every tool call
