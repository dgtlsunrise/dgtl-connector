import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { openApiDocument } from "../src/openapi";
import { SCOPE } from "../src/scopes";
import { sealRefreshToken } from "../src/seal";
import { TEST_ENC_KEY, envWithGrant, emptyEnv, issuedToken } from "./support";

const ORIGIN = "https://muse-api.dgtlsunrise.com";
const REFRESH = "muse-refresh-plaintext-9f3c2a7b";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const IDENTITY = ["openid", "https://www.googleapis.com/auth/userinfo.email"] as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("expected a JSON object");
  }
  return body as Record<string, unknown>;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function forbidFetch(): void {
  vi.stubGlobal("fetch", () => {
    throw new Error("fetch should not be called");
  });
}

async function linkedEnv(scopes: readonly string[]) {
  const { token, hash, grant } = await issuedToken();
  const sealed = await sealRefreshToken(REFRESH, TEST_ENC_KEY);
  if (sealed === null) {
    throw new Error("seal failed");
  }
  return {
    token,
    env: envWithGrant(hash, {
      ...grant,
      google: {
        sub: "1001",
        email: "ada@example.com",
        scopes: [...scopes],
        refresh_token: sealed,
        linked_at: "2026-09-24T00:00:00.000Z",
      },
    }),
  };
}

function mockGoogle(routes: Record<string, unknown>): { urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    urls.push(url);
    if (url === TOKEN_URL) {
      expect(init?.method).toBe("POST");
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: "test-access-token", token_type: "Bearer" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    const body = routes[url];
    if (body === undefined) {
      throw new Error(`unexpected fetch ${url}`);
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return { urls };
}

function concrete(path: string): string {
  return path
    .replaceAll("{property_id}", "123")
    .replaceAll("{account_id}", "456")
    .replaceAll("{container_id}", "789")
    .replaceAll("{workspace_id}", "12");
}

describe("routing", () => {
  it("requires a bearer token on every /v1 path in the OpenAPI document", async () => {
    const paths = openApiDocument.paths as Record<string, Record<string, unknown>>;
    const methods = ["get", "post", "put", "patch", "delete"] as const;
    let operations = 0;
    for (const [path, item] of Object.entries(paths)) {
      if (!path.startsWith("/v1/")) {
        continue;
      }
      for (const method of methods) {
        if (item[method] === undefined) {
          continue;
        }
        operations += 1;
        const response = await worker.fetch(
          new Request(`${ORIGIN}${concrete(path)}`, { method: method.toUpperCase() }),
          emptyEnv(),
        );
        expect(response.status, `${method} ${path}`).toBe(401);
      }
    }
    expect(operations).toBe(35);
  });
});

describe("scope gate", () => {
  it("refuses each read family when its readonly scope is missing and does not call Google", async () => {
    forbidFetch();
    const { token, env } = await linkedEnv(IDENTITY);
    const cases = [
      { path: "/v1/ga4/accounts", scope: SCOPE.analytics },
      { path: "/v1/gsc/sites", scope: SCOPE.webmasters },
      { path: "/v1/gtm/accounts", scope: SCOPE.tagmanager },
      { path: "/v1/gsc/schema", scope: SCOPE.webmasters },
      { path: "/v1/ga4/properties/123/sessions", scope: SCOPE.analytics },
    ];
    for (const item of cases) {
      const response = await worker.fetch(
        new Request(`${ORIGIN}${item.path}`, { headers: { authorization: `Bearer ${token}` } }),
        env,
      );
      expect(response.status, item.path).toBe(403);
      expect(await readJson(response), item.path).toEqual({
        error: "google_reconnect_required",
        message: `This Google connection is missing ${item.scope}. Reopen /connect and reconnect Google.`,
        missing_scopes: [item.scope],
      });
    }
  });

  it("refuses a read when Google is not linked", async () => {
    forbidFetch();
    const { token, hash, grant } = await issuedToken();
    const response = await worker.fetch(
      new Request(`${ORIGIN}/v1/ga4/properties/123`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      envWithGrant(hash, grant),
    );
    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({ error: "google_not_linked" });
  });

  it("rejects a search-query GA4 dimension before any Google call", async () => {
    forbidFetch();
    const { token, env } = await linkedEnv([SCOPE.analytics]);
    const response = await worker.fetch(
      new Request(`${ORIGIN}/v1/ga4/properties/123/reports`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          date_ranges: [{ start_date: "2026-01-01", end_date: "2026-01-07" }],
          metrics: ["sessions"],
          dimensions: ["query"],
        }),
      }),
      env,
    );
    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({ error: "unsupported_dimension" });
  });

  it("rejects a GA4 report recipe before any Google call", async () => {
    forbidFetch();
    const { token, env } = await linkedEnv([SCOPE.analytics]);
    const response = await worker.fetch(
      new Request(`${ORIGIN}/v1/ga4/properties/123/reports`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          date_ranges: [{ start_date: "2026-01-01", end_date: "2026-01-07" }],
          metrics: ["sessions"],
          recipe: "ads_mta_campaign_ids",
        }),
      }),
      env,
    );
    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({ error: "unsupported_field" });
  });
});

describe("ga4", () => {
  it("reads a property with analytics.readonly and without analytics.edit", async () => {
    const { token, env } = await linkedEnv([SCOPE.analytics]);
    const calls = mockGoogle({
      "https://analyticsadmin.googleapis.com/v1beta/properties/123456789": {
        name: "properties/123456789",
        displayName: "Sunrise",
        timeZone: "America/Los_Angeles",
        currencyCode: "USD",
      },
    });
    const response = await worker.fetch(
      new Request(`${ORIGIN}/v1/ga4/properties/123456789`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      property_id: "123456789",
      resource: {
        name: "properties/123456789",
        displayName: "Sunrise",
        timeZone: "America/Los_Angeles",
        currencyCode: "USD",
      },
    });
    expect(calls.urls).toEqual([
      TOKEN_URL,
      "https://analyticsadmin.googleapis.com/v1beta/properties/123456789",
    ]);
  });

  it("runs a report subset and cites the request", async () => {
    const { token, env } = await linkedEnv([SCOPE.analytics]);
    const calls = mockGoogle({
      "https://analyticsdata.googleapis.com/v1beta/properties/123:runReport": {
        rows: [{ metricValues: [{ value: "3" }] }],
        rowCount: 1,
      },
    });
    const response = await worker.fetch(
      new Request(`${ORIGIN}/v1/ga4/properties/123/reports`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          date_ranges: [{ start_date: "2026-01-01", end_date: "2026-01-07" }],
          metrics: ["sessions"],
          key_event_names: ["purchase"],
          limit: 10,
        }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      property_id: "123",
      rowCount: 1,
      cited: {
        property_id: "properties/123",
        metrics: ["sessions", "keyEvents:purchase"],
        dimensions: [],
        limit: 10,
        offset: 0,
      },
    });
    expect(calls.urls[1]).toBe("https://analyticsdata.googleapis.com/v1beta/properties/123:runReport");
  });
});

describe("gsc", () => {
  it("serves the local schema without calling Google", async () => {
    forbidFetch();
    const { token, env } = await linkedEnv([SCOPE.webmasters]);
    const response = await worker.fetch(
      new Request(`${ORIGIN}/v1/gsc/schema`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
    );
    expect(response.status).toBe(200);
    const body = await readJson(response);
    const dimensions = body["dimensions"];
    expect(Array.isArray(dimensions)).toBe(true);
    if (!Array.isArray(dimensions)) {
      throw new Error("dimensions");
    }
    expect(dimensions.map((item) => (item as { api_name: string }).api_name)).toContain("query");
  });

  it("lists sites from Search Console", async () => {
    const { token, env } = await linkedEnv([SCOPE.webmasters]);
    const calls = mockGoogle({
      "https://searchconsole.googleapis.com/webmasters/v3/sites": {
        siteEntry: [{ siteUrl: "https://example.com/", permissionLevel: "siteOwner" }],
      },
    });
    const response = await worker.fetch(
      new Request(`${ORIGIN}/v1/gsc/sites`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      site_entry: [{ siteUrl: "https://example.com/", permissionLevel: "siteOwner" }],
    });
    expect(calls.urls).toEqual([TOKEN_URL, "https://searchconsole.googleapis.com/webmasters/v3/sites"]);
  });
});

describe("gtm", () => {
  it("lists Tag Manager accounts", async () => {
    const { token, env } = await linkedEnv([SCOPE.tagmanager]);
    const calls = mockGoogle({
      "https://tagmanager.googleapis.com/tagmanager/v2/accounts": {
        account: [{ accountId: "6001", name: "Sunrise" }],
      },
    });
    const response = await worker.fetch(
      new Request(`${ORIGIN}/v1/gtm/accounts`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      account: [{ accountId: "6001", name: "Sunrise" }],
    });
    expect(calls.urls).toEqual([
      TOKEN_URL,
      "https://tagmanager.googleapis.com/tagmanager/v2/accounts",
    ]);
  });

  it("reads the live container version from versions:live", async () => {
    const { token, env } = await linkedEnv([SCOPE.tagmanager]);
    mockGoogle({
      "https://tagmanager.googleapis.com/tagmanager/v2/accounts/6001/containers/7001/versions:live": {
        containerVersion: { containerVersionId: "9" },
      },
    });
    const response = await worker.fetch(
      new Request(`${ORIGIN}/v1/gtm/accounts/6001/containers/7001/versions/live`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      source: "live",
      containerVersion: { containerVersionId: "9" },
      cited: { account_id: "6001", container_id: "7001" },
    });
  });
});
