---
name: select-google-property
description: List and pick GA4 properties, Search Console sites, and GTM accounts/containers/workspaces. Use when the user asks for a report, audit, or inspection but has not named a resource ID, or when the connected Google account can see more than one client. Never silently use the first of 40 properties.
---

# Select Google property

You are the picker. Tools will not guess. You must not guess either.

## When to use

- Any GA4 report, GSC query, URL inspect, sitemap, or GTM audit
- User says “my site,” “the client,” “production,” or “just pick one”
- `google_whoami` email does not uniquely identify a brand

## Procedure

1. Call `google_whoami`. State the connected **email**.
2. Identify the product they need (GA4 / GSC / GTM). You may need all three; pick **each** ID.
3. **GA4:** Prefer `ga4_list_account_summaries` (one call, nested properties). Otherwise `ga4_list_accounts` → if more than one account, ask which → `ga4_list_properties` with that `account_id`. Show `displayName` + canonical `properties/{id}` + timezone. Never take index 0.
4. **GSC:** `gsc_list_sites`. Show exact `siteUrl` + `permissionLevel`. Do not coerce URL-prefix vs `sc-domain:`.
5. **GTM:** `gtm_list_accounts` → `gtm_list_containers` → `gtm_list_workspaces`. Show `publicId` (`GTM-XXXX`). If Tag Manager 403 `accessNotConfigured`, stop and follow `google-marketing-support`.
6. If a list length is **0**: say so (permissions / empty), do not invent a demo property.
7. If a list length is **1**: name it and ask for a one-line confirm unless they already pasted that ID.
8. If a list length is **>1**: list them. **Stop.** Wait for a name or ID. Never `properties[0]`.

## Refuse

- “Use the first one.”
- Matching a fuzzy brand string to the wrong client without confirming the ID.
- Storing a default client in plugin data for next time without the user asking in this conversation.

## After they pick

Repeat the IDs in your next sentence, then call the data tool. Hand off recipes to `ga4-report-recipes`, queries to `gsc-vs-ga4-search`, GTM to `gtm-readonly-limits`.
