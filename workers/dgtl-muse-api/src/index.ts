import { authenticate, type ActiveGrant } from "./auth";
import { routeConnect } from "./connect";
import { CORS_HEADERS, json } from "./http";
import { connectPage, finishGoogleOAuth, startGoogleOAuth } from "./oauth";
import { openApiDocument } from "./openapi";
import { routeReads } from "./reads";
import { routeKlaviyoReads } from "./klaviyo-reads";
import { routeShopifyReads } from "./shopify-reads";
import { readSessions } from "./sessions";
import { confirmWrite, previewWrite } from "./writes";

function unauthorized(request: Request): Response {
  const { pathname } = new URL(request.url);
  return json(
    {
      error: "unauthorized",
      message: "Unauthorized.",
      path: pathname,
      method: request.method,
    },
    401,
    { "WWW-Authenticate": "Bearer" },
  );
}

function notImplemented(request: Request): Response {
  const { pathname } = new URL(request.url);
  return json(
    {
      error: "not_implemented",
      message: "This operation is not implemented.",
      path: pathname,
      method: request.method,
    },
    501,
  );
}

async function handleV1(
  request: Request,
  grant: ActiveGrant,
  key: string,
  env: Env,
): Promise<Response> {
  const connect = await routeConnect(request, grant, key, env);
  if (connect !== null) {
    return connect;
  }
  const { pathname } = new URL(request.url);
  const sessions = /^\/v1\/ga4\/properties\/([^/]+)\/sessions$/.exec(pathname);
  if (request.method === "GET" && sessions !== null) {
    const propertyId = sessions[1];
    if (propertyId === undefined) {
      return notImplemented(request);
    }
    return readSessions(request, grant, env, propertyId);
  }
  const shopify = await routeShopifyReads(request, grant, env);
  if (shopify !== null) {
    return shopify;
  }
  const klaviyo = await routeKlaviyoReads(request, grant, env);
  if (klaviyo !== null) {
    return klaviyo;
  }
  const read = await routeReads(request, grant, env);
  if (read !== null) {
    return read;
  }
  if (request.method === "POST" && pathname === "/v1/writes/preview") {
    return previewWrite(request, grant, env);
  }
  if (request.method === "POST" && pathname === "/v1/writes/confirm") {
    return confirmWrite(request, grant, env);
  }
  return notImplemented(request);
}

function isV1(pathname: string): boolean {
  return pathname === "/v1" || pathname.startsWith("/v1/");
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    if (request.method === "GET" && pathname === "/healthz") {
      return json({ ok: true }, 200);
    }

    if (request.method === "GET" && pathname === "/openapi.json") {
      return json(openApiDocument, 200);
    }

    if (request.method === "GET" && pathname === "/connect") {
      return connectPage();
    }

    if (request.method === "GET" && pathname === "/oauth/google/start") {
      return startGoogleOAuth(env);
    }

    if (request.method === "GET" && pathname === "/oauth/google/callback") {
      return finishGoogleOAuth(request, env);
    }

    if (isV1(pathname)) {
      const result = await authenticate(
        request.headers.get("authorization"),
        env.MUSE_TOKENS,
      );
      switch (result.kind) {
        case "grant":
          return handleV1(request, result.grant, result.key, env);
        case "unauthorized":
          return unauthorized(request);
        default: {
          const unexpected: never = result;
          return unexpected;
        }
      }
    }

    return json(
      {
        error: "not_found",
        message: "No route for this path.",
        path: pathname,
        method: request.method,
      },
      404,
    );
  },
} satisfies ExportedHandler<Env>;

export default worker;
