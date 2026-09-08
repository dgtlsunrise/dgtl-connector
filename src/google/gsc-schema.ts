/**
 * Local GSC dimension/metric catalog (Surendran-style discovery).
 * No Google call — agents must use these names; do not invent fields.
 */

export type GscField = {
  api_name: string;
  description: string;
};

/** Search Analytics query dimensions (API + common extensions we already accept). */
export const GSC_DIMENSIONS: GscField[] = [
  {
    api_name: "query",
    description: "The query string the user entered into Google Search.",
  },
  {
    api_name: "page",
    description: "Canonical URL of the page that received impressions/clicks.",
  },
  {
    api_name: "country",
    description: "Three-letter ISO 3166-1 alpha-3 country code.",
  },
  {
    api_name: "device",
    description: "Device type: DESKTOP, MOBILE, or TABLET.",
  },
  {
    api_name: "searchAppearance",
    description: "Search appearance type (rich results, etc.). One impression can have multiple.",
  },
  {
    api_name: "date",
    description: "Calendar date of the query in YYYY-MM-DD.",
  },
  {
    api_name: "hour",
    description: "Hour of day (0–23). Only valid for recent windows; prefer date for longer ranges.",
  },
];

export const GSC_METRICS: GscField[] = [
  {
    api_name: "clicks",
    description: "Clicks from search results to your property.",
  },
  {
    api_name: "impressions",
    description: "Times a URL from your site appeared in search results.",
  },
  {
    api_name: "ctr",
    description: "Click-through rate (clicks / impressions).",
  },
  {
    api_name: "position",
    description: "Average position in results (1 = top).",
  },
];

export const GSC_DIMENSION_NAMES = new Set(GSC_DIMENSIONS.map((d) => d.api_name));

export function describeGscSchema(): {
  dimensions: GscField[];
  metrics: GscField[];
  site_url_notes: string[];
  data_state_notes: string[];
} {
  return {
    dimensions: GSC_DIMENSIONS,
    metrics: GSC_METRICS,
    site_url_notes: [
      "Copy site_url EXACTLY from gsc_list_sites.",
      "URL-prefix properties include the trailing slash (e.g. https://example.com/).",
      "Domain properties look like sc-domain:example.com — different from https://example.com/.",
      "Do not coerce sc-domain vs URL-prefix.",
    ],
    data_state_notes: [
      "data_state=final (default here): finalized data only (often lags ~2–3 days).",
      "data_state=all: includes fresh/incomplete rows — use when investigating today/yesterday.",
      "Empty rows with ok:true is not an auth failure.",
    ],
  };
}
