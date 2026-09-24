import { afterEach, describe, expect, it, vi } from "vitest";
import { parseToken, tokenKey, type SealedRefreshToken } from "../src/auth";
import { bytesToBase64Url } from "../src/bytes";
import worker from "../src/index";
import { openRefreshToken, sealRefreshToken } from "../src/seal";
import { CONSENT_A, FREE_GOOGLE_NEVER } from "../src/scopes";
import { MemoryKv, TEST_ENC_KEY, emptyEnv, envWithGrant, envWithKv, issuedToken } from "./support";

const ORIGIN = "https://muse-api.dgtlsunrise.com";
const REFRESH = "muse-refresh-plaintext-9f3c2a7b";
const FREE_GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/tagmanager.readonly",
  "https://www.googleapis.com/auth/analytics.edit",
  "https://www.googleapis.com/auth/tagmanager.edit.containers",
  "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
  "https://www.googleapis.com/auth/tagmanager.publish",
  "https://www.googleapis.com/auth/webmasters",
] as const;
const LEGACY_READONLY_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/analytics.readonly",
] as const;

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

function formBody(init: RequestInit | undefined): URLSearchParams {
  const body = init?.body;
  if (body instanceof URLSearchParams) {
    return body;
  }
  if (typeof body === "string") {
    return new URLSearchParams(body);
  }
  throw new Error("expected a form body");
}

function jwt(claims: unknown): string {
  const part = (value: unknown) => bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  return `${part({ alg: "none", typ: "JWT" })}.${part(claims)}.sig`;
}

function forbidFetch(): void {
  vi.stubGlobal("fetch", () => {
    throw new Error("fetch should not be called");
  });
}

async function startOAuth(kv: MemoryKv): Promise<URL> {
  const response = await worker.fetch(
    new Request(`${ORIGIN}/oauth/google/start`),
    envWithKv(kv),
  );
  expect(response.status).toBe(302);
  const location = response.headers.get("location");
  expect(location).toEqual(expect.any(String));
  if (location === null) {
    throw new Error("missing location");
  }
  return new URL(location);
}

describe("connect", () => {
  it("renders a page whose button starts Google sign-in", async () => {
    const response = await worker.fetch(new Request(`${ORIGIN}/connect`), emptyEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    expect(html).toContain("<h1>Connect Google to Muse</h1>");
    expect(html).toContain("Search Console");
    expect(html).toContain("Tag Manager");
    expect(html).toContain("does not ask for Google Ads");
    expect(html).toContain('action="/oauth/google/start"');
    expect(html).toContain(">Connect Google</button>");
    expect(html.toLowerCase()).not.toContain("coming soon");
    expect(html.toLowerCase()).not.toMatch(/\bbeta\b/);
  });
});

describe("google oauth callback", () => {
  it("stores an encrypted grant and shows the bearer token once", async () => {
    const kv = new MemoryKv();
    const authorize = await startOAuth(kv);
    expect(`${authorize.origin}${authorize.pathname}`).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(authorize.searchParams.get("client_id")).toBe("test-web-client-id");
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      "https://muse-api.dgtlsunrise.com/oauth/google/callback",
    );
    expect(authorize.searchParams.get("response_type")).toBe("code");
    expect([...CONSENT_A]).toEqual([...FREE_GOOGLE_SCOPES]);
    expect(authorize.searchParams.get("scope")).toBe(FREE_GOOGLE_SCOPES.join(" "));
    const requested = authorize.searchParams.get("scope")?.split(" ") ?? [];
    for (const banned of FREE_GOOGLE_NEVER) {
      expect(requested).not.toContain(banned);
    }
    expect(requested).not.toContain("https://www.googleapis.com/auth/analytics");
    expect(authorize.searchParams.get("access_type")).toBe("offline");
    expect(authorize.searchParams.get("prompt")).toBe("consent");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    const state = authorize.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (state === null) {
      throw new Error("missing state");
    }
    const pendingRaw = kv.entries().get(`state:${state}`);
    expect(pendingRaw).toEqual(expect.any(String));
    if (pendingRaw === undefined) {
      throw new Error("missing state record");
    }
    const pending = JSON.parse(pendingRaw) as { code_verifier: string; created_at: string };
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(pending.code_verifier),
    );
    expect(authorize.searchParams.get("code_challenge")).toBe(
      bytesToBase64Url(new Uint8Array(digest)),
    );
    expect(kv.puts[0]).toEqual({ key: `state:${state}`, expirationTtl: 600 });

    const tokenCalls: URLSearchParams[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      expect(requestUrl(input)).toBe("https://oauth2.googleapis.com/token");
      tokenCalls.push(formBody(init));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "access-should-not-be-stored",
            refresh_token: REFRESH,
            id_token: jwt({ sub: "1001", email: "ada@example.com" }),
            scope: FREE_GOOGLE_SCOPES.join(" "),
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });

    const callback = await worker.fetch(
      new Request(`${ORIGIN}/oauth/google/callback?code=auth-code-1&state=${state}`),
      envWithKv(kv),
    );
    expect(callback.status).toBe(200);
    expect(callback.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await callback.text();
    expect(html).toContain("Paste this into Muse as the Bearer token.");
    const shown = html.match(/dgtl_muse_[A-Za-z0-9_-]{43}/g);
    expect(shown).toHaveLength(1);
    const shownToken = shown?.[0];
    if (shownToken === undefined) {
      throw new Error("missing bearer token");
    }
    expect(tokenCalls).toHaveLength(1);
    const sent = tokenCalls[0];
    if (sent === undefined) {
      throw new Error("missing token request");
    }
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("code")).toBe("auth-code-1");
    expect(sent.get("client_id")).toBe("test-web-client-id");
    expect(sent.get("client_secret")).toBe("test-web-client-secret");
    expect(sent.get("redirect_uri")).toBe("https://muse-api.dgtlsunrise.com/oauth/google/callback");
    expect(sent.get("code_verifier")).toBe(pending.code_verifier);

    const parsed = parseToken(shownToken);
    expect(parsed).not.toBeNull();
    if (parsed === null) {
      throw new Error("shown token did not parse");
    }
    const hash = await tokenKey(parsed);
    expect([...kv.entries().keys()]).toEqual([hash]);
    const stored = kv.entries().get(hash);
    expect(stored).toEqual(expect.any(String));
    if (stored === undefined) {
      throw new Error("missing grant");
    }
    expect(stored).not.toContain(REFRESH);
    expect(stored).not.toContain("access-should-not-be-stored");
    const grant = JSON.parse(stored) as {
      v: number;
      status: string;
      google: {
        sub: string;
        email: string;
        scopes: string[];
        refresh_token: { alg: string; iv: string; ct: string };
      };
    };
    expect(grant.v).toBe(1);
    expect(grant.status).toBe("active");
    expect(grant.google).toMatchObject({
      sub: "1001",
      email: "ada@example.com",
      scopes: [...FREE_GOOGLE_SCOPES],
      refresh_token: { alg: "A256GCM" },
    });
    expect(grant.google.refresh_token.ct).not.toContain(REFRESH);
    const sealed: SealedRefreshToken = {
      alg: "A256GCM",
      iv: grant.google.refresh_token.iv,
      ct: grant.google.refresh_token.ct,
    };
    expect(await openRefreshToken(sealed, TEST_ENC_KEY)).toBe(REFRESH);

    const replay = await worker.fetch(
      new Request(`${ORIGIN}/oauth/google/callback?code=auth-code-1&state=${state}`),
      envWithKv(kv),
    );
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("This sign-in link is invalid or has expired.");
    expect([...kv.entries().keys()]).toEqual([hash]);
  });

  it("returns 400 for a bad state and stores nothing", async () => {
    forbidFetch();
    const kv = new MemoryKv();
    const response = await worker.fetch(
      new Request(`${ORIGIN}/oauth/google/callback?code=auth-code-1&state=${"a".repeat(43)}`),
      envWithKv(kv),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("This sign-in link is invalid or has expired.");
    expect([...kv.entries().keys()]).toEqual([]);
  });

  it("stores nothing when the token exchange fails", async () => {
    const kv = new MemoryKv();
    const authorize = await startOAuth(kv);
    const state = authorize.searchParams.get("state");
    if (state === null) {
      throw new Error("missing state");
    }
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const response = await worker.fetch(
      new Request(`${ORIGIN}/oauth/google/callback?code=auth-code-1&state=${state}`),
      envWithKv(kv),
    );
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("Google did not complete sign-in.");
    expect([...kv.entries().keys()]).toEqual([]);
  });

  it("stores nothing when Google omits the refresh token", async () => {
    const kv = new MemoryKv();
    const authorize = await startOAuth(kv);
    const state = authorize.searchParams.get("state");
    if (state === null) {
      throw new Error("missing state");
    }
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "access-should-not-be-stored",
            id_token: jwt({ sub: "1001", email: "ada@example.com" }),
            scope: FREE_GOOGLE_SCOPES.join(" "),
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const response = await worker.fetch(
      new Request(`${ORIGIN}/oauth/google/callback?code=auth-code-1&state=${state}`),
      envWithKv(kv),
    );
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("Google did not return a refresh token.");
    expect([...kv.entries().keys()]).toEqual([]);
  });

  it("stores nothing when Google returns only analytics.readonly", async () => {
    const kv = new MemoryKv();
    const authorize = await startOAuth(kv);
    const state = authorize.searchParams.get("state");
    if (state === null) {
      throw new Error("missing state");
    }
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "access-should-not-be-stored",
            refresh_token: REFRESH,
            id_token: jwt({ sub: "1001", email: "ada@example.com" }),
            scope: LEGACY_READONLY_SCOPES.join(" "),
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const response = await worker.fetch(
      new Request(`${ORIGIN}/oauth/google/callback?code=auth-code-1&state=${state}`),
      envWithKv(kv),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Reopen /connect and reconnect Google.");
    expect([...kv.entries().keys()]).toEqual([]);
  });
});

describe("ga4 sessions", () => {
  it("returns the sessions number from runReport for a legacy analytics.readonly grant", async () => {
    const { token, hash, grant } = await issuedToken();
    const sealed = await sealRefreshToken(REFRESH, TEST_ENC_KEY);
    if (sealed === null) {
      throw new Error("seal failed");
    }
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push({ url, init });
      if (url === "https://oauth2.googleapis.com/token") {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "test-access-token", token_type: "Bearer" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url === "https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              metricHeaders: [{ name: "sessions", type: "TYPE_INTEGER" }],
              rows: [{ metricValues: [{ value: "1842" }] }],
              rowCount: 1,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const response = await worker.fetch(
      new Request(`${ORIGIN}/v1/ga4/properties/123456789/sessions`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      envWithGrant(hash, {
        ...grant,
        google: {
          sub: "1001",
          email: "ada@example.com",
          scopes: [...LEGACY_READONLY_SCOPES],
          refresh_token: sealed,
          linked_at: "2026-09-24T00:00:00.000Z",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      property_id: "123456789",
      start_date: "28daysAgo",
      end_date: "yesterday",
      sessions: 1842,
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport",
    ]);
    const refresh = calls[0];
    const report = calls[1];
    if (refresh === undefined || report === undefined) {
      throw new Error("missing Google calls");
    }
    expect(formBody(refresh.init).get("grant_type")).toBe("refresh_token");
    expect(formBody(refresh.init).get("refresh_token")).toBe(REFRESH);
    expect(formBody(refresh.init).get("client_id")).toBe("test-web-client-id");
    expect(formBody(refresh.init).get("client_secret")).toBe("test-web-client-secret");
    expect(report.init?.headers).toEqual({
      authorization: "Bearer test-access-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(report.init?.body))).toEqual({
      dateRanges: [{ startDate: "28daysAgo", endDate: "yesterday" }],
      metrics: [{ name: "sessions" }],
    });
  });

  it("returns 403 google_not_linked when the grant has no Google link", async () => {
    forbidFetch();
    const { token, hash, grant } = await issuedToken();
    const response = await worker.fetch(
      new Request(`${ORIGIN}/v1/ga4/properties/123456789/sessions`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      envWithGrant(hash, grant),
    );
    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({ error: "google_not_linked" });
  });

  it("maps a Google 403 to ga4_forbidden", async () => {
    const { token, hash, grant } = await issuedToken();
    const sealed = await sealRefreshToken(REFRESH, TEST_ENC_KEY);
    if (sealed === null) {
      throw new Error("seal failed");
    }
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "test-access-token", token_type: "Bearer" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url === "https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport") {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: 403, message: "Forbidden" } }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const response = await worker.fetch(
      new Request(`${ORIGIN}/v1/ga4/properties/123456789/sessions`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      envWithGrant(hash, {
        ...grant,
        google: {
          sub: "1001",
          email: "ada@example.com",
          scopes: [...LEGACY_READONLY_SCOPES],
          refresh_token: sealed,
          linked_at: "2026-09-24T00:00:00.000Z",
        },
      }),
    );
    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({ error: "ga4_forbidden" });
  });

  it("returns 400 when property_id is not digits", async () => {
    forbidFetch();
    const { token, hash, grant } = await issuedToken();
    const response = await worker.fetch(
      new Request(`${ORIGIN}/v1/ga4/properties/nope/sessions`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      envWithGrant(hash, grant),
    );
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: "invalid_property_id" });
  });
});
