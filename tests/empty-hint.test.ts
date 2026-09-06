import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { HINT_EMPTY_LIST, HINT_EMPTY_ROWS } from "../src/envelope.js";
import { dispatch } from "../src/tools/dispatch.js";
import { installNetworkGuard, makeCtx, reportArgs } from "./helpers.js";

describe("empty-state hints on ok list/report tools", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("ga4_run_report empty rows: ok true + HINT_EMPTY_ROWS", async () => {
    const ctx = makeCtx({ emptyReport: true });
    const env = await dispatch(ctx, "ga4_run_report", reportArgs());
    assert.equal(env.ok, true);
    assert.equal(env.page?.row_count, 0);
    assert.equal(env.hint, HINT_EMPTY_ROWS);
    assert.ok(env.hint?.includes("not an auth failure"));
  });

  it("ga4_run_report with rows has no empty hint", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "ga4_run_report", reportArgs());
    assert.equal(env.ok, true);
    assert.ok((env.page?.row_count ?? 0) > 0);
    assert.equal(env.hint, undefined);
  });

  it("empty GA4/GSC/GTM lists: ok true + HINT_EMPTY_LIST", async () => {
    const ctx = makeCtx({ emptyList: true });
    const cases: Array<[string, Record<string, unknown>]> = [
      ["ga4_list_accounts", {}],
      ["ga4_list_account_summaries", {}],
      ["ga4_list_properties", { account_id: "accounts/111111" }],
      ["ga4_list_data_streams", { property_id: "111111111" }],
      ["ga4_list_key_events", { property_id: "111111111" }],
      ["gsc_list_sites", {}],
      ["gtm_list_accounts", {}],
      ["gtm_list_containers", { account_id: "444444" }],
      ["gtm_list_workspaces", { account_id: "444444", container_id: "555555" }],
    ];
    for (const [name, args] of cases) {
      const env = await dispatch(ctx, name, args);
      assert.equal(env.ok, true, name);
      assert.equal(env.page?.row_count, 0, name);
      assert.equal(env.hint, HINT_EMPTY_LIST, name);
    }
  });

  it("gsc_query_search_analytics empty rows: ok true + HINT_EMPTY_ROWS", async () => {
    const ctx = makeCtx({ emptyGscQuery: true });
    const env = await dispatch(ctx, "gsc_query_search_analytics", {
      site_url: "sc-domain:example.com",
      start_date: "2026-08-01",
      end_date: "2026-08-31",
      dimensions: ["query"],
    });
    assert.equal(env.ok, true);
    assert.equal(env.page?.row_count, 0);
    assert.equal(env.hint, HINT_EMPTY_ROWS);
  });

  it("populated list tools do not attach an empty hint", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "ga4_list_accounts", {});
    assert.equal(env.ok, true);
    assert.ok((env.page?.row_count ?? 0) > 0);
    assert.equal(env.hint, undefined);
  });
});
