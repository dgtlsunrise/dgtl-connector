---
name: gtm-readonly-limits
description: Audit Google Tag Manager as read-only. Use when the user wants tags, triggers, variables, container IDs, or to publish/edit/create a tag. v1 cannot publish. Distinguish workspace drafts from the live container version. GTM 403 accessNotConfigured means the Tag Manager API is not enabled on the OAuth client's Cloud project.
---

# GTM readonly limits

GTM is **in v1**. It is **read-only**.

## When they want an audit

1. Picker: account → container (`GTM-XXXX`) → decide **live vs workspace**.
2. **What’s on the site:** `gtm_get_live_container_version`. Cite that it is the published version.
3. **What’s in progress:** `gtm_list_workspaces` then `gtm_list_tags` / `gtm_list_triggers` / `gtm_list_variables` for a **confirmed** `workspace_id`. If multiple workspaces, ask; do not assume Default Workspace when length > 1.
4. Config ≠ firing. Do not report how many times a tag fired (that’s GA4 events, if they exist).

## When they want to publish, create, edit, pause, or delete

Refuse. No such tool. `UNSUPPORTED_OPERATION`.

**Copy:**  
“v1 cannot publish or edit Tag Manager. I can show the live version and the workspace draft. Publishing stays in the Tag Manager UI.”

Do not imply v2 hosted Ads will publish tags. Do not collect tokens “so DGTL can publish.”

## 403 `accessNotConfigured`

Tag Manager API not Enabled on the **OAuth client** project. Hand off to `google-marketing-support`. This is a classic false “you don’t have GTM access” — they might have access in the UI and still 403 in API.

## Permissions

Connected Google user still needs GTM account permission. Empty `gtm_list_accounts` after a successful API call means this login isn’t on any GTM account, not that the API is off (API-off is 403).
