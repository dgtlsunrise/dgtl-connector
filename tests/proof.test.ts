import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { dispatch } from "../src/tools/dispatch.js";
import {
  ALL_SCOPES,
  installNetworkGuard,
  makeCtx,
  reportArgs,
  signLicense,
  testEnv,
} from "./helpers.js";
import { FREE_TOOL_NAMES, TOOLS } from "../src/tools/registry.js";
import { SEARCH_QUERY_DENY } from "../src/tools/denylist.js";

describe("session proofs", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("ga4_run_report denylists searchQuery with zero HTTP", async () => {
    for (const dim of [...SEARCH_QUERY_DENY, "searchQuery", "QUERY", "searchTerm", "keyword"]) {
      const ctx = makeCtx();
      const env = await dispatch(ctx, "ga4_run_report", {
        ...reportArgs(),
        dimensions: [dim],
      });
      assert.equal(env.ok, false);
      assert.equal(env.error_code, "UNSUPPORTED_DIMENSION");
      assert.equal(ctx.calls.length, 0, `HTTP leaked for dimension ${dim}`);
      assert.ok(ctx.calls.every((c) => !c.host.includes("googleapis")));
    }
  });

  it("missing property_id returns RESOURCE_REQUIRED with zero HTTP", async () => {
    const ctx = makeCtx();
    for (const bad of [undefined, "", "default", "first", "0"]) {
      const env = await dispatch(ctx, "ga4_run_report", {
        property_id: bad,
        date_ranges: [{ start_date: "2026-08-01", end_date: "2026-08-31" }],
        metrics: ["sessions"],
      });
      assert.equal(env.error_code, "RESOURCE_REQUIRED", `failed for ${JSON.stringify(bad)}`);
      assert.equal(ctx.calls.length, 0);
    }
  });

  it("40-property fixture never picks index 0", async () => {
    const ctx = makeCtx({ agencySummaries: true });
    const listed = await dispatch(ctx, "ga4_list_account_summaries", {});
    assert.equal(listed.ok, true);
    const summaries = (listed.data as { account_summaries: Array<{ propertySummaries: Array<{ property: string }> }> })
      .account_summaries;
    const props = summaries[0]?.propertySummaries ?? [];
    assert.equal(props.length, 40);
    const first = props[0]?.property;
    const last = props[39]?.property;
    assert.equal(first, "properties/2000000001");
    assert.equal(last, "properties/2000000040");

    const before = ctx.calls.length;
    const missing = await dispatch(ctx, "ga4_run_report", {
      date_ranges: [{ start_date: "2026-08-01", end_date: "2026-08-31" }],
      metrics: ["sessions"],
    });
    assert.equal(missing.error_code, "RESOURCE_REQUIRED");
    assert.equal(ctx.calls.length, before);

    const targeted = await dispatch(ctx, "ga4_run_report", reportArgs("properties/2000000040"));
    assert.equal(targeted.ok, true);
    const reportCalls = ctx.calls.filter((c) => c.path.includes(":runReport"));
    assert.equal(reportCalls.length, 1);
    assert.ok(reportCalls[0]?.path.includes("2000000040"));
    assert.ok(!reportCalls[0]?.path.includes("2000000001"));
    assert.ok(ctx.calls.every((c) => !c.path.includes("2000000001") || !c.path.includes(":runReport")));
  });

  it("LICENSE_REQUIRED for gads tools but ga4 still works", async () => {
    const ctx = makeCtx();
    const ads = await dispatch(ctx, "gads_search", {
      customer_id: "123",
      recipe: "campaigns",
    });
    assert.equal(ads.ok, false);
    assert.equal(ads.error_code, "LICENSE_REQUIRED");
    assert.equal(ctx.calls.length, 0);

    const ga4 = await dispatch(ctx, "ga4_run_report", reportArgs());
    assert.equal(ga4.ok, true);
    assert.ok(ga4.quota);
    const rows = (ga4.data as { rows?: unknown[] }).rows ?? [];
    assert.ok(rows.length > 0);
  });

  it("expired JWT is LICENSE_REQUIRED and does not break GA4", async () => {
    const jwt = signLicense({
      sub: "test-user",
      exp: 1,
      features: ["ads", "meta"],
      jti: "expired-jti",
    });
    const ctx = makeCtx({}, testEnv({ DGTL_LICENSE_JWT: jwt }));
    assert.equal(ctx.license.ok, false);
    assert.equal(ctx.license.reason, "expired");
    const ads = await dispatch(ctx, "gads_list_accessible_customers", {});
    assert.equal(ads.error_code, "LICENSE_REQUIRED");
    const ga4 = await dispatch(ctx, "ga4_get_property", { property_id: "111111111" });
    assert.equal(ga4.ok, true);
  });

  it("valid license still does not attach developer-token; ga4 works", async () => {
    const jwt = signLicense({
      sub: "test-user",
      exp: Math.floor(Date.now() / 1000) + 86400,
      features: ["ads"],
      jti: "ok-jti",
    });
    const ctx = makeCtx({}, testEnv({ DGTL_LICENSE_JWT: jwt }));
    assert.equal(ctx.license.ok, true);
    const ads = await dispatch(ctx, "gads_search", { customer_id: "123", recipe: "campaigns" });
    assert.equal(ads.ok, false);
    assert.ok(ads.error_code === "ADS_SCOPE_MISSING" || ads.error_code === "LICENSE_REQUIRED");
    assert.ok(ctx.calls.every((c) => !c.hasDeveloperToken));
    const ga4 = await dispatch(ctx, "ga4_run_report", reportArgs());
    assert.equal(ga4.ok, true);
  });

  it("GBP tools return GBP_NOT_ENABLED with zero HTTP", async () => {
    const ctx = makeCtx();
    for (const name of ["gbp_list_accounts", "gbp_list_locations", "gbp_get_location", "gbp_performance", "gbp_search_keywords"]) {
      const env = await dispatch(ctx, name, {});
      assert.equal(env.error_code, "GBP_NOT_ENABLED", name);
    }
    assert.equal(ctx.calls.length, 0);
  });

  it("empty report is ok: true with row_count 0", async () => {
    const ctx = makeCtx({ emptyReport: true });
    const env = await dispatch(ctx, "ga4_run_report", reportArgs());
    assert.equal(env.ok, true);
    assert.equal(env.page?.row_count, 0);
  });

  it("oversize GTM tag list truncates", async () => {
    const ctx = makeCtx({ oversizeTags: true });
    const env = await dispatch(ctx, "gtm_list_tags", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      page_size: 50,
    });
    assert.equal(env.ok, true);
    assert.equal(env.page?.truncated, true);
    assert.equal(env.page?.row_count, 80);
    const tags = (env.data as { tag: unknown[] }).tag;
    assert.equal(tags.length, 50);
    assert.ok(env.page?.next_page_token);
  });

  it("GTM 403 accessNotConfigured maps without guessing a container", async () => {
    const ctx = makeCtx({ gtmForbidden: true });
    const env = await dispatch(ctx, "gtm_list_accounts", {});
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "ACCESS_NOT_CONFIGURED");
    assert.equal(env.google_status, 403);
    assert.equal(env.api, "tagmanager.googleapis.com");
  });

  it("CONSENT_MISSING for GTM when only GA4 scope was granted — zero GTM HTTP after whoami", async () => {
    const ctx = makeCtx(
      {},
      testEnv({ GOOGLE_GRANTED_SCOPES: `${SCOPE_ANALYTICS} ${SCOPE_OPENID}` }),
    );
    const env = await dispatch(ctx, "gtm_list_accounts", {});
    assert.equal(env.error_code, "CONSENT_MISSING");
    assert.ok(String(env.missing_scope).includes("tagmanager"));
    assert.equal(ctx.calls.length, 0);
  });

  it("UNAUTHENTICATED when no token", async () => {
    const ctx = makeCtx({}, testEnv({ GOOGLE_ACCESS_TOKEN: "", DGTL_GOOGLE_ACCESS_TOKEN: "" }));
    const env = await dispatch(ctx, "google_whoami", {});
    assert.equal(env.error_code, "UNAUTHENTICATED");
    assert.ok(String(env.message).toLowerCase().includes("pkce") || String(env.message).toLowerCase().includes("stdio"));
    assert.ok(!String(env.message).toLowerCase().includes("connect card") || String(env.message).includes("no Gmail"));
  });

  it("closed free kernel is 23 tools including ga4_list_account_summaries", () => {
    assert.equal(FREE_TOOL_NAMES.length, 23);
    assert.ok(FREE_TOOL_NAMES.includes("ga4_list_account_summaries"));
    assert.ok(FREE_TOOL_NAMES.includes("ga4_run_report"));
    assert.ok(TOOLS.some((t) => t.name === "gads_search"));
    assert.ok(!TOOLS.some((t) => t.name.includes(".")));
  });

  it("date range > 366 days is INVALID_ARGUMENT with zero HTTP", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "ga4_run_report", {
      property_id: "111111111",
      date_ranges: [{ start_date: "2024-01-01", end_date: "2026-08-01" }],
      metrics: ["sessions"],
    });
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(ctx.calls.length, 0);
  });
});

const SCOPE_ANALYTICS = "https://www.googleapis.com/auth/analytics.readonly";
const SCOPE_OPENID = "openid";
void ALL_SCOPES;
