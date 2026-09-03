import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { dispatch } from "../src/tools/dispatch.js";
import { installNetworkGuard, makeCtx, reportArgs } from "./helpers.js";
import { FREE_TOOL_NAMES } from "../src/tools/registry.js";

const ARGS: Record<string, Record<string, unknown>> = {
  google_whoami: {},
  ga4_list_accounts: {},
  ga4_list_account_summaries: {},
  ga4_list_properties: { account_id: "accounts/111111" },
  ga4_get_property: { property_id: "properties/111111111" },
  ga4_list_data_streams: { property_id: "111111111" },
  ga4_list_key_events: { property_id: "111111111" },
  ga4_get_metadata: { property_id: "111111111" },
  ga4_run_report: reportArgs(),
  gsc_list_sites: {},
  gsc_get_site: { site_url: "sc-domain:example.com" },
  gsc_query_search_analytics: {
    site_url: "sc-domain:example.com",
    start_date: "2026-08-01",
    end_date: "2026-08-31",
    dimensions: ["query"],
    data_state: "final",
  },
  gsc_inspect_url: {
    site_url: "sc-domain:example.com",
    inspection_url: "https://example.com/",
  },
  gsc_list_sitemaps: { site_url: "sc-domain:example.com" },
  gsc_get_sitemap: { site_url: "sc-domain:example.com", feedpath: "https://example.com/sitemap.xml" },
  gtm_list_accounts: {},
  gtm_list_containers: { account_id: "444444" },
  gtm_get_container: { account_id: "444444", container_id: "555555" },
  gtm_list_workspaces: { account_id: "444444", container_id: "555555" },
  gtm_list_tags: { account_id: "444444", container_id: "555555", workspace_id: "6" },
  gtm_list_triggers: { account_id: "444444", container_id: "555555", workspace_id: "6" },
  gtm_list_variables: { account_id: "444444", container_id: "555555", workspace_id: "6" },
  gtm_get_live_container_version: { account_id: "444444", container_id: "555555" },
};

describe("free tool contracts against fixtures", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  for (const name of FREE_TOOL_NAMES) {
    it(`${name} returns ok envelope (no googleapis leak beyond fixture fetch)`, async () => {
      const ctx = makeCtx();
      const args = ARGS[name];
      assert.ok(args, `missing ARGS for ${name}`);
      const env = await dispatch(ctx, name, args);
      assert.equal(env.ok, true, `${name} ${JSON.stringify(env)}`);
      assert.equal(env.tool, name);
      assert.ok(ctx.calls.every((c) => c.hasAuthorization));
      assert.ok(ctx.calls.every((c) => !c.hasDeveloperToken));
      if (name === "ga4_run_report") {
        assert.ok(env.quota);
        assert.ok(env.page);
      }
      if (name.startsWith("gtm_list_tags") || name.startsWith("gtm_list_triggers") || name.startsWith("gtm_list_variables")) {
        const data = env.data as { source?: string };
        assert.equal(data.source, "workspace");
      }
      if (name === "gtm_get_live_container_version") {
        assert.equal((env.data as { source?: string }).source, "live");
      }
    });
  }

  it("google_whoami never includes a bearer or refresh token", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "google_whoami", {});
    const blob = JSON.stringify(env);
    assert.equal(env.ok, true);
    assert.ok(!blob.includes("Bearer"));
    assert.ok(!blob.includes(ctx.env.GOOGLE_ACCESS_TOKEN ?? "nope-if-empty"));
    assert.ok(!blob.toLowerCase().includes("refresh_token"));
    const data = env.data as { email?: string; granted_scopes?: string[] };
    assert.equal(data.email, "user@example.com");
    assert.ok(data.granted_scopes && data.granted_scopes.length > 0);
  });

  it("closed dimension_filter compiles; unknown keys rejected with zero HTTP", async () => {
    const ctx = makeCtx();
    const bad = await dispatch(ctx, "ga4_run_report", {
      ...reportArgs(),
      dimension_filter: { garbage: true },
    });
    assert.equal(bad.error_code, "INVALID_ARGUMENT");
    assert.equal(ctx.calls.length, 0);

    const ctx2 = makeCtx();
    const ok = await dispatch(ctx2, "ga4_run_report", {
      ...reportArgs(),
      dimension_filter: {
        field: "sessionDefaultChannelGroup",
        string_filter: { match_type: "EXACT", value: "Organic Search" },
      },
    });
    assert.equal(ok.ok, true);
    assert.ok(ctx2.calls.some((c) => c.path.includes(":runReport")));
  });

  it("GSC does not coerce site URLs", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "gsc_query_search_analytics", ARGS.gsc_query_search_analytics);
    assert.equal(env.ok, true);
    assert.equal(env.resource?.id, "sc-domain:example.com");
    const call = ctx.calls.find((c) => c.path.includes("searchAnalytics"));
    assert.ok(call?.path.includes(encodeURIComponent("sc-domain:example.com")));
  });
});
