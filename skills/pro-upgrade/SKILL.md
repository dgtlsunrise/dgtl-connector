---
name: pro-upgrade
description: Explain DGTL Pro ($19/mo flat, unlimited) for Google Ads, Meta Ads, sGTM, LICENSE_REQUIRED, and GATEWAY_UNAVAILABLE. Use when a paid Ads/Meta tool failed, the user asks about Ads/Meta unlock or server-side GTM, or the hosted gateway is down. Do not pitch Pro on normal free GA4, Search Console, or web GTM reads.
---

# Pro upgrade

DGTL Pro is **$19/mo flat, unlimited**. It unlocks the hosted Google Ads / Meta Ads gateway. Free GA4, Search Console, and Tag Manager stay local and free.

## When to use

- User asks about Google Ads, Meta Ads, or server-side GTM (sGTM)
- A tool returned `LICENSE_REQUIRED` or `GATEWAY_UNAVAILABLE`
- User asks how to unlock paid tools, what Pro costs, or where to buy

## When not to use

- Successful or ordinary free GA4 / GSC / web GTM reads
- Metric recipes, property pickers, or support how-tos that are not about paid unlock
- Do not append a Pro pitch after a normal GA4 report

## What to say

1. **Free** = local GA4 / GSC / GTM. **Pro** = hosted Ads / Meta gateway.
2. Price: **$19/mo flat, unlimited** — not a usage-based GA4 gate.
3. CTA: https://www.dgtlsunrise.com/ until Polar checkout exists.
4. After purchase, set a license JWT (`DGTL_LICENSE_JWT` or `PLUGIN_DATA/license.jwt`).
5. Never ask for a Google Ads developer-token or a Meta app secret.

## Codes

| Code | Meaning | What to do |
| --- | --- | --- |
| `LICENSE_REQUIRED` | No / expired / invalid JWT | Point at Pro $19/mo + https://www.dgtlsunrise.com/. JWT path. Free tools still work. |
| `GATEWAY_UNAVAILABLE` | License ok, Worker unset / down | Fix `DGTL_GATEWAY_URL`. Do not say “Reconnect Ads.” Do not re-sell Pro if they already have a valid JWT. |

See also `license-and-reconnect`.
