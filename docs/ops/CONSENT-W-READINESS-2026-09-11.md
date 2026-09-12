# Consent W / GTM publish readiness — 2026-09-11 (PT)

> **SUPERSEDED (2026-09-11, W0.7):** the `auth login-write` **Missing** row below is stale. The CLI **shipped** (`dgtl-connector-mcp auth login-write` in `src/auth/login-cli.ts` / `src/index.ts`; tests in `tests/shopify-readonly.test.ts`). It writes `PLUGIN_DATA/google-oauth-write.json` with `CONSENT_W_GTM` and does **not** enable `DGTL_WRITES_ENABLED`. See `docs/TOOLS.md` Consent W section. Planning pointer: `/workspace/dgtl-planning/ops/CONSENT-W-CLIENT-CREATED-2026-09-11.md`. **Keep this file’s E2E checklist** (§3 Noel + local smoke, §4 DONE WHEN). Noel still owns the W Desktop client, scopes, and live tag create. Do not delete this note.
>
> **Wave 6 (2026-09-12):** trigger/variable create+update tools shipped (`gtm_create_trigger`, `gtm_update_trigger`, `gtm_create_variable`, `gtm_update_variable`). Same gates as tags. Marketplace default remains `DGTL_WRITES_ENABLED=false`. Live disposable-container E2E is still a **Noel gate** — fixtures cover the HTTP path. GA4/GSC write tools are **not** registered until a live GTM publish is proven.

Publisher: Sunrise Consulting LLC / DGTL Sunrise  
Lane: Track A — turn Consent W on safely **without** bolting writes onto Consent A.  
Sources: `FULL-STACK-ACCELERATE.md`, `NOEL-ONLY-CHECKLIST.md`, `OAUTH-CONSENT-COPY.md`, `SPEED-RUN.md`, `POST-POLAR-BACKLOG.md`, plugin `src/google/gtm-write.ts`, `src/http/google-write.ts`, `src/flags.ts`, `src/google/scopes.ts`, `docs/TOOLS.md`.

**Hard rule:** Do **not** create Google Cloud OAuth clients from agents. Do **not** change Consent A scopes, Data Access, or verification. Do **not** send email.

---

## 1. What code already exists vs what’s flagged off

### Shipped (code on disk; safe while flag off)

| Piece | Location | Behavior today |
| --- | --- | --- |
| Tools registered | `src/tools/registry.ts` | `gtm_create_tag`, `gtm_update_tag`, `gtm_publish_container` with write/destructive annotations |
| Catalog gates | `schemas/v1/catalog.json` `gated_tools` | Same three tools; `flag: writes.enabled` → fail `WRITE_NOT_ENABLED` |
| Flag | `src/flags.ts` | `writesEnabled` from `DGTL_WRITES_ENABLED` / `WRITES_ENABLED`; **default false** (`truthy` only) |
| Handlers | `src/google/gtm-write.ts` | Full dry-run + live mutate path; gate → resolve `publicId` → confirm → HTTP |
| Write HTTP | `src/http/google-write.ts` | Consent W only; Tag Manager host; **method+path allowlist** (GET container/workspace; POST tags; PUT tags; create_version; publish) |
| Auth split | `src/auth/port.ts` `writeFromEnv` | `GOOGLE_WRITE_ACCESS_TOKEN` / `PLUGIN_DATA/google-oauth-write.json`; **never** Consent A AuthPort |
| Scopes constants | `src/google/scopes.ts` | `CONSENT_W`, `CONSENT_W_GTM` (`tagmanager.edit.containers`, `tagmanager.publish`) — **never** merged into `CONSENT_A` |
| Env placeholders | `.env.example` | `GOOGLE_OAUTH_WRITE_CLIENT_ID` / `_SECRET`, `GOOGLE_WRITE_ACCESS_TOKEN`, `DGTL_WRITES_ENABLED=false` |
| Docs / skills | `TOOLS.md`, `PERMISSIONS.md`, `OAUTH-CONSENT-COPY.md`, gtm-readonly-limits | Promise Consent A readonly; W is separate + flagged |
| `auth login-write` CLI | `src/auth/login-cli.ts` / `src/index.ts` | **Shipped (W0.7).** PKCE → `google-oauth-write.json` with `CONSENT_W_GTM`. Does not enable `DGTL_WRITES_ENABLED`. |

### Flagged off / incomplete for live E2E

| Gap | Detail |
| --- | --- |
| `DGTL_WRITES_ENABLED` | Must stay `false` in shipped defaults; when false → `WRITE_NOT_ENABLED`, **zero HTTP** |
| Consent W OAuth client | **Noel-only** — not created; agents must not create it |
| Runtime W token | Without `GOOGLE_WRITE_ACCESS_TOKEN` or write store → `CONSENT_W_REQUIRED` even if flag on |
| `auth login-write` CLI | **SUPERSEDED 2026-09-11 (W0.7) — shipped.** `dgtl-connector-mcp auth login-write` writes `PLUGIN_DATA/google-oauth-write.json` with `CONSENT_W_GTM`. Help lists `login-write` / `logout-write`. Does **not** flip `DGTL_WRITES_ENABLED`. Historical claim (struck): *Missing. Help lists `auth login` (A), `login-ads` (C), `login-meta` — not write.* |
| GSC / GA4 writes | Candidate scopes in `CONSENT_W`; **no tools** yet — out of this E2E |
| Polar `writes` JWT feature | Independent of technical flag today (OPEN-QUESTIONS OQ 3 / 9). First ship = local user tokens + `DGTL_WRITES_ENABLED` |

### Safety already in the mutate path (when eventually enabled)

1. Flag off → zero HTTP.  
2. Consent W token only (`ctx.authWrite` / `httpWrite`) — Consent A cannot POST/PUT Tag Manager (`GoogleHttp` refuses).  
3. `dry_run` **defaults true** (only explicit `false` is live).  
4. Live requires `confirm_phrase` containing resolved container **publicId** (`GTM-XXXX`).  
5. Harness rule: user message this turn must contain publicId (list-tool output ≠ user message).  
6. Publish is last: `create_version` then `:publish`; publish needs `tagmanager.publish`.

---

## 2. Exact Noel-only gates (OAuth client, scopes, Cloud Console clicks)

Do these only as **noel@dgtlsunrise.com**. Agents prep docs; they do not click Console, do not create clients, do not submit verification for W.

### B1–B3 (from NOEL-ONLY-CHECKLIST) — Consent W

1. **GCP project:** Prefer **same** project as Consent A: `dgtl-marketing-oauth-20260903` (559563115308), **second** OAuth client (OPEN-QUESTIONS OQ 8 recommended default). Sibling project only if Google review hygiene forces it later.  
2. **Create OAuth client type Desktop app** named clearly for writes (e.g. “DGTL Sunrise Writes”) — **not** editing the Consent A Desktop client.  
3. **Data Access / scopes on the W client only** (start narrow):
   - First E2E (edit only): `https://www.googleapis.com/auth/tagmanager.edit.containers`
   - Add later for publish E2E: `https://www.googleapis.com/auth/tagmanager.publish`
   - Optional identity if needed for whoami-style checks: `openid`, `userinfo.email`  
   - **Do not** add these to Consent A Data Access.  
   - **Do not** add `adwords`, `business.manage`, Gmail, Drive, blanket `analytics`, or `webmasters` write yet.  
4. **Audience:** External / Testing; add Noel as test user on the W consent screen if separate. Keep Consent A verification path untouched (do not Publish W to production until ready for W verification).  
5. **Env (gitignored only):**  
   - `GOOGLE_OAUTH_WRITE_CLIENT_ID`  
   - `GOOGLE_OAUTH_WRITE_CLIENT_SECRET` (Desktop `/token` needs it; never reuse `GOOGLE_OAUTH_CLIENT_SECRET`)  
   - Optional for smoke without PKCE CLI: `GOOGLE_WRITE_ACCESS_TOKEN` + `GOOGLE_WRITE_GRANTED_SCOPES`  
6. **Tag Manager API** already expected enabled on the project (Consent A checklist item 4). Confirm still enabled.  
7. **Speak a safe smoke container** (non-Axos) — account / container / workspace IDs + publicId — for dry-run then one live create. No Axos.

### Explicitly do **not** click

- Any change to Consent A scopes, branding used for A verification, or “Publish app” on the A client.  
- Adding write scopes to the free Desktop client used for marketplace / demo.  
- Creating Polar products or spending for W (W first ship is local tokens).

---

## 3. Smallest E2E path (safe on; no Consent A bolt-on)

**Goal:** Prove create-tag dry-run → one live workspace tag create on a disposable container. **Publish last** (optional second session).

### Agent-buildable before Noel clicks (optional but recommended)

1. **Done (W0.7).** `auth login-write` mirrors `login-ads`: `CONSENT_W_GTM` → `PLUGIN_DATA/google-oauth-write.json`; fail closed without `GOOGLE_OAUTH_WRITE_CLIENT_ID`; never reuse A secret. Historical: this item used to say “add login-write.”  
2. Unit/fixture tests cover flag-off / confirm / allowlist **and** login-write wiring (`tests/shopify-readonly.test.ts`). Keep green.

### Noel + local smoke (after W client exists)

| Step | Who | Action |
| --- | --- | --- |
| 0 | Noel | Create W Desktop client + edit scope only (above). Hand client id/secret into gitignored `.env` (or host-inject write access token). |
| 1 | Agent/local | Confirm Consent A still readonly: `DGTL_WRITES_ENABLED` unset/false → any write tool returns `WRITE_NOT_ENABLED`. |
| 2 | Local | Set `DGTL_WRITES_ENABLED=true` **only** in local/runtime env (not marketplace default). |
| 3 | Noel | Complete W consent in browser (login-write **or** paste host-injected write token with edit scope). Confirm store is `google-oauth-write.json` / `GOOGLE_WRITE_ACCESS_TOKEN` — **not** `google-oauth.json`. |
| 4 | Agent | Consent A readonly list: pick account → container → workspace → note `publicId`. |
| 5 | Agent | `gtm_create_tag` with `dry_run` omitted/true → expect proposed payload + publicId; **no** mutate HTTP. |
| 6 | Noel | In a **user** message this turn, include the publicId (e.g. “confirm GTM-XXXX”). |
| 7 | Agent | Live create: `dry_run=false`, `confirm_phrase` containing that publicId, minimal name/type. |
| 8 | Agent | Readonly verify via Consent A `gtm_*` list/get that draft tag exists in workspace (not live). |
| 9 | **Stop** | Do **not** call `gtm_publish_container` live until Noel explicitly wants publish and W client has `tagmanager.publish`. |
| 10 | Optional later | Dry-run publish → Noel confirms with publicId → live publish once. Prefer disposable container. |

### Anti-patterns (refuse)

- Setting write scopes on Consent A “to move faster.”  
- Reusing `GOOGLE_ACCESS_TOKEN` / `google-oauth.json` for mutate.  
- Shipping `DGTL_WRITES_ENABLED=true` as package default.  
- Live publish in CI.  
- Inventing confirm phrases without a user message containing publicId.

---

## 4. DONE WHEN checklist

- [ ] Consent A Data Access still **only** readonly trio + openid/email (unchanged).  
- [ ] Second Desktop OAuth client exists for W; edit scope on W only (publish scope optional, last).  
- [ ] Gitignored env has distinct `GOOGLE_OAUTH_WRITE_*` (and/or `GOOGLE_WRITE_ACCESS_TOKEN`); secrets never in git/chat.  
- [ ] Default / marketplace story: `DGTL_WRITES_ENABLED` false → `WRITE_NOT_ENABLED`.  
- [ ] With flag on + W token: dry-run create returns publicId + proposed; zero mutate.  
- [ ] One live `gtm_create_tag` on a named non-Axos workspace after user message contains publicId.  
- [ ] Consent A tools still work on same machine without write scopes.  
- [ ] `gtm_publish_container` either still dry-run-only or explicitly Noel-approved live once — never accidental.  
- [ ] No email sent; no Consent A verification form edits for W.

---

## Pointers

- Lock: `/workspace/dgtl-google-plugin/docs/ops/FULL-STACK-ACCELERATE.md`  
- Noel clicks: `/workspace/dgtl-google-plugin/docs/ops/NOEL-ONLY-CHECKLIST.md` (B1–B3)  
- A verification copy (must stay W-free): `/workspace/dgtl-google-plugin/docs/ops/OAUTH-CONSENT-COPY.md`  
- Dual-track: `/workspace/dgtl-google-plugin/docs/ops/SPEED-RUN.md`
