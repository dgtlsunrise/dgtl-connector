import { afterEach, describe, expect, it, vi } from "vitest";
import type { Grant } from "../src/auth";
import worker from "../src/index";
import { openApiDocument } from "../src/openapi";
import { CONSENT_A, SCOPE } from "../src/scopes";
import { MemoryKv, emptyEnv, envWithGrant, envWithKv, issuedToken } from "./support";

const ORIGIN = "https://muse-api.dgtlsunrise.com";
const PREVIEW_PATH = "/v1/writes/preview";
const CONFIRM_PATH = "/v1/writes/confirm";
const PROPERTY_ID = "554200375";
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

function linkedGrant(grant: Grant, sub = "1001", scopes: readonly string[] = CONSENT_A): Grant {
  return {
    ...grant,
    google: {
      sub,
      email: sub === "1001" ? "ada@example.com" : "bea@example.com",
      scopes: [...scopes],
      refresh_token: { alg: "A256GCM", iv: "iv-test", ct: "ct-test" },
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
  const grant = linkedGrant(issued.grant, sub, scopes);
  kv.records.set(issued.hash, { value: JSON.stringify(grant), expiresAtMs: null });
  return { token: issued.token, grant };
}

describe("openapi writes", () => {
  it("documents preview and confirm with 200, 400, 401, and 403", () => {
    const preview = openApiDocument.paths["/v1/writes/preview"].post.responses;
    const confirm = openApiDocument.paths["/v1/writes/confirm"].post.responses;
    expect(Object.keys(preview).sort()).toEqual(["200", "400", "401", "403"]);
    expect(Object.keys(confirm).sort()).toEqual(["200", "400", "401", "403"]);
    expect(preview).not.toHaveProperty("501");
    expect(confirm).not.toHaveProperty("501");
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
      resource_ids: [PROPERTY_ID],
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
      resource_ids: [PROPERTY_ID],
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

    const accepted = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: `confirm create on property ${PROPERTY_ID}` },
        token,
      ),
      envWithKv(kv),
    );
    expect(accepted.status).toBe(200);
    expect(await readJson(accepted)).toMatchObject({
      status: "confirmed",
      preview_id: previewId,
      executed: false,
    });
  });

  it("accepts a matching phrase with executed false, then rejects a second confirm", async () => {
    forbidFetch();
    const kv = new MemoryKv();
    const { token } = await seedLinked(kv);
    const previewId = await preview(kv, token);
    const accepted = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: `confirm create on property ${PROPERTY_ID}` },
        token,
      ),
      envWithKv(kv),
    );
    expect(accepted.status).toBe(200);
    expect(await readJson(accepted)).toEqual({
      status: "confirmed",
      preview_id: previewId,
      executed: false,
      reason: "stub_no_mutate",
      message: "Confirm accepted. Live Google mutate is not enabled on this stub.",
    });
    expect(kv.entries().has(`preview:${previewId}`)).toBe(false);

    const again = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: `confirm create on property ${PROPERTY_ID}` },
        token,
      ),
      envWithKv(kv),
    );
    expect(again.status).toBe(400);
    expect(await readJson(again)).toEqual({ error: "preview_invalid" });
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
        resource_ids: [PROPERTY_ID],
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
        resource_ids: [PROPERTY_ID],
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
