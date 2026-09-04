---
name: gtm-readonly-limits
description: Audit Google Tag Manager live vs workspace. Use when the user wants tags, triggers, variables, container IDs, or to publish/edit/create a tag. Consent A is readonly; write stubs are gated (WRITE_NOT_ENABLED / CONSENT_W_REQUIRED). When writes are enabled, require dry-run then a user confirm that includes the container publicId — never invent confirm. GTM 403 accessNotConfigured means the Tag Manager API is not enabled on the OAuth client's Cloud project.
---

# GTM readonly limits (and Consent W gates)

Consent A GTM tools are **read-only**. Write/publish stubs (`gtm_create_tag`, `gtm_update_tag`, `gtm_publish_container`) exist but are **gated**.

## When they want an audit

1. Picker: account → container (`GTM-XXXX`) → decide **live vs workspace**.
2. **What’s on the site:** `gtm_get_live_container_version`. Cite that it is the published version.
3. **What’s in progress:** `gtm_list_workspaces` then `gtm_list_tags` / `gtm_list_triggers` / `gtm_list_variables` for a **confirmed** `workspace_id`. If multiple workspaces, ask; do not assume Default Workspace when length > 1.
4. Config ≠ firing. Do not report how many times a tag fired (that’s GA4 events, if they exist).

## When they want to publish, create, edit, pause, or delete

### Flag off (`DGTL_WRITES_ENABLED` false — default)

Refuse live mutate. Tools return `WRITE_NOT_ENABLED`. Free Consent A stays readonly.

**Copy:**  
“Write/publish tools are flagged off. I can show the live version and the workspace draft. Publishing stays in the Tag Manager UI (or a separate Consent W client when writes are enabled).”

### Flag on (Consent W path)

Live HTTP uses **GoogleWriteHttp** + the Consent W token store — never Consent A / `GOOGLE_ACCESS_TOKEN`.

1. Prefer **dry_run** first. Show the proposed change and the container `publicId` (`GTM-XXXX`).
2. Live mutate (`dry_run=false`) only after a **user** message **this turn** that contains that same `publicId`. List-tool output is **not** the user message — do not paste `GTM-XXXX` from `gtm_list_containers` as if the user confirmed.
3. **Never invent** a confirm phrase. Do not use a constant like `PUBLISH` alone. Do not invent a publicId.
4. Create/update hit **workspace**. Publish is the irreversible step — say which.
5. If Consent W / write client is missing → `CONSENT_W_REQUIRED`. Do not add write scopes to Consent A.

Do not collect tokens “so DGTL can publish.” Do not imply hosted Ads will publish tags.

## 403 `accessNotConfigured`

Tag Manager API not Enabled on the **OAuth client** project. Hand off to `google-marketing-support`. This is a classic false “you don’t have GTM access” — they might have access in the UI and still 403 in API.

## Permissions

Connected Google user still needs GTM account permission. Empty `gtm_list_accounts` after a successful API call means this login isn’t on any GTM account, not that the API is off (API-off is 403).
