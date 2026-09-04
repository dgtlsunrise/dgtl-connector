# DESIGN-OUTLINE-OPERATOR — DGTL Sunrise

Complement to Grok Build `PRODUCT-DESIGN.md`. **Outline only** — gaps startups miss for an agentic marketing platform. Plan; no code.

## Locks (do not violate)

- Free = local Bot, Consent A **readonly** (`analytics.readonly`, `webmasters.readonly`, `tagmanager.readonly` + openid/email)
- Paid = **DGTL-hosted** only (Polar, Ads/Meta gateway, sGTM / delayed conversions, vault)
- Writes = separate **Consent W** client/scopes — never bolted onto free Desktop Consent A
- **Polar** = billing SoR (not Whop); JWT features unlock Ads/Meta locally; gateway holds secrets
- No Axos / client outbound; Axos delayed-funding path = **internal case study only**
- No secrets in git/plugin; no token pastes; plan only

---

## 1. Agency multi-client isolation

- Google OAuth does **not** ACL clients — one agency login sees every Viewer property
- Operational isolation (v1): list → pick → call; required IDs; answer headers name property/site/container; no sticky default without explicit action; no cross-client joins
- Hosted future: workspace / client binding (DGTL ACL) separate from Google identity; employee seats ≠ shared owner login
- Kill criteria: silent “first property” pick; unlabeled report numbers; merging Client A GSC onto Client B GA4
- Support line: “limit visibility in Google, not in DGTL free plugin”

## 2. Support without token pastes

- Intake: plugin version, host, tool, `error_code`, Google status/`google_reason`/`api`, property/site/container IDs, connected email (redactable), repro — **never** refresh/access tokens, secrets, HARs with `Authorization`
- On paste: instruct revoke + rotate; do **not** store; confirm “I did not paste tokens”
- Diagnose with envelope fields + whoami scopes — not “send me token.json”
- Engagement handoff ≠ support: contract + their Google share / vault invite; never “forward refresh token”
- No Axos/Breakwater/SAM material in tickets or model context

## 3. Approval UX for publish / spend

- Pattern: **list → pick → mutate**; dry-run default; explicit confirm phrase naming resource + action
- Separate gates: GTM publish (Consent W) vs Ads/Meta spend (hosted + license + budget ceiling)
- Show: who, which client/property, estimated spend / change set, reversible vs irreversible
- Autopilot off by default; time-boxed approvals; dual-control for agency seats (optional later)
- Failure modes: agent invents confirm; confirm without dry-run; spend tool without entitlement

## 4. Audit logs

- What to log (hosted): actor, workspace/client, tool, resource IDs, approval id, outcome, request id — **not** tokens or report row payloads
- Free/local: optional local audit file in `PLUGIN_DATA`; never ship bytes to DGTL
- Retention / export for agency clients; immutable append for spend/publish
- Correlate support ticket ↔ `jti` / Polar order / gateway request id without PII dumps

## 5. Kill switches

| Switch | Scope | Fail closed |
| --- | --- | --- |
| `DGTL_WRITES_ENABLED` | Consent W tools | `WRITE_NOT_ENABLED` |
| Consent W missing | write stubs | `CONSENT_W_REQUIRED` |
| License JWT missing/exp | ads/meta features | `LICENSE_REQUIRED` |
| Gateway deny / feature flag | hosted Ads/Meta/sGTM | tool fails; GA4/GSC/GTM keep working |
| Per-workspace spend cap | paid | block mutate before API |
| Global “pause agents” | Noel / ops | all writes + spend |

- Revocation: Polar refund/cancel → stop mint; short JWT `exp` + remint; later denylist optional
- User kill: Google Third-party access revoke; disconnect skill copy ready

## 6. Billing entitlement mapping

- Polar product / price id → JWT `features` (`ads`, `meta`, later `sgtm`, `vault`) — unknown product = no mint
- Plugin verifies Ed25519 locally (`iss=dgtl-sunrise`); does **not** call Polar; Polar license-key string ≠ DGTL JWT
- Map: subscription period → `exp`; seat/workspace limits on Worker, not in free tools
- Free GA4/GSC/GTM never gated by Polar
- Entitlement ≠ credential: JWT unlocks tools; gateway still holds developer-token / Meta secret

## 7. sGTM / delayed conversions

- Paid/hosted only; free plugin never hosts conversion pixels or bank-like event pipes
- Design for delayed funding / offline conversion lag (internal pattern only — no Axos contact)
- Needs: event idempotency keys, consent/state machine, replay-safe upload to Ads/Meta, quarantine bad payloads
- Isolation: per-client container / measurement ID binding; no shared “default” pixel
- Observability: lag histograms, drop reasons, last-success watermark — support without raw PII

## 8. Google / Meta review sequencing

1. Consent A External + sensitive-scope verification (readonly demo video; refuse publish on camera)
2. Marketplace listing of **free** plugin (public git, clean secret scan)
3. Separate OAuth client for Consent W — **after** A verified; never pre-declare write/Ads on A
4. Google Ads API / developer-token + Meta App Review on **hosted** app — separate clients/secrets
5. Do not bolt `adwords` / `business.manage` onto free Desktop client “to save a round”

## 9. Marketplace listing vs hosted SKU

| | Marketplace plugin | Hosted SKU |
| --- | --- | --- |
| Surface | stdio MCP, free 23 tools, Consent A | gateway, sGTM, vault, write entitlements |
| Auth | user tokens local / AuthPort | DGTL account + Polar + gateway creds |
| Secrets | none in package | Worker/env only |
| Price | free forever for GA4/GSC/GTM | infra/liability pricing — not $5–10 wedge |
| Fail | local errors | `LICENSE_REQUIRED` / gateway errors; free tools unaffected |

- Listing promises must match Consent A only; hosted sold as optional second server

## 10. Day-1 instrumentation for support

- Every tool envelope: `ok`, `error_code`, `hint`, `google_status`, `google_reason`, `api`, resource `{type,id,display_name}`, `quota`, truncation
- Plugin + host version in whoami / support skill prompt
- Structured local log redacting Authorization; correlation id per tool call
- Counters (local or hosted): auth failures, `RESOURCE_REQUIRED`, empty lists, 403 `accessNotConfigured`, 429s
- Hosted: webhook verify fails, mint failures, gateway 4xx/5xx by tool — no report bodies
- Support skill reads envelope fields first; intake form mirrors §2

## 11. Non-goals (operator)

- Dashboards-with-chat; Ryze-style silent autopilot; token-as-support; Axos outreach; secrets in marketplace binary; gating free readonly behind Polar

## 12. Open for PRODUCT-DESIGN / Noel

- Agency workspace model timing (picker-only vs hosted ACL)
- Spend dual-control default on/off
- JWT feature strings beyond `ads`/`meta`
- Audit retention default
- sGTM SKU packaging vs gateway-only Pro
