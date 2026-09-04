import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createAppContext } from "../src/context.js";
import { postGateway, probeGatewayReachable } from "../src/gateway/client.js";
import { dispatch } from "../src/tools/dispatch.js";
import {
  ROOT,
  installNetworkGuard,
  makeCtx,
  signLicense,
  testEnv,
  TEST_TOKEN,
} from "./helpers.js";

const ADS_TOKEN = "consent-c-ads-user-token";
const META_TOKEN = "meta-user-token-xyz";
const GATEWAY = "https://gateway.test.dgtl";

type Captured = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
};

function headerMap(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    for (const [k, v] of h) out[k.toLowerCase()] = v;
    return out;
  }
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

function mockWorker(opts: {
  healthOk?: boolean;
  healthStatus?: number;
  hop?: { status: number; body: unknown };
}): { fetchImpl: typeof fetch; captures: Captured[] } {
  const captures: Captured[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = headerMap(init?.headers);
    let body: unknown;
    if (init?.body && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    captures.push({ method, url, headers, body });

    // Never allow googleads / graph live hosts in these tests.
    if (url.includes("googleapis.com") || url.includes("graph.facebook.com")) {
      throw new Error(`NETWORK_FORBIDDEN live ads/meta host: ${url}`);
    }

    if (url.endsWith("/v1/health") && method === "GET") {
      if (opts.healthOk === false) {
        return new Response(JSON.stringify({ ok: false }), {
          status: opts.healthStatus ?? 503,
          headers: { "content-type": "application/json" },
        });
      }
      if (opts.healthStatus && opts.healthStatus >= 400) {
        return new Response("down", { status: opts.healthStatus });
      }
      return new Response(JSON.stringify({ ok: true, service: "stamp" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.includes("/v1/gads/") || url.includes("/v1/meta/")) {
      const hop = opts.hop ?? {
        status: 200,
        body: {
          ok: true,
          tool: "gads_list_accessible_customers",
          data: { resourceNames: ["customers/123"] },
        },
      };
      return new Response(JSON.stringify(hop.body), {
        status: hop.status,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`UNMAPPED_MOCK ${method} ${url}`);
  };
  return { fetchImpl, captures };
}

function licensedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const jwt = signLicense({
    sub: "gw-user",
    exp: Math.floor(Date.now() / 1000) + 86400,
    features: ["ads", "meta"],
    jti: "gw-jti-1",
  });
  return testEnv({
    DGTL_LICENSE_JWT: jwt,
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    ...extra,
  });
}

describe("PR-5 license-gated gateway client", () => {
  let restoreNet: () => void;
  before(() => {
    restoreNet = installNetworkGuard();
  });
  after(() => restoreNet());

  it("no feature → LICENSE_REQUIRED (before gateway check)", async () => {
    const ctx = makeCtx({}, testEnv({ DGTL_LICENSE_JWT: "", DGTL_GATEWAY_URL: GATEWAY }));
    const env = await dispatch(ctx, "gads_list_accessible_customers", {});
    assert.equal(env.error_code, "LICENSE_REQUIRED");
  });

  it("feature + URL unset → GATEWAY_UNAVAILABLE (not ADS_SCOPE_MISSING)", async () => {
    const ctx = makeCtx(
      {},
      licensedEnv({ GOOGLE_ADS_ACCESS_TOKEN: ADS_TOKEN, DGTL_GATEWAY_URL: "" }),
    );
    const env = await dispatch(ctx, "gads_list_accessible_customers", {});
    assert.equal(env.error_code, "GATEWAY_UNAVAILABLE");
    assert.ok(env.hint?.includes("DGTL_GATEWAY_URL") || env.message?.includes("gateway"));
  });

  it("feature + Worker down → GATEWAY_UNAVAILABLE", async () => {
    const { fetchImpl, captures } = mockWorker({ healthOk: false, healthStatus: 503 });
    const envVars = licensedEnv({
      DGTL_GATEWAY_URL: GATEWAY,
      GOOGLE_ADS_ACCESS_TOKEN: ADS_TOKEN,
    });
    const ctx = createAppContext({ pluginRoot: ROOT, env: envVars, fetchImpl });
    const env = await dispatch(ctx, "gads_search", { customer_id: "123", recipe: "campaigns" });
    assert.equal(env.error_code, "GATEWAY_UNAVAILABLE");
    assert.ok(captures.some((c) => c.url.endsWith("/v1/health")));
    assert.ok(!captures.some((c) => c.url.includes("/v1/gads/")));
  });

  it("gateway up + no Consent C token → ADS_SCOPE_MISSING (never hops with A token)", async () => {
    const { fetchImpl, captures } = mockWorker({ healthOk: true });
    const envVars = licensedEnv({
      DGTL_GATEWAY_URL: GATEWAY,
      GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
      // no GOOGLE_ADS_ACCESS_TOKEN
    });
    const ctx = createAppContext({ pluginRoot: ROOT, env: envVars, fetchImpl });
    let authCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "gads_list_accessible_customers", {});
    assert.equal(env.error_code, "ADS_SCOPE_MISSING");
    assert.equal(authCalls, 0, "must not read ctx.auth");
    assert.ok(!captures.some((c) => c.url.includes("/v1/gads/")));
    // Health probe only — no user token header
    const health = captures.find((c) => c.url.endsWith("/v1/health"));
    assert.ok(health);
    assert.equal(health!.headers["x-dgtl-user-access-token"], undefined);
    assert.equal(health!.headers.authorization, undefined);
  });

  it("gateway up + no Meta token → META_NOT_CONNECTED", async () => {
    const { fetchImpl } = mockWorker({ healthOk: true });
    const envVars = licensedEnv({ DGTL_GATEWAY_URL: GATEWAY });
    const ctx = createAppContext({ pluginRoot: ROOT, env: envVars, fetchImpl });
    const env = await dispatch(ctx, "meta_list_ad_accounts", {});
    assert.equal(env.error_code, "META_NOT_CONNECTED");
  });

  it("successful hop POSTs GatewayRequest with JWT + C token; never developer-token; never URL; never ctx.auth", async () => {
    const { fetchImpl, captures } = mockWorker({
      healthOk: true,
      hop: {
        status: 200,
        body: {
          ok: true,
          tool: "gads_search",
          data: { results: [{ campaign: { id: "1" } }] },
          page: { truncated: false, row_count: 1 },
        },
      },
    });
    const jwt = signLicense({
      sub: "gw-user",
      exp: Math.floor(Date.now() / 1000) + 86400,
      features: ["ads", "meta"],
      jti: "gw-hop-1",
    });
    const envVars = testEnv({
      DGTL_LICENSE_JWT: jwt,
      DGTL_GATEWAY_URL: GATEWAY,
      GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
      GOOGLE_ADS_ACCESS_TOKEN: ADS_TOKEN,
    });
    const ctx = createAppContext({ pluginRoot: ROOT, env: envVars, fetchImpl });
    let authCalls = 0;
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      return { accessToken: TEST_TOKEN, source: "host-injected", scopes: [] };
    };
    const env = await dispatch(ctx, "gads_search", {
      customer_id: "1112223333",
      recipe: "campaigns",
      limit: 10,
    });
    assert.equal(env.ok, true);
    assert.equal(authCalls, 0, "gateway client must never read ctx.auth / GOOGLE_ACCESS_TOKEN");

    const hop = captures.find((c) => c.url.includes("/v1/gads/gads_search"));
    assert.ok(hop, "expected POST hop");
    assert.equal(hop!.method, "POST");
    assert.equal(hop!.headers.authorization, `Bearer ${jwt}`);
    assert.equal(hop!.headers["x-dgtl-user-access-token"], ADS_TOKEN);
    assert.ok(hop!.headers["x-dgtl-request-id"]);
    assert.ok(!("developer-token" in hop!.headers));
    assert.ok(!Object.keys(hop!.headers).some((k) => k.includes("developer")));

    const body = hop!.body as { tool: string; recipe: string; params: Record<string, unknown> };
    assert.equal(body.tool, "gads_search");
    assert.equal(body.recipe, "campaigns");
    assert.equal(body.params.customer_id, "1112223333");
    assert.equal(body.params.limit, 10);
    assert.ok(!("url" in body));
    assert.ok(!("url" in (body.params ?? {})));
    const blob = JSON.stringify(body);
    assert.ok(!/https?:\/\//i.test(blob));
    assert.ok(!blob.includes(TEST_TOKEN), "must not send Consent A token");
  });

  it("gateway client never reads ctx.auth / GOOGLE_ACCESS_TOKEN (direct postGateway)", async () => {
    const { fetchImpl, captures } = mockWorker({
      healthOk: true,
      hop: {
        status: 200,
        body: { ok: true, tool: "gads_list_accessible_customers", data: { resourceNames: [] } },
      },
    });
    const jwt = signLicense({
      sub: "gw-user",
      exp: Math.floor(Date.now() / 1000) + 86400,
      features: ["ads"],
      jti: "gw-direct",
    });
    const envVars = testEnv({
      DGTL_LICENSE_JWT: jwt,
      DGTL_GATEWAY_URL: GATEWAY,
      GOOGLE_ACCESS_TOKEN: "SHOULD-NEVER-BE-READ",
      GOOGLE_ADS_ACCESS_TOKEN: ADS_TOKEN,
    });
    const ctx = createAppContext({ pluginRoot: ROOT, env: envVars, fetchImpl });
    let authCalls = 0;
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      throw new Error("ctx.auth must not be read by gateway client");
    };
    const env = await postGateway(ctx, {
      family: "gads",
      tool: "gads_list_accessible_customers",
      userAccessToken: ADS_TOKEN,
      args: {},
    });
    assert.equal(env.ok, true);
    assert.equal(authCalls, 0);
    const hop = captures.find((c) => c.url.includes("/v1/gads/"));
    assert.ok(hop);
    assert.equal(hop!.headers["x-dgtl-user-access-token"], ADS_TOKEN);
    assert.ok(!JSON.stringify(hop).includes("SHOULD-NEVER-BE-READ"));
  });

  it("license_status: URL unset → reachable false (no throw); URL set + healthy → true; probe fail → false + note", async () => {
    const unset = makeCtx({}, licensedEnv({ DGTL_GATEWAY_URL: "" }));
    const a = await dispatch(unset, "license_status", {});
    assert.equal(a.ok, true);
    const aData = a.data as { gateway?: { reachable?: boolean; note?: string } };
    assert.equal(aData.gateway?.reachable, false);
    assert.ok(aData.gateway?.note);

    const { fetchImpl: okFetch } = mockWorker({ healthOk: true });
    const up = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({ DGTL_GATEWAY_URL: GATEWAY }),
      fetchImpl: okFetch,
    });
    const b = await dispatch(up, "license_status", {});
    const bData = b.data as { gateway?: { reachable?: boolean } };
    assert.equal(bData.gateway?.reachable, true);

    const { fetchImpl: badFetch } = mockWorker({ healthOk: false, healthStatus: 502 });
    const down = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({ DGTL_GATEWAY_URL: GATEWAY }),
      fetchImpl: badFetch,
    });
    const c = await dispatch(down, "license_status", {});
    const cData = c.data as { gateway?: { reachable?: boolean; note?: string } };
    assert.equal(cData.gateway?.reachable, false);
    assert.ok(cData.gateway?.note);

    // Do not report true from URL configured alone (probe must succeed).
    const probe = await probeGatewayReachable(down);
    assert.equal(probe.reachable, false);
  });

  it("meta hop uses META_ACCESS_TOKEN only", async () => {
    const { fetchImpl, captures } = mockWorker({
      healthOk: true,
      hop: {
        status: 200,
        body: { ok: true, tool: "meta_list_ad_accounts", data: { data: [] } },
      },
    });
    const envVars = licensedEnv({
      DGTL_GATEWAY_URL: GATEWAY,
      META_ACCESS_TOKEN: META_TOKEN,
      GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    });
    const ctx = createAppContext({ pluginRoot: ROOT, env: envVars, fetchImpl });
    let authCalls = 0;
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      return { accessToken: TEST_TOKEN, source: "host-injected", scopes: [] };
    };
    const env = await dispatch(ctx, "meta_list_ad_accounts", {});
    assert.equal(env.ok, true);
    assert.equal(authCalls, 0);
    const hop = captures.find((c) => c.url.includes("/v1/meta/meta_list_ad_accounts"));
    assert.ok(hop);
    assert.equal(hop!.headers["x-dgtl-user-access-token"], META_TOKEN);
    const body = hop!.body as { tool: string; recipe: null | string; params: object };
    assert.equal(body.tool, "meta_list_ad_accounts");
    assert.equal(body.recipe, null);
  });

  it("Worker 5xx on hop maps to GATEWAY_UNAVAILABLE", async () => {
    const { fetchImpl } = mockWorker({
      healthOk: true,
      hop: {
        status: 503,
        body: {
          ok: false,
          tool: "gads_get_customer",
          error_code: "GATEWAY_UNAVAILABLE",
          message: "Gateway paused",
        },
      },
    });
    const envVars = licensedEnv({
      DGTL_GATEWAY_URL: GATEWAY,
      GOOGLE_ADS_ACCESS_TOKEN: ADS_TOKEN,
    });
    const ctx = createAppContext({ pluginRoot: ROOT, env: envVars, fetchImpl });
    const env = await dispatch(ctx, "gads_get_customer", { customer_id: "999" });
    assert.equal(env.error_code, "GATEWAY_UNAVAILABLE");
  });
});
