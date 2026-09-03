# v2 hosted (optional)

v1 is complete without this document’s product. Hosted exists **only** for credentials a **public plugin cannot hold**. It is not a $5–10/month gate in front of GA4, GSC, or GTM.

## When hosted is justified

| Credential | Why a public plugin cannot hold it | What users who have their own can do |
| --- | --- | --- |
| **Google Ads developer token** | Google issues these to Ads managers; a shared token in git is theft; putting DGTL’s MCC token in a public MCP makes DGTL the data plane | A future **local** Ads tool could accept *the user’s* developer token via host secret storage — still not v1 |
| **Meta app secret** | Meta App Review + app secret cannot be shipped in a public repo; a DGTL app implies DGTL servers | Same pattern: user-owned app, or hosted |
| **Agency token vault** | Employees must not all share one Google login; a vault is an actual service with audit logs | v1 isolation is picker-only (see [PERMISSIONS.md](PERMISSIONS.md)) |

If none of those apply, **stay local**. GA4/GSC/GTM readonly must remain installable with zero DGTL account.

## When hosted is not justified

- Charging for `ga4_run_report` that already runs on the user’s computer
- “Pro” row limits as a business model
- Cloning Ryze autopilot (Ads/Meta/TikTok/Shopify writes, ~$89) as our v1 identity
- Collecting refresh tokens “so support can log in”

## Pricing posture

Not $5–10 SaaS.

Hosted is **infrastructure plus liability** (Ads API, Meta, vault). Price it like professional / agency infrastructure: contract, retainer, or usage of **hosted** APIs — decided later, not in this spec. The number is not “cheap so they convert from free GA4.”

Free local v1 stays free even if v2 exists.

## How it stays optional

Architecture: **second MCP server**, not a rewrite of GA4 tools ([ARCHITECTURE.md](ARCHITECTURE.md)).

| v1 (required for the plugin to be itself) | v2 (opt-in) |
| --- | --- |
| stdio / user computer | streamable-http DGTL or user-hosted |
| GA4, GSC, GTM tools unchanged | `gads_*`, `meta_*`, vault admin |
| User Google OAuth via connect card | Separate consent; Ads developer token on the host |
| No DGTL account | DGTL account only for hosted features |

Skills: if Ads is asked and v2 is absent — say what’s missing, still run GA4/GSC. Never disable GTM because they declined hosted.

## Google Ads / Meta review (future)

- Ads: developer token, API access, likely a **different** OAuth client with `adwords` — do not bolt that scope onto the v1 client “early.”
- Meta: App Review, app secret on a server.
- Writes (if ever): approval-gated, explicit tools, not silent autopilot. Still not a Ryze clone by default.

## Decision test

Add hosted **only if** all three are true:

1. The feature is impossible in a public plugin without sharing a secret DGTL must not publish.
2. GA4/GSC/GTM keep working with hosted uninstalled.
3. The price is not a vanity SaaS wedge.

Until then, this file is a fence, not a backlog of ads tools.
