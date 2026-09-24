import { afterEach, describe, expect, it, vi } from "vitest";
import type { Grant } from "../src/auth";
import worker from "../src/index";
import { openApiDocument } from "../src/openapi";
import { sealRefreshToken } from "../src/seal";
import { CONSENT_A, SCOPE } from "../src/scopes";
import { WRITE_KIND_NAMES } from "../src/writes";
import { MemoryKv, TEST_ENC_KEY, emptyEnv, envWithGrant, envWithKv, issuedToken } from "./support";

const ORIGIN = "https://muse-api.dgtlsunrise.com";
const PREVIEW_PATH = "/v1/writes/preview";
const CONFIRM_PATH = "/v1/writes/confirm";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ACCESS = "test-access-token";
const REFRESH = "muse-refresh-plaintext-9f3c2a7b";
const PROPERTY_ID = "554200375";
const RESOURCE_ID = `properties/${PROPERTY_ID}`;
const GA4_URL = `https://analyticsadmin.googleapis.com/v1beta/properties/${PROPERTY_ID}/customDimensions`;
const GA4_NAME = `${RESOURCE_ID}/customDimensions/customEvent:muse_stub_dim`;
const PREVIEW_BODY = {
  kind: "ga4_custom_dimension_create",
  property_id: PROPERTY_ID,
  dimension: {
    parameter_name: "muse_stub_dim",
    display_name: "Muse stub",
    scope: "EVENT",
  },
};
const SUMMARY = `Would create custom dimension muse_stub_dim on GA4 property ${PROPERTY_ID}. Not executed.`;
const ACCOUNT_ID = "600100200";
const CONTAINER_ID = "700300400";
const WORKSPACE_ID = "3";
const PUBLIC_ID = "GTM-MUSEF4";
const GTM_CONTAINER_URL = `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${ACCOUNT_ID}/containers/${CONTAINER_ID}`;
const GTM_VARIABLE_URL = `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${ACCOUNT_ID}/containers/${CONTAINER_ID}/workspaces/${WORKSPACE_ID}/variables`;
const GTM_PATH = `accounts/${ACCOUNT_ID}/containers/${CONTAINER_ID}/workspaces/${WORKSPACE_ID}/variables/15`;
const GTM_BODY = {
  kind: "gtm_variable_create",
  account_id: ACCOUNT_ID,
  container_id: CONTAINER_ID,
  workspace_id: WORKSPACE_ID,
  variable: { name: "Muse constant", type: "c" },
};
const GTM_SUMMARY = `Would create GTM variable Muse constant (c) in workspace ${WORKSPACE_ID} on container ${PUBLIC_ID}. Not executed.`;
const LEGACY_READONLY_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/analytics.readonly",
] as const;
const RECONNECT = {
  error: "google_reconnect_required",
  message: `This Google connection is missing ${SCOPE.analyticsEdit}. Reopen /connect and reconnect Google.`,
  missing_scopes: [SCOPE.analyticsEdit],
};

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

function forbidFetch(): void {
  vi.stubGlobal("fetch", () => {
    throw new Error("fetch should not be called");
  });
}

type SeenCall = {
  url: string;
  method: string;
  body: string | undefined;
  authorization: string | undefined;
};

function headerValue(headers: HeadersInit | undefined, name: string): string | undefined {
  if (headers === undefined) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name);
    return found?.[1];
  }
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()];
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

function mockGoogle(routes: Record<string, { status?: number; body: unknown }>): SeenCall[] {
  const seen: SeenCall[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    seen.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
      authorization: headerValue(init?.headers, "authorization"),
    });
    if (url === TOKEN_URL) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: ACCESS, token_type: "Bearer" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    const route = routes[url];
    if (route === undefined) {
      return Promise.reject(new Error(`unexpected fetch ${init?.method ?? "GET"} ${url}`));
    }
    return Promise.resolve(
      new Response(JSON.stringify(route.body), {
        status: route.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return seen;
}

function ga4Created(): Record<string, { status?: number; body: unknown }> {
  return {
    [GA4_URL]: {
      body: {
        name: GA4_NAME,
        parameterName: "muse_stub_dim",
        displayName: "Muse stub",
        scope: "EVENT",
      },
    },
  };
}

function post(pathname: string, body: unknown, token?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== undefined) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return new Request(`${ORIGIN}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function linkedGrant(
  grant: Grant,
  sub = "1001",
  scopes: readonly string[] = CONSENT_A,
): Promise<Grant> {
  const refresh = await sealRefreshToken(REFRESH, TEST_ENC_KEY);
  if (refresh === null) {
    throw new Error("seal failed");
  }
  return {
    ...grant,
    google: {
      sub,
      email: sub === "1001" ? "ada@example.com" : "bea@example.com",
      scopes: [...scopes],
      refresh_token: refresh,
      linked_at: "2026-09-24T00:00:00.000Z",
    },
  };
}

async function seedLinked(
  kv: MemoryKv,
  sub?: string,
  scopes?: readonly string[],
): Promise<{ token: string; grant: Grant }> {
  const issued = await issuedToken();
  const grant = await linkedGrant(issued.grant, sub, scopes);
  kv.records.set(issued.hash, { value: JSON.stringify(grant), expiresAtMs: null });
  return { token: issued.token, grant };
}

describe("openapi writes", () => {
  it("documents preview and confirm with 200, 400, 401, and 403", () => {
    const preview = openApiDocument.paths["/v1/writes/preview"].post.responses;
    const confirm = openApiDocument.paths["/v1/writes/confirm"].post.responses;
    expect(Object.keys(preview).sort()).toEqual(["200", "400", "401", "403", "404", "500", "502"]);
    expect(Object.keys(confirm).sort()).toEqual(["200", "400", "401", "403", "404", "500", "502"]);
    expect(preview).not.toHaveProperty("501");
    expect(confirm).not.toHaveProperty("501");
    expect(openApiDocument.components.schemas.WriteKind.enum).toEqual([...WRITE_KIND_NAMES]);
    expect(JSON.stringify(openApiDocument)).not.toContain("stub_no_mutate");
  });
});

describe("write preview", () => {
  it("returns 401 when the preview has no bearer token", async () => {
    const response = await worker.fetch(post(PREVIEW_PATH, PREVIEW_BODY), emptyEnv());
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await readJson(response)).toEqual({
      error: "unauthorized",
      message: "Unauthorized.",
      path: PREVIEW_PATH,
      method: "POST",
    });
  });

  it("returns 401 when confirm has no bearer token", async () => {
    const response = await worker.fetch(
      post(CONFIRM_PATH, { preview_id: "a".repeat(43), confirm_phrase: "confirm" }),
      emptyEnv(),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await readJson(response)).toEqual({
      error: "unauthorized",
      message: "Unauthorized.",
      path: CONFIRM_PATH,
      method: "POST",
    });
  });

  it("returns 403 google_not_linked when the grant has no Google link", async () => {
    forbidFetch();
    const { token, hash, grant } = await issuedToken();
    const response = await worker.fetch(
      post(PREVIEW_PATH, PREVIEW_BODY, token),
      envWithGrant(hash, grant),
    );
    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({ error: "google_not_linked" });
  });

  it("stores a one-shot preview and does not call Google", async () => {
    forbidFetch();
    const kv = new MemoryKv();
    const { token, grant } = await seedLinked(kv);
    const before = Date.now();
    const response = await worker.fetch(post(PREVIEW_PATH, PREVIEW_BODY, token), envWithKv(kv));
    const after = Date.now();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await readJson(response);
    expect(body).toMatchObject({
      status: "preview",
      confirm_required: true,
      kind: "ga4_custom_dimension_create",
      resource_ids: [RESOURCE_ID],
      summary: SUMMARY,
    });
    expect(body["preview_id"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const previewId = body["preview_id"];
    if (typeof previewId !== "string") {
      throw new Error("missing preview_id");
    }
    const expiresAt = body["expires_at"];
    expect(typeof expiresAt).toBe("string");
    if (typeof expiresAt !== "string") {
      throw new Error("missing expires_at");
    }
    const expiresMs = Date.parse(expiresAt);
    expect(expiresMs).toBeGreaterThanOrEqual(before + 600_000);
    expect(expiresMs).toBeLessThanOrEqual(after + 600_000);

    expect(kv.puts).toEqual([{ key: `preview:${previewId}`, expirationTtl: 600 }]);
    const storedRaw = kv.entries().get(`preview:${previewId}`);
    expect(storedRaw).toEqual(expect.any(String));
    if (storedRaw === undefined) {
      throw new Error("missing preview record");
    }
    expect(storedRaw).not.toContain(token);
    expect(JSON.parse(storedRaw)).toEqual({
      grant_id: grant.grant_id,
      kind: "ga4_custom_dimension_create",
      property_id: PROPERTY_ID,
      dimension: PREVIEW_BODY.dimension,
      resource_ids: [RESOURCE_ID],
      summary: SUMMARY,
      expires_at: expiresAt,
    });
  });

  it("returns 400 unknown_kind for any other write kind", async () => {
    forbidFetch();
    const kv = new MemoryKv();
    const { token } = await seedLinked(kv);
    const response = await worker.fetch(
      post(PREVIEW_PATH, { ...PREVIEW_BODY, kind: "gtm.tags.create" }, token),
      envWithKv(kv),
    );
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: "unknown_kind" });
    expect(kv.puts).toEqual([]);
  });

  it("rejects a readonly-only grant and does not store a preview", async () => {
    forbidFetch();
    const kv = new MemoryKv();
    const { token } = await seedLinked(kv, "1001", LEGACY_READONLY_SCOPES);
    const response = await worker.fetch(post(PREVIEW_PATH, PREVIEW_BODY, token), envWithKv(kv));
    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual(RECONNECT);
    expect(kv.puts).toEqual([]);
    expect([...kv.entries().keys()].some((key) => key.startsWith("preview:"))).toBe(false);
  });
});

describe("write confirm", () => {
  async function preview(kv: MemoryKv, token: string): Promise<string> {
    const response = await worker.fetch(post(PREVIEW_PATH, PREVIEW_BODY, token), envWithKv(kv));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    const previewId = body["preview_id"];
    if (typeof previewId !== "string") {
      throw new Error("missing preview_id");
    }
    return previewId;
  }

  it("returns 400 confirm_refused and leaves the preview usable", async () => {
    forbidFetch();
    const kv = new MemoryKv();
    const { token } = await seedLinked(kv);
    const previewId = await preview(kv, token);
    const refused = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: "confirm create on property" },
        token,
      ),
      envWithKv(kv),
    );
    expect(refused.status).toBe(400);
    expect(await readJson(refused)).toEqual({
      error: "confirm_refused",
      confirm_required: true,
    });
    expect(kv.entries().has(`preview:${previewId}`)).toBe(true);

    const digitsOnly = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: `confirm create on property ${PROPERTY_ID}` },
        token,
      ),
      envWithKv(kv),
    );
    expect(digitsOnly.status).toBe(400);
    expect(await readJson(digitsOnly)).toEqual({
      error: "confirm_refused",
      confirm_required: true,
    });
    expect(kv.entries().has(`preview:${previewId}`)).toBe(true);

    const seen = mockGoogle(ga4Created());
    const accepted = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: `confirm create on ${RESOURCE_ID}` },
        token,
      ),
      envWithKv(kv),
    );
    expect(accepted.status).toBe(200);
    expect(await readJson(accepted)).toEqual({
      status: "confirmed",
      preview_id: previewId,
      kind: "ga4_custom_dimension_create",
      executed: true,
      resource_name: GA4_NAME,
    });
    expect(seen.filter((call) => call.url === GA4_URL)).toHaveLength(1);
    expect(kv.entries().has(`preview:${previewId}`)).toBe(false);
  });

  it("posts the custom dimension and rejects a second confirm", async () => {
    forbidFetch();
    const kv = new MemoryKv();
    const { token } = await seedLinked(kv);
    const previewId = await preview(kv, token);
    const seen = mockGoogle(ga4Created());
    const accepted = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: `confirm create on ${RESOURCE_ID}` },
        token,
      ),
      envWithKv(kv),
    );
    expect(accepted.status).toBe(200);
    expect(await readJson(accepted)).toEqual({
      status: "confirmed",
      preview_id: previewId,
      kind: "ga4_custom_dimension_create",
      executed: true,
      resource_name: GA4_NAME,
    });
    const mutate = seen.filter((call) => call.url === GA4_URL);
    expect(mutate).toEqual([
      {
        url: GA4_URL,
        method: "POST",
        authorization: `Bearer ${ACCESS}`,
        body: JSON.stringify({
          parameterName: "muse_stub_dim",
          displayName: "Muse stub",
          scope: "EVENT",
        }),
      },
    ]);
    expect(seen.some((call) => call.url === TOKEN_URL && call.method === "POST")).toBe(true);
    expect(kv.entries().has(`preview:${previewId}`)).toBe(false);

    const again = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: `confirm create on ${RESOURCE_ID}` },
        token,
      ),
      envWithKv(kv),
    );
    expect(again.status).toBe(400);
    expect(await readJson(again)).toEqual({ error: "preview_invalid" });
    expect(seen.filter((call) => call.url === GA4_URL)).toHaveLength(1);
  });

  it("leaves the preview in place when Google refuses the mutate", async () => {
    forbidFetch();
    const kv = new MemoryKv();
    const { token } = await seedLinked(kv);
    const previewId = await preview(kv, token);
    mockGoogle({ [GA4_URL]: { status: 403, body: { error: { code: 403 } } } });
    const response = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: `confirm create on ${RESOURCE_ID}` },
        token,
      ),
      envWithKv(kv),
    );
    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({ error: "ga4_forbidden" });
    expect(kv.entries().has(`preview:${previewId}`)).toBe(true);
  });

  it("leaves the preview in place when Google omits the resource name", async () => {
    forbidFetch();
    const kv = new MemoryKv();
    const { token } = await seedLinked(kv);
    const previewId = await preview(kv, token);
    mockGoogle({ [GA4_URL]: { body: {} } });
    const response = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: `confirm create on ${RESOURCE_ID}` },
        token,
      ),
      envWithKv(kv),
    );
    expect(response.status).toBe(502);
    expect(await readJson(response)).toEqual({ error: "ga4_unavailable" });
    expect(kv.entries().has(`preview:${previewId}`)).toBe(true);
  });

  it("returns 403 when another grant confirms the preview", async () => {
    forbidFetch();
    const kv = new MemoryKv();
    const owner = await seedLinked(kv, "1001");
    const other = await seedLinked(kv, "1002");
    const previewId = await preview(kv, owner.token);
    const response = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: `confirm create on property ${PROPERTY_ID}` },
        other.token,
      ),
      envWithKv(kv),
    );
    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({ error: "preview_forbidden" });
    expect(kv.entries().has(`preview:${previewId}`)).toBe(true);
    expect(owner.grant.grant_id).not.toBe(other.grant.grant_id);
  });

  it("returns 400 preview_invalid when the stored preview is past expires_at", async () => {
    forbidFetch();
    const kv = new MemoryKv();
    const { token, grant } = await seedLinked(kv);
    const previewId = "c".repeat(43);
    kv.records.set(`preview:${previewId}`, {
      value: JSON.stringify({
        grant_id: grant.grant_id,
        kind: "ga4_custom_dimension_create",
        property_id: PROPERTY_ID,
        dimension: PREVIEW_BODY.dimension,
        resource_ids: [RESOURCE_ID],
        summary: SUMMARY,
        expires_at: "2020-01-01T00:00:00.000Z",
      }),
      expiresAtMs: null,
    });
    const response = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: `confirm create on property ${PROPERTY_ID}` },
        token,
      ),
      envWithKv(kv),
    );
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: "preview_invalid" });
    expect(kv.entries().has(`preview:${previewId}`)).toBe(true);
  });

  it("returns 400 preview_invalid for an unknown preview", async () => {
    forbidFetch();
    const kv = new MemoryKv();
    const { token } = await seedLinked(kv);
    const response = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: "b".repeat(43), confirm_phrase: `confirm ${PROPERTY_ID}` },
        token,
      ),
      envWithKv(kv),
    );
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: "preview_invalid" });
  });

  it("rejects a readonly-only grant and does not delete the preview", async () => {
    forbidFetch();
    const kv = new MemoryKv();
    const { token, grant } = await seedLinked(kv, "1001", LEGACY_READONLY_SCOPES);
    const previewId = "d".repeat(43);
    kv.records.set(`preview:${previewId}`, {
      value: JSON.stringify({
        grant_id: grant.grant_id,
        kind: "ga4_custom_dimension_create",
        property_id: PROPERTY_ID,
        dimension: PREVIEW_BODY.dimension,
        resource_ids: [RESOURCE_ID],
        summary: SUMMARY,
        expires_at: "2099-01-01T00:00:00.000Z",
      }),
      expiresAtMs: null,
    });
    const response = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: `confirm create on property ${PROPERTY_ID}` },
        token,
      ),
      envWithKv(kv),
    );
    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual(RECONNECT);
    expect(kv.entries().has(`preview:${previewId}`)).toBe(true);
  });
});

describe("gtm variable create", () => {
  const GTM_RECONNECT = {
    error: "google_reconnect_required",
    message: `This Google connection is missing ${SCOPE.tagmanagerEditContainers}. Reopen /connect and reconnect Google.`,
    missing_scopes: [SCOPE.tagmanagerEditContainers],
  };

  it("refuses a grant missing tagmanager.edit.containers and does not call Google", async () => {
    forbidFetch();
    const kv = new MemoryKv();
    const scopes = CONSENT_A.filter((scope) => scope !== SCOPE.tagmanagerEditContainers);
    const { token } = await seedLinked(kv, "1001", scopes);
    const response = await worker.fetch(post(PREVIEW_PATH, GTM_BODY, token), envWithKv(kv));
    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual(GTM_RECONNECT);
    expect(kv.puts).toEqual([]);
  });

  it("resolves publicId on preview and posts the variable on confirm", async () => {
    const kv = new MemoryKv();
    const { token } = await seedLinked(kv);
    const previewSeen = mockGoogle({
      [GTM_CONTAINER_URL]: { body: { publicId: PUBLIC_ID, containerId: CONTAINER_ID } },
    });
    const previewResponse = await worker.fetch(post(PREVIEW_PATH, GTM_BODY, token), envWithKv(kv));
    expect(previewResponse.status).toBe(200);
    const previewBody = await readJson(previewResponse);
    expect(previewBody).toMatchObject({
      status: "preview",
      confirm_required: true,
      kind: "gtm_variable_create",
      resource_ids: [PUBLIC_ID],
      summary: GTM_SUMMARY,
    });
    const previewId = previewBody["preview_id"];
    if (typeof previewId !== "string") {
      throw new Error("missing preview_id");
    }
    expect(previewSeen.some((call) => call.url === GTM_VARIABLE_URL)).toBe(false);
    expect(previewSeen.filter((call) => call.url === GTM_CONTAINER_URL)).toEqual([
      {
        url: GTM_CONTAINER_URL,
        method: "GET",
        authorization: `Bearer ${ACCESS}`,
        body: undefined,
      },
    ]);

    forbidFetch();
    const refused = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: `create variable on ${CONTAINER_ID}` },
        token,
      ),
      envWithKv(kv),
    );
    expect(refused.status).toBe(400);
    expect(await readJson(refused)).toEqual({ error: "confirm_refused", confirm_required: true });
    expect(kv.entries().has(`preview:${previewId}`)).toBe(true);

    const seen = mockGoogle({
      [GTM_VARIABLE_URL]: {
        body: { path: GTM_PATH, name: "Muse constant", type: "c", variableId: "15" },
      },
    });
    const accepted = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: `create variable on ${PUBLIC_ID}` },
        token,
      ),
      envWithKv(kv),
    );
    expect(accepted.status).toBe(200);
    expect(await readJson(accepted)).toEqual({
      status: "confirmed",
      preview_id: previewId,
      kind: "gtm_variable_create",
      executed: true,
      resource_name: GTM_PATH,
    });
    expect(seen.filter((call) => call.url === GTM_VARIABLE_URL)).toEqual([
      {
        url: GTM_VARIABLE_URL,
        method: "POST",
        authorization: `Bearer ${ACCESS}`,
        body: JSON.stringify({ name: "Muse constant", type: "c" }),
      },
    ]);
    expect(kv.entries().has(`preview:${previewId}`)).toBe(false);
  });

  it("does not store a preview when the container has no publicId", async () => {
    const kv = new MemoryKv();
    const { token } = await seedLinked(kv);
    mockGoogle({ [GTM_CONTAINER_URL]: { body: { containerId: CONTAINER_ID } } });
    const response = await worker.fetch(post(PREVIEW_PATH, GTM_BODY, token), envWithKv(kv));
    expect(response.status).toBe(502);
    expect(await readJson(response)).toEqual({ error: "gtm_unavailable" });
    expect(kv.puts).toEqual([]);
  });
});
