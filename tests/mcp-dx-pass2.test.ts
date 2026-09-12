import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createAppContext } from "../src/context.js";
import { dispatch } from "../src/tools/dispatch.js";
import { CONSENT_A_TOOLS, LICENSE_GATED_TOOLS } from "../src/tools/registry.js";
import { META_BREAKDOWN_NAMES, META_FIELD_NAMES } from "../src/meta/insights-schema.js";
import { GADS_RECIPE_NAMES } from "../src/ads/recipes-schema.js";
import {
  ROOT,
  installNetworkGuard,
  makeCtx,
  signLicense,
  testEnv,
  TEST_TOKEN,
} from "./helpers.js";

const GATEWAY = "https://gateway.test.dgtl";
const ADS_TOKEN = "consent-c-ads-user-token";
const META_TOKEN = "meta-user-token-xyz";

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

function licensedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const jwt = signLicense({
    sub: "dx2-user",
    exp: Math.floor(Date.now() / 1000) + 86400,
    features: ["ads", "meta"],
    jti: "dx2-jti",
  });
  return testEnv({
    DGTL_LICENSE_JWT: jwt,
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    ...extra,
  });
}

describe("Meta + Google MCP DX pass 2 (no live Ads/Meta)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("Consent A kernel stays 24 (describe tools are license-gated)", () => {
    assert.equal(CONSENT_A_TOOLS.length, 24);
    assert.ok(!CONSENT_A_TOOLS.includes("meta_describe_insights_schema"));
    assert.ok(!CONSENT_A_TOOLS.includes("gads_describe_recipes"));
    assert.ok(LICENSE_GATED_TOOLS.includes("meta_describe_insights_schema"));
    assert.ok(LICENSE_GATED_TOOLS.includes("gads_describe_recipes"));
  });

  it("meta_describe_insights_schema is local (zero gateway) when licensed", async () => {
    const captures: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      captures.push(String(input));
      throw new Error(`unexpected fetch ${input}`);
    };
    const ctx = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({ DGTL_GATEWAY_URL: GATEWAY }),
      fetchImpl,
    });
    const env = await dispatch(ctx, "meta_describe_insights_schema", {});
    assert.equal(env.ok, true);
    assert.equal(captures.length, 0);
    const data = env.data as {
      breakdowns: Array<{ api_name: string }>;
      fields: Array<{ api_name: string }>;
      deferred: string[];
    };
    assert.ok(data.breakdowns.some((b) => b.api_name === "age"));
    assert.ok(data.fields.some((f) => f.api_name === "spend"));
    assert.ok(data.deferred.some((d) => d.toLowerCase().includes("ads_mcp_management")));
    for (const b of data.breakdowns) assert.ok(META_BREAKDOWN_NAMES.has(b.api_name));
    for (const f of data.fields) assert.ok(META_FIELD_NAMES.has(f.api_name));
  });

  it("meta_describe_insights_schema without license → LICENSE_REQUIRED", async () => {
    const ctx = makeCtx({}, testEnv({ DGTL_LICENSE_JWT: "" }));
    const env = await dispatch(ctx, "meta_describe_insights_schema", {});
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "LICENSE_REQUIRED");
  });

  it("meta_insights rejects invented breakdown before hop", async () => {
    const captures: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      captures.push(String(input));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const ctx = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({
        DGTL_GATEWAY_URL: GATEWAY,
        META_ACCESS_TOKEN: META_TOKEN,
      }),
      fetchImpl,
    });
    const env = await dispatch(ctx, "meta_insights", {
      ad_account_id: "act_1",
      breakdowns: ["not_a_real_breakdown"],
      date_preset: "last_7d",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.ok(!captures.some((u) => u.includes("/v1/meta/")));
    assert.ok(env.hint?.includes("Valid:"));
  });

  it("meta_insights hop sends date_preset/breakdowns and cites them", async () => {
    const captures: Array<{ url: string; body?: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      let body: unknown;
      if (init?.body && typeof init.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      captures.push({ url, body });
      if (url.endsWith("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          tool: "meta_insights",
          data: { rows: [{ spend: "1.00" }] },
          page: { truncated: false, row_count: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const ctx = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({
        DGTL_GATEWAY_URL: GATEWAY,
        META_ACCESS_TOKEN: META_TOKEN,
      }),
      fetchImpl,
    });
    const env = await dispatch(ctx, "meta_insights", {
      ad_account_id: "act_99",
      level: "campaign",
      date_preset: "last_30d",
      breakdowns: ["age", "gender"],
      fields: ["spend", "impressions", "ctr"],
    });
    assert.equal(env.ok, true);
    const hop = captures.find((c) => c.url.includes("/v1/meta/meta_insights"));
    assert.ok(hop);
    const params = (hop!.body as { params: Record<string, unknown> }).params;
    assert.equal(params.date_preset, "last_30d");
    assert.deepEqual(params.breakdowns, ["age", "gender"]);
    assert.deepEqual(params.fields, ["spend", "impressions", "ctr"]);
    const cited = (env.data as { cited?: Record<string, unknown> }).cited;
    assert.equal(cited?.ad_account_id, "act_99");
    assert.equal(cited?.date_preset, "last_30d");
    assert.deepEqual(cited?.breakdowns, ["age", "gender"]);
  });

  it("gads_describe_recipes is local when licensed", async () => {
    const ctx = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({ DGTL_GATEWAY_URL: GATEWAY }),
      fetchImpl: async () => {
        throw new Error("no fetch");
      },
    });
    const env = await dispatch(ctx, "gads_describe_recipes", {});
    assert.equal(env.ok, true);
    const data = env.data as { recipes: Array<{ recipe: string }>; rejected_from_official: string[] };
    assert.ok(data.recipes.some((r) => r.recipe === "performance"));
    assert.ok(data.recipes.some((r) => r.recipe === "assets"));
    assert.ok(data.recipes.some((r) => r.recipe === "change_event"));
    assert.ok(data.recipes.some((r) => r.recipe === "account_budget"));
    for (const r of data.recipes) assert.ok(GADS_RECIPE_NAMES.has(r.recipe));
    assert.ok(data.rejected_from_official.some((x) => x.toLowerCase().includes("gaql")));
  });

  it("gads_search cites customer_id (hyphens stripped) on ok hop", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          tool: "gads_search",
          data: { results: [] },
          page: { truncated: false, row_count: 0 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const ctx = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({
        DGTL_GATEWAY_URL: GATEWAY,
        GOOGLE_ADS_ACCESS_TOKEN: ADS_TOKEN,
      }),
      fetchImpl,
    });
    const env = await dispatch(ctx, "gads_search", {
      customer_id: "123-456-7890",
      login_customer_id: "999-888-7777",
      recipe: "campaigns",
    });
    assert.equal(env.ok, true);
    const cited = (env.data as { cited?: { customer_id?: string; login_customer_id?: string } }).cited;
    assert.equal(cited?.customer_id, "1234567890");
    assert.equal(cited?.login_customer_id, "9998887777");
    assert.ok(env.hint?.toLowerCase().includes("empty") || env.hint?.includes("gads_describe_recipes"));
  });

  it("gads_search unknown recipe fails closed without hop", async () => {
    const captures: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      captures.push(String(input));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const ctx = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({
        DGTL_GATEWAY_URL: GATEWAY,
        GOOGLE_ADS_ACCESS_TOKEN: ADS_TOKEN,
      }),
      fetchImpl,
    });
    const env = await dispatch(ctx, "gads_search", {
      customer_id: "123",
      recipe: "raw_gaql_please",
    });
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.ok(!captures.some((u) => u.includes("/v1/gads/")));
  });

  // silence unused in case of tree-shake noise
  void headerMap;
});
