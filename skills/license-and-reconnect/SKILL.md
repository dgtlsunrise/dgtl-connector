---
name: license-and-reconnect
description: Map LICENSE_REQUIRED, REAUTH_REQUIRED, CONSENT_MISSING, GBP_NOT_ENABLED, ADS_SCOPE_MISSING, META_NOT_CONNECTED. Use when a paid tool failed, Google access expired, a scope was unchecked, or the user asks about Ads/Meta unlock. Free GA4/GSC/GTM keep working without a license.
---

# License and reconnect

## Codes

| Code | Meaning | What to do |
| --- | --- | --- |
| `LICENSE_REQUIRED` | No/expired/invalid DGTL license JWT | Free tools still work. Paid Ads/Meta need a JWT (`DGTL_LICENSE_JWT`). Do not ask for a Google Ads developer-token. |
| `REAUTH_REQUIRED` | Google token expired or revoked | Host-injected token refresh, or `dgtl-marketing-mcp auth login` (PKCE). Not a Gmail Connect card on stdio. |
| `CONSENT_MISSING` | A product scope was unchecked | Same Consent A (GA4+GSC+GTM). Do not start a second product login. |
| `GBP_NOT_ENABLED` | GBP flag off / quota 0 | Not a license issue. Consent B is separate. Do not put `business.manage` on Consent A. |
| `ADS_SCOPE_MISSING` | License ok, Ads OAuth missing | Consent C (`adwords`) is a second grant. Runtime/gateway is a later phase. |
| `META_NOT_CONNECTED` | License ok, Meta OAuth missing | Separate Meta login (`ads_read`). App secret is never in the plugin. |

## Rules

1. Call `license_status` and `google_whoami` before guessing.
2. Never collect refresh tokens, `developer-token`, or Meta app secrets.
3. Do not hide paid tools; they are listed and fail closed.
4. Do not tell the user GA4 is broken because Ads is locked.
