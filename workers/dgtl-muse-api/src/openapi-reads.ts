import { SCOPE } from "./scopes";

type Family = "ga4" | "gsc" | "gtm";

const BEARER = [{ bearerAuth: [] }];

function familyNames(family: Family): { readonly forbidden: string; readonly unavailable: string; readonly scope: string } {
  switch (family) {
    case "ga4":
      return { forbidden: "Ga4Forbidden", unavailable: "Ga4Unavailable", scope: SCOPE.analytics };
    case "gsc":
      return { forbidden: "GscForbidden", unavailable: "GscUnavailable", scope: SCOPE.webmasters };
    case "gtm":
      return { forbidden: "GtmForbidden", unavailable: "GtmUnavailable", scope: SCOPE.tagmanager };
    default: {
      const unexpected: never = family;
      return unexpected;
    }
  }
}

function readResponses(
  family: Family,
  okRef: string,
  okDescription: string,
  options: { readonly badRequest?: string; readonly notFound?: boolean; readonly google?: boolean },
): Record<string, unknown> {
  const names = familyNames(family);
  const responses: Record<string, unknown> = {
    "200": {
      description: okDescription,
      content: {
        "application/json": { schema: { $ref: `#/components/schemas/${okRef}` } },
      },
    },
    "401": { $ref: "#/components/responses/Unauthorized" },
    "403": {
      description:
        options.google === false
          ? `The grant has no Google link, or it is missing ${names.scope}. This route does not call Google. Reopen /connect and reconnect.`
          : `The grant has no Google link, or it is missing ${names.scope}. A missing scope does not call Google. Reopen /connect and reconnect. Google can also refuse the read.`,
      content: {
        "application/json": {
          schema: {
            oneOf: [
              { $ref: "#/components/schemas/GoogleNotLinked" },
              { $ref: "#/components/schemas/GoogleReconnectRequired" },
              ...(options.google === false
                ? []
                : [{ $ref: `#/components/schemas/${names.forbidden}` }]),
            ],
          },
        },
      },
    },
  };
  if (options.badRequest !== undefined) {
    responses["400"] = {
      description: "The path, query, or body is not valid for this route.",
      content: {
        "application/json": { schema: { $ref: `#/components/schemas/${options.badRequest}` } },
      },
    };
  }
  if (options.notFound === true) {
    responses["404"] = {
      description: "Google has no resource at this id.",
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/NotFound" } },
      },
    };
  }
  if (options.google !== false) {
    responses["500"] = {
      description: "The stored refresh token could not be opened.",
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/GrantUnreadable" } },
      },
    };
    responses["502"] = {
      description: "Refreshing the Google access token failed, or the Google API call failed.",
      content: {
        "application/json": { schema: { $ref: `#/components/schemas/${names.unavailable}` } },
      },
    };
  }
  return responses;
}

function getOp(
  family: Family,
  operationId: string,
  summary: string,
  description: string,
  okRef: string,
  okDescription: string,
  parameters: unknown[],
  options: { readonly badRequest?: string; readonly notFound?: boolean; readonly google?: boolean } = {},
): Record<string, unknown> {
  return {
    get: {
      operationId,
      tags: [family],
      summary,
      description,
      security: BEARER,
      parameters,
      responses: readResponses(family, okRef, okDescription, options),
    },
  };
}

function postOp(
  family: Family,
  operationId: string,
  summary: string,
  description: string,
  okRef: string,
  okDescription: string,
  bodyRef: string,
  badRequest: string,
): Record<string, unknown> {
  return {
    post: {
      operationId,
      tags: [family],
      summary,
      description,
      security: BEARER,
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: `#/components/schemas/${bodyRef}` } },
        },
      },
      responses: readResponses(family, okRef, okDescription, { badRequest }),
    },
  };
}

const page = [
  { $ref: "#/components/parameters/pageSize" },
  { $ref: "#/components/parameters/pageToken" },
];
const property = [{ $ref: "#/components/parameters/propertyId" }];
const account = [{ $ref: "#/components/parameters/accountId" }];
const container = [
  { $ref: "#/components/parameters/accountId" },
  { $ref: "#/components/parameters/containerId" },
];
const workspace = [
  ...container,
  { $ref: "#/components/parameters/workspaceId" },
];
const site = [{ $ref: "#/components/parameters/siteUrl" }];

const GA4 = SCOPE.analytics;
const GSC = SCOPE.webmasters;
const GTM = SCOPE.tagmanager;

export const readPaths = {
  "/v1/ga4/accounts": getOp(
    "ga4",
    "listGa4Accounts",
    "List GA4 accounts",
    `Tip tool ga4_list_accounts. Analytics Admin accounts.list. Requires ${GA4}. page_token is Google's nextPageToken. Does not pick an account.`,
    "Ga4AccountList",
    "Accounts visible to the linked Google user.",
    page,
    { badRequest: "InvalidRequest" },
  ),
  "/v1/ga4/account-summaries": getOp(
    "ga4",
    "listGa4AccountSummaries",
    "List GA4 account summaries",
    `Tip tool ga4_list_account_summaries. Analytics Admin accountSummaries.list, including nested property summaries. Requires ${GA4}. Does not pick a property.`,
    "Ga4AccountSummaryList",
    "Account summaries for the linked Google user.",
    page,
    { badRequest: "InvalidRequest" },
  ),
  "/v1/ga4/accounts/{account_id}/properties": getOp(
    "ga4",
    "listGa4Properties",
    "List GA4 properties",
    `Tip tool ga4_list_properties. Analytics Admin properties.list filtered to parent:accounts/{account_id}. Requires ${GA4}. The path is the numeric id; tip also accepts an accounts/{id} prefix.`,
    "Ga4PropertyList",
    "Properties under the account.",
    [...account, ...page],
    { badRequest: "InvalidRequest" },
  ),
  "/v1/ga4/properties/{property_id}": getOp(
    "ga4",
    "getGa4Property",
    "Read a GA4 property",
    `Tip tool ga4_get_property. Analytics Admin properties.get. Requires ${GA4}. resource is the Admin property (displayName, timeZone, currencyCode, and the other fields Google returns).`,
    "Ga4PropertyRead",
    "The Admin property resource.",
    property,
    { badRequest: "InvalidRequest", notFound: true },
  ),
  "/v1/ga4/properties/{property_id}/data-streams": getOp(
    "ga4",
    "listGa4DataStreams",
    "List GA4 data streams",
    `Tip tool ga4_list_data_streams. Analytics Admin properties.dataStreams.list. Requires ${GA4}.`,
    "Ga4DataStreamList",
    "Data streams on the property.",
    [...property, ...page],
    { badRequest: "InvalidRequest" },
  ),
  "/v1/ga4/properties/{property_id}/key-events": getOp(
    "ga4",
    "listGa4KeyEvents",
    "List GA4 key events",
    `Tip tool ga4_list_key_events. Analytics Admin properties.keyEvents.list. Requires ${GA4}.`,
    "Ga4KeyEventList",
    "Key events on the property.",
    [...property, ...page],
    { badRequest: "InvalidRequest" },
  ),
  "/v1/ga4/properties/{property_id}/metadata": getOp(
    "ga4",
    "getGa4Metadata",
    "Read GA4 metadata",
    `Tip tool ga4_get_metadata. GA4 Data API properties.getMetadata. Requires ${GA4}. Optional query, kind, and custom_only filter the catalog. This Worker does not cache metadata. Cite apiName values from the response.`,
    "Ga4Metadata",
    "Dimensions and metrics for the property.",
    [
      ...property,
      {
        name: "query",
        in: "query",
        required: false,
        description: "Case-insensitive substring of apiName, uiName, or description.",
        schema: { type: "string", minLength: 1, maxLength: 120 },
      },
      {
        name: "kind",
        in: "query",
        required: false,
        schema: { type: "string", enum: ["dimension", "metric", "all"], default: "all" },
      },
      {
        name: "custom_only",
        in: "query",
        required: false,
        schema: { type: "string", enum: ["true", "false"] },
      },
    ],
    { badRequest: "InvalidRequest" },
  ),
  "/v1/ga4/properties/{property_id}/reports": postOp(
    "ga4",
    "runGa4Report",
    "Run a GA4 report",
    `Tip tool ga4_run_report, subset. GA4 Data API properties.runReport. Requires ${GA4}. date_ranges is 1 or 2 ranges. metrics and key_event_names together must name 1–10 metrics. dimensions max 9. limit max 1000. Search-query names (query, searchQuery, searchTerm, keyword) and gclid names are rejected locally and are not sent to Google. This path does not accept recipe, dimension_filter, metric_filter, or order_bys. It does not query Search Console. The response is the Data API JSON plus property_id and cited.`,
    "Ga4Report",
    "Data API runReport payload plus cited.",
    "Ga4ReportRequest",
    "ReportRejected",
  ),
  "/v1/gsc/schema": getOp(
    "gsc",
    "describeGscSchema",
    "Describe the Search Console schema",
    `Tip tool gsc_describe_schema. Local dimension and metric catalog. No Google call. Requires ${GSC} so a grant without Search Console is not shown an empty success. Use these api_name values in POST /v1/gsc/search-analytics.`,
    "GscSchema",
    "Local catalog. Google was not called.",
    [],
    { google: false },
  ),
  "/v1/gsc/sites": getOp(
    "gsc",
    "listGscSites",
    "List Search Console sites",
    `Tip tool gsc_list_sites. Search Console sites.list. Requires ${GSC}. Copy siteUrl exactly. page_token is a numeric offset into that list, not a Google page token.`,
    "GscSiteList",
    "Sites for the linked Google user.",
    page,
    { badRequest: "InvalidRequest" },
  ),
  "/v1/gsc/site": getOp(
    "gsc",
    "getGscSite",
    "Read a Search Console site",
    `Tip tool gsc_get_site. Search Console sites.get. Requires ${GSC}. site_url is a query parameter because the property string contains slashes or a sc-domain: prefix.`,
    "GscSite",
    "The site resource.",
    site,
    { badRequest: "InvalidRequest", notFound: true },
  ),
  "/v1/gsc/search-analytics": postOp(
    "gsc",
    "queryGscSearchAnalytics",
    "Query Search Console analytics",
    `Tip tool gsc_query_search_analytics. Search Console searchAnalytics.query. Requires ${GSC}. This is the route for search queries. data_state defaults to final. Dimensions are the closed set from GET /v1/gsc/schema.`,
    "GscSearchAnalytics",
    "Search Analytics rows plus cited.",
    "GscSearchAnalyticsRequest",
    "GscRejected",
  ),
  "/v1/gsc/url-inspection": postOp(
    "gsc",
    "inspectGscUrl",
    "Inspect a URL",
    `Tip tool gsc_inspect_url. Search Console URL Inspection index.inspect. Requires ${GSC}. There is no request-indexing route.`,
    "GscUrlInspection",
    "URL Inspection result plus cited.",
    "GscUrlInspectionRequest",
    "GscRejected",
  ),
  "/v1/gsc/sitemaps": getOp(
    "gsc",
    "listGscSitemaps",
    "List sitemaps",
    `Tip tool gsc_list_sitemaps. Search Console sitemaps.list. Requires ${GSC}. page_token is a numeric offset.`,
    "GscSitemapList",
    "Sitemaps for the site.",
    [...site, ...page, { $ref: "#/components/parameters/sitemapIndex" }],
    { badRequest: "InvalidRequest" },
  ),
  "/v1/gsc/sitemap": getOp(
    "gsc",
    "getGscSitemap",
    "Read a sitemap",
    `Tip tool gsc_get_sitemap. Search Console sitemaps.get. Requires ${GSC}. feedpath is the sitemap path or URL from the list route, passed as a query parameter.`,
    "GscSitemap",
    "The sitemap resource.",
    [...site, { $ref: "#/components/parameters/feedpath" }],
    { badRequest: "InvalidRequest", notFound: true },
  ),
  "/v1/gtm/accounts": getOp(
    "gtm",
    "listGtmAccounts",
    "List Tag Manager accounts",
    `Tip tool gtm_list_accounts. Tag Manager accounts.list. Requires ${GTM}. page_token is a numeric offset. A Google 403 can mean the Tag Manager API is not enabled.`,
    "GtmAccountList",
    "Tag Manager accounts.",
    page,
    { badRequest: "InvalidRequest" },
  ),
  "/v1/gtm/accounts/{account_id}/containers": getOp(
    "gtm",
    "listGtmContainers",
    "List Tag Manager containers",
    `Tip tool gtm_list_containers. Tag Manager accounts.containers.list. Requires ${GTM}. publicId (GTM-XXXX) is a field on each container, not the path id.`,
    "GtmContainerList",
    "Containers in the account.",
    [...account, ...page],
    { badRequest: "InvalidRequest" },
  ),
  "/v1/gtm/accounts/{account_id}/containers/{container_id}": getOp(
    "gtm",
    "getGtmContainer",
    "Read a Tag Manager container",
    `Tip tool gtm_get_container. Tag Manager accounts.containers.get. Requires ${GTM}.`,
    "GtmContainer",
    "The container resource.",
    container,
    { badRequest: "InvalidRequest", notFound: true },
  ),
  "/v1/gtm/accounts/{account_id}/containers/{container_id}/workspaces": getOp(
    "gtm",
    "listGtmWorkspaces",
    "List Tag Manager workspaces",
    `Tip tool gtm_list_workspaces. Tag Manager workspaces.list. Requires ${GTM}. If more than one workspace is returned, do not assume a default. Drafts are not the live container.`,
    "GtmWorkspaceList",
    "Workspaces in the container.",
    [...container, ...page],
    { badRequest: "InvalidRequest" },
  ),
  "/v1/gtm/accounts/{account_id}/containers/{container_id}/workspaces/{workspace_id}/tags": getOp(
    "gtm",
    "listGtmTags",
    "List workspace tags",
    `Tip tool gtm_list_tags. Workspace tags.list. Requires ${GTM}. source=workspace means drafts, not the published container.`,
    "GtmTagList",
    "Draft tags in the workspace.",
    [...workspace, ...page],
    { badRequest: "InvalidRequest" },
  ),
  "/v1/gtm/accounts/{account_id}/containers/{container_id}/workspaces/{workspace_id}/triggers": getOp(
    "gtm",
    "listGtmTriggers",
    "List workspace triggers",
    `Tip tool gtm_list_triggers. Workspace triggers.list. Requires ${GTM}. source=workspace means drafts.`,
    "GtmTriggerList",
    "Draft triggers in the workspace.",
    [...workspace, ...page],
    { badRequest: "InvalidRequest" },
  ),
  "/v1/gtm/accounts/{account_id}/containers/{container_id}/workspaces/{workspace_id}/variables": getOp(
    "gtm",
    "listGtmVariables",
    "List workspace variables",
    `Tip tool gtm_list_variables. Workspace variables.list. Requires ${GTM}. source=workspace means drafts.`,
    "GtmVariableList",
    "Draft variables in the workspace.",
    [...workspace, ...page],
    { badRequest: "InvalidRequest" },
  ),
  "/v1/gtm/accounts/{account_id}/containers/{container_id}/versions/live": getOp(
    "gtm",
    "getGtmLiveContainerVersion",
    "Read the live container version",
    `Tip tool gtm_get_live_container_version. Tag Manager versions.live (the Google path is versions:live). Requires ${GTM}. This is the published container. This route does not publish.`,
    "GtmLiveVersion",
    "The published container version.",
    container,
    { badRequest: "InvalidRequest", notFound: true },
  ),
  "/v1/gtm/accounts/{account_id}/containers/{container_id}/workspaces/{workspace_id}/clients": getOp(
    "gtm",
    "listGtmClients",
    "List workspace clients",
    `Tip tool gtm_list_clients. Workspace clients.list. Requires ${GTM}. Server containers expose clients; web containers are often empty. This is not stamp ingest.`,
    "GtmClientList",
    "Draft clients in the workspace.",
    [...workspace, ...page],
    { badRequest: "InvalidRequest" },
  ),
  "/v1/gtm/accounts/{account_id}/containers/{container_id}/environments": getOp(
    "gtm",
    "listGtmEnvironments",
    "List container environments",
    `Tip tool gtm_list_environments. Tag Manager environments.list. Requires ${GTM}. Environments are container-level, not workspace-level.`,
    "GtmEnvironmentList",
    "Environments on the container.",
    [...container, ...page],
    { badRequest: "InvalidRequest" },
  ),
};

function googleList(collection: string, description: string): Record<string, unknown> {
  return {
    type: "object",
    description,
    required: [collection],
    properties: {
      [collection]: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
      next_page_token: { type: "string" },
      hint: { type: "string" },
    },
    additionalProperties: true,
  };
}

const errorEnum = (codes: readonly string[]): Record<string, unknown> => ({
  type: "object",
  required: ["error"],
  properties: {
    error: { type: "string", enum: [...codes] },
  },
});

const messageError = (codes: readonly string[]): Record<string, unknown> => ({
  type: "object",
  required: ["error", "message"],
  properties: {
    error: { type: "string", enum: [...codes] },
    message: { type: "string" },
  },
});

export const readParameters = {
  accountId: {
    name: "account_id",
    in: "path",
    required: true,
    description: "Numeric account id. Tip tools also accept an accounts/{id} prefix; this path uses the digits only.",
    schema: { type: "string", pattern: "^[0-9]{1,20}$" },
  },
  containerId: {
    name: "container_id",
    in: "path",
    required: true,
    description: "Numeric Tag Manager container id. GTM-XXXX is publicId on the container, not this id.",
    schema: { type: "string", pattern: "^[0-9]{1,20}$" },
  },
  workspaceId: {
    name: "workspace_id",
    in: "path",
    required: true,
    description: "Numeric Tag Manager workspace id.",
    schema: { type: "string", pattern: "^[0-9]{1,20}$" },
  },
  pageSize: {
    name: "page_size",
    in: "query",
    required: false,
    description: "Page size from 1 to 200. Defaults to 50.",
    schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
  },
  pageToken: {
    name: "page_token",
    in: "query",
    required: false,
    description:
      "GA4 Admin lists: the next_page_token from the previous response (Google nextPageToken). Search Console and Tag Manager lists: a numeric offset into the full Google list.",
    schema: { type: "string" },
  },
  siteUrl: {
    name: "site_url",
    in: "query",
    required: true,
    description:
      "Exact Search Console siteUrl. URL-prefix properties include the trailing slash. sc-domain:example.com is a different property from https://example.com/.",
    schema: { type: "string", minLength: 1, maxLength: 2048 },
  },
  feedpath: {
    name: "feedpath",
    in: "query",
    required: true,
    description: "Sitemap path or URL copied from the list route.",
    schema: { type: "string", minLength: 1, maxLength: 2048 },
  },
  sitemapIndex: {
    name: "sitemap_index",
    in: "query",
    required: false,
    description: "Optional sitemap index URL passed to Search Console as sitemapIndex.",
    schema: { type: "string", minLength: 1, maxLength: 2048 },
  },
};

export const readSchemas = {
  InvalidRequest: messageError(["invalid_request"]),
  ReportRejected: messageError(["invalid_request", "unsupported_dimension", "unsupported_field"]),
  GscRejected: messageError(["invalid_request", "unsupported_field"]),
  NotFound: errorEnum(["not_found"]),
  GrantUnreadable: errorEnum(["grant_unreadable"]),
  Ga4Forbidden: errorEnum(["ga4_forbidden"]),
  GscForbidden: errorEnum(["gsc_forbidden"]),
  GtmForbidden: errorEnum(["gtm_forbidden"]),
  Ga4Unavailable: errorEnum(["ga4_unavailable", "google_token_failed"]),
  GscUnavailable: errorEnum(["gsc_unavailable", "google_token_failed"]),
  GtmUnavailable: errorEnum(["gtm_unavailable", "google_token_failed"]),
  Ga4AccountList: googleList("accounts", "Analytics Admin account resources."),
  Ga4AccountSummaryList: googleList("account_summaries", "Analytics Admin account summary resources."),
  Ga4PropertyList: googleList("properties", "Analytics Admin property resources for one account."),
  Ga4PropertyRead: {
    type: "object",
    required: ["property_id", "resource"],
    properties: {
      property_id: { type: "string" },
      resource: {
        type: "object",
        description: "Analytics Admin Property resource. displayName, timeZone, and currencyCode use Google's camelCase.",
        additionalProperties: true,
      },
    },
  },
  Ga4DataStreamList: googleList("data_streams", "Analytics Admin data stream resources."),
  Ga4KeyEventList: googleList("key_events", "Analytics Admin key event resources."),
  Ga4Metadata: {
    type: "object",
    required: [
      "property_id",
      "name",
      "kind",
      "query",
      "custom_only",
      "dimension_count",
      "metric_count",
      "dimensions",
      "metrics",
    ],
    properties: {
      property_id: { type: "string" },
      name: { type: "string" },
      kind: { type: "string", enum: ["dimension", "metric", "all"] },
      query: { type: ["string", "null"] },
      custom_only: { type: "boolean" },
      dimension_count: { type: "integer" },
      metric_count: { type: "integer" },
      dimensions: { type: "array", items: { type: "object", additionalProperties: true } },
      metrics: { type: "array", items: { type: "object", additionalProperties: true } },
    },
  },
  Ga4ReportRequest: {
    type: "object",
    required: ["date_ranges"],
    additionalProperties: false,
    properties: {
      date_ranges: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        items: {
          type: "object",
          required: ["start_date", "end_date"],
          additionalProperties: false,
          properties: {
            start_date: { type: "string" },
            end_date: { type: "string" },
          },
        },
      },
      metrics: { type: "array", maxItems: 10, items: { type: "string" } },
      dimensions: { type: "array", maxItems: 9, items: { type: "string" } },
      key_event_names: { type: "array", maxItems: 10, items: { type: "string" } },
      limit: { type: "integer", minimum: 1, maximum: 1000 },
      offset: { type: "integer", minimum: 0 },
      keep_empty_rows: { type: "boolean" },
      currency_code: { type: "string", pattern: "^[A-Z]{3}$" },
      allow_long_range: { type: "boolean" },
    },
  },
  Ga4Report: {
    type: "object",
    required: ["property_id", "cited"],
    description: "GA4 Data API runReport JSON, plus property_id and cited. Report fields keep Google's camelCase.",
    properties: {
      property_id: { type: "string" },
      cited: { type: "object", additionalProperties: true },
      rows: { type: "array", items: { type: "object", additionalProperties: true } },
      rowCount: { type: "integer" },
      propertyQuota: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  },
  GscSchema: {
    type: "object",
    required: ["dimensions", "metrics", "site_url_notes", "data_state_notes"],
    properties: {
      dimensions: {
        type: "array",
        items: {
          type: "object",
          required: ["api_name", "description"],
          properties: {
            api_name: { type: "string" },
            description: { type: "string" },
          },
        },
      },
      metrics: {
        type: "array",
        items: {
          type: "object",
          required: ["api_name", "description"],
          properties: {
            api_name: { type: "string" },
            description: { type: "string" },
          },
        },
      },
      site_url_notes: { type: "array", items: { type: "string" } },
      data_state_notes: { type: "array", items: { type: "string" } },
    },
  },
  GscSiteList: googleList("site_entry", "Search Console site entries. Use siteUrl exactly."),
  GscSite: {
    type: "object",
    required: ["site_url", "resource"],
    properties: {
      site_url: { type: "string" },
      resource: { type: "object", additionalProperties: true },
    },
  },
  GscSearchAnalyticsRequest: {
    type: "object",
    required: ["site_url", "start_date", "end_date"],
    additionalProperties: false,
    properties: {
      site_url: { type: "string" },
      start_date: { type: "string" },
      end_date: { type: "string" },
      dimensions: {
        type: "array",
        items: {
          type: "string",
          enum: ["query", "page", "country", "device", "searchAppearance", "date", "hour"],
        },
      },
      row_limit: { type: "integer", minimum: 1, maximum: 1000 },
      start_row: { type: "integer", minimum: 0 },
      search_type: {
        type: "string",
        enum: ["web", "image", "video", "news", "discover", "googleNews"],
      },
      data_state: { type: "string", enum: ["final", "all"] },
      aggregation_type: { type: "string" },
      dimension_filter_groups: {
        type: "array",
        maxItems: 8,
        items: { type: "object", additionalProperties: true },
      },
    },
  },
  GscSearchAnalytics: {
    type: "object",
    required: ["site_url", "cited"],
    description: "Search Analytics query JSON, plus site_url and cited.",
    properties: {
      site_url: { type: "string" },
      cited: { type: "object", additionalProperties: true },
      rows: { type: "array", items: { type: "object", additionalProperties: true } },
    },
    additionalProperties: true,
  },
  GscUrlInspectionRequest: {
    type: "object",
    required: ["site_url", "inspection_url"],
    additionalProperties: false,
    properties: {
      site_url: { type: "string" },
      inspection_url: { type: "string" },
      language_code: { type: "string" },
    },
  },
  GscUrlInspection: {
    type: "object",
    required: ["cited"],
    description: "URL Inspection JSON plus cited. There is no request-indexing field.",
    properties: {
      cited: { type: "object", additionalProperties: true },
      inspectionResult: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  },
  GscSitemapList: googleList("sitemap", "Search Console sitemap resources for one site."),
  GscSitemap: {
    type: "object",
    required: ["site_url", "feedpath", "resource"],
    properties: {
      site_url: { type: "string" },
      feedpath: { type: "string" },
      resource: { type: "object", additionalProperties: true },
    },
  },
  GtmAccountList: googleList("account", "Tag Manager account resources."),
  GtmContainerList: googleList("container", "Tag Manager container resources."),
  GtmContainer: {
    type: "object",
    required: ["account_id", "container_id", "resource"],
    properties: {
      account_id: { type: "string" },
      container_id: { type: "string" },
      resource: { type: "object", additionalProperties: true },
    },
  },
  GtmWorkspaceList: googleList("workspace", "Tag Manager workspace resources."),
  GtmTagList: googleList("tag", "Workspace draft tags. Each item has source=workspace."),
  GtmTriggerList: googleList("trigger", "Workspace draft triggers. Each item has source=workspace."),
  GtmVariableList: googleList("variable", "Workspace draft variables. Each item has source=workspace."),
  GtmClientList: googleList("client", "Workspace draft clients. Each item has source=workspace."),
  GtmLiveVersion: {
    type: "object",
    required: ["source", "cited", "hint"],
    description: "Tag Manager versions.live JSON plus source=live and cited. This route does not publish.",
    properties: {
      source: { type: "string", enum: ["live"] },
      cited: { type: "object", additionalProperties: true },
      hint: { type: "string" },
      containerVersion: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  },
  GtmEnvironmentList: googleList("environment", "Tag Manager environment resources."),
};

export const readTags = [
  { name: "ga4", description: `Free Google Analytics 4 reads. Requires ${GA4}. Does not mutate.` },
  {
    name: "gsc",
    description: `Free Google Search Console reads. Requires ${GSC}. Does not submit or delete sitemaps.`,
  },
  {
    name: "gtm",
    description: `Free Google Tag Manager reads. Requires ${GTM}. Workspace lists are drafts. versions/live is the published container and does not publish.`,
  },
];
