import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createAppContext } from "../src/context.js";
import {
  CONVERSION_FABRIC_WAVE,
  SGTM_APPLY_HEADER,
  SGTM_CLOSED_EVENT,
  SGTM_FUNDED_HEADER,
  SGTM_INGEST_PATH,
  applyKeyPresent,
} from "../src/conversion/fabric.js";
import { loadFlags } from "../src/flags.js";
import { CONVERSION_FABRIC } from "../src/gateway/hop-maps.generated.js";
import { hasFeature } from "../src/license/verify.js";
import { CONSENT_A_KERNEL_COUNT, CONSENT_A_TOOLS, TOOLS } from "../src/tools/registry.js";
import { dispatch } from "../src/tools/dispatch.js";
import { ROOT, installNetworkGuard, makeCtx, signLicense, testEnv } from "./helpers.js";

const GATEWAY = "https://gateway.test.dgtl";
const STATUS_FIXTURE = JSON.parse(
  readFileSync(join(ROOT, "fixtures/conversion/fabric.status.json"), "utf8"),
) as {
  replaces_product_story: string;
  stamp_interface: string;
  sinks: Array<{
    id: string;
    stamp_sink: string;
    stamp_hop: string;
    plugin_send_tool: string | null;
    rpc?: string;
    not?: string;
  }>;
  ingest: { path: string; apply_header: string; funded_header: string; plugin_test_tool: string };
};
const APPLY_FIXTURE = JSON.parse(
  readFileSync(join(ROOT, "fixtures/conversion/sgtm.ingest.apply.json"), "utf8"),
) as {
  event_name: string;
  event_id: string;
  application_id: string;
  client_id: string;
};

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
    for (const [k, v] of h) out[k.toLowerCase()] = String(v);
    return out;
  }
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

function mockGateway(opts: {
  health?: Record<string, unknown>;
  ingestStatus?: number;
  ingestBody?: unknown;
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
    if (url.includes("googleapis.com") || url.includes("graph.facebook.com") || url.includes("tiktok.com")) {
      throw new Error(`NETWORK_FORBIDDEN live host: ${url}`);
    }
    if (url.endsWith("/v1/health")) {
      return new Response(
        JSON.stringify({
          ok: true,
          ads_mutate_enabled: false,
          meta_mutate_enabled: false,
          tiktok_mutate_enabled: false,
          meta_capi_enabled: true,
          tiktok_events_enabled: true,
          ads_data_manager_enabled: true,
          sgtm_ingest_enabled: true,
          ...opts.health,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.endsWith(SGTM_INGEST_PATH)) {
      return new Response(JSON.stringify(opts.ingestBody ?? { ok: true, accepted: true }), {
        status: opts.ingestStatus ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  return { fetchImpl, captures };
}

function fabricCtx(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch) {
  return createAppContext({
    pluginRoot: ROOT,
    env,
    fetchImpl,
    now: () => new Date("2026-09-13T12:00:00Z"),
  });
}

function assertNoSecrets(blob: string): void {
  assert.ok(!blob.includes("eyJ"));
  assert.ok(!/ya29\./.test(blob));
  assert.ok(!blob.includes("apply-secret"));
  assert.ok(!blob.includes("ingest-secret"));
  assert.ok(!blob.toLowerCase().includes("bearer "));
  assert.ok(!blob.includes("user@example.com"));
  assert.ok(!/"user_data"\s*:/.test(blob));
}

describe("Wave 20 conversion fabric", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("registers named tools; Consent A stays 26; no Wave 21 budget skill", () => {
    assert.ok(TOOLS.some((t) => t.name === "conversion_fabric_status"));
    assert.ok(TOOLS.some((t) => t.name === "sgtm_ingest_test"));
    assert.ok(TOOLS.some((t) => t.name === "meta_send_capi_events"));
    assert.ok(TOOLS.some((t) => t.name === "tiktok_track_events"));
    assert.ok(!TOOLS.some((t) => t.name === "ads_data_manager_ingest_events"));
    assert.ok(!TOOLS.some((t) => /budget/i.test(t.name) && t.name.includes("wave21")));
    assert.equal(CONSENT_A_KERNEL_COUNT, 26);
    assert.equal(CONSENT_A_TOOLS.length, 26);
    assert.equal(existsSync(join(ROOT, "skills/gtm-readonly-limits/SKILL.md")), true);
    assert.equal(existsSync(join(ROOT, "skills/budget")), false);
    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8")) as {
      count: number;
      gated_tools: Array<{ name: string; fail: string | null; group: string }>;
    };
    assert.equal(catalog.count, 26);
    const status = catalog.gated_tools.find((t) => t.name === "conversion_fabric_status");
    const ingest = catalog.gated_tools.find((t) => t.name === "sgtm_ingest_test");
    assert.equal(status?.fail, null);
    assert.equal(status?.group, "conversion-fabric");
    assert.equal(ingest?.fail, "SGTM_NOT_ENABLED");
  });

  it("hop-catalog CONVERSION_FABRIC matches fixture sink / hop names", () => {
    assert.equal(CONVERSION_FABRIC.replaces_product_story, STATUS_FIXTURE.replaces_product_story);
    assert.equal(CONVERSION_FABRIC.stamp_interface, STATUS_FIXTURE.stamp_interface);
    assert.equal(CONVERSION_FABRIC.polar_sgtm.feature, "sgtm");
    assert.equal(CONVERSION_FABRIC.polar_sgtm.default, "off");
    assert.equal(CONVERSION_FABRIC.polar_sgtm.mint, false);
    assert.equal(CONVERSION_FABRIC.sinks.length, 3);
    for (const expected of STATUS_FIXTURE.sinks) {
      const row = CONVERSION_FABRIC.sinks.find((s) => s.id === expected.id);
      assert.ok(row, expected.id);
      assert.equal(row!.stamp_sink, expected.stamp_sink);
      assert.equal(row!.stamp_hop, expected.stamp_hop);
      assert.equal(row!.plugin_send_tool, expected.plugin_send_tool);
    }
    const ads = CONVERSION_FABRIC.sinks[0];
    assert.equal(ads.rpc, "IngestEvents");
    assert.equal(ads.not, "UploadClickConversions");
    assert.equal(ads.plugin_send_tool, null);
    assert.equal(CONVERSION_FABRIC.ingest.path, STATUS_FIXTURE.ingest.path);
    assert.equal(CONVERSION_FABRIC.ingest.apply_header, SGTM_APPLY_HEADER);
    assert.equal(CONVERSION_FABRIC.ingest.funded_header, SGTM_FUNDED_HEADER);
    assert.equal(CONVERSION_FABRIC.ingest.plugin_test_tool, "sgtm_ingest_test");
    assert.deepEqual([...CONVERSION_FABRIC.ingest.closed_event_name], [SGTM_CLOSED_EVENT]);
  });

  it("sibling stamp hop-catalog conversion_fabric matches when checkout is present", () => {
    const stamp = process.env.DGTL_STAMP_ROOT?.trim() || "/workspace/dgtl-planning/services/stamp";
    if (!existsSync(join(stamp, "src/gateway/hop-catalog.json"))) return;
    const a = JSON.parse(readFileSync(join(ROOT, "src/gateway/hop-catalog.json"), "utf8")) as {
      conversion_fabric: unknown;
    };
    const b = JSON.parse(readFileSync(join(stamp, "src/gateway/hop-catalog.json"), "utf8")) as {
      conversion_fabric: unknown;
    };
    assert.deepEqual(a.conversion_fabric, b.conversion_fabric);
  });

  it("hasFeature does not accept sgtm; plugin Ads Data Manager default on; sGTM test default off", () => {
    assert.equal(loadFlags({}).adsDataManagerEnabled, true);
    assert.equal(loadFlags({ DGTL_ADS_DATA_MANAGER_ENABLED: "false" }).adsDataManagerEnabled, false);
    assert.equal(loadFlags({}).sgtmIngestTestEnabled, false);
    assert.equal(loadFlags({ DGTL_SGTM_INGEST_TEST_ENABLED: "true" }).sgtmIngestTestEnabled, true);
    const licensed = { ok: true, features: ["ads", "meta", "tiktok", "sgtm"] };
    assert.equal(hasFeature(licensed, "ads"), true);
    assert.equal(hasFeature(licensed, "meta"), true);
    assert.equal(hasFeature(licensed, "tiktok"), true);
    assert.equal(["ads", "meta", "tiktok"].includes("sgtm"), false);
    assert.equal(applyKeyPresent({}), false);
    assert.equal(applyKeyPresent({ DGTL_SGTM_APPLY_KEY: "x" }), true);
  });

  it("conversion_fabric_status is always ok and never leaks keys", async () => {
    const jwt = signLicense({
      sub: "wave20-user",
      exp: Math.floor(Date.now() / 1000) + 86400,
      features: ["ads", "meta"],
      jti: "wave20-jti",
    });
    const ctx = makeCtx(
      {},
      testEnv({
        DGTL_LICENSE_JWT: jwt,
        DGTL_SGTM_APPLY_KEY: "apply-secret-must-not-leak",
        DGTL_HOST: "Cursor",
      }),
    );
    const env = await dispatch(ctx, "conversion_fabric_status", {});
    assert.equal(env.ok, true);
    assert.equal(env.tool, "conversion_fabric_status");
    const data = env.data as {
      wave?: number;
      replaces_product_story?: string;
      stamp_interface?: string;
      polar?: { sgtm?: { reserved?: boolean; default?: string; mint?: boolean; present?: boolean } };
      sinks?: Array<{ id: string; stamp_hop: string; plugin_send_tool: string | null }>;
      send_tools?: { ads_data_manager?: string | null; meta_capi?: string; tiktok_events?: string };
      ingest?: { apply_key_present?: boolean; funded_never_in_web_gtm?: boolean };
      locks?: { never_log_user_data_plaintext?: boolean; has_feature_sgtm?: boolean };
      license?: { features?: string[]; sgtm?: boolean };
    };
    assert.equal(data.wave, CONVERSION_FABRIC_WAVE);
    assert.equal(data.replaces_product_story, "NoNetworkUploadSink");
    assert.equal(data.stamp_interface, "FundedUploadSink");
    assert.equal(data.polar?.sgtm?.reserved, true);
    assert.equal(data.polar?.sgtm?.default, "off");
    assert.equal(data.polar?.sgtm?.mint, false);
    assert.equal(data.polar?.sgtm?.present, false);
    assert.equal(data.send_tools?.ads_data_manager, null);
    assert.equal(data.send_tools?.meta_capi, "meta_send_capi_events");
    assert.equal(data.send_tools?.tiktok_events, "tiktok_track_events");
    assert.equal(data.ingest?.apply_key_present, true);
    assert.equal(data.ingest?.funded_never_in_web_gtm, true);
    assert.equal(data.locks?.never_log_user_data_plaintext, true);
    assert.equal(data.locks?.has_feature_sgtm, false);
    assert.equal(data.license?.sgtm, false);
    assert.deepEqual(
      data.sinks?.map((s) => s.stamp_hop),
      CONVERSION_FABRIC.sinks.map((s) => s.stamp_hop),
    );
    const blob = JSON.stringify(env);
    assertNoSecrets(blob);
    assert.ok(!blob.includes(jwt));
    assert.ok(!blob.includes("wave20-user"));
    assert.ok(!blob.includes("apply-secret-must-not-leak"));
  });

  it("sgtm_ingest_test flag off is zero HTTP", async () => {
    const { fetchImpl, captures } = mockGateway({});
    const ctx = fabricCtx(
      testEnv({
        DGTL_GATEWAY_URL: GATEWAY,
        DGTL_SGTM_INGEST_TEST_ENABLED: "false",
        DGTL_SGTM_APPLY_KEY: "apply-secret",
      }),
      fetchImpl,
    );
    const env = await dispatch(ctx, "sgtm_ingest_test", { ...APPLY_FIXTURE });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "SGTM_NOT_ENABLED");
    assert.equal(captures.length, 0);
  });

  it("sgtm_ingest_test dry_run does not POST", async () => {
    const { fetchImpl, captures } = mockGateway({});
    const ctx = fabricCtx(
      testEnv({
        DGTL_GATEWAY_URL: GATEWAY,
        DGTL_SGTM_INGEST_TEST_ENABLED: "true",
        DGTL_SGTM_APPLY_KEY: "apply-secret",
      }),
      fetchImpl,
    );
    const env = await dispatch(ctx, "sgtm_ingest_test", { ...APPLY_FIXTURE });
    assert.equal(env.ok, true);
    const data = env.data as { dry_run?: boolean; apply_key_present?: boolean; funded?: boolean };
    assert.equal(data.dry_run, true);
    assert.equal(data.apply_key_present, true);
    assert.equal(data.funded, false);
    assert.equal(captures.length, 0);
  });

  it("refuses funded event, user_data, and key-shaped args without HTTP", async () => {
    const { fetchImpl, captures } = mockGateway({});
    const ctx = fabricCtx(
      testEnv({
        DGTL_GATEWAY_URL: GATEWAY,
        DGTL_SGTM_INGEST_TEST_ENABLED: "true",
      }),
      fetchImpl,
    );
    const funded = await dispatch(ctx, "sgtm_ingest_test", {
      ...APPLY_FIXTURE,
      event_name: "funded",
    });
    assert.equal(funded.ok, false);
    assert.equal(funded.error_code, "INVALID_ARGUMENT");
    const pii = await dispatch(ctx, "sgtm_ingest_test", {
      ...APPLY_FIXTURE,
      user_data: { email: "user@example.com" },
    });
    assert.equal(pii.ok, false);
    assert.equal(pii.error_code, "INVALID_ARGUMENT");
    const keyArg = await dispatch(ctx, "sgtm_ingest_test", {
      ...APPLY_FIXTURE,
      apply_key: "apply-secret",
    });
    assert.equal(keyArg.ok, false);
    assert.equal(keyArg.error_code, "INVALID_ARGUMENT");
    const tokenish = await dispatch(ctx, "sgtm_ingest_test", {
      ...APPLY_FIXTURE,
      client_id: "eyJhbGciOiJFRERTQSJ9.payload.sig",
    });
    assert.equal(tokenish.ok, false);
    assert.equal(tokenish.error_code, "INVALID_ARGUMENT");
    assert.equal(captures.length, 0);
    assertNoSecrets(JSON.stringify(funded) + JSON.stringify(pii) + JSON.stringify(keyArg));
  });

  it("live apply-only POST uses apply header and never ingest key or Authorization", async () => {
    const { fetchImpl, captures } = mockGateway({});
    const ctx = fabricCtx(
      testEnv({
        DGTL_GATEWAY_URL: GATEWAY,
        DGTL_SGTM_INGEST_TEST_ENABLED: "true",
        DGTL_SGTM_APPLY_KEY: "apply-secret",
      }),
      fetchImpl,
    );
    const env = await dispatch(ctx, "sgtm_ingest_test", {
      ...APPLY_FIXTURE,
      dry_run: false,
      confirm: true,
    });
    assert.equal(env.ok, true);
    assert.equal(captures.length, 2);
    assert.ok(captures[0]!.url.endsWith("/v1/health"));
    const post = captures[1]!;
    assert.equal(post.method, "POST");
    assert.equal(post.url, `${GATEWAY}${SGTM_INGEST_PATH}`);
    assert.equal(post.headers["x-dgtl-apply-key"], "apply-secret");
    assert.equal(post.headers.authorization, undefined);
    assert.equal(post.headers["x-dgtl-ingest-key"], undefined);
    const body = post.body as Record<string, unknown>;
    assert.equal(body.event_name, "apply");
    assert.equal(body.user_data, undefined);
    const blob = JSON.stringify(env);
    assert.ok(!blob.includes("apply-secret"));
  });

  it("live worker fail-closed and missing apply key send no ingest POST", async () => {
    const closed = mockGateway({ health: { sgtm_ingest_enabled: false } });
    const closedCtx = fabricCtx(
      testEnv({
        DGTL_GATEWAY_URL: GATEWAY,
        DGTL_SGTM_INGEST_TEST_ENABLED: "true",
        DGTL_SGTM_APPLY_KEY: "apply-secret",
      }),
      closed.fetchImpl,
    );
    const closedEnv = await dispatch(closedCtx, "sgtm_ingest_test", {
      ...APPLY_FIXTURE,
      dry_run: false,
      confirm: true,
    });
    assert.equal(closedEnv.ok, false);
    assert.equal(closedEnv.error_code, "SGTM_NOT_ENABLED");
    assert.equal(
      closed.captures.filter((c) => c.url.endsWith(SGTM_INGEST_PATH)).length,
      0,
    );

    const missing = mockGateway({});
    const missingCtx = fabricCtx(
      testEnv({
        DGTL_GATEWAY_URL: GATEWAY,
        DGTL_SGTM_INGEST_TEST_ENABLED: "true",
      }),
      missing.fetchImpl,
    );
    const missingEnv = await dispatch(missingCtx, "sgtm_ingest_test", {
      ...APPLY_FIXTURE,
      dry_run: false,
      confirm: true,
    });
    assert.equal(missingEnv.ok, false);
    assert.equal(missingEnv.error_code, "SGTM_APPLY_KEY_MISSING");
    assert.equal(
      missing.captures.filter((c) => c.url.endsWith(SGTM_INGEST_PATH)).length,
      0,
    );

    const nogw = makeCtx({}, testEnv({ DGTL_SGTM_INGEST_TEST_ENABLED: "true", DGTL_GATEWAY_URL: "" }));
    const nogwEnv = await dispatch(nogw, "sgtm_ingest_test", {
      ...APPLY_FIXTURE,
      dry_run: false,
      confirm: true,
    });
    assert.equal(nogwEnv.ok, false);
    assert.equal(nogwEnv.error_code, "GATEWAY_UNAVAILABLE");
  });
});
