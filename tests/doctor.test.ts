import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { collectDoctor, DOCTOR_ENV_NAMES, formatDoctorReport, runDoctorCli } from "../src/auth/doctor.js";
import { DEFAULT_GATEWAY_HEALTH_TTL_MS } from "../src/gateway/client.js";
import { DEFAULT_GA4_METADATA_CACHE_TTL_MS, DEFAULT_METADATA_CACHE_TTL_MS } from "../src/http/metadata-cache.js";
import { installNetworkGuard, ROOT, signLicense } from "./helpers.js";

const W03 = JSON.parse(
  readFileSync(join(ROOT, "tests/fixtures/w0-3-support-packet.json"), "utf8"),
) as {
  plugin_flag_keys: string[];
  dual_gate_lane_keys: string[];
  store_keys: string[];
  plugin_mutate_defaults: Record<string, boolean>;
  doctor_env_names: string[];
};

describe("doctor CLI (no secrets)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("reports node, package, plugin versions and dist presence; never prints env values", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-doctor-"));
    try {
      const secret = "host-injected-access-token-must-never-appear";
      const report = await collectDoctor({
        pluginRoot: ROOT,
        pluginDataDir: dir,
        env: {
          GOOGLE_ACCESS_TOKEN: secret,
          GOOGLE_OAUTH_CLIENT_ID: "public-client.apps.googleusercontent.com",
          DGTL_LICENSE_JWT: "",
        },
      });
      assert.equal(report.auth.host_injected, true);
      assert.equal(report.auth.oauth_client_id, true);
      assert.equal(report.auth.can_auth, true);
      assert.ok(report.env_set.includes("GOOGLE_ACCESS_TOKEN"));
      assert.ok(report.env_set.includes("GOOGLE_OAUTH_CLIENT_ID"));
      assert.ok(!report.env_set.includes("DGTL_LICENSE_JWT"));
      assert.equal(report.package_version, "0.1.0");
      assert.equal(report.plugin_version, "0.1.0");
      assert.equal(typeof report.node.version, "string");
      const text = formatDoctorReport(report);
      assert.ok(text.includes("dgtl-connector doctor"));
      assert.ok(text.includes("GOOGLE_ACCESS_TOKEN"));
      assert.ok(!text.includes(secret));
      assert.ok(!text.includes("public-client.apps.googleusercontent.com"));
      assert.ok(!text.includes("host-injected-access-token-must-never-appear"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits non-zero when there is no way to auth", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-doctor-noauth-"));
    try {
      const report = await collectDoctor({
        pluginRoot: ROOT,
        pluginDataDir: dir,
        env: { PATH: "/usr/bin", HOME: dir },
      });
      assert.equal(report.auth.can_auth, false);
      assert.ok(report.critical.includes("no_auth"));
      assert.equal(report.ok, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats PLUGIN_DATA/google-oauth.json existence as a way to auth (does not read tokens)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-doctor-pkce-"));
    try {
      writeFileSync(
        join(dir, "google-oauth.json"),
        JSON.stringify({ access_token: "must-not-be-printed-token-value", refresh_token: "refresh-not-logged" }),
      );
      const report = await collectDoctor({
        pluginRoot: ROOT,
        pluginDataDir: dir,
        env: { PATH: "/usr/bin" },
      });
      assert.equal(report.plugin_data.google_oauth_json, true);
      assert.equal(report.auth.pkce_store, true);
      assert.equal(report.auth.can_auth, true);
      assert.ok(!report.critical.includes("no_auth"));
      const text = formatDoctorReport(report);
      assert.ok(!text.includes("must-not-be-printed-token-value"));
      assert.ok(!text.includes("refresh-not-logged"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("license summary is valid/invalid/missing features with no JWT body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-doctor-lic-"));
    const jwt = signLicense({
      sub: "doctor-user",
      exp: Math.floor(Date.now() / 1000) + 86400,
      features: ["ads"],
      jti: "doctor-jti",
    });
    try {
      writeFileSync(join(dir, "license.jwt"), jwt);
      const report = await collectDoctor({
        pluginRoot: ROOT,
        pluginDataDir: dir,
        env: { GOOGLE_ACCESS_TOKEN: "host-token-not-printed" },
      });
      assert.equal(report.plugin_data.license_jwt, true);
      assert.equal(report.license.present, true);
      assert.equal(report.license.status, "valid");
      assert.deepEqual(report.license.features, ["ads"]);
      assert.equal(report.license.ads, true);
      assert.equal(report.license.meta, false);
      assert.equal(report.license.sgtm, false);
      assert.deepEqual(report.license.missing_features, ["meta"]);
      const text = formatDoctorReport(report);
      assert.ok(text.includes("valid"));
      assert.ok(text.includes("missing features: meta"));
      assert.ok(!text.includes(jwt));
      assert.ok(!text.includes("doctor-user"));
      assert.ok(!text.includes("doctor-jti"));
      assert.ok(!text.includes("host-token-not-printed"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("invalid JWT is invalid — no payload dump", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-doctor-badlic-"));
    try {
      const report = await collectDoctor({
        pluginRoot: ROOT,
        pluginDataDir: dir,
        env: {
          GOOGLE_OAUTH_CLIENT_ID: "x",
          DGTL_LICENSE_JWT: "not-a-jwt.payload.sig",
        },
      });
      assert.equal(report.license.present, true);
      assert.equal(report.license.status, "invalid");
      const text = formatDoctorReport(report);
      assert.ok(text.includes("invalid"));
      assert.ok(!text.includes("not-a-jwt.payload.sig"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cli writes checklist and returns 1 when plugin root has no dist", async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "dgtl-doctor-root-"));
    const data = mkdtempSync(join(tmpdir(), "dgtl-doctor-data-"));
    try {
      writeFileSync(join(emptyRoot, "package.json"), JSON.stringify({ name: "dgtl-connector", version: "0.1.0" }));
      writeFileSync(join(emptyRoot, "plugin.json"), JSON.stringify({ name: "dgtl-connector", version: "0.1.0" }));
      const chunks: string[] = [];
      const code = await runDoctorCli(
        { pluginRoot: emptyRoot, pluginDataDir: data, env: {} },
        (s) => {
          chunks.push(s);
        },
      );
      assert.equal(code, 1);
      const out = chunks.join("");
      assert.ok(out.includes("dist/index.js: MISSING"));
      assert.ok(out.includes("no_build"));
      assert.ok(out.includes("no_auth"));
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
      rmSync(data, { recursive: true, force: true });
    }
  });

  it("does not treat a fake dist directory without index.js as present", async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "dgtl-doctor-fakedist-"));
    try {
      mkdirSync(join(emptyRoot, "dist"));
      writeFileSync(join(emptyRoot, "package.json"), JSON.stringify({ version: "0.1.0" }));
      const report = await collectDoctor({
        pluginRoot: emptyRoot,
        pluginDataDir: emptyRoot,
        env: { GOOGLE_ACCESS_TOKEN: "t" },
      });
      assert.equal(report.dist_present, false);
      assert.ok(report.critical.includes("no_build"));
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it("lists W0.3 mutate/GBP env names and default plugin-on / worker-off dual-gate", async () => {
    for (const name of W03.doctor_env_names) {
      assert.ok((DOCTOR_ENV_NAMES as readonly string[]).includes(name), name);
    }
    const dir = mkdtempSync(join(tmpdir(), "dgtl-doctor-matrix-"));
    try {
      const report = await collectDoctor({
        pluginRoot: ROOT,
        pluginDataDir: dir,
        env: { GOOGLE_ACCESS_TOKEN: "host-token-not-printed" },
      });
      assert.deepEqual(report.flags.plugin, W03.plugin_mutate_defaults);
      assert.equal(report.flags.worker.adsMutateEnabled, null);
      assert.equal(report.flags.worker.metaMutateEnabled, null);
      assert.equal(report.flags.worker.tiktokMutateEnabled, null);
      assert.equal(report.flags.worker.metaCapiEnabled, null);
      assert.equal(report.flags.worker.tiktokEventsEnabled, null);
      assert.equal(report.flags.worker.adsDataManagerEnabled, null);
      assert.equal(report.flags.worker.sgtmIngestEnabled, null);
      assert.equal(report.dual_gate.ads.plugin_mutate_enabled, true);
      assert.equal(report.dual_gate.meta.plugin_mutate_enabled, true);
      assert.equal(report.dual_gate.tiktok.plugin_mutate_enabled, true);
      assert.equal(report.dual_gate.capi.plugin_mutate_enabled, true);
      assert.equal(report.dual_gate.tiktok_events.plugin_mutate_enabled, true);
      assert.equal(report.dual_gate.ads_data_manager.plugin_mutate_enabled, true);
      assert.equal(report.dual_gate.sgtm_ingest.plugin_mutate_enabled, false);
      assert.equal(report.dual_gate.ads.worker_mutate_enabled, false);
      assert.equal(report.dual_gate.meta.worker_mutate_enabled, false);
      assert.equal(report.dual_gate.ads.worker_flag_known, false);
      assert.equal(report.dual_gate.meta.worker_flag_known, false);
      assert.equal(report.dual_gate.ads.live_mutate_possible, false);
      assert.equal(report.dual_gate.meta.live_mutate_possible, false);
      assert.equal(report.gateway.configured, false);
      assert.equal(report.gateway.reachable, false);
      const text = formatDoctorReport(report);
      assert.ok(text.includes("dual-gate"));
      assert.ok(text.includes("plugin=true"));
      assert.ok(text.includes("worker=false"));
      assert.ok(text.includes("live=false"));
      assert.ok(text.includes("adsMutateEnabled: true"));
      assert.ok(text.includes("metaMutateEnabled: true"));
      assert.ok(text.includes("tiktokMutateEnabled: true"));
      assert.ok(text.includes("metaCapiEnabled: true"));
      assert.ok(text.includes("tiktokEventsEnabled: true"));
      assert.ok(text.includes("adsDataManagerEnabled: true"));
      assert.ok(text.includes("sgtmIngestTestEnabled: false"));
      assert.ok(text.includes("writesEnabled: false"));
      assert.ok(text.includes("gbpEnabled: false"));
      assert.ok(!text.includes("host-token-not-printed"));
      for (const k of W03.dual_gate_lane_keys) {
        assert.ok(k in report.dual_gate.ads, k);
        assert.ok(k in report.dual_gate.meta, k);
        assert.ok(k in report.dual_gate.tiktok, k);
        assert.ok(k in report.dual_gate.capi, k);
        assert.ok(k in report.dual_gate.tiktok_events, k);
        assert.ok(k in report.dual_gate.ads_data_manager, k);
        assert.ok(k in report.dual_gate.sgtm_ingest, k);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("plugin_data store booleans are existence-only (never file contents)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-doctor-stores-"));
    try {
      writeFileSync(join(dir, "google-oauth.json"), JSON.stringify({ access_token: "a-secret-must-not-print", refresh_token: "refresh-secret-must-not-print" }));
      writeFileSync(join(dir, "google-oauth-ads.json"), JSON.stringify({ access_token: "ads-secret-must-not-print" }));
      writeFileSync(join(dir, "google-oauth-write.json"), JSON.stringify({ access_token: "write-secret-must-not-print" }));
      writeFileSync(join(dir, "google-oauth-ga4-admin.json"), JSON.stringify({ access_token: "g-secret-must-not-print" }));
      writeFileSync(join(dir, "google-oauth-gsc-write.json"), JSON.stringify({ access_token: "s-secret-must-not-print" }));
      writeFileSync(join(dir, "meta-oauth.json"), JSON.stringify({ access_token: "meta-secret-must-not-print" }));
      writeFileSync(join(dir, "tiktok-oauth.json"), JSON.stringify({ access_token: "tiktok-secret-must-not-print" }));
      writeFileSync(join(dir, "google-oauth-mc.json"), JSON.stringify({ access_token: "mc-secret-must-not-print" }));
      writeFileSync(join(dir, "google-oauth-gbp.json"), JSON.stringify({ access_token: "gbp-secret-must-not-print" }));
      writeFileSync(join(dir, "shopify-oauth.json"), JSON.stringify({ access_token: "shpat_secret-must-not-print" }));
      writeFileSync(join(dir, "klaviyo.json"), JSON.stringify({ api_key: "pk_secret_must_not_print_xx" }));
      const report = await collectDoctor({
        pluginRoot: ROOT,
        pluginDataDir: dir,
        env: { PATH: "/usr/bin" },
      });
      assert.equal(report.plugin_data.google_oauth_json, true);
      assert.equal(report.plugin_data.google_oauth_ads_json, true);
      assert.equal(report.plugin_data.google_oauth_write_json, true);
      assert.equal(report.plugin_data.google_oauth_ga4_admin_json, true);
      assert.equal(report.plugin_data.google_oauth_gsc_write_json, true);
      assert.equal(report.plugin_data.meta_oauth_json, true);
      assert.equal(report.plugin_data.tiktok_oauth_json, true);
      assert.equal(report.plugin_data.google_oauth_mc_json, true);
      assert.equal(report.plugin_data.google_oauth_gbp_json, true);
      assert.equal(report.plugin_data.shopify_oauth_json, true);
      assert.equal(report.plugin_data.klaviyo_json, true);
      assert.deepEqual(report.stores, {
        consent_a: true,
        consent_c: true,
        consent_w: true,
        consent_g: true,
        consent_s: true,
        consent_mc: true,
        consent_b: true,
        meta: true,
        tiktok: true,
        shopify: true,
        klaviyo: true,
      });
      for (const k of W03.store_keys) assert.ok(k in report.stores, k);
      const text = formatDoctorReport(report);
      assert.ok(text.includes("Consent A"));
      assert.ok(text.includes("Consent C"));
      assert.ok(text.includes("Consent W"));
      assert.ok(text.includes("Consent G"));
      assert.ok(text.includes("Consent S"));
      assert.ok(!text.includes("a-secret-must-not-print"));
      assert.ok(!text.includes("refresh-secret-must-not-print"));
      assert.ok(!text.includes("ads-secret-must-not-print"));
      assert.ok(!text.includes("write-secret-must-not-print"));
      assert.ok(!text.includes("g-secret-must-not-print"));
      assert.ok(!text.includes("s-secret-must-not-print"));
      assert.ok(!text.includes("meta-secret-must-not-print"));
      assert.ok(!text.includes("tiktok-secret-must-not-print"));
      assert.ok(!text.includes("shpat_secret-must-not-print"));
      assert.ok(!text.includes("pk_secret_must_not_print_xx"));
      assert.ok(!text.includes("mc-secret-must-not-print"));
      assert.ok(!text.includes("gbp-secret-must-not-print"));
      assert.ok(text.includes("Consent MC"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("probes Worker health for mutate booleans and never echoes the gateway URL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-doctor-probe-"));
    try {
      const report = await collectDoctor({
        pluginRoot: ROOT,
        pluginDataDir: dir,
        env: {
          GOOGLE_ACCESS_TOKEN: "host-token-not-printed",
          DGTL_GATEWAY_URL: "https://user:leak-pass@stamp.example.test/path?jwt=eyJhbGciOiJFRERTQSJ9.fake.sig",
        },
        fetchImpl: (async (input) => {
          const url = String(input instanceof Request ? input.url : input);
          assert.ok(url.endsWith("/v1/health"));
          return new Response(
            JSON.stringify({
              ok: true,
              service: "stamp",
              ads_mutate_enabled: true,
              meta_mutate_enabled: false,
              tiktok_mutate_enabled: false,
              meta_capi_enabled: false,
              tiktok_events_enabled: false,
              ads_data_manager_enabled: false,
              sgtm_ingest_enabled: false,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }) as typeof fetch,
      });
      assert.equal(report.gateway.configured, true);
      assert.equal(report.gateway.reachable, true);
      assert.equal(report.gateway.host, "stamp.example.test");
      assert.equal(report.flags.worker.adsMutateEnabled, true);
      assert.equal(report.flags.worker.metaMutateEnabled, false);
      assert.equal(report.flags.worker.tiktokMutateEnabled, false);
      assert.equal(report.flags.worker.metaCapiEnabled, false);
      assert.equal(report.flags.worker.tiktokEventsEnabled, false);
      assert.equal(report.flags.worker.adsDataManagerEnabled, false);
      assert.equal(report.flags.worker.sgtmIngestEnabled, false);
      assert.equal(report.dual_gate.ads.live_mutate_possible, true);
      assert.equal(report.dual_gate.meta.live_mutate_possible, false);
      assert.equal(report.dual_gate.tiktok.live_mutate_possible, false);
      assert.equal(report.dual_gate.capi.live_mutate_possible, false);
      assert.equal(report.dual_gate.tiktok_events.live_mutate_possible, false);
      assert.equal(report.dual_gate.ads_data_manager.live_mutate_possible, false);
      assert.equal(report.dual_gate.sgtm_ingest.live_mutate_possible, false);
      assert.equal(report.dual_gate.ads.worker_flag_known, true);
      const text = formatDoctorReport(report);
      assert.ok(text.includes("host=stamp.example.test"));
      assert.ok(text.includes("ads: plugin=true worker=true worker_known=true live=true"));
      assert.ok(text.includes("meta: plugin=true worker=false worker_known=true live=false"));
      assert.ok(!text.includes("leak-pass"));
      assert.ok(!text.includes("eyJhbGciOiJFRERTQSJ9"));
      assert.ok(!text.includes("user:"));
      assert.ok(!text.includes("/path"));
      assert.ok(!JSON.stringify(report).includes("leak-pass"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cache layers are booleans/ms (on/default or env TTL); doctor still exits 0", async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "dgtl-doctor-cache-"));
    const data = mkdtempSync(join(tmpdir(), "dgtl-doctor-cache-data-"));
    const secret = "host-injected-access-token-must-never-appear";
    try {
      mkdirSync(join(emptyRoot, "dist"));
      writeFileSync(join(emptyRoot, "dist", "index.js"), "export {};\n");
      writeFileSync(join(emptyRoot, "package.json"), JSON.stringify({ name: "dgtl-connector", version: "0.1.0" }));
      writeFileSync(join(emptyRoot, "plugin.json"), JSON.stringify({ name: "dgtl-connector", version: "0.1.0" }));

      const defaults = await collectDoctor({
        pluginRoot: emptyRoot,
        pluginDataDir: data,
        env: { GOOGLE_ACCESS_TOKEN: secret },
      });
      assert.equal(defaults.ok, true);
      assert.deepEqual(defaults.cache, {
        metadata: { enabled: true, ttl_ms: DEFAULT_GA4_METADATA_CACHE_TTL_MS, source: "default" },
        list: { enabled: true, ttl_ms: DEFAULT_METADATA_CACHE_TTL_MS, source: "default" },
        health: { enabled: true, ttl_ms: DEFAULT_GATEWAY_HEALTH_TTL_MS, source: "default" },
      });
      const defaultText = formatDoctorReport(defaults);
      assert.ok(defaultText.includes("cache layers (TTL ms; no secrets):"));
      assert.ok(defaultText.includes(`metadata: on/default ttl_ms=${DEFAULT_GA4_METADATA_CACHE_TTL_MS}`));
      assert.ok(defaultText.includes(`list: on/default ttl_ms=${DEFAULT_METADATA_CACHE_TTL_MS}`));
      assert.ok(defaultText.includes(`health: on/default ttl_ms=${DEFAULT_GATEWAY_HEALTH_TTL_MS}`));
      assert.ok(!defaultText.includes(secret));
      assert.ok(!defaults.critical.includes("cache"));

      const chunks: string[] = [];
      const code = await runDoctorCli(
        {
          pluginRoot: emptyRoot,
          pluginDataDir: data,
          env: {
            GOOGLE_ACCESS_TOKEN: secret,
            DGTL_GA4_METADATA_CACHE_TTL_MS: "0",
            DGTL_METADATA_CACHE_TTL_MS: "60000",
            DGTL_GATEWAY_HEALTH_TTL_MS: "15000",
          },
        },
        (s) => {
          chunks.push(s);
        },
      );
      assert.equal(code, 0);
      const out = chunks.join("");
      assert.ok(out.includes("metadata: off ttl_ms=0"));
      assert.ok(out.includes("list: on ttl_ms=60000"));
      assert.ok(out.includes("health: on ttl_ms=15000"));
      assert.ok(out.includes("exit: 0"));
      assert.ok(!out.includes(secret));
      assert.ok(!out.includes("host-injected"));
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
      rmSync(data, { recursive: true, force: true });
    }
  });
});
