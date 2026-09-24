import type { ActiveGrant } from "./auth";
import { json } from "./http";
import { openRefreshToken } from "./seal";
import { invalidRequest, isRecord } from "./validate";

/** Tip pins this in src/shopify/auth.ts. Muse reads call Admin REST, not the tip GraphQL client. */
export const SHOPIFY_ADMIN_API_VERSION = "2026-04";

const PRODUCT_PAGE_DEFAULT = 25;
const PRODUCT_PAGE_MAX = 50;

type ReadyLink = {
  readonly shop: string;
  readonly accessToken: string;
};

type ShopifyResult =
  | { readonly kind: "ok"; readonly body: unknown; readonly link: string | null }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "rate_limited" }
  | { readonly kind: "unavailable" };

type ProductPage = {
  readonly pageSize: number;
  readonly pageToken: string | undefined;
};

function upstreamError(
  kind: "unauthorized" | "forbidden" | "rate_limited" | "unavailable",
): Response {
  switch (kind) {
    case "unauthorized":
      return json({ error: "shopify_unauthorized" }, 401);
    case "forbidden":
      return json({ error: "shopify_forbidden" }, 403);
    case "rate_limited":
      return json({ error: "shopify_rate_limited" }, 429);
    case "unavailable":
      return json({ error: "shopify_unavailable" }, 502);
    default: {
      const unexpected: never = kind;
      return unexpected;
    }
  }
}

async function readyLink(grant: ActiveGrant, env: Env): Promise<ReadyLink | Response> {
  if (grant.shopify === null) {
    return json({ error: "shopify_not_linked" }, 403);
  }
  const accessToken = await openRefreshToken(grant.shopify.access_token, env.MUSE_TOKEN_ENC_KEY);
  if (accessToken === null) {
    return json({ error: "grant_unreadable" }, 500);
  }
  return { shop: grant.shopify.shop, accessToken };
}

function readProductPage(url: URL): ProductPage | Response {
  const rawSize = url.searchParams.get("page_size");
  let pageSize = PRODUCT_PAGE_DEFAULT;
  if (rawSize !== null && rawSize.length > 0) {
    if (!/^[0-9]+$/.test(rawSize)) {
      return invalidRequest("page_size must be an integer from 1 to 50.");
    }
    pageSize = Number(rawSize);
    if (pageSize < 1 || pageSize > PRODUCT_PAGE_MAX) {
      return invalidRequest("page_size must be an integer from 1 to 50.");
    }
  }
  const rawToken = url.searchParams.get("page_token");
  if (rawToken === null || rawToken.length === 0) {
    return { pageSize, pageToken: undefined };
  }
  if (rawToken.length > 2048 || /[\u0000-\u001F]/.test(rawToken)) {
    return invalidRequest("page_token is not valid.");
  }
  return { pageSize, pageToken: rawToken };
}

function nextPageToken(link: string | null): string | undefined {
  if (link === null) {
    return undefined;
  }
  for (const part of link.split(",")) {
    const match = /<([^>]+)>;\s*rel="?next"?/i.exec(part.trim());
    const href = match?.[1];
    if (href === undefined) {
      continue;
    }
    let pageInfo: string | null;
    try {
      pageInfo = new URL(href).searchParams.get("page_info");
    } catch {
      return undefined;
    }
    if (pageInfo !== null && pageInfo.length > 0) {
      return pageInfo;
    }
  }
  return undefined;
}

async function shopifyGet(
  link: ReadyLink,
  pathAndQuery: string,
): Promise<ShopifyResult> {
  const url = `https://${link.shop}/admin/api/${SHOPIFY_ADMIN_API_VERSION}${pathAndQuery}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "X-Shopify-Access-Token": link.accessToken,
      },
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (response.status === 401) {
    return { kind: "unauthorized" };
  }
  if (response.status === 403) {
    return { kind: "forbidden" };
  }
  if (response.status === 429) {
    return { kind: "rate_limited" };
  }
  if (!response.ok) {
    return { kind: "unavailable" };
  }
  try {
    return { kind: "ok", body: await response.json(), link: response.headers.get("link") };
  } catch {
    return { kind: "unavailable" };
  }
}

async function readShop(grant: ActiveGrant, env: Env): Promise<Response> {
  const link = await readyLink(grant, env);
  if (link instanceof Response) {
    return link;
  }
  const result = await shopifyGet(link, "/shop.json");
  switch (result.kind) {
    case "ok": {
      if (!isRecord(result.body) || !isRecord(result.body["shop"])) {
        return upstreamError("unavailable");
      }
      return json({ shop: result.body["shop"] }, 200);
    }
    case "unauthorized":
    case "forbidden":
    case "rate_limited":
    case "unavailable":
      return upstreamError(result.kind);
    default: {
      const unexpected: never = result;
      return unexpected;
    }
  }
}

async function readProducts(url: URL, grant: ActiveGrant, env: Env): Promise<Response> {
  const page = readProductPage(url);
  if (page instanceof Response) {
    return page;
  }
  const link = await readyLink(grant, env);
  if (link instanceof Response) {
    return link;
  }
  const params = new URLSearchParams({ limit: String(page.pageSize) });
  if (page.pageToken !== undefined) {
    params.set("page_info", page.pageToken);
  }
  const result = await shopifyGet(link, `/products.json?${params.toString()}`);
  switch (result.kind) {
    case "ok": {
      if (!isRecord(result.body) || !Array.isArray(result.body["products"])) {
        return upstreamError("unavailable");
      }
      const products = result.body["products"];
      const next = nextPageToken(result.link);
      const body: Record<string, unknown> = { products };
      if (next !== undefined) {
        body["next_page_token"] = next;
      }
      return json(body, 200);
    }
    case "unauthorized":
    case "forbidden":
    case "rate_limited":
    case "unavailable":
      return upstreamError(result.kind);
    default: {
      const unexpected: never = result;
      return unexpected;
    }
  }
}

export async function routeShopifyReads(
  request: Request,
  grant: ActiveGrant,
  env: Env,
): Promise<Response | null> {
  if (request.method !== "GET") {
    return null;
  }
  const url = new URL(request.url);
  if (url.pathname === "/v1/shopify/shop") {
    return readShop(grant, env);
  }
  if (url.pathname === "/v1/shopify/products") {
    return readProducts(url, grant, env);
  }
  return null;
}
