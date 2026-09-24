import { openApiDocument } from "./openapi";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
};

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function isV1(pathname: string): boolean {
  return pathname === "/v1" || pathname.startsWith("/v1/");
}

const worker = {
  async fetch(request: Request): Promise<Response> {
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

    if (isV1(pathname)) {
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
} satisfies ExportedHandler;

export default worker;
