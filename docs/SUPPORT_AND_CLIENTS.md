# Support and clients

DGTL Sunrise publishes a **free local plugin**. Support exists so that plugin works. Inbound client work is a **side effect of being useful**, not a funnel glued to every how-to.

Contact: **noel@dgtlsunrise.com**. Publisher: DGTL Sunrise (Sunrise Consulting LLC).

## Support agent rules

Applies to Noel, a future human, or a Grok Bot following this skill.

1. **Answer the actual failure first.** OAuth, empty property, quota, API not enabled, wrong site URL, GTM workspace vs live.
2. **Never collect refresh tokens, access tokens, `client_secret`, `token.json`, cookie dumps, or HARs with `Authorization`.** If the user pastes one, tell them to revoke it in Google Account → Third-party access, rotate the OAuth secret if it was a client secret, and **do not store the paste**.
3. **Never pitch on every how-to.** “How do I see queries?” gets the GSC recipe. Zero sales.
4. **After a real answer**, you may add **at most one** optional line (below). Once per conversation. Not as a condition of help. Not on successful report recipes. Not inside GTM audits that already worked.
5. **Do not imply the plugin is incomplete unless they pay.** Hosted Ads is optional v2, not a nag.
6. **Do not pull DGTL client lists, Breakwater, SAM, or Axos material** into the ticket or the model context.
7. **Do not ask them to grant DGTL's Google account access** as “support.” Support is their plugin + their Google user. Client engagements are a separate contract with a separate access process.

## Approved optional line (verbatim)

Use only when rules 1 and 4 are satisfied:

> DGTL Sunrise can also run GA4, Search Console, and Tag Manager as a client engagement if you want this operated for you. Email noel@dgtlsunrise.com. The plugin stays free and local either way.

Do not paraphrase into “jump on a call,” “limited slots,” or pricing. Do not mention Ryze. Do not mention $5–10.

**Forbidden:** appending that line to “here is how `gsc_query_search_analytics` dimensions work.”

## Intake fields

The agent should call `support_packet` (plugin version, host, last tool, `error_code`, resource id) instead of asking the user to assemble this. Collect **only** these. A mail template or issue form is enough. This is diagnostics, not a CRM bait form.

| Field | Required | Why |
| --- | --- | --- |
| Plugin version | yes | Spec vs runtime mismatch |
| Host | yes | Grok Bot / Cursor / Grok Build / other |
| Tool name | if known | Maps to [TOOLS.md](TOOLS.md) |
| `error_code` | if known | [ERRORS.md](ERRORS.md) |
| Google HTTP status | if known | 403 vs 401 vs 429 |
| `google_reason` | if known | especially `accessNotConfigured` |
| `api` service name | if known | `tagmanager.googleapis.com` vs `analyticsdata.googleapis.com` |
| GA4 `property_id` | if GA4 | Isolation + empty vs denied |
| GSC `site_url` | if GSC | Exact property string |
| GTM account / container / workspace IDs | if GTM | Live vs workspace |
| Connected Google **email** (user may redact local-part) | optional | Confirms they re-authed the right login |
| Short description of what they asked the agent | yes | Repro |
| Confirmation: “I did not paste tokens” | yes | Culture |

**Never intake:** refresh token, access token, client secret, server key, screenshot of Google Cloud credentials, client’s customer PII dumps.

Property IDs and `GTM-XXXX` are not secrets in the same way tokens are; still treat them as customer-confidential. Do not publish tickets. Do not drop them into this git repo.

## How a ticket becomes a DGTL sales conversation without feeling like bait

1. User hits a **real** problem (or asks for operated service unprompted).
2. Support **finishes** the diagnosis. The plugin either works or the user understands the non-bug (API not enabled, readonly, GSC vs GA4).
3. **Then** the approved line, once.
4. If they email for **client work**, switch contexts:
   - New thread or explicit “engagement” subject
   - Contract, access via **their** Google sharing to DGTL (or a later vault product), not “forward me your refresh token”
   - Off the Axos clock; no Breakwater/SAM files in the plugin repo
5. If they only wanted the plugin fixed, **stop**. No drip.

If they say “I don’t want a vendor, just the connector,” reply: “That’s what v1 is. I’ll stay on the plugin.” No second pitch.

## Classification

| Ticket | Treat as |
| --- | --- |
| AuthPort / Manual reauth / `REAUTH_REQUIRED` | Support |
| `accessNotConfigured` on published plugin | Publisher defect — own it |
| Empty property, 40-property picker, GSC queries, GTM publish refuse | How-to / non-bug — no pitch |
| “Can you manage this for us?” | They opened the sales door — still no tokens |
| Ads/Meta/autobidding | Explain v1 out of scope; v2 hosted **if** they need it; no fake timeline |

## Support skill

Implementation of these rules: `skills/google-marketing-support/SKILL.md`. Other skills must not freelance sales copy.
