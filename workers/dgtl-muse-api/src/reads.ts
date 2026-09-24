import type { ActiveGrant } from "./auth";
import {
  getGa4Metadata,
  getGa4Property,
  listGa4AccountSummaries,
  listGa4Accounts,
  listGa4DataStreams,
  listGa4KeyEvents,
  listGa4Properties,
  runGa4Report,
} from "./ga4-reads";
import {
  describeGscSchema,
  getGscSite,
  getGscSitemap,
  inspectGscUrl,
  listGscSitemaps,
  listGscSites,
  queryGscSearchAnalytics,
} from "./gsc-reads";
import {
  getGtmContainer,
  getGtmLiveVersion,
  listGtmAccounts,
  listGtmClients,
  listGtmContainers,
  listGtmEnvironments,
  listGtmTags,
  listGtmTriggers,
  listGtmVariables,
  listGtmWorkspaces,
} from "./gtm-reads";
import { GA4_READ_SCOPES, GSC_READ_SCOPES, GTM_READ_SCOPES, refusalForGoogleScopes } from "./scopes";

export type ReadCtx = {
  readonly request: Request;
  readonly url: URL;
  readonly env: Env;
  readonly grant: ActiveGrant;
  readonly params: readonly string[];
};

type Route = {
  readonly method: "GET" | "POST";
  readonly pattern: RegExp;
  readonly scopes: readonly string[];
  readonly handle: (ctx: ReadCtx) => Response | Promise<Response>;
};

const ROUTES: readonly Route[] = [
  {
    method: "GET",
    pattern: /^\/v1\/ga4\/accounts$/,
    scopes: GA4_READ_SCOPES,
    handle: listGa4Accounts,
  },
  {
    method: "GET",
    pattern: /^\/v1\/ga4\/account-summaries$/,
    scopes: GA4_READ_SCOPES,
    handle: listGa4AccountSummaries,
  },
  {
    method: "GET",
    pattern: /^\/v1\/ga4\/accounts\/([^/]+)\/properties$/,
    scopes: GA4_READ_SCOPES,
    handle: listGa4Properties,
  },
  {
    method: "GET",
    pattern: /^\/v1\/ga4\/properties\/([^/]+)\/data-streams$/,
    scopes: GA4_READ_SCOPES,
    handle: listGa4DataStreams,
  },
  {
    method: "GET",
    pattern: /^\/v1\/ga4\/properties\/([^/]+)\/key-events$/,
    scopes: GA4_READ_SCOPES,
    handle: listGa4KeyEvents,
  },
  {
    method: "GET",
    pattern: /^\/v1\/ga4\/properties\/([^/]+)\/metadata$/,
    scopes: GA4_READ_SCOPES,
    handle: getGa4Metadata,
  },
  {
    method: "POST",
    pattern: /^\/v1\/ga4\/properties\/([^/]+)\/reports$/,
    scopes: GA4_READ_SCOPES,
    handle: runGa4Report,
  },
  {
    method: "GET",
    pattern: /^\/v1\/ga4\/properties\/([^/]+)$/,
    scopes: GA4_READ_SCOPES,
    handle: getGa4Property,
  },
  {
    method: "GET",
    pattern: /^\/v1\/gsc\/schema$/,
    scopes: GSC_READ_SCOPES,
    handle: describeGscSchema,
  },
  {
    method: "GET",
    pattern: /^\/v1\/gsc\/sites$/,
    scopes: GSC_READ_SCOPES,
    handle: listGscSites,
  },
  {
    method: "GET",
    pattern: /^\/v1\/gsc\/site$/,
    scopes: GSC_READ_SCOPES,
    handle: getGscSite,
  },
  {
    method: "POST",
    pattern: /^\/v1\/gsc\/search-analytics$/,
    scopes: GSC_READ_SCOPES,
    handle: queryGscSearchAnalytics,
  },
  {
    method: "POST",
    pattern: /^\/v1\/gsc\/url-inspection$/,
    scopes: GSC_READ_SCOPES,
    handle: inspectGscUrl,
  },
  {
    method: "GET",
    pattern: /^\/v1\/gsc\/sitemaps$/,
    scopes: GSC_READ_SCOPES,
    handle: listGscSitemaps,
  },
  {
    method: "GET",
    pattern: /^\/v1\/gsc\/sitemap$/,
    scopes: GSC_READ_SCOPES,
    handle: getGscSitemap,
  },
  {
    method: "GET",
    pattern: /^\/v1\/gtm\/accounts\/([^/]+)\/containers\/([^/]+)\/workspaces\/([^/]+)\/tags$/,
    scopes: GTM_READ_SCOPES,
    handle: listGtmTags,
  },
  {
    method: "GET",
    pattern: /^\/v1\/gtm\/accounts\/([^/]+)\/containers\/([^/]+)\/workspaces\/([^/]+)\/triggers$/,
    scopes: GTM_READ_SCOPES,
    handle: listGtmTriggers,
  },
  {
    method: "GET",
    pattern: /^\/v1\/gtm\/accounts\/([^/]+)\/containers\/([^/]+)\/workspaces\/([^/]+)\/variables$/,
    scopes: GTM_READ_SCOPES,
    handle: listGtmVariables,
  },
  {
    method: "GET",
    pattern: /^\/v1\/gtm\/accounts\/([^/]+)\/containers\/([^/]+)\/workspaces\/([^/]+)\/clients$/,
    scopes: GTM_READ_SCOPES,
    handle: listGtmClients,
  },
  {
    method: "GET",
    pattern: /^\/v1\/gtm\/accounts\/([^/]+)\/containers\/([^/]+)\/versions\/live$/,
    scopes: GTM_READ_SCOPES,
    handle: getGtmLiveVersion,
  },
  {
    method: "GET",
    pattern: /^\/v1\/gtm\/accounts\/([^/]+)\/containers\/([^/]+)\/workspaces$/,
    scopes: GTM_READ_SCOPES,
    handle: listGtmWorkspaces,
  },
  {
    method: "GET",
    pattern: /^\/v1\/gtm\/accounts\/([^/]+)\/containers\/([^/]+)\/environments$/,
    scopes: GTM_READ_SCOPES,
    handle: listGtmEnvironments,
  },
  {
    method: "GET",
    pattern: /^\/v1\/gtm\/accounts\/([^/]+)\/containers\/([^/]+)$/,
    scopes: GTM_READ_SCOPES,
    handle: getGtmContainer,
  },
  {
    method: "GET",
    pattern: /^\/v1\/gtm\/accounts\/([^/]+)\/containers$/,
    scopes: GTM_READ_SCOPES,
    handle: listGtmContainers,
  },
  {
    method: "GET",
    pattern: /^\/v1\/gtm\/accounts$/,
    scopes: GTM_READ_SCOPES,
    handle: listGtmAccounts,
  },
];

export async function routeReads(
  request: Request,
  grant: ActiveGrant,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  for (const route of ROUTES) {
    if (request.method !== route.method) {
      continue;
    }
    const match = route.pattern.exec(url.pathname);
    if (match === null) {
      continue;
    }
    const refused = refusalForGoogleScopes(grant.google, route.scopes);
    if (refused !== null) {
      return refused;
    }
    return route.handle({
      request,
      url,
      env,
      grant,
      params: match.slice(1),
    });
  }
  return null;
}
