import { MSG, ToolError } from "../errors.js";

/** GA4 Data API has no search-query dimension. Check before any HTTP. */
export const SEARCH_QUERY_DENY = new Set(["searchquery", "query", "searchterm", "keyword"]);

export function denySearchQueryDimensions(names: unknown): void {
  if (!names) return;
  const list = Array.isArray(names) ? names : [names];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const key = raw.trim().toLowerCase();
    if (SEARCH_QUERY_DENY.has(key)) {
      throw new ToolError("UNSUPPORTED_DIMENSION", MSG.UNSUPPORTED_DIMENSION, {
        hint: "Use gsc_query_search_analytics with dimensions: [\"query\"] after picking an exact site_url.",
      });
    }
  }
}

/** gclid is an Ads click_view field. GA4 Data API has no gclid dimension. */
export const GA4_GCLID_DENY = new Set(["gclid", "sessiongclid", "firstusergclid", "googleadsgclid"]);

export function denyGa4GclidDimensions(names: unknown): void {
  if (!names) return;
  const list = Array.isArray(names) ? names : [names];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const key = raw.trim().toLowerCase();
    if (GA4_GCLID_DENY.has(key) || key.endsWith("gclid")) {
      throw new ToolError("UNSUPPORTED_DIMENSION", MSG.UNSUPPORTED_DIMENSION, {
        hint: "gclid is not a GA4 dimension. Use gads_search recipe=click_view (Consent C + Pro). Join on Ads-id dimensions, not gclid.",
      });
    }
  }
}
