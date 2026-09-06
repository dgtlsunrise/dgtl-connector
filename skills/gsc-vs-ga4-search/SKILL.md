---
name: gsc-vs-ga4-search
description: Search queries, keywords, impressions, CTR, and average position live in Search Console searchanalytics, not the GA4 Data API. Use when the user asks for queries in GA4, GSC vs GA4 mismatch, organic keywords, or landing-page SEO. Linking GSC in the GA4 UI does not add searchQuery to the Data API. GSC-into-GA4 import lags.
---

# GSC vs GA4 search

## The non-bugs

1. **GA4 Data API has no `searchQuery` dimension.** Plugin denylist: `searchQuery`, `query`, `searchTerm`, `keyword` on `ga4_run_report` → `UNSUPPORTED_DIMENSION`.
2. **`analytics.readonly` cannot create GSC–GA4 links.** Tell them to link in GA4 Admin → Search Console links if they want the **GA4 UI** reports. That still does not add queries to `ga4_run_report`.
3. **Import lag.** GA4’s Search Console collection vs GSC API: often ~48h lag, timezone mismatch (GSC dates are not the GA4 property TZ), GSC clicks ≠ GA4 sessions.

## Procedure for queries

1. Pick exact `site_url` via `gsc_list_sites` (`select-google-property`).
2. `gsc_query_search_analytics` with `dimensions: ["query"]` (add `page`, `country`, `device`, `date` as asked).
3. Use `data_state: "final"` unless they want recent incomplete data (`all`).
4. Header (required): exact `site_url`, date range, `search_type` (default `web`), and `data_state`. GSC daily dates are **not** the GA4 property timezone — say that when comparing to GA4. Do not emit query rows before this header.

## Procedure for “organic landing pages” in GA4

That’s **sessions** by `landingPage` (and maybe `sessionDefaultChannelGroup = Organic Search`) — not queries. Different question. Don’t mix tables without labeling.

## Mismatch copy

“Clicks in Search Console are not sessions in GA4. I can show both if you confirm **both** the GSC site URL and the GA4 property ID. Expect lag and timezone differences. That is not a plugin bug.”

## Do not

- Scrape the GA4 UI
- Hallucinate query volume
- Use the first GSC site on an agency account
