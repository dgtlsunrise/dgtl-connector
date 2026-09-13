# Free full Google Connect proof — 2026-09-13

Date: 2026-09-13  
Branch: `cursor/free-full-google-connect-9ac5`  
Base: `2f215e1` (Wave 23 local 572-pass proof)  
Goal: One Free Google Connect with GA4 / GSC / GTM read **and** manage. Pro stays Ads / Meta / TikTok. GBP off until Basic Access. Mutates stay flag-gated.

## What shipped

| Item | Detail |
| --- | --- |
| `CONSENT_A` | Evolved in place to the locked Free Google set (identity + three readonly + `analytics.edit` + GTM edit/publish + `webmasters`) |
| Auth | `auth login` / AuthPort A / host-injected `GOOGLE_ACCESS_TOKEN` request or carry that set |
| Write ports | Legacy W/G/S stores still win if present. Else Free Google is used **when the token lists the needed write scopes** |
| Login aliases | `login-write` / `login-ga4-admin` / `login-gsc-write` → `auth login` (same store). Logout of legacy files still works |
| Copy | Marketplace / `plugin.json` / `package.json` / PERMISSIONS / TOOLS / SKILLS drop the readonly-only promise. Honest manage + Pro Ads/Meta/TikTok |
| Flags | `DGTL_WRITES_ENABLED` still defaults false. Confirms unchanged |

No new named mutate tools. Kernel stays **26**. `tools/list` freeze unchanged. Never Axos. No sGTM mint. No mega-mutate. Marketplace submit stays deferred.

## Locks held

- Free Google must **not** include `adwords`, `content`, or `business.manage`.
- Write tools stay out of `CONSENT_A_TOOLS` / `catalog.json` `tools[]`.
- Writes without the flag → `WRITE_NOT_ENABLED` (zero mutate HTTP).
- Old `google-oauth-write.json` / `google-oauth-ga4-admin.json` / `google-oauth-gsc-write.json` still accepted.

## Spec honesty

Local 2026-09-13:

```
SPEC OK  tools=26 (Consent A kernel)  local_free=36  skills=21
```

`npm run generate:hop:check` → `hop maps up to date`.

`check_marketplace_honesty` requires **read and manage** + flag-gated mutates, and forbids `adwords` / `content` / `business.manage` on `plugin.json` `consentA`.

## Tests

`npm test` (fixture / unit only; network guard; no live stamp / Google / Meta / TikTok / Klaviyo):

```
# tests 579
# pass 579
# fail 0
```

| Suite | Role |
| --- | --- |
| `tests/free-full-connect.test.ts` | Literal Free Google set; URL; scoped write-port fallback; legacy W wins; flag-gated writes; dry-run on full A; help aliases |
| `tests/consent-w.test.ts` / `consent-c.test.ts` / `consent-gs.test.ts` | W/G/S ⊆ A; A ∩ {adwords, content, business.manage, Meta ads_management} = ∅ |
| `tests/wave23-ops.test.ts` | Kernel 26; listing copy honesty; Consent G runbook still names `login-ga4-admin` as alias |
| `scripts/validate-spec.py` | Free Google product+manage scopes; marketplace honesty |

## Noel atom (console — RED)

**Do not change Consent A Data Access in Google Cloud from this PR or any agent.**

The binary now requests:

1. `openid`
2. `https://www.googleapis.com/auth/userinfo.email`
3. `https://www.googleapis.com/auth/analytics.readonly`
4. `https://www.googleapis.com/auth/webmasters.readonly`
5. `https://www.googleapis.com/auth/tagmanager.readonly`
6. `https://www.googleapis.com/auth/analytics.edit`
7. `https://www.googleapis.com/auth/tagmanager.edit.containers`
8. `https://www.googleapis.com/auth/tagmanager.publish`
9. `https://www.googleapis.com/auth/webmasters`

Noel adds 6–9 on the existing Consent A Desktop client Data Access screen when he is ready. Do **not** add `adwords`, `content`, or `business.manage`. Do **not** publish Worker / site / marketplace from this PR.

Checklist: [NOEL-ONLY-CHECKLIST.md](NOEL-ONLY-CHECKLIST.md) § Consent A Data Access.

## Do not (held)

- Auto-publish Worker / site / marketplace
- Axos
- Mint sGTM
- Mega-mutate
- Stuff Pro scopes onto Free Google
