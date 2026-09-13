import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { googleGa4AdminPathAllowed } from "../src/http/google-ga4-admin.js";
import { CONSENT_A, CONSENT_G } from "../src/google/scopes.js";
import * as S from "../src/tools/schemas.js";
import { dispatch } from "../src/tools/dispatch.js";
import { CONSENT_A_TOOLS, GA4_WRITE_TOOL_NAMES, TOOLS } from "../src/tools/registry.js";
import { installNetworkGuard, makeCtx, testEnv, TEST_TOKEN } from "./helpers.js";

const PROP = "properties/111111111";
const ACCOUNT = "accounts/111111";
const G_TOKEN = "ga4-admin-test-token";
const MP_LIST_SECRET = "mp-secret-MUST-NOT-APPEAR-IN-LOGS";
const MP_CREATE_SECRET = "mp-created-secret-MUST-NOT-APPEAR-IN-LOGS";

const WRITE_TOOLS = [
  "ga4_create_google_ads_link",
  "ga4_delete_google_ads_link",
  "ga4_update_attribution_settings",
  "ga4_create_data_stream",
  "ga4_update_data_stream",
  "ga4_create_key_event",
  "ga4_update_key_event",
  "ga4_create_custom_dimension",
  "ga4_create_custom_metric",
  "ga4_create_mp_secret",
  "ga4_create_property",
] as const;

function gEnv(extra: NodeJS.ProcessEnv = {}) {
  return testEnv({
    DGTL_WRITES_ENABLED: "true",
    GOOGLE_GA4_ADMIN_ACCESS_TOKEN: G_TOKEN,
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    ...extra,
  });
}

function callsBlob(ctx: ReturnType<typeof makeCtx>): string {
  return JSON.stringify(ctx.calls);
}

describe("Wave 11 GA4 Admin (Consent G)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("write tools are registered, not in CONSENT_A_TOOLS, family ga4_write", () => {
    assert.equal(CONSENT_A_TOOLS.length, 24);
    assert.ok(GA4_WRITE_TOOL_NAMES.length >= 14);
    for (const name of WRITE_TOOLS) {
      assert.ok(!CONSENT_A_TOOLS.includes(name), name);
      const spec = TOOLS.find((t) => t.name === name);
      assert.equal(spec?.family, "ga4_write", name);
      assert.equal(spec?.annotations.readOnlyHint, false, name);
      assert.ok(!/confirm_phrase\s*=/.test(spec!.description), name);
    }
    assert.ok(!CONSENT_A_TOOLS.includes("ga4_list_google_ads_links"));
    assert.ok(!CONSENT_A_TOOLS.includes("ga4_list_mp_secrets"));
    assert.ok(!CONSENT_A_TOOLS.includes("ga4_get_attribution_settings"));
  });

  it("A ∩ G = ∅ still", () => {
    const setG = new Set<string>(CONSENT_G);
    assert.deepEqual(
      CONSENT_A.filter((s) => setG.has(s)),
      [],
    );
  });

  it("schemas default dry_run true; live needs confirm_phrase", () => {
    const parsed = S.ga4CreateDataStream.parse({
      property_id: PROP,
      display_name: "Web",
      default_uri: "https://example.com",
    });
    assert.equal(parsed.dry_run, true);
    const liveMissing = S.ga4CreateProperty.safeParse({
      account_id: ACCOUNT,
      display_name: "X",
      time_zone: "America/Los_Angeles",
      currency_code: "USD",
      dry_run: false,
    });
    assert.equal(liveMissing.success, false);
  });

  it("path allowlist is closed (no mega-mutate)", () => {
    assert.equal(googleGa4AdminPathAllowed("POST", "/v1beta/properties/111111111/googleAdsLinks"), true);
    assert.equal(googleGa4AdminPathAllowed("DELETE", "/v1beta/properties/111111111/googleAdsLinks/222"), true);
    assert.equal(googleGa4AdminPathAllowed("GET", "/v1alpha/properties/111111111/attributionSettings"), true);
    assert.equal(googleGa4AdminPathAllowed("PATCH", "/v1alpha/properties/111111111/attributionSettings"), true);
    assert.equal(googleGa4AdminPathAllowed("POST", "/v1beta/properties/111111111/dataStreams"), true);
    assert.equal(googleGa4AdminPathAllowed("POST", "/v1beta/properties"), true);
    assert.equal(googleGa4AdminPathAllowed("DELETE", "/v1beta/properties/111111111"), false);
    assert.equal(googleGa4AdminPathAllowed("POST", "/v1beta/properties/111111111/firebaseLinks"), false);
    assert.equal(googleGa4AdminPathAllowed("GET", "/v1beta/accounts"), false);
    assert.equal(googleGa4AdminPathAllowed("POST", "/v1beta/properties/111111111:runAccessReport"), false);
  });

  it("WRITE_NOT_ENABLED with zero HTTP", async () => {
    const ctx = makeCtx({}, testEnv({ GOOGLE_GA4_ADMIN_ACCESS_TOKEN: G_TOKEN }));
    const env = await dispatch(ctx, "ga4_create_data_stream", {
      property_id: PROP,
      display_name: "Web",
      default_uri: "https://example.com",
      dry_run: false,
      confirm_phrase: PROP,
    });
    assert.equal(env.error_code, "WRITE_NOT_ENABLED");
    assert.equal(ctx.calls.length, 0);
  });

  it("CONSENT_G_REQUIRED when flag on but no G token; never uses Consent A", async () => {
    const ctx = makeCtx({}, testEnv({ DGTL_WRITES_ENABLED: "true" }));
    let aCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      aCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "ga4_create_key_event", {
      property_id: PROP,
      event_name: "purchase",
      dry_run: false,
      confirm_phrase: PROP,
    });
    assert.equal(env.error_code, "CONSENT_G_REQUIRED");
    assert.equal(aCalls, 0);
    assert.equal(ctx.calls.length, 0);
  });

  it("list Google Ads links uses Consent A GET", async () => {
    const ctx = makeCtx();
    let gCalls = 0;
    const orig = ctx.authGa4Admin.getAccessToken.bind(ctx.authGa4Admin);
    ctx.authGa4Admin.getAccessToken = async () => {
      gCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "ga4_list_google_ads_links", { property_id: PROP });
    assert.equal(env.ok, true, JSON.stringify(env));
    const data = env.data as { google_ads_links: unknown[]; consent: string };
    assert.equal(data.consent, "A");
    assert.ok(Array.isArray(data.google_ads_links));
    assert.equal(gCalls, 0);
    assert.ok(ctx.calls.some((c) => c.method === "GET" && c.path.endsWith("/googleAdsLinks")));
    assert.ok(ctx.calls.every((c) => c.method === "GET"));
  });

  it("get attribution settings uses Consent A v1alpha GET", async () => {
    const ctx = makeCtx();
    let gCalls = 0;
    ctx.authGa4Admin.getAccessToken = async () => {
      gCalls += 1;
      return null;
    };
    const env = await dispatch(ctx, "ga4_get_attribution_settings", { property_id: PROP });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal((env.data as { api_version: string }).api_version, "v1alpha");
    assert.equal(gCalls, 0);
    assert.ok(ctx.calls.some((c) => c.method === "GET" && c.path.endsWith("/attributionSettings")));
  });

  it("dry_run create data stream is zero mutate HTTP", async () => {
    const ctx = makeCtx({}, gEnv());
    const env = await dispatch(ctx, "ga4_create_data_stream", {
      property_id: PROP,
      display_name: "Web",
      default_uri: "https://example.com",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal((env.data as { dry_run: boolean }).dry_run, true);
    assert.ok(!ctx.calls.some((c) => c.method !== "GET"));
  });

  it("live mutate without properties/{id} in confirm_phrase → INVALID_ARGUMENT", async () => {
    const ctx = makeCtx({}, gEnv());
    const env = await dispatch(ctx, "ga4_create_data_stream", {
      property_id: PROP,
      display_name: "Web",
      default_uri: "https://example.com",
      dry_run: false,
      confirm_phrase: "yes do it",
    });
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.ok(!ctx.calls.some((c) => c.method === "POST" || c.method === "PATCH" || c.method === "DELETE"));
  });

  it("live writes use httpGa4Admin and never ctx.auth", async () => {
    const cases: Array<{ tool: string; args: Record<string, unknown>; method: string; pathIncludes: string }> = [
      {
        tool: "ga4_create_google_ads_link",
        args: { property_id: PROP, customer_id: "123-456-7890" },
        method: "POST",
        pathIncludes: "/googleAdsLinks",
      },
      {
        tool: "ga4_delete_google_ads_link",
        args: { property_id: PROP, ads_link_id: "222222" },
        method: "DELETE",
        pathIncludes: "/googleAdsLinks/222222",
      },
      {
        tool: "ga4_update_attribution_settings",
        args: { property_id: PROP, reporting_attribution_model: "PAID_AND_ORGANIC_CHANNELS_LAST_CLICK" },
        method: "PATCH",
        pathIncludes: "/attributionSettings",
      },
      {
        tool: "ga4_create_data_stream",
        args: { property_id: PROP, display_name: "Web", default_uri: "https://example.com" },
        method: "POST",
        pathIncludes: "/dataStreams",
      },
      {
        tool: "ga4_update_data_stream",
        args: { property_id: PROP, stream_id: "3333333", display_name: "Updated" },
        method: "PATCH",
        pathIncludes: "/dataStreams/3333333",
      },
      {
        tool: "ga4_create_key_event",
        args: { property_id: PROP, event_name: "purchase" },
        method: "POST",
        pathIncludes: "/keyEvents",
      },
      {
        tool: "ga4_update_key_event",
        args: { property_id: PROP, key_event_id: "4444444", counting_method: "ONCE_PER_SESSION" },
        method: "PATCH",
        pathIncludes: "/keyEvents/4444444",
      },
      {
        tool: "ga4_create_custom_dimension",
        args: {
          property_id: PROP,
          parameter_name: "subscription_name",
          display_name: "Subscription Name",
          scope: "EVENT",
        },
        method: "POST",
        pathIncludes: "/customDimensions",
      },
      {
        tool: "ga4_create_custom_metric",
        args: { property_id: PROP, parameter_name: "item_value", display_name: "Item Value" },
        method: "POST",
        pathIncludes: "/customMetrics",
      },
    ];
    for (const c of cases) {
      const ctx = makeCtx({}, gEnv());
      let aCalls = 0;
      const orig = ctx.auth.getAccessToken.bind(ctx.auth);
      ctx.auth.getAccessToken = async () => {
        aCalls += 1;
        return orig();
      };
      const env = await dispatch(ctx, c.tool, {
        ...c.args,
        dry_run: false,
        confirm_phrase: `please apply ${PROP}`,
      });
      assert.equal(env.ok, true, `${c.tool} ${JSON.stringify(env)}`);
      assert.equal(aCalls, 0, c.tool);
      assert.ok(
        ctx.calls.some((x) => x.method === c.method && x.path.includes(c.pathIncludes)),
        `${c.tool} missing ${c.method} ${c.pathIncludes} in ${JSON.stringify(ctx.calls)}`,
      );
      assert.ok(ctx.calls.every((x) => x.host === "analyticsadmin.googleapis.com"), c.tool);
    }
  });

  it("create_property confirm uses accounts/{id}", async () => {
    const ctx = makeCtx({}, gEnv());
    const bad = await dispatch(ctx, "ga4_create_property", {
      account_id: ACCOUNT,
      display_name: "DGTL disposable fixture",
      time_zone: "America/Los_Angeles",
      currency_code: "USD",
      dry_run: false,
      confirm_phrase: PROP,
    });
    assert.equal(bad.error_code, "INVALID_ARGUMENT");
    const ok = await dispatch(ctx, "ga4_create_property", {
      account_id: ACCOUNT,
      display_name: "DGTL disposable fixture",
      time_zone: "America/Los_Angeles",
      currency_code: "USD",
      dry_run: false,
      confirm_phrase: `create under ${ACCOUNT}`,
    });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.ok(ctx.calls.some((c) => c.method === "POST" && c.path === "/v1beta/properties"));
  });

  it("locked numeric id is refused with zero HTTP", async () => {
    const ctx = makeCtx({}, gEnv());
    const env = await dispatch(ctx, "ga4_create_data_stream", {
      property_id: "2859537899",
      display_name: "Web",
      default_uri: "https://example.com",
      dry_run: true,
    });
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.equal(ctx.calls.length, 0);
  });

  it("list MP secrets uses Consent G and redacts secretValue", async () => {
    const ctx = makeCtx(
      {},
      testEnv({
        GOOGLE_GA4_ADMIN_ACCESS_TOKEN: G_TOKEN,
        GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
      }),
    );
    let aCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      aCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "ga4_list_mp_secrets", {
      property_id: PROP,
      stream_id: "3333333",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal(aCalls, 0);
    const blob = JSON.stringify(env);
    assert.ok(!blob.includes(MP_LIST_SECRET));
    assert.ok(!callsBlob(ctx).includes(MP_LIST_SECRET));
    assert.equal((env.data as { secret_values_redacted: boolean }).secret_values_redacted, true);
  });

  it("create MP secret returns value in data but never in call logs", async () => {
    const ctx = makeCtx({}, gEnv());
    const env = await dispatch(ctx, "ga4_create_mp_secret", {
      property_id: PROP,
      stream_id: "3333333",
      display_name: "ci-fixture",
      dry_run: false,
      confirm_phrase: PROP,
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    const data = env.data as { measurement_protocol_secret: { secretValue?: string } };
    assert.equal(data.measurement_protocol_secret.secretValue, MP_CREATE_SECRET);
    assert.ok(!callsBlob(ctx).includes(MP_CREATE_SECRET));
    assert.ok(!JSON.stringify(ctx.calls).includes("secretValue"));
  });
});
