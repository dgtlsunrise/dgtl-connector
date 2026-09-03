# DGTL Sunrise — Google marketing connector (step 0)

Status: planning only. No implementation. Off Axos clock.
Publisher: Sunrise Consulting LLC / DGTL Sunrise (`noel@dgtlsunrise.com`)
Date: 2026-09-02

## Decision lock (Noel, Sep 2)

- Public Grok Bot / Cursor plugin people install.
- They authorize their own accounts.
- Queries run on **their** Grok Bot computer. No DGTL data plane in v1.
- All self-hosted features are free.
- Anything that requires DGTL servers is a later paid upgrade, only if it is something local cannot do.
- Not a $5–10 SaaS. Not Ryze with a cheaper sticker.

## What we are actually competing with

Ryze is not a plugin. It is a **hosted** MCP (`https://connector.get-ryze.ai/mcp`) plus a workspace, token vault, scheduled agent, and approval-gated writes. Price is free-to-connect, autopilot from ~$89/mo. Surfaces: Google Ads (read + gated write), Meta Ads, TikTok Ads, GA4, GSC, Shopify, plus CRM/mail extras.

Treg is a metered third-party API bus (GA/GSC as one slice). Different job.

Google's own Ads MCP exists for developers who already have a developer token. GA4/GSC have no first-party Grok plugin (Calendar/Drive/Gmail do).

We do not clone Ryze. We ship the missing **first-party-shaped** Google marketing connector.

## Architecture

```
User Grok Bot computer
  plugin (skills + local MCP stdio)
    OAuth connect card (platform-hosted tokens, like Gmail)
      --> Google APIs (GA4, GSC, later Ads if user has a token)
```

v1 must not: store refresh tokens on DGTL machines, proxy report bytes through DGTL, or commit client secrets / Ads developer tokens to a public git repo.

OAuth client ID can still be DGTL's Google Cloud project (required for a one-click connect). That is an **app**, not a data server. Tokens stay in the user's connector store.

### Fallback if platform OAuth is not offered to third-party plugins

User pastes their own Google Cloud OAuth client (plugin variables). Worse UX. Document it. Do not fake a vault.

## Parties and touch points

| Party | What they touch | Approval |
| --- | --- | --- |
| Noel / DGTL | Product, Google Cloud project, Meta app later, marketplace listing, support agent | Spend, publish, legal |
| End user | Install, OAuth consent, property/account picker, their bot computer | Their Google/Meta admin |
| xAI / Cursor review | Public repo, manifest, no secrets, honest description, README | Marketplace listing |
| Google | OAuth verification, sensitive scopes, Ads API developer token (separate) | Cloud app verification |
| Meta (later) | Business verification + App Review | App Review |
| Support agent | How-to, reconnect, property ID | Never sees user tokens; never mutates ads |
| Future DGTL clients | Optional "we run this for you" | Sales, not the plugin |

## Permissions model

v1 scopes (read):

- GA4 Data API: run reports the user can already see
- Search Console: sites the user verified
- Explicit property/site picker. Never "first property we find" across a login with 40 clients.

v1 must not request:

- Ads write, Gmail (already a first-party plugin), Drive write, Analytics Admin destructive, MCC god-mode

Later, off by default:

- Google Ads read (needs developer token — see hosted split)
- Ads/Meta mutate, always approval-gated in the client, never unattended in free plugin

Agency isolation: one Google login can see many properties. Skill rule: name the property ID in every tool call; refuse to mix clients in one answer.

## Feature split

### Free, local, no DGTL servers

- Install from Grok Plugins / Cursor marketplace
- Connect Google (GA4 + GSC) via OAuth
- List properties / verified sites
- GA4: standard + custom reports, date ranges, dimensions, conversions, channels, landing pages
- GSC: queries, pages, countries, devices, inspect URL, sitemaps (read)
- Skills: "don't invent metrics", date-range discipline, property confirmation, readout templates
- Support skill: diagnose OAuth / empty property / quota; offer DGTL managed service **once** after a real answer
- User-supplied Google Ads developer token as an optional plugin variable (power users only)

### Cannot honestly be free-local (paid hosted, later or never)

These need DGTL infrastructure or a secret we cannot put in a public plugin:

1. **Shared Google Ads developer token** — Google issues this to DGTL, not to each plugin user. Putting it in git is a ToS and security failure. Hosted Ads "just connect" is the real Ryze wedge.
2. **Meta Ads** — app secret + App Review. Same problem.
3. **Token vault / reconnect portal** — only if we hold tokens. We don't in v1.
4. **Cross-account agency workspace** with server-side client isolation (Ryze workspaces).
5. **Anonymized benchmarks** ("your CVR vs other DGTL plugin users") — needs our data plane. Privacy policy required. Skip until we have volume and a lawyer pass.
6. **Unattended write + audit log** when the user's bot is off. Grok Bot computers stay on, so this is weaker than it is for Claude Desktop. Don't pretend we need this.
7. **Managed service** — humans (DGTL) run ads/SEO. This is the actual upsell. It is not a software SKU.

### Do not upsell as "hosted"

- Faster queries (Google is the bottleneck)
- "AI insights" that are just prompts (ship as free skills)
- Nightly email digests (their own routines on their computer)

## v1 / v1.1 / v2

**v1 (submit):** GA4 + GSC, local MCP, platform OAuth, skills, DGTL branding, support skill, public repo, Cursor marketplace + Grok plugin marketplace PR (`xai-org/plugin-marketplace`).

**v1.1:** optional user-supplied Ads developer token; GBP read if it falls out of the same Google login cheaply.

**v2 (only after real installs):** DGTL-hosted Ads connect using our developer token. Price like software ($29–89) or skip and take consulting. Do not do $5–10.

## xAI / Cursor review bar

- Public git, DGTL Sunrise author, honest README
- No committed secrets, no `..` paths, tested locally
- Description: "Connect your GA4 and Search Console to your agent. Data stays on your computer."
- Logo, license (Apache-2.0 or MIT)
- Skills that prevent hallucinated metrics (this is the quality tell vs Ryze's 150-tool dump)

## Support and later clients

- Support agent is a how-to bot, not a closer.
- After a successful diagnosis, one line: DGTL can run this as a client engagement.
- Intake: property ID, error string, **never** refresh tokens, **never** Ads MCC passwords.
- Log plugin version + Google API error codes in the user's chat, not on our servers.

## Extensibility

- One MCP server, one tool family per API, versioned (`ga4.run_report`, `gsc.query`)
- Skills separate from tools so we can add Ads without rewriting GA4
- Fixture tests with recorded Google JSON so we don't hit live APIs in CI
- Feature flags in skill text for write tools (default off)

## Non-goals

- Breakwater-specific logic in the public plugin
- Axos accounts
- Shopify/TikTok/HubSpot in v1 (Ryze's moat, not ours)
- Building a hosted control plane before v1 is listed

## Existing work (SEO inventory, 2026-09-02)

Proven with user OAuth Installed App (not MCP, not API keys):

- GSC: `webmasters.readonly` — inspect, searchanalytics, sitemaps.list
- GTM v2: `tagmanager.readonly` — accounts/containers/tags/triggers (API must be Enabled or 403)
- GA4 Admin + Data v1beta: `analytics.readonly` — list accounts/properties/streams + runReport

Not started there: Ads, Meta, GBP, write scopes.

Auth lesson: sequential consents produced one token JSON per product. Public plugin should do **one consent, multiple readonly scopes**. Local-server PKCE is a test harness; Grok Bot needs a connect card. Do not ship localhost OAuth.

Known non-bugs to document in skills:

- Each API must be Enabled on the GCP project (`accessNotConfigured`)
- `analytics.readonly` cannot create GSC-GA4 product links (that's a GSC UI action)
- Data API has no `searchQuery` dimension; queries live in GSC searchanalytics
- GSC import into GA4 lags after linking

v1 surface locked from this: GA4 + GSC + GTM readonly. Ads/Meta still v2/hosted.

## Open inputs

- Confirm Google Cloud project for the public OAuth client lives under Sunrise Consulting LLC
- Plugin public name (working: `dgtl-google-marketing` until Noel names it)
- Whether Grok third-party plugins get a platform connect card, or users must bring a GCP client

## Next (still planning)

1. Closed v1 tool list (GA4 / GSC / GTM)
2. OAuth scope list for Google verification
3. Marketplace README draft
4. Then, and only then, a Cursor cloud agent to scaffold the repo
