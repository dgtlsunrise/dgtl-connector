import { describe, expect, it } from "vitest";
import { createMint, formatMint } from "../scripts/mint-token.mjs";
import worker from "../src/index";
import { envWithGrant, emptyEnv, issuedToken } from "./support";

const ORIGIN = "https://muse-api.dgtlsunrise.com";
const SESSIONS = "/v1/ga4/properties/123/sessions";

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("expected a JSON object");
  }
  return body as Record<string, unknown>;
}

function request(pathname: string, token?: string): Request {
  const headers = new Headers();
  if (token !== undefined) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return new Request(`${ORIGIN}${pathname}`, { method: "GET", headers });
}

const UNAUTHORIZED = {
  error: "unauthorized",
  message: "Unauthorized.",
  path: SESSIONS,
  method: "GET",
};

describe("auth boundary", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const response = await worker.fetch(request(SESSIONS), emptyEnv());
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await readJson(response)).toEqual(UNAUTHORIZED);
  });

  it("returns 401 for a bad token", async () => {
    const response = await worker.fetch(request(SESSIONS, "bad"), emptyEnv());
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await readJson(response)).toEqual(UNAUTHORIZED);
  });

  it("returns 401 for an unknown token", async () => {
    const { token } = await issuedToken();
    const response = await worker.fetch(request(SESSIONS, token), emptyEnv());
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await readJson(response)).toEqual(UNAUTHORIZED);
  });

  it("returns 401 for a revoked token", async () => {
    const { token, hash, grant } = await issuedToken();
    const response = await worker.fetch(
      request(SESSIONS, token),
      envWithGrant(hash, { ...grant, status: "revoked" }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await readJson(response)).toEqual(UNAUTHORIZED);
  });

  it("returns 501 for a valid token on /v1/ga4/properties/123/sessions", async () => {
    const { token, hash, grant } = await issuedToken();
    const response = await worker.fetch(
      request(SESSIONS, token),
      envWithGrant(hash, grant),
    );
    expect(response.status).toBe(501);
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(await readJson(response)).toEqual({
      error: "not_implemented",
      message: "This operation is not implemented.",
      path: SESSIONS,
      method: "GET",
    });
  });

  it("returns 200 from /healthz without auth", async () => {
    const response = await worker.fetch(request("/healthz"), emptyEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(await readJson(response)).toEqual({ ok: true });
  });
});

describe("mint script", () => {
  it("prints the token once and the remote KV put command", async () => {
    const minted = createMint(new Date("2026-09-24T00:00:00.000Z"));
    const stdout = formatMint(minted);
    const lines = stdout.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("");
    expect(lines[0]).toBe(minted.token);
    expect(stdout.indexOf(minted.token)).toBe(0);
    expect(stdout.indexOf(minted.token, 1)).toBe(-1);
    expect(lines[1]).toBe(
      `wrangler kv key put --binding MUSE_TOKENS ${minted.hash} '${JSON.stringify(minted.grant)}' --remote`,
    );
    expect(minted.grant.v).toBe(1);
    expect(minted.grant.created_at).toBe("2026-09-24T00:00:00.000Z");
    expect(minted.grant.status).toBe("active");
    expect(minted.grant.google).toBeNull();
    expect(minted.grant.grant_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
