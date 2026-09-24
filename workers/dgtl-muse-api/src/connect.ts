import {
  parseKlaviyoApiKey,
  parseShopDomain,
  parseShopifyAccessToken,
  type ActiveGrant,
  type KlaviyoLink,
  type ShopifyLink,
} from "./auth";
import { json } from "./http";
import { sealRefreshToken } from "./seal";
import { extraKeys, readJsonObject } from "./validate";

type LinkState = "linked" | null;

type ShopifyBody =
  | { readonly kind: "ok"; readonly shop: string; readonly accessToken: string }
  | { readonly kind: "invalid_request" }
  | { readonly kind: "invalid_shop" }
  | { readonly kind: "invalid_shopify_credential" };

type KlaviyoBody =
  | { readonly kind: "ok"; readonly apiKey: string }
  | { readonly kind: "invalid_request" }
  | { readonly kind: "invalid_klaviyo_credential" };

function publicStatus(grant: ActiveGrant): { shopify: LinkState; klaviyo: LinkState } {
  return {
    shopify: grant.shopify === null ? null : "linked",
    klaviyo: grant.klaviyo === null ? null : "linked",
  };
}

function parseShopifyBody(value: Record<string, unknown>): ShopifyBody {
  if (extraKeys(value, ["shop", "access_token"]).length > 0) {
    return { kind: "invalid_request" };
  }
  if (typeof value["shop"] !== "string") {
    return { kind: "invalid_shop" };
  }
  const shop = parseShopDomain(value["shop"]);
  if (shop === null) {
    return { kind: "invalid_shop" };
  }
  if (typeof value["access_token"] !== "string") {
    return { kind: "invalid_shopify_credential" };
  }
  const accessToken = parseShopifyAccessToken(value["access_token"]);
  if (accessToken === null) {
    return { kind: "invalid_shopify_credential" };
  }
  return { kind: "ok", shop, accessToken };
}

function parseKlaviyoBody(value: Record<string, unknown>): KlaviyoBody {
  if (extraKeys(value, ["api_key"]).length > 0) {
    return { kind: "invalid_request" };
  }
  if (typeof value["api_key"] !== "string") {
    return { kind: "invalid_klaviyo_credential" };
  }
  const apiKey = parseKlaviyoApiKey(value["api_key"]);
  if (apiKey === null) {
    return { kind: "invalid_klaviyo_credential" };
  }
  return { kind: "ok", apiKey };
}

async function putGrant(env: Env, key: string, grant: ActiveGrant): Promise<void> {
  await env.MUSE_TOKENS.put(key, JSON.stringify(grant));
}

async function connectShopify(
  request: Request,
  grant: ActiveGrant,
  key: string,
  env: Env,
): Promise<Response> {
  const body = await readJsonObject(request);
  if (body instanceof Response) {
    return body;
  }
  const parsed = parseShopifyBody(body);
  switch (parsed.kind) {
    case "invalid_request":
    case "invalid_shop":
    case "invalid_shopify_credential":
      return json({ error: parsed.kind }, 400);
    case "ok":
      break;
    default: {
      const unexpected: never = parsed;
      return unexpected;
    }
  }
  const sealed = await sealRefreshToken(parsed.accessToken, env.MUSE_TOKEN_ENC_KEY);
  if (sealed === null) {
    return json({ error: "seal_failed" }, 500);
  }
  const shopify: ShopifyLink = {
    shop: parsed.shop,
    access_token: sealed,
    linked_at: new Date().toISOString(),
  };
  await putGrant(env, key, { ...grant, shopify });
  return json({ connected: true, shop: parsed.shop }, 200);
}

async function disconnectShopify(grant: ActiveGrant, key: string, env: Env): Promise<Response> {
  if (grant.shopify !== null) {
    await putGrant(env, key, { ...grant, shopify: null });
  }
  return json({ connected: false }, 200);
}

async function connectKlaviyo(
  request: Request,
  grant: ActiveGrant,
  key: string,
  env: Env,
): Promise<Response> {
  const body = await readJsonObject(request);
  if (body instanceof Response) {
    return body;
  }
  const parsed = parseKlaviyoBody(body);
  switch (parsed.kind) {
    case "invalid_request":
    case "invalid_klaviyo_credential":
      return json({ error: parsed.kind }, 400);
    case "ok":
      break;
    default: {
      const unexpected: never = parsed;
      return unexpected;
    }
  }
  const sealed = await sealRefreshToken(parsed.apiKey, env.MUSE_TOKEN_ENC_KEY);
  if (sealed === null) {
    return json({ error: "seal_failed" }, 500);
  }
  const klaviyo: KlaviyoLink = {
    api_key: sealed,
    account_id: null,
    linked_at: new Date().toISOString(),
  };
  await putGrant(env, key, { ...grant, klaviyo });
  return json({ connected: true }, 200);
}

async function disconnectKlaviyo(grant: ActiveGrant, key: string, env: Env): Promise<Response> {
  if (grant.klaviyo !== null) {
    await putGrant(env, key, { ...grant, klaviyo: null });
  }
  return json({ connected: false }, 200);
}

export async function routeConnect(
  request: Request,
  grant: ActiveGrant,
  key: string,
  env: Env,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname === "/v1/connect" && request.method === "GET") {
    return json(publicStatus(grant), 200);
  }
  if (pathname === "/v1/connect/shopify") {
    if (request.method === "POST") {
      return connectShopify(request, grant, key, env);
    }
    if (request.method === "DELETE") {
      return disconnectShopify(grant, key, env);
    }
    return null;
  }
  if (pathname === "/v1/connect/klaviyo") {
    if (request.method === "POST") {
      return connectKlaviyo(request, grant, key, env);
    }
    if (request.method === "DELETE") {
      return disconnectKlaviyo(grant, key, env);
    }
  }
  return null;
}
