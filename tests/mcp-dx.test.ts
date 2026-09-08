import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { dispatch } from "../src/tools/dispatch.js";
import { GoogleHttp } from "../src/http/google.js";
import { ALL_SCOPES, installNetworkGuard, makeCtx, reportArgs, TEST_TOKEN } from "./helpers.js";
import { GSC_DIMENSION_NAMES } from "../src/google/gsc-schema.js";
import type { AccessTokenSource } from "../src/auth/types.js";
import type { HttpCall } from "../src/http/calls.js";

describe("Google MCP DX patterns (no live Google)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("ga4_get_metadata query filters apiNames without inventing fields", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "ga4_get_metadata", {
      property_id: "111111111",
      query: "session",
      kind: "metric",
    });
    assert.equal(env.ok, true);
    const data = env.data as {
      property_id: string;
      filtered: boolean;
      metrics: Array<{ apiName?: string }>;
      dimensions: unknown[];
    };
    assert.equal(data.property_id, "properties/111111111");
    assert.equal(data.filtered, true);
    assert.equal(data.dimensions.length, 0);
    assert.ok(data.metrics.length >= 1);
    assert.ok(
      data.metrics.every((m) => {
        const n = String(m.apiName ?? "").toLowerCase();
        return n.includes("session") || n.includes("engaged");
      }),
    );
    assert.ok(ctx.calls.some((c) => c.path.endsWith("/metadata")));
  });

  it("ga4_get_metadata empty filter returns hint not invented replacements", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "ga4_get_metadata", {
      property_id: "111111111",
      query: "this-metric-does-not-exist-zzz",
    });
    assert.equal(env.ok, true);
    assert.equal(env.page?.row_count, 0);
    assert.ok(env.hint?.toLowerCase().includes("invent"));
  });

  it("gsc_describe_schema is local (zero Google HTTP) and lists valid dims", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "gsc_describe_schema", {});
    assert.equal(env.ok, true);
    assert.equal(ctx.calls.length, 0);
    const data = env.data as {
      dimensions: Array<{ api_name: string }>;
      metrics: Array<{ api_name: string }>;
    };
    assert.ok(data.dimensions.some((d) => d.api_name === "query"));
    assert.ok(data.metrics.some((m) => m.api_name === "clicks"));
    for (const d of data.dimensions) assert.ok(GSC_DIMENSION_NAMES.has(d.api_name));
  });

  it("gsc_query rejects invented dimensions before HTTP", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "gsc_query_search_analytics", {
      site_url: "sc-domain:example.com",
      start_date: "2026-08-01",
      end_date: "2026-08-31",
      dimensions: ["notARealDimension"],
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(ctx.calls.length, 0);
    assert.ok(env.message?.includes("Valid:"));
  });

  it("gtm workspace lists warn draft vs live", async () => {
    const ctx = makeCtx();
    const tags = await dispatch(ctx, "gtm_list_tags", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
    });
    assert.equal(tags.ok, true);
    assert.equal((tags.data as { source?: string }).source, "workspace");
    assert.ok(tags.hint?.includes("not the live"));

    const live = await dispatch(ctx, "gtm_get_live_container_version", {
      account_id: "444444",
      container_id: "555555",
    });
    assert.equal(live.ok, true);
    assert.equal((live.data as { source?: string }).source, "live");
    assert.ok(live.hint?.includes("published"));
  });

  it("ga4_run_report cites property_id and dates on success", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "ga4_run_report", reportArgs());
    assert.equal(env.ok, true);
    const cited = (env.data as { cited?: { property_id?: string; date_ranges?: unknown[] } }).cited;
    assert.equal(cited?.property_id, "properties/111111111");
    assert.ok(Array.isArray(cited?.date_ranges) && cited!.date_ranges!.length >= 1);
  });

  it("GoogleHttp retries 429 then succeeds", async () => {
    let hits = 0;
    const calls: HttpCall[] = [];
    const tokenSource: AccessTokenSource = {
      name: "test",
      async getAccessToken() {
        return { accessToken: TEST_TOKEN, scopes: ALL_SCOPES.split(" "), source: "host-injected" };
      },
    };
    const fetchImpl: typeof fetch = async () => {
      hits += 1;
      if (hits === 1) {
        return new Response(JSON.stringify({ error: { message: "rate limit", status: "RESOURCE_EXHAUSTED" } }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "0" },
        });
      }
      return new Response(JSON.stringify({ accounts: [{ name: "accounts/1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const http = new GoogleHttp({ tokenSource, fetchImpl, calls });
    const raw = (await http.get("analyticsadmin.googleapis.com", "/v1beta/accounts", undefined, {
      api: "analyticsadmin.googleapis.com",
      requiredScope: "https://www.googleapis.com/auth/analytics.readonly",
      tool: "ga4_list_accounts",
    })) as { accounts?: unknown[] };
    assert.equal(hits, 2);
    assert.ok(Array.isArray(raw.accounts));
    assert.equal(calls.length, 2);
  });
});
