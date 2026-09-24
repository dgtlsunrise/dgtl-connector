import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { sealRefreshToken } from "../src/seal";
import { MemoryKv, TEST_ENC_KEY, envWithKv, issuedToken } from "./support";

const ORIGIN = "https://muse-api.dgtlsunrise.com";
const PREVIEW_PATH = "/v1/writes/preview";
const CONFIRM_PATH = "/v1/writes/confirm";
const KLAVIYO_KEY = "pk_test_not_a_real_key_0001";
const REVISION = "2026-07-15";
const PROFILE_URL = "https://a.klaviyo.com/api/profile-import";
const EMAIL = "sam@example.com";
const EXTERNAL_ID = "cust-100";
const PROFILE_ID = "01HPROFILEID0000000000000000";
const RETURNED_ID = "01HRETURNEDPROFILE00000000000";

const PREVIEW_BODY = {
  kind: "klaviyo_upsert_profile",
  email: EMAIL,
  external_id: EXTERNAL_ID,
  profile_id: PROFILE_ID,
  first_name: "Sam",
  last_name: "Mason",
};

const RESOURCE_IDS = [EMAIL, EXTERNAL_ID, PROFILE_ID];

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

function post(path: string, body: unknown, token?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== undefined) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function forbidFetch(): void {
  vi.stubGlobal("fetch", () => {
    throw new Error("klaviyo write must not call out");
  });
}

type SeenCall = {
  readonly url: string;
  readonly method: string;
  readonly authorization: string | null;
  readonly accept: string | null;
  readonly contentType: string | null;
  readonly revision: string | null;
  readonly body: unknown;
};

function mockKlaviyo(status: number, body: unknown): SeenCall[] {
  const seen: SeenCall[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const raw = init?.body;
    seen.push({
      url: requestUrl(input),
      method: init?.method ?? "GET",
      authorization: headers.get("authorization"),
      accept: headers.get("accept"),
      contentType: headers.get("content-type"),
      revision: headers.get("revision"),
      body: typeof raw === "string" ? JSON.parse(raw) : raw,
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

async function linkedKv(apiKey: string | null) {
  const kv = new MemoryKv();
  const issued = await issuedToken();
  const sealed =
    apiKey === null
      ? { alg: "A256GCM" as const, iv: "aaaaaaaaaaaa", ct: "ciphertext-not-a-key" }
      : await sealRefreshToken(apiKey, TEST_ENC_KEY);
  if (sealed === null) {
    throw new Error("seal failed");
  }
  const grant = {
    ...issued.grant,
    klaviyo: {
      api_key: sealed,
      account_id: null,
      linked_at: "2026-09-24T00:00:00.000Z",
    },
  };
  kv.records.set(issued.hash, { value: JSON.stringify(grant), expiresAtMs: null });
  return { token: issued.token, kv, sealed, grant };
}

function assertNoSecret(body: unknown, sealed: { iv: string; ct: string }): void {
  const text = JSON.stringify(body);
  expect(text).not.toContain(KLAVIYO_KEY);
  expect(text).not.toContain(sealed.iv);
  expect(text).not.toContain(sealed.ct);
  expect(text).not.toContain("pk_");
  expect(text).not.toContain("api_key");
}

describe("klaviyo upsert profile", () => {
  it("fails closed when Klaviyo is not linked and stores nothing", async () => {
    forbidFetch();
    const { token, hash, grant } = await issuedToken();
    const kv = new MemoryKv();
    kv.records.set(hash, { value: JSON.stringify(grant), expiresAtMs: null });
    const response = await worker.fetch(post(PREVIEW_PATH, PREVIEW_BODY, token), envWithKv(kv));
    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({ error: "klaviyo_not_linked" });
    expect(kv.puts).toEqual([]);
    expect([...kv.entries().keys()].some((key) => key.startsWith("preview:"))).toBe(false);
  });

  it("refuses a properties bag and a body with no identifier", async () => {
    forbidFetch();
    const { token, kv } = await linkedKv(KLAVIYO_KEY);
    const bag = await worker.fetch(
      post(PREVIEW_PATH, { ...PREVIEW_BODY, properties: { bag: true } }, token),
      envWithKv(kv),
    );
    expect(bag.status).toBe(400);
    expect(await readJson(bag)).toEqual({ error: "invalid_request" });
    const empty = await worker.fetch(
      post(PREVIEW_PATH, { kind: "klaviyo_upsert_profile", first_name: "Sam" }, token),
      envWithKv(kv),
    );
    expect(empty.status).toBe(400);
    expect(await readJson(empty)).toEqual({ error: "invalid_request" });
    expect(kv.puts).toEqual([]);
  });

  it("previews without a mutate, refuses a phrase that misses an identifier, then confirms", async () => {
    forbidFetch();
    const { token, kv, sealed, grant } = await linkedKv(KLAVIYO_KEY);
    const preview = await worker.fetch(post(PREVIEW_PATH, PREVIEW_BODY, token), envWithKv(kv));
    expect(preview.status).toBe(200);
    const previewBody = await readJson(preview);
    expect(previewBody).toMatchObject({
      status: "preview",
      confirm_required: true,
      kind: "klaviyo_upsert_profile",
      resource_ids: RESOURCE_IDS,
      summary: `Would upsert Klaviyo profile ${RESOURCE_IDS.join(", ")}. Not executed.`,
    });
    assertNoSecret(previewBody, sealed);
    const previewId = previewBody["preview_id"];
    if (typeof previewId !== "string") {
      throw new Error("missing preview_id");
    }
    const storedRaw = kv.entries().get(`preview:${previewId}`);
    expect(JSON.parse(storedRaw ?? "null")).toEqual({
      kind: "klaviyo_upsert_profile",
      grant_id: grant.grant_id,
      email: EMAIL,
      external_id: EXTERNAL_ID,
      profile_id: PROFILE_ID,
      first_name: "Sam",
      last_name: "Mason",
      resource_ids: RESOURCE_IDS,
      summary: previewBody["summary"],
      expires_at: previewBody["expires_at"],
    });
    assertNoSecret(storedRaw, sealed);

    const refused = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: `upsert ${EMAIL} ${EXTERNAL_ID}` },
        token,
      ),
      envWithKv(kv),
    );
    expect(refused.status).toBe(400);
    expect(await readJson(refused)).toEqual({ error: "confirm_refused", confirm_required: true });
    expect(kv.entries().has(`preview:${previewId}`)).toBe(true);

    const calls = mockKlaviyo(200, {
      data: {
        type: "profile",
        id: RETURNED_ID,
        attributes: {
          email: EMAIL,
          phone_number: "+15555550100",
          properties: { secret: KLAVIYO_KEY },
        },
      },
    });
    const confirmed = await worker.fetch(
      post(
        CONFIRM_PATH,
        { preview_id: previewId, confirm_phrase: `upsert ${EMAIL} ${EXTERNAL_ID} ${PROFILE_ID}` },
        token,
      ),
      envWithKv(kv),
    );
    expect(confirmed.status).toBe(200);
    const confirmedBody = await readJson(confirmed);
    expect(confirmedBody).toEqual({
      status: "confirmed",
      preview_id: previewId,
      kind: "klaviyo_upsert_profile",
      executed: true,
      profile_id: RETURNED_ID,
    });
    assertNoSecret(confirmedBody, sealed);
    expect(JSON.stringify(confirmedBody)).not.toContain("phone_number");
    expect(JSON.stringify(confirmedBody)).not.toContain("properties");
    expect(kv.entries().has(`preview:${previewId}`)).toBe(false);
    expect(calls).toEqual([
      {
        url: PROFILE_URL,
        method: "POST",
        authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
        accept: "application/vnd.api+json",
        contentType: "application/vnd.api+json",
        revision: REVISION,
        body: {
          data: {
            type: "profile",
            id: PROFILE_ID,
            attributes: {
              email: EMAIL,
              external_id: EXTERNAL_ID,
              first_name: "Sam",
              last_name: "Mason",
            },
          },
        },
      },
    ]);
  });

  it("maps Klaviyo 401, 403, and 429 without the upstream body and keeps the preview", async () => {
    const { token, kv, sealed } = await linkedKv(KLAVIYO_KEY);
    forbidFetch();
    const preview = await worker.fetch(post(PREVIEW_PATH, PREVIEW_BODY, token), envWithKv(kv));
    const previewBody = await readJson(preview);
    const previewId = previewBody["preview_id"];
    if (typeof previewId !== "string") {
      throw new Error("missing preview_id");
    }
    const cases = [
      { status: 401, error: "klaviyo_unauthorized" },
      { status: 403, error: "klaviyo_forbidden" },
      { status: 429, error: "klaviyo_rate_limited" },
    ] as const;
    for (const item of cases) {
      mockKlaviyo(item.status, {
        errors: [{ detail: KLAVIYO_KEY, api_key: KLAVIYO_KEY, ct: sealed.ct }],
      });
      const response = await worker.fetch(
        post(
          CONFIRM_PATH,
          { preview_id: previewId, confirm_phrase: RESOURCE_IDS.join(" ") },
          token,
        ),
        envWithKv(kv),
      );
      expect(response.status, item.error).toBe(item.status);
      const body = await readJson(response);
      expect(body, item.error).toEqual({ error: item.error });
      assertNoSecret(body, sealed);
      expect(kv.entries().has(`preview:${previewId}`)).toBe(true);
    }
  });
});
