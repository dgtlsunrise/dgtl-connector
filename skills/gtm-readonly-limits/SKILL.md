---
name: gtm-readonly-limits
description: Audit Google Tag Manager live vs workspace, including sGTM clients and environments. Use when the user wants tags, triggers, variables, clients, environments, container IDs, or to publish/edit/create a tag or sGTM client. Free Google can hold GTM manage scopes; write tools (tag/trigger/variable/client/container/environment/publish) need those scopes plus dry-run then a user confirm that includes the container publicId or container path — never invent confirm. Publish last. Never put stamp ingest keys, apply keys, or funded keys in GTM clients or web variables. Use `conversion_fabric_status` / `sgtm_ingest_test` (apply-path only). GTM 403 accessNotConfigured means the Tag Manager API is not enabled on the OAuth client's Cloud project.
---

# GTM readonly limits (and Consent W gates)

Free Google GTM list tools are **read**. Write/publish tools (`gtm_create_tag`, `gtm_update_tag`, `gtm_create_trigger`, `gtm_update_trigger`, `gtm_create_variable`, `gtm_update_variable`, `gtm_create_client`, `gtm_update_client`, `gtm_create_container`, `gtm_create_environment`, `gtm_publish_container`) exist after Connect grants GTM manage scopes. Live mutate needs confirm. `DGTL_WRITES_ENABLED` is **not** a Free Google gate.

## When they want an audit

1. Picker: account → container (`GTM-XXXX`) → decide **live vs workspace**.
2. **What’s on the site:** `gtm_get_live_container_version`. Cite that it is the published version.
3. **What’s in progress:** `gtm_list_workspaces` then `gtm_list_tags` / `gtm_list_triggers` / `gtm_list_variables` / `gtm_list_clients` for a **confirmed** `workspace_id`. Environments are container-level (`gtm_list_environments`). If multiple workspaces, ask; do not assume Default Workspace when length > 1. Empty clients on a **web** container is normal — clients are sGTM (server).
4. Config ≠ firing. Do not report how many times a tag fired (that’s GA4 events, if they exist).

## When they want to publish, create, edit, pause, or delete

### Missing GTM write scopes

Refuse live mutate. Tools return `CONSENT_W_REQUIRED`.

**Copy:**  
“I can show the live version and the workspace draft. Connect Free Google (`auth login`) so the token includes Tag Manager manage scopes, then confirm the container publicId if you want me to mutate.”

### Free Google write path

Live HTTP uses **GoogleWriteHttp** + `authWrite` (legacy `google-oauth-write.json`, then Free Google when GTM write scopes are present). PKCE: `dgtl-connector-mcp auth login` (alias `login-write`).

1. Prefer **dry_run** first. Show the proposed change and the container `publicId` (`GTM-XXXX`).
2. Live mutate (`dry_run=false`) only after a **user** message **this turn** that contains that same `publicId`. List-tool output is **not** the user message — do not paste `GTM-XXXX` from `gtm_list_containers` as if the user confirmed.
3. **Never invent** a confirm phrase. Do not use a constant like `PUBLISH` alone. Do not invent a publicId.
4. Create/update tag, trigger, variable, or **client** hit **workspace**. Create container / environment are account- or container-level. **Publish last** (`gtm_publish_container`) — it is irreversible. Say which step you are on.
5. If GTM write scopes are missing → `CONSENT_W_REQUIRED`. Run `auth login`. Do not add `adwords`, `content`, or `business.manage` to Free Google.
6. Closed client `type` only (`gaawp`, `googtag`, `gclidw`, `flc`, `ua`, `mp`). Do not invent `cvt_*` or tag types (`html`). Do **not** put stamp ingest keys, apply keys, or funded keys in client parameters or **web** GTM variables. Funded ingest keys stay on server sGTM env / the customer backend only. Polar `sgtm` is reserved, default-off, and not minted. Closed plugin ingest event is `apply` only (`sgtm_ingest_test`). For sink health use `conversion_fabric_status`.
7. GA4 Admin / GSC sitemap writes use the same Free Google token when `analytics.edit` / `webmasters` are present. Still confirm. Ads/Meta/TikTok stay Pro. Merchant Center ProductInput writes still need `DGTL_WRITES_ENABLED`.

Do not collect tokens “so DGTL can publish.” Do not imply hosted Ads will publish tags.

## 403 `accessNotConfigured`

Tag Manager API not Enabled on the **OAuth client** project. Hand off to `google-marketing-support`. This is a classic false “you don’t have GTM access” — they might have access in the UI and still 403 in API.

## Permissions

Connected Google user still needs GTM account permission. Empty `gtm_list_accounts` after a successful API call means this login isn’t on any GTM account, not that the API is off (API-off is 403).
