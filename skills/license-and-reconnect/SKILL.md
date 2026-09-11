---
name: license-and-reconnect
description: Map LICENSE_REQUIRED, GATEWAY_UNAVAILABLE, REAUTH_REQUIRED, CONSENT_MISSING, GBP_NOT_ENABLED, WRITE_NOT_ENABLED, CONSENT_W_REQUIRED, ADS_MUTATE_NOT_ENABLED, ADS_SCOPE_MISSING, META_NOT_CONNECTED. Use when a paid tool failed, Google access expired, a scope was unchecked, writes are gated, gateway is down, or the user asks about Ads/Meta unlock. Free GA4/GSC/GTM keep working without a license.
---

# License and reconnect

## LICENSE_REQUIRED ladder (Pro unlock)

Follow this order. Free GA4 / GSC / GTM keep working at every step.

1. **Missing / expired / invalid JWT** → buy Pro ($19/mo flat unlimited) at https://buy.polar.sh/polar_cl_yZECJ26Ln9mGTQDwBETXCskJRMTwrYAd6thMJO1zHPk (site: https://www.dgtlsunrise.com/). See `pro-upgrade`.
2. **Redeem** → set `DGTL_GATEWAY_URL` (live: `https://stamp.dgtlsunrise.com`; backup: `https://dgtl-stamp.noel-4ea.workers.dev`) then run `dgtl-connector-mcp auth redeem --code <one-time-code>` or `--checkout-id <uuid|polar_c_*>` (stamp resolves confirmation secrets) → writes `PLUGIN_DATA/license.jwt`. Never print or paste the JWT into chat. Or set `DGTL_LICENSE_JWT`. Confirm with `license_status` / `auth status`.
3. **Ads OAuth** (`ADS_SCOPE_MISSING`) → Consent C via `GOOGLE_ADS_ACCESS_TOKEN` or `auth login-ads`. Never reuse Consent A.
4. **Meta OAuth** (`META_NOT_CONNECTED`) → `META_ACCESS_TOKEN` or `auth login-meta --code`. Support never collects Meta tokens.
5. **Gateway** (`GATEWAY_UNAVAILABLE`) → fix `DGTL_GATEWAY_URL` / Worker. **Do not** say “Reconnect Ads.” Do not re-sell Pro if the JWT is already valid.

Do not ask for a Google Ads developer-token or a Meta app secret.

## Codes

| Code | Meaning | What to do |
| --- | --- | --- |
| `LICENSE_REQUIRED` | No/expired/invalid DGTL license JWT | Free tools still work. Follow the ladder above (buy → redeem → Ads/Meta OAuth → gateway). Pro is $19/mo flat unlimited. CTA: https://buy.polar.sh/polar_cl_yZECJ26Ln9mGTQDwBETXCskJRMTwrYAd6thMJO1zHPk (https://www.dgtlsunrise.com/). Prefer `auth redeem`; or paste JWT (`DGTL_LICENSE_JWT` / `PLUGIN_DATA/license.jwt`). Never ask for a developer-token. See `pro-upgrade`. |
| `GATEWAY_UNAVAILABLE` | License ok, but `DGTL_GATEWAY_URL` unset / Worker down / paused | Set or fix the gateway URL (live: `https://stamp.dgtlsunrise.com`; backup: `https://dgtl-stamp.noel-4ea.workers.dev`). **Do not** tell the user to reconnect Ads. Free tools still work. |
| `REAUTH_REQUIRED` | Google token expired or revoked | Host-injected token refresh, or `dgtl-connector-mcp auth login` (PKCE / AuthPort). Not a Gmail Connect card on stdio. |
| `CONSENT_MISSING` | A product scope was unchecked | Same Consent A (GA4+GSC+GTM). Do not start a second product login. |
| `GBP_NOT_ENABLED` | GBP flag off / quota 0 | Not a license issue. Consent B is separate. Do not put `business.manage` on Consent A. |
| `WRITE_NOT_ENABLED` | `DGTL_WRITES_ENABLED` false | Write/publish stubs fail closed. Free Consent A stays readonly. See `gtm-readonly-limits`. |
| `CONSENT_W_REQUIRED` | Writes flagged on but Consent W missing | Separate write OAuth client — never add edit/publish scopes to Consent A. |
| `ADS_MUTATE_NOT_ENABLED` | Ads mutate flag off (`DGTL_ADS_MUTATE_ENABLED`) | Reads still work. Mutates (pause/enable) stay off until Google mutate access + Worker `ADS_MUTATE_ENABLED` + plugin flag. Never Consent A. |
| `ADS_SCOPE_MISSING` | License + gateway ok, Ads OAuth missing | Consent C (`adwords`) is a second grant — never reuse Consent A / `GOOGLE_ACCESS_TOKEN`. |
| `META_NOT_CONNECTED` | License + gateway ok, Meta OAuth missing | Separate Meta login (`ads_read`). App secret is never in the plugin. |

## Rules

1. Call `license_status` and `google_whoami` before guessing.
2. Never collect refresh tokens, `developer-token`, Meta app secrets, or license JWTs into chat.
3. Do not hide paid or gated write tools; they are listed and fail closed.
4. Do not tell the user GA4 is broken because Ads is locked.
5. For GTM write/publish: follow `gtm-readonly-limits` — refuse when flag off; when on, dry-run + user publicId confirm — never invent confirm.
6. For `GATEWAY_UNAVAILABLE`: check `license_status.gateway` / `DGTL_GATEWAY_URL` — never say “Reconnect Ads.”
7. For `LICENSE_REQUIRED`: walk the ladder (buy → redeem → Ads/Meta → gateway). Prefer `auth redeem` over asking the user to paste a bearer.
