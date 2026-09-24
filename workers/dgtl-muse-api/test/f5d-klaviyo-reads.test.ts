import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { sealRefreshToken } from "../src/seal";
import { MemoryKv, TEST_ENC_KEY, envWithGrant, envWithKv, issuedToken } from "./support";

const ORIGIN = "https://muse-api.dgtlsunrise.com";
const KLAVIYO_KEY = "pk_test_not_a_real_key_0001";
const REVISION = "2026-07-15";
const ACCOUNT_FIELDS =
  "contact_information.organization_name,industry,timezone,preferred_currency,locale,test_account";

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

type SeenCall = {
  readonly url: string;
  readonly authorization: string | null;
  readonly revision: string | null;
  readonly accept: string | null;
};

function forbidFetch(): void {
  vi.stubGlobal("fetch", () => {
    throw new Error("klaviyo read must not call out");
  });
}

function mockKlaviyo(status: number, body: unknown): SeenCall[] {
  const seen: SeenCall[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: requestUrl(input),
      authorization: headers.get("authorization"),
      revision: headers.get("revision"),
      accept: headers.get("accept"),
    });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/vnd.api+json" },
      }),
    );
  });
  return seen;
}

async function linkedEnv(apiKey: string | null) {
  const { token, hash, grant } = await issuedToken();
  const sealed = apiKey === null ? null : await sealRefreshToken(apiKey, TEST_ENC_KEY);
  if (apiKey !== null && sealed === null) {
    throw new Error("seal failed");
  }
  const klaviyo =
    sealed === null
      ? {
          api_key: { alg: "A256GCM" as const, iv: "aaaaaaaaaaaa", ct: "ciphertext-not-a-key" },
          account_id: null,
          linked_at: "2026-09-24T00:00:00.000Z",
        }
      : {
          api_key: sealed,
          account_id: null,
          linked_at: "2026-09-24T00:00:00.000Z",
        };
  const kv = new MemoryKv();
  kv.records.set(hash, {
    value: JSON.stringify({ ...grant, klaviyo }),
    expiresAtMs: null,
  });
  return {
    token,
    hash,
    sealed: klaviyo.api_key,
    kv,
    env: envWithKv(kv),
  };
}

function authed(path: string, token: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

function assertNoSecret(body: unknown, sealed: { iv: string; ct: string }): void {
  const text = JSON.stringify(body);
  expect(text).not.toContain(KLAVIYO_KEY);
  expect(text).not.toContain(sealed.iv);
  expect(text).not.toContain(sealed.ct);
  expect(text).not.toContain("api_key");
}

describe("klaviyo reads", () => {
  it("fails closed when Klaviyo is not linked and does not call Klaviyo", async () => {
    forbidFetch();
    const { token, hash, grant } = await issuedToken();
    const env = envWithGrant(hash, grant);
    const account = await worker.fetch(authed("/v1/klaviyo/account", token), env);
    const profiles = await worker.fetch(authed("/v1/klaviyo/profiles", token), env);
    expect(account.status).toBe(403);
    expect(profiles.status).toBe(403);
    expect(await readJson(account)).toEqual({ error: "klaviyo_not_linked" });
    expect(await readJson(profiles)).toEqual({ error: "klaviyo_not_linked" });
  });

  it("returns the first account at revision 2026-07-15 and leaves account_id null", async () => {
    const calls = mockKlaviyo(200, {
      data: [
        {
          type: "account",
          id: "acct_1",
          attributes: { contact_information: { organization_name: "Sunrise" } },
        },
        { type: "account", id: "acct_2", attributes: {} },
      ],
    });
    const { token, hash, sealed, kv, env } = await linkedEnv(KLAVIYO_KEY);
    const response = await worker.fetch(authed("/v1/klaviyo/account", token), env);
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body).toEqual({
      account: {
        type: "account",
        id: "acct_1",
        attributes: { contact_information: { organization_name: "Sunrise" } },
      },
    });
    assertNoSecret(body, sealed);
    expect(calls).toHaveLength(1);
    const called = calls[0];
    if (called === undefined) {
      throw new Error("missing Klaviyo call");
    }
    const url = new URL(called.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://a.klaviyo.com/api/accounts");
    expect(url.searchParams.get("fields[account]")).toBe(ACCOUNT_FIELDS);
    expect(called.authorization).toBe(`Klaviyo-API-Key ${KLAVIYO_KEY}`);
    expect(called.revision).toBe(REVISION);
    expect(called.accept).toBe("application/vnd.api+json");
    expect(kv.puts).toEqual([]);
    const stored = JSON.parse(kv.records.get(hash)?.value ?? "{}") as {
      klaviyo?: { account_id?: unknown };
    };
    expect(stored.klaviyo?.account_id).toBeNull();
  });

  it("lists sparse profiles with tip page bounds and a page cursor", async () => {
    const calls = mockKlaviyo(200, {
      data: [
        {
          type: "profile",
          id: "prof_1",
          attributes: {
            email: "ada@example.com",
            created: "2026-01-01T00:00:00Z",
            updated: "2026-01-02T00:00:00Z",
            external_id: "ext-1",
            phone_number: "+15555550100",
            location: { city: "Austin" },
            properties: { secret: "bag" },
          },
        },
      ],
      links: {
        next: "https://a.klaviyo.com/api/profiles?page%5Bcursor%5D=cursor-next",
      },
    });
    const { token, sealed, env } = await linkedEnv(KLAVIYO_KEY);
    const response = await worker.fetch(
      authed("/v1/klaviyo/profiles?page_size=10&page_token=cursor-1", token),
      env,
    );
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body).toEqual({
      profiles: [
        {
          type: "profile",
          id: "prof_1",
          attributes: {
            email: "ada@example.com",
            created: "2026-01-01T00:00:00Z",
            updated: "2026-01-02T00:00:00Z",
            external_id: "ext-1",
          },
        },
      ],
      next_page_token: "cursor-next",
    });
    assertNoSecret(body, sealed);
    expect(calls).toHaveLength(1);
    const called = calls[0];
    if (called === undefined) {
      throw new Error("missing Klaviyo call");
    }
    const url = new URL(called.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://a.klaviyo.com/api/profiles");
    expect(url.searchParams.get("page[size]")).toBe("10");
    expect(url.searchParams.get("page[cursor]")).toBe("cursor-1");
    expect(url.searchParams.get("fields[profile]")).toBe("email,created,updated,external_id");
    expect(called.authorization).toBe(`Klaviyo-API-Key ${KLAVIYO_KEY}`);
    expect(called.revision).toBe(REVISION);
  });

  it("defaults profile page size to 20 and rejects a size outside 1 to 100 before calling Klaviyo", async () => {
    const calls = mockKlaviyo(200, { data: [] });
    const { token, env } = await linkedEnv(KLAVIYO_KEY);
    const listed = await worker.fetch(authed("/v1/klaviyo/profiles", token), env);
    expect(listed.status).toBe(200);
    expect(await readJson(listed)).toEqual({ profiles: [] });
    expect(calls).toHaveLength(1);
    const called = calls[0];
    if (called === undefined) {
      throw new Error("missing Klaviyo call");
    }
    expect(new URL(called.url).searchParams.get("page[size]")).toBe("20");

    forbidFetch();
    const rejected = await worker.fetch(authed("/v1/klaviyo/profiles?page_size=101", token), env);
    expect(rejected.status).toBe(400);
    expect(await readJson(rejected)).toEqual({
      error: "invalid_request",
      message: "page_size must be an integer from 1 to 100.",
    });
  });

  it("maps Klaviyo 401, 403, and 429 without the upstream body", async () => {
    const { token, sealed, env } = await linkedEnv(KLAVIYO_KEY);
    const cases = [
      { status: 401, error: "klaviyo_unauthorized" },
      { status: 403, error: "klaviyo_forbidden" },
      { status: 429, error: "klaviyo_rate_limited" },
    ] as const;
    for (const item of cases) {
      mockKlaviyo(item.status, {
        errors: [{ detail: KLAVIYO_KEY, code: sealed.ct }],
        api_key: KLAVIYO_KEY,
      });
      const response = await worker.fetch(authed("/v1/klaviyo/account", token), env);
      expect(response.status, item.error).toBe(item.status);
      const body = await readJson(response);
      expect(body, item.error).toEqual({ error: item.error });
      assertNoSecret(body, sealed);
    }
  });

  it("returns grant_unreadable when the sealed key cannot be opened", async () => {
    forbidFetch();
    const { token, sealed, env } = await linkedEnv(null);
    const response = await worker.fetch(authed("/v1/klaviyo/account", token), env);
    expect(response.status).toBe(500);
    const body = await readJson(response);
    expect(body).toEqual({ error: "grant_unreadable" });
    assertNoSecret(body, sealed);
  });
});
