import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { AuthPort } from "../src/auth/port.js";
import { STORE_FILE, writeStore } from "../src/auth/store.js";
import { CONSENT_A, CONSENT_B, SCOPE } from "../src/google/scopes.js";
import { buildGoogleAuthUrl, generatePkce } from "../src/auth/pkce.js";
import { helpText } from "../src/auth/login-cli.js";
import { dispatch } from "../src/tools/dispatch.js";
import { LICENSE_GATED_TOOLS, LOCAL_FREE_TOOLS, TOOLS } from "../src/tools/registry.js";
import { loadFlags } from "../src/flags.js";
import { installNetworkGuard, makeCtx, testEnv, TEST_TOKEN } from "./helpers.js";

const GBP_READ = [
  "gbp_list_accounts",
  "gbp_list_locations",
  "gbp_get_location",
  "gbp_performance",
  "gbp_search_keywords",
] as const;

function gbpOnEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return testEnv({
    DGTL_GBP_ENABLED: "true",
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    GOOGLE_GBP_ACCESS_TOKEN: "gbp-user-token-fixture",
    GOOGLE_GBP_GRANTED_SCOPES: SCOPE.business,
    ...extra,
  });
}

describe("Wave 5 GBP live readonly HTTP", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("GBP tools are registered readonly and local-free (not Consent A kernel, not Polar, not stamp)", () => {
    for (const name of GBP_READ) {
      const t = TOOLS.find((x) => x.name === name);
      assert.ok(t, name);
      assert.equal(t!.family, "gbp", name);
      assert.equal(t!.group, "gbp", name);
      assert.equal(t!.annotations.readOnlyHint, true, name);
      assert.equal(t!.annotations.destructiveHint, false, name);
      assert.ok(LOCAL_FREE_TOOLS.includes(name), name);
      assert.ok(!LICENSE_GATED_TOOLS.includes(name), name);
    }
    assert.ok(!TOOLS.some((t) => t.name === "gbp_create_post"));
    assert.ok(!TOOLS.some((t) => t.name === "gbp_reply_review"));
  });

  it("CONSENT_B is business.manage only and never on Consent A / default auth URL", () => {
    assert.deepEqual([...CONSENT_B], [SCOPE.business]);
    assert.ok(!(CONSENT_A as readonly string[]).includes(SCOPE.business));
    const pkce = generatePkce();
    const aUrl = buildGoogleAuthUrl({
      clientId: "a-client.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:9876/callback",
      challenge: pkce.challenge,
      state: pkce.state,
    });
    const granted = new URL(aUrl).searchParams.get("scope")?.split(/\s+/) ?? [];
    assert.deepEqual(granted, [...CONSENT_A]);
    assert.ok(!granted.includes(SCOPE.business));
    assert.ok(!aUrl.includes("business.manage"));

    const bUrl = buildGoogleAuthUrl({
      clientId: "gbp-client.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:9876/callback",
      challenge: pkce.challenge,
      state: pkce.state,
      scopes: CONSENT_B,
    });
    assert.deepEqual(new URL(bUrl).searchParams.get("scope")?.split(/\s+/), [SCOPE.business]);
    assert.ok(!new URL(bUrl).searchParams.get("scope")?.includes("analytics.readonly"));
  });

  it("helpText documents login-gbp and never-Consent-A", () => {
    const h = helpText();
    assert.ok(h.includes("auth login-gbp"));
    assert.ok(h.includes("auth logout-gbp"));
    assert.ok(h.includes("GOOGLE_GBP_ACCESS_TOKEN") || h.includes("google-oauth-gbp.json"));
    assert.ok(h.includes("business.manage"));
    assert.ok(h.includes("no stamp") || h.includes("Direct GBP"));
    assert.ok(!h.includes("Phase 7"));
  });

  it("DGTL_GBP_ENABLED defaults false", () => {
    assert.equal(loadFlags({}).gbpEnabled, false);
    assert.equal(loadFlags({ DGTL_GBP_ENABLED: "false" }).gbpEnabled, false);
    assert.equal(loadFlags({ DGTL_GBP_ENABLED: "true" }).gbpEnabled, true);
  });

  it("AuthPort A ignores GBP token; GBP port ignores Consent A", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-gbp-ports-"));
    try {
      const fetchImpl = (async () => {
        throw new Error("NETWORK_FORBIDDEN");
      }) as typeof fetch;
      const a = AuthPort.fromEnv({
        env: { GOOGLE_GBP_ACCESS_TOKEN: "gbp-only", GOOGLE_MC_ACCESS_TOKEN: "mc-only" },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal(await a.getAccessToken(), null);

      const gbp = AuthPort.gbpFromEnv({
        env: { GOOGLE_ACCESS_TOKEN: "consent-a", GOOGLE_MC_ACCESS_TOKEN: "mc-only" },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal(await gbp.getAccessToken(), null);

      const gbp2 = AuthPort.gbpFromEnv({
        env: { GOOGLE_GBP_ACCESS_TOKEN: "gbp-only" },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal((await gbp2.getAccessToken())?.accessToken, "gbp-only");

      writeStore(dir, { access_token: "a-token", expiry: Date.now() + 3_600_000 }, STORE_FILE.a);
      writeStore(dir, { access_token: "gbp-file", expiry: Date.now() + 3_600_000 }, STORE_FILE.gbp);
      assert.ok(!readFileSync(join(dir, "google-oauth.json"), "utf8").includes("gbp-file"));
      assert.ok(!readFileSync(join(dir, "google-oauth-gbp.json"), "utf8").includes("a-token"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flag off → GBP_NOT_ENABLED; never uses Consent A; zero hop (no Phase 7 stub)", async () => {
    const ctx = makeCtx({}, testEnv({ DGTL_GBP_ENABLED: "", GOOGLE_ACCESS_TOKEN: TEST_TOKEN }));
    let authCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "gbp_list_accounts", {});
    assert.equal(env.error_code, "GBP_NOT_ENABLED");
    assert.ok(!env.hint?.includes("Phase 7"));
    assert.ok(!env.hint?.includes("not in this binary"));
    assert.equal(authCalls, 0);
    assert.equal(ctx.calls.length, 0);
    assert.ok(ctx.httpGbp !== ctx.http);
  });

  it("flag on + Consent A only → GBP_NOT_CONNECTED; never uses ctx.auth; no gateway required", async () => {
    const ctx = makeCtx(
      {},
      gbpOnEnv({ GOOGLE_GBP_ACCESS_TOKEN: "", GOOGLE_GBP_GRANTED_SCOPES: "" }),
    );
    let authCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "gbp_list_accounts", {});
    assert.equal(env.error_code, "GBP_NOT_CONNECTED");
    assert.equal(authCalls, 0);
    assert.equal(ctx.calls.length, 0);
    assert.ok(
      env.hint?.includes("Consent B") ||
        env.message?.includes("Consent B") ||
        env.hint?.includes("login-gbp"),
    );
    assert.notEqual(env.error_code, "GATEWAY_UNAVAILABLE");
    assert.notEqual(env.error_code, "LICENSE_REQUIRED");
  });

  it("GBP token without business.manage → GBP_SCOPE_MISSING zero hop", async () => {
    const ctx = makeCtx({}, gbpOnEnv({ GOOGLE_GBP_GRANTED_SCOPES: "openid email" }));
    const env = await dispatch(ctx, "gbp_list_locations", { account_name: "accounts/111111111111111111111" });
    assert.equal(env.error_code, "GBP_SCOPE_MISSING");
    assert.equal(env.missing_scope, SCOPE.business);
    assert.equal(ctx.calls.length, 0);
  });

  it("gbp_list_locations without account_name → RESOURCE_REQUIRED zero hop", async () => {
    const ctx = makeCtx({}, gbpOnEnv());
    const env = await dispatch(ctx, "gbp_list_locations", {});
    assert.equal(env.error_code, "RESOURCE_REQUIRED");
    assert.equal(ctx.calls.length, 0);
  });

  it("gbp_get_location / performance without location_name → RESOURCE_REQUIRED", async () => {
    const ctx = makeCtx({}, gbpOnEnv());
    const get = await dispatch(ctx, "gbp_get_location", {});
    assert.equal(get.error_code, "RESOURCE_REQUIRED");
    const perf = await dispatch(ctx, "gbp_performance", { start_date: "2026-08-01", end_date: "2026-08-31" });
    assert.equal(perf.error_code, "RESOURCE_REQUIRED");
    assert.equal(ctx.calls.length, 0);
  });

  it("flag on hops accounts.list (not stamp, not Consent A host)", async () => {
    const ctx = makeCtx({}, gbpOnEnv());
    const env = await dispatch(ctx, "gbp_list_accounts", {});
    assert.equal(env.ok, true);
    const data = env.data as { accounts?: unknown[] };
    assert.equal(data.accounts?.length, 1);
    assert.equal(ctx.calls.length, 1);
    assert.equal(ctx.calls[0]?.host, "mybusinessaccountmanagement.googleapis.com");
    assert.equal(ctx.calls[0]?.path, "/v1/accounts");
    assert.equal(ctx.calls[0]?.method, "GET");
    assert.equal(ctx.calls[0]?.hasDeveloperToken, false);
  });

  it("locations list + get read fixtures", async () => {
    const ctx = makeCtx({}, gbpOnEnv());
    const list = await dispatch(ctx, "gbp_list_locations", {
      account_name: "111111111111111111111",
    });
    assert.equal(list.ok, true);
    const locations = (list.data as { locations?: unknown[] }).locations ?? [];
    assert.equal(locations.length, 1);
    assert.equal(list.resource?.id, "111111111111111111111");

    const get = await dispatch(ctx, "gbp_get_location", {
      location_name: "locations/12345678901234567890",
    });
    assert.equal(get.ok, true);
    assert.equal(get.resource?.type, "gbp_location");
    const getData = get.data as { title?: string; metadata?: { placeId?: string } };
    assert.equal(getData.title, "Example Brand Store");
    assert.equal(getData.metadata?.placeId, "ChIJexampleplaceid0001");

    const hops = ctx.calls.filter((c) => c.host === "mybusinessbusinessinformation.googleapis.com");
    assert.equal(hops.length, 2);
    assert.ok(hops.every((c) => c.method === "GET"));
    assert.ok(hops.every((c) => !c.hasDeveloperToken));
    assert.ok(hops.some((c) => c.path === "/v1/accounts/111111111111111111111/locations"));
    assert.ok(hops.some((c) => c.path === "/v1/locations/12345678901234567890"));
  });

  it("performance + search keywords hop Performance API GET-only", async () => {
    const ctx = makeCtx({}, gbpOnEnv());
    const perf = await dispatch(ctx, "gbp_performance", {
      location_name: "12345678901234567890",
      start_date: "2026-08-01",
      end_date: "2026-08-31",
    });
    assert.equal(perf.ok, true);
    const series = (perf.data as { multiDailyMetricTimeSeries?: unknown[] }).multiDailyMetricTimeSeries ?? [];
    assert.equal(series.length, 1);
    assert.ok(perf.hint?.includes("does not list locations"));

    const kw = await dispatch(ctx, "gbp_search_keywords", {
      location_name: "locations/12345678901234567890",
      month: "2026-08",
    });
    assert.equal(kw.ok, true);
    const rows = (kw.data as { searchKeywordsCounts?: unknown[] }).searchKeywordsCounts ?? [];
    assert.equal(rows.length, 2);

    const hops = ctx.calls.filter((c) => c.host === "businessprofileperformance.googleapis.com");
    assert.equal(hops.length, 2);
    assert.ok(hops.every((c) => c.method === "GET"));
    assert.ok(hops.every((c) => !c.hasDeveloperToken));
    assert.ok(hops.some((c) => c.path.includes(":fetchMultiDailyMetricsTimeSeries")));
    assert.ok(hops.some((c) => c.path.includes("/searchkeywords/impressions/monthly")));
  });

  it("invalid daily_metric / dates fail closed with zero hop", async () => {
    const ctx = makeCtx({}, gbpOnEnv());
    const metric = await dispatch(ctx, "gbp_performance", {
      location_name: "locations/1",
      start_date: "2026-08-01",
      end_date: "2026-08-31",
      daily_metric: "SESSIONS",
    });
    assert.equal(metric.error_code, "INVALID_ARGUMENT");
    const date = await dispatch(ctx, "gbp_performance", {
      location_name: "locations/1",
      start_date: "August 1",
      end_date: "2026-08-31",
    });
    assert.equal(date.error_code, "INVALID_ARGUMENT");
    const month = await dispatch(ctx, "gbp_search_keywords", {
      location_name: "locations/1",
      month: "August",
    });
    assert.equal(month.error_code, "INVALID_ARGUMENT");
    assert.equal(ctx.calls.length, 0);
  });

  it("GBP hop does not require DGTL_GATEWAY_URL or Polar license", async () => {
    const ctx = makeCtx(
      {},
      gbpOnEnv({ DGTL_GATEWAY_URL: "", DGTL_LICENSE_JWT: "" }),
    );
    const env = await dispatch(ctx, "gbp_list_accounts", {});
    assert.equal(env.ok, true);
    assert.notEqual(env.error_code, "GATEWAY_UNAVAILABLE");
    assert.notEqual(env.error_code, "LICENSE_REQUIRED");
  });

  it("Consent A GoogleHttp refuses GBP hosts; GBP client refuses POST", async () => {
    const ctx = makeCtx({}, gbpOnEnv());
    await assert.rejects(
      () =>
        ctx.http.get(
          "mybusinessaccountmanagement.googleapis.com",
          "/v1/accounts",
          undefined,
          { api: "gbp", tool: "probe" },
        ),
      (err: unknown) => {
        const e = err as { error_code?: string; message?: string };
        return e.error_code === "UNSUPPORTED_OPERATION" && Boolean(e.message?.includes("non-allowlisted"));
      },
    );
    await assert.rejects(
      () =>
        ctx.httpGbp.post(
          "mybusinessaccountmanagement.googleapis.com",
          "/v1/accounts",
          { name: "nope" },
          { api: "gbp", tool: "probe" },
        ),
      (err: unknown) => {
        const e = err as { error_code?: string };
        return e.error_code === "UNSUPPORTED_OPERATION";
      },
    );
    assert.ok(ctx.calls.every((c) => c.method === "GET" || c.host !== "mybusinessaccountmanagement.googleapis.com"));
  });
});
