import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPI } from "openapi-types";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { openApiDocument } from "../src/openapi";

function isOpenApiDocument(value: unknown): value is OpenAPI.Document {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const doc = value as { openapi?: unknown; info?: { title?: unknown } };
  return doc.openapi === "3.1.0" && typeof doc.info?.title === "string";
}

const ORIGIN = "https://muse-api.dgtlsunrise.com";

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("expected a JSON object");
  }
  return body as Record<string, unknown>;
}

function request(pathname: string, method = "GET"): Request {
  return new Request(`${ORIGIN}${pathname}`, { method });
}

describe("openapi", () => {
  it("serves a document that passes the OpenAPI validator", async () => {
    const response = await worker.fetch(request("/openapi.json"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");

    const body = await readJson(response);
    expect(body).toEqual(openApiDocument);
    expect(body).toMatchObject({
      openapi: "3.1.0",
      info: {
        title: "DGTL Sunrise Connector API",
        termsOfService: "https://www.dgtlsunrise.com/terms",
        contact: { email: "support@dgtlsunrise.com" },
      },
      externalDocs: { url: "https://www.dgtlsunrise.com/privacy" },
      servers: [{ url: "https://muse-api.dgtlsunrise.com" }],
    });

    const serialized = JSON.stringify(body);
    expect(serialized).toContain("https://www.dgtlsunrise.com/privacy");
    expect(serialized).toContain("https://www.dgtlsunrise.com/terms");
    const schemes = (body["components"] as { securitySchemes: Record<string, unknown> })
      .securitySchemes;
    expect(schemes["freeCredential"]).toEqual({
      type: "http",
      scheme: "bearer",
      description:
        "Stub for a Muse-storable Free credential. No credential is included in this document.",
    });

    const paths = body["paths"] as Record<string, unknown>;
    expect(paths["/v1/ga4/properties/{property_id}/sessions"]).toBeDefined();
    expect(paths["/v1/ga4/properties/{property_id}"]).toBeDefined();
    expect(paths["/v1/writes/preview"]).toBeDefined();
    expect(paths["/v1/writes/confirm"]).toBeDefined();

    if (!isOpenApiDocument(body)) {
      throw new Error("served document is not OpenAPI 3.1");
    }
    const validated = await SwaggerParser.validate(structuredClone(body));
    expect(validated.info.title).toBe("DGTL Sunrise Connector API");
  });
});

describe("routes", () => {
  it("returns 200 JSON from /healthz", async () => {
    const response = await worker.fetch(request("/healthz"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await readJson(response)).toEqual({ ok: true });
  });

  it("returns 501 JSON for Free read and confirm-gated write stubs", async () => {
    const cases = [
      request("/v1/ga4/properties/123456789/sessions?start_date=28daysAgo&end_date=yesterday"),
      request("/v1/ga4/properties/123456789"),
      request("/v1/writes/preview", "POST"),
      request("/v1/writes/confirm", "POST"),
    ];

    for (const req of cases) {
      const response = await worker.fetch(req);
      expect(response.status).toBe(501);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      const body = await readJson(response);
      expect(body["error"]).toBe("not_implemented");
      expect(body["path"]).toBe(new URL(req.url).pathname);
      expect(body["method"]).toBe(req.method);
    }
  });

  it("returns 404 JSON for unknown paths", async () => {
    const response = await worker.fetch(request("/missing"));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await readJson(response)).toMatchObject({
      error: "not_found",
      path: "/missing",
    });
  });

  it("answers CORS preflight", async () => {
    const response = await worker.fetch(request("/v1/writes/preview", "OPTIONS"));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });
});
