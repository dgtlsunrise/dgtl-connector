---
name: license-and-reconnect
description: Map LICENSE_REQUIRED, GATEWAY_UNAVAILABLE, REAUTH_REQUIRED, CONSENT_MISSING, GBP_NOT_ENABLED, WRITE_NOT_ENABLED, CONSENT_W_REQUIRED, ADS_SCOPE_MISSING, META_NOT_CONNECTED. Use when a paid tool failed, Google access expired, a scope was unchecked, writes are gated, gateway is down, or the user asks about Ads/Meta unlock. Free GA4/GSC/GTM keep working without a license.
---

# License and reconnect

## Codes

| Code | Meaning | What to do |
| --- | --- | --- |
| `LICENSE_REQUIRED` | No/expired/invalid DGTL license JWT | Free tools still work. Pro is $19/mo flat unlimited (hosted Ads/Meta). CTA: https://www.dgtlsunrise.com/. Paste a JWT (`DGTL_LICENSE_JWT` or `PLUGIN_DATA/license.jwt`). Do not ask for a Google Ads developer-token. See `pro-upgrade`. |
| `GATEWAY_UNAVAILABLE` | License ok, but `DGTL_GATEWAY_URL` unset / Worker down / paused | Set or fix the gateway URL. **Do not** tell the user to reconnect Ads. Free tools still work. |
| `REAUTH_REQUIRED` | Google token expired or revoked | Host-injected token refresh, or `dgtl-connector-mcp auth login` (PKCE / AuthPort). Not a Gmail Connect card on stdio. |
| `CONSENT_MISSING` | A product scope was unchecked | Same Consent A (GA4+GSC+GTM). Do not start a second product login. |
| `GBP_NOT_ENABLED` | GBP flag off / quota 0 | Not a license issue. Consent B is separate. Do not put `business.manage` on Consent A. |
| `WRITE_NOT_ENABLED` | `DGTL_WRITES_ENABLED` false | Write/publish stubs fail closed. Free Consent A stays readonly. See `gtm-readonly-limits`. |
| `CONSENT_W_REQUIRED` | Writes flagged on but Consent W missing | Separate write OAuth client — never add edit/publish scopes to Consent A. |
| `ADS_SCOPE_MISSING` | License + gateway ok, Ads OAuth missing | Consent C (`adwords`) is a second grant — never reuse Consent A / `GOOGLE_ACCESS_TOKEN`. |
| `META_NOT_CONNECTED` | License + gateway ok, Meta OAuth missing | Separate Meta login (`ads_read`). App secret is never in the plugin. |

## Rules

1. Call `license_status` and `google_whoami` before guessing.
2. Never collect refresh tokens, `developer-token`, or Meta app secrets.
3. Do not hide paid or gated write tools; they are listed and fail closed.
4. Do not tell the user GA4 is broken because Ads is locked.
5. For GTM write/publish: follow `gtm-readonly-limits` — refuse when flag off; when on, dry-run + user publicId confirm — never invent confirm.
6. For `GATEWAY_UNAVAILABLE`: check `license_status.gateway` / `DGTL_GATEWAY_URL` — never say “Reconnect Ads.”
