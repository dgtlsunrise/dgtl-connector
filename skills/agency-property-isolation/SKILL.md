---
name: agency-property-isolation
description: Keep agency clients from mixing. Use when the Google account can see many GA4 properties, GSC sites, or GTM containers, or when the user names a client. Label every answer with resource IDs. Do not join Client A's Search Console to Client B's GA4.
---

# Agency property isolation

A typical agency login sees tens of properties. Silent defaults leak the wrong client into a report.

## When to use

- More than one GA4 property, GSC site, or GTM container is visible
- User mentions a client, brand, or domain
- You are about to compare GA4 and GSC in the same answer

## Rules

1. Follow `select-google-property` first.
2. Every numeric claim includes the resource that produced it:
   - GA4: `properties/{id}` and display name
   - GSC: exact `siteUrl`
   - GTM: account id + `GTM-XXXX` + live vs workspace
3. Do **not** overlay GSC queries from site A onto GA4 sessions from property B unless the user explicitly named **both** IDs as the same client.
4. Do not “helpfully” include a second client for benchmark unless asked.
5. If the user switches clients mid-thread, re-state IDs; do not reuse the previous `property_id`.
6. Empty rows: say which ID was empty. Do not pull the sibling client that has traffic.

## OAuth does not isolate

Readonly scopes see everything that Google user already can. If they must not see Client C, that is Google ACL (don’t share the agency owner login). Explain; don’t offer a DGTL vault in v1; don’t collect tokens.

## Copy

“Your login can see **{n}** GA4 properties. I will not use the first. Which client / property ID?”
