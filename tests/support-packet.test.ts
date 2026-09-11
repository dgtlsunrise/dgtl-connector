import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createAppContext } from "../src/context.js";
import { PLUGIN_VERSION } from "../src/version.js";
import { dispatch } from "../src/tools/dispatch.js";
import { installNetworkGuard, makeCtx, ROOT, signLicense, testEnv, TEST_TOKEN } from "./helpers.js";

const W03 = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/w0-3-support-packet.json"), "utf8")) as {
  packet_keys: string[];
  plugin_flag_keys: string[];
  worker_flag_keys: string[];
  dual_gate_lane_keys: string[];
  store_keys: string[];
  plugin_mutate_defaults: Record<string, boolean>;
};

describe("support_packet", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("returns plugin version, host, and passed fields — never tokens", async () => {
    const ctx = makeCtx(
      {},
      testEnv({
        GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
        DGTL_HOST: "Cursor",
        DGTL_LICENSE_JWT: "eyJhbGciOiJFRERTQSJ9.fake.payload",
      }),
    );
    const env = await dispatch(ctx, "support_packet", {
      last_tool: "gtm_list_accounts",
      error_code: "ACCESS_NOT_CONFIGURED",
      resource_id: "accounts/444444",
    });
    assert.equal(env.ok, true);
    assert.equal(env.tool, "support_packet");
    const data = env.data as Record<string, unknown>;
    assert.equal(data.plugin_version, PLUGIN_VERSION);
    assert.equal(data.host, "Cursor");
    assert.equal(data.last_tool, "gtm_list_accounts");
    assert.equal(data.error_code, "ACCESS_NOT_CONFIGURED");
    assert.equal(data.resource_id, "accounts/444444");
    for (const k of W03.packet_keys) assert.ok(k in data, k);
    assert.equal(ctx.calls.length, 0);
    const blob = JSON.stringify(env);
    assert.ok(!blob.includes(TEST_TOKEN));
    assert.ok(!blob.includes("eyJhbGciOiJFRERTQSJ9"));
    assert.ok(!blob.toLowerCase().includes("bearer"));
  });

  it("works without Google auth (no host token)", async () => {
    const ctx = makeCtx({}, testEnv({ GOOGLE_ACCESS_TOKEN: "", DGTL_LICENSE_JWT: "" }));
    const env = await dispatch(ctx, "support_packet", {});
    assert.equal(env.ok, true);
    const data = env.data as { plugin_version?: string; last_tool?: string | null };
    assert.equal(data.plugin_version, PLUGIN_VERSION);
    assert.equal(data.last_tool, null);
    assert.equal(ctx.calls.length, 0);
  });

  it("strips token-shaped last_tool / resource_id / error_code", async () => {
    const ctx = makeCtx();
    const env = await dispatch(ctx, "support_packet", {
      last_tool: "Bearer should-not-echo",
      error_code: "developer-token",
      resource_id: "eyJhbGciOiJFRERTQSJ9.payload.sig",
    });
    assert.equal(env.ok, true);
    const data = env.data as {
      last_tool?: string | null;
      error_code?: string | null;
      resource_id?: string | null;
    };
    assert.equal(data.last_tool, null);
    assert.equal(data.error_code, null);
    assert.equal(data.resource_id, null);
    const blob = JSON.stringify(env);
    assert.ok(!blob.includes("Bearer should-not-echo"));
    assert.ok(!blob.includes("developer-token"));
    assert.ok(!blob.includes("eyJhbGciOiJFRERTQSJ9"));
  });

  it("includes plugin flags, store booleans, license feature names — never tokens or JWT", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-packet-stores-"));
    const jwt = signLicense({
      sub: "packet-user",
      exp: Math.floor(Date.now() / 1000) + 86400,
      features: ["ads", "meta"],
      jti: "packet-jti",
    });
    try {
      writeFileSync(join(dir, "google-oauth.json"), JSON.stringify({ access_token: "access-token-packet-must-not-leak", refresh_token: "refresh-packet-must-not-leak" }));
      writeFileSync(join(dir, "google-oauth-ads.json"), JSON.stringify({ access_token: "ads-packet-secret" }));
      writeFileSync(join(dir, "meta-oauth.json"), JSON.stringify({ access_token: "meta-packet-secret" }));
      const ctx = createAppContext({
        pluginRoot: ROOT,
        env: testEnv({
          PLUGIN_DATA: dir,
          DGTL_LICENSE_JWT: jwt,
          DGTL_HOST: "Grok Bot",
          GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
          DGTL_GATEWAY_URL: "",
          DGTL_ADS_MUTATE_ENABLED: undefined as unknown as string,
          DGTL_META_MUTATE_ENABLED: undefined as unknown as string,
          DGTL_WRITES_ENABLED: undefined as unknown as string,
          DGTL_GBP_ENABLED: undefined as unknown as string,
          ADS_MUTATE_ENABLED: undefined as unknown as string,
          META_MUTATE_ENABLED: undefined as unknown as string,
          WRITES_ENABLED: undefined as unknown as string,
          GBP_ENABLED: undefined as unknown as string,
        }),
      });
      const env = await dispatch(ctx, "support_packet", { last_tool: "gads_search", error_code: "LICENSE_REQUIRED" });
      assert.equal(env.ok, true);
      const data = env.data as {
        flags?: { plugin?: Record<string, boolean>; worker?: Record<string, boolean | null> };
        stores?: Record<string, boolean>;
        license?: { present?: boolean; ok?: boolean; features?: string[]; ads?: boolean; meta?: boolean };
        gateway?: { configured?: boolean; reachable?: boolean; host?: string | null };
        dual_gate?: { ads?: Record<string, boolean>; meta?: Record<string, boolean> };
      };
      assert.deepEqual(data.flags?.plugin, W03.plugin_mutate_defaults);
      for (const k of W03.plugin_flag_keys) assert.equal(typeof data.flags?.plugin?.[k], "boolean", k);
      for (const k of W03.worker_flag_keys) assert.equal(data.flags?.worker?.[k], null, k);
      assert.equal(data.stores?.consent_a, true);
      assert.equal(data.stores?.consent_c, true);
      assert.equal(data.stores?.consent_w, false);
      assert.equal(data.stores?.meta, true);
      assert.equal(data.stores?.shopify, false);
      for (const k of W03.store_keys) assert.equal(typeof data.stores?.[k], "boolean", k);
      assert.equal(data.license?.present, true);
      assert.equal(data.license?.ok, true);
      assert.deepEqual(data.license?.features, ["ads", "meta"]);
      assert.equal(data.license?.ads, true);
      assert.equal(data.license?.meta, true);
      assert.equal(data.gateway?.configured, false);
      assert.equal(data.gateway?.reachable, false);
      assert.equal(data.gateway?.host, null);
      assert.equal(data.dual_gate?.ads?.plugin_mutate_enabled, true);
      assert.equal(data.dual_gate?.ads?.worker_mutate_enabled, false);
      assert.equal(data.dual_gate?.ads?.worker_flag_known, false);
      assert.equal(data.dual_gate?.ads?.live_mutate_possible, false);
      const blob = JSON.stringify(env);
      assert.ok(!blob.includes(jwt));
      assert.ok(!blob.includes("packet-user"));
      assert.ok(!blob.includes("packet-jti"));
      assert.ok(!blob.includes("access-token-packet-must-not-leak"));
      assert.ok(!blob.includes("refresh-packet-must-not-leak"));
      assert.ok(!blob.includes("ads-packet-secret"));
      assert.ok(!blob.includes("meta-packet-secret"));
      assert.ok(!blob.includes(TEST_TOKEN));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dual-gate live is true only when plugin AND Worker health flags are true; host not URL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-packet-gw-"));
    try {
      const ctx = createAppContext({
        pluginRoot: ROOT,
        env: testEnv({
          PLUGIN_DATA: dir,
          DGTL_GATEWAY_URL: "https://user:leak-pass@stamp.example.test/secret-path?token=developer-token-value",
          DGTL_LICENSE_JWT: "",
          GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
        }),
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              ok: true,
              service: "stamp",
              version: "0.0.1-pr9",
              ads_mutate_enabled: true,
              meta_mutate_enabled: false,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )) as typeof fetch,
      });
      const env = await dispatch(ctx, "support_packet", {});
      assert.equal(env.ok, true);
      const data = env.data as {
        gateway?: { configured?: boolean; reachable?: boolean; host?: string | null };
        dual_gate?: {
          ads?: { live_mutate_possible?: boolean; worker_flag_known?: boolean; worker_mutate_enabled?: boolean };
          meta?: { live_mutate_possible?: boolean; worker_mutate_enabled?: boolean };
        };
        flags?: { worker?: { adsMutateEnabled?: boolean | null; metaMutateEnabled?: boolean | null } };
      };
      assert.equal(data.gateway?.configured, true);
      assert.equal(data.gateway?.reachable, true);
      assert.equal(data.gateway?.host, "stamp.example.test");
      assert.equal(data.flags?.worker?.adsMutateEnabled, true);
      assert.equal(data.flags?.worker?.metaMutateEnabled, false);
      assert.equal(data.dual_gate?.ads?.worker_flag_known, true);
      assert.equal(data.dual_gate?.ads?.worker_mutate_enabled, true);
      assert.equal(data.dual_gate?.ads?.live_mutate_possible, true);
      assert.equal(data.dual_gate?.meta?.worker_mutate_enabled, false);
      assert.equal(data.dual_gate?.meta?.live_mutate_possible, false);
      const blob = JSON.stringify(env);
      assert.ok(!blob.includes("leak-pass"));
      assert.ok(!blob.includes("secret-path"));
      assert.ok(!blob.includes("developer-token-value"));
      assert.ok(!blob.includes("user:"));
      assert.ok(!blob.toLowerCase().includes("developer-token"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
