/** Closed error codes. Human `message` is user-visible; never include tokens. */

export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "REAUTH_REQUIRED",
  "CONSENT_MISSING",
  "ACCESS_NOT_CONFIGURED",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "RESOURCE_REQUIRED",
  "INVALID_ARGUMENT",
  "UNSUPPORTED_DIMENSION",
  "UNSUPPORTED_OPERATION",
  "QUOTA_EXCEEDED",
  "RATE_LIMITED",
  "GOOGLE_UNAVAILABLE",
  "LICENSE_REQUIRED",
  "GATEWAY_UNAVAILABLE",
  "ADS_SCOPE_MISSING",
  "META_NOT_CONNECTED",
  "GBP_NOT_ENABLED",
  "WRITE_NOT_ENABLED",
  "CONSENT_W_REQUIRED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorExtra = {
  hint?: string;
  google_status?: number;
  google_reason?: string;
  api?: string;
  resource_id?: string;
  missing_scope?: string;
};

export class ToolError extends Error {
  readonly error_code: ErrorCode;
  readonly extra: ErrorExtra;

  constructor(code: ErrorCode, message: string, extra: ErrorExtra = {}) {
    super(message);
    this.name = "ToolError";
    this.error_code = code;
    this.extra = extra;
  }
}

export const MSG = {
  UNAUTHENTICATED:
    "Google is not connected. For Cursor and Grok Build stdio, set a host-injected access token (GOOGLE_ACCESS_TOKEN) or run `dgtl-connector-mcp auth login` (installed-app PKCE). There is no Gmail-style Connect card for local stdio MCP.",
  UNVERIFIED_APP:
    "Google may show “This app isn’t verified” or block sign-in while DGTL Sunrise’s OAuth client is in Testing — that is Google’s allowlist, not a broken plugin. Continue only for your own Google account (or a tester the publisher added); other accounts stay stranded until Google verification.",
  REAUTH_REQUIRED:
    "Google access expired or was revoked. Re-run host token injection or `dgtl-connector-mcp auth login`. You can also revoke this app under Google Account → Third-party access, then reconnect.",
  RESOURCE_REQUIRED:
    "This tool will not guess a property. Name the GA4 property ID, Search Console site, or GTM account/container/workspace. If you are not sure, ask me to list them.",
  UNSUPPORTED_DIMENSION:
    "The GA4 Data API has no search-query dimension. Search queries stay in Search Console search analytics. I can run gsc_query_search_analytics with dimension query for the Search Console site you pick. Linking GSC in the GA4 UI does not add searchQuery to this API.",
  UNSUPPORTED_OPERATION:
    "v1 is read-only. I cannot publish Tag Manager containers, create tags, submit sitemaps, request indexing, or create GA4–Search Console links (analytics.readonly cannot create those links). Use the Google UI.",
  LICENSE_REQUIRED:
    "This tool needs DGTL Pro ($19/mo flat, unlimited) for Google Ads / Meta Ads. Free GA4, Search Console, and Tag Manager tools still work. Get Pro at https://www.dgtlsunrise.com/ then paste a license JWT via DGTL_LICENSE_JWT or PLUGIN_DATA/license.jwt — never a Google Ads developer-token.",
  GATEWAY_UNAVAILABLE:
    "The DGTL Ads/Meta gateway is not reachable. Set DGTL_GATEWAY_URL to a live Worker, or wait until the hosted gateway is up. Free GA4, Search Console, and Tag Manager tools still work. This is not a missing Ads OAuth reconnect.",
  FEEDBACK_GATEWAY_UNAVAILABLE:
    "The DGTL feedback endpoint is not configured. Set DGTL_FEEDBACK_URL or DGTL_GATEWAY_URL to the hosted stamp gateway (POST /v1/feedback). Destination mailbox is support@dgtlsunrise.com. Do not email tokens. Free GA4, Search Console, and Tag Manager tools still work.",
  FEEDBACK_CONFIRM_REQUIRED:
    "feedback_send requires confirm: true after the user approves the draft from feedback_prepare. Do not send without that approval.",
  GBP_NOT_ENABLED:
    "Google Business Profile tools are flagged off until DGTL's GCP project has non-zero GBP API quota (Basic API Access). They are not on the free GA4/GSC/GTM consent screen. Consent B (business.manage) is a separate grant.",
  WRITE_NOT_ENABLED:
    "Write/publish tools are flagged off (DGTL_WRITES_ENABLED=false). Free Consent A stays readonly (analytics/webmasters/tagmanager.readonly). Writes use a separate Consent W OAuth client — see docs/ops/FULL-STACK-ACCELERATE.md.",
  CONSENT_W_REQUIRED:
    "This write tool needs Consent W (separate OAuth client with edit/publish scopes). It is not part of free Consent A. Do not add write scopes to the Desktop readonly client.",
  ADS_SCOPE_MISSING:
    "Google Ads is a second OAuth grant (scope adwords). It is not part of the free GA4/GSC/GTM consent. After a valid DGTL license, set GOOGLE_ADS_ACCESS_TOKEN or run `dgtl-connector-mcp auth login-ads` (separate Consent C client). Never reuse Consent A.",
  META_NOT_CONNECTED:
    "Meta Ads is a separate OAuth (ads_read). After a valid DGTL license + gateway, set META_ACCESS_TOKEN or run `dgtl-connector-mcp auth login-meta --code <grant>`. Support never collects Meta tokens; the app secret is never in this plugin.",
  INVALID_ARGUMENT:
    "Google rejected the request (INVALID_ARGUMENT). Check dates (YYYY-MM-DD), GA4 limits (≤9 dimensions, ≤10 metrics), and names from ga4_get_metadata. I will not invent a replacement metric.",
  NOT_FOUND:
    "Google does not know this resource. Copy the ID from the list tools. Search Console URL-prefix properties must match, including the trailing slash. Domain properties look like sc-domain:example.com.",
  PERMISSION_DENIED:
    "This Google account cannot access that resource. In GA4: Admin → Property access. In Search Console: Settings → Users. In GTM: Account user management. Being signed into Google is not the same as being a user on that property.",
  ACCESS_NOT_CONFIGURED:
    "Google returned 403 accessNotConfigured. That means the API is not Enabled on the OAuth client's Google Cloud project — not that your GA4 property is empty.",
  QUOTA:
    "Google quota or rate limit hit. I cap reports at 1,000 rows per call. Wait, narrow the date range, or inspect fewer URLs.",
  GOOGLE_UNAVAILABLE:
    "Google’s API returned a server error. Retry once. If it keeps failing, it is on Google’s side, not your property picker.",
  RANGE_TOO_LONG:
    "Date range exceeds 366 days. Pass allow_long_range: true if you really need a longer window (uses more GA4 quota).",
} as const;

export function consentMissing(scope: string): ToolError {
  return new ToolError(
    "CONSENT_MISSING",
    `This Google login did not grant ${scope}. Re-authorize the same GA4 + Search Console + Tag Manager consent and allow all three product scopes. This plugin will not start a second Google login just for one API.`,
    {
      missing_scope: scope,
      hint: "One consent for GA4 + GSC + GTM. GBP and Ads are separate grants and are not on this screen.",
    },
  );
}
