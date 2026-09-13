import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { AuthPort } from "../src/auth/port.js";
import { collectDoctor, formatDoctorReport } from "../src/auth/doctor.js";
import { helpText } from "../src/auth/login-cli.js";
import { buildGoogleAuthUrl, generatePkce } from "../src/auth/pkce.js";
import { STORE_FILE, readStore, tokenPath, writeStore } from "../src/auth/store.js";
import {
  applyGa4AdminEnvLocal,
  applyGscWriteEnvLocal,
  GA4_ADMIN_ENV_LOCAL_KEYS,
  GSC_WRITE_ENV_LOCAL_KEYS,
  parseDotEnvLocal,
} from "../src/auth/write-env-local.js";
import { ERROR_CODES, MSG } from "../src/errors.js";
import { loadFlags } from "../src/flags.js";
import { CONSENT_A, CONSENT_C_GOOGLE, CONSENT_G, CONSENT_S, CONSENT_W, SCOPE } from "../src/google/scopes.js";
import { dispatch } from "../src/tools/dispatch.js";
import { CONSENT_A_TOOLS, FREE_TOOL_NAMES } from "../src/tools/registry.js";
import { installNetworkGuard, makeCtx, ROOT, testEnv, TEST_TOKEN } from "./helpers.js";

const WRITE_TOOLS = [
  "gtm_create_tag",
  "gtm_update_tag",
  "gtm_create_trigger",
  "gtm_update_trigger",
  "gtm_create_variable",
  "gtm_update_variable",
  "gtm_publish_container",
] as const;

function intersect(a: readonly string[], b: readonly string[]): string[] {
  const setB = new Set<string>(b);
  return a.filter((s) => setB.has(s));
}

describe("Wave 10 Consent G / Consent S plumbing", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("A ∩ G = ∅, A ∩ S = ∅, A ∩ W ∩ C still hold", () => {
    assert.deepEqual([...CONSENT_G], [SCOPE.analyticsEdit]);
    assert.deepEqual([...CONSENT_S], [SCOPE.webmastersWrite]);
    assert.ok(!CONSENT_G.includes(SCOPE.analytics as (typeof CONSENT_G)[number]));
    assert.ok(!CONSENT_S.includes(SCOPE.webmasters as (typeof CONSENT_S)[number]));

    assert.deepEqual(intersect(CONSENT_A, CONSENT_G), []);
    assert.deepEqual(intersect(CONSENT_A, CONSENT_S), []);
    assert.deepEqual(intersect(CONSENT_A, CONSENT_W), []);
    assert.deepEqual(intersect(CONSENT_A, CONSENT_C_GOOGLE), []);
    assert.deepEqual(intersect(CONSENT_W, CONSENT_C_GOOGLE), []);
    assert.deepEqual(intersect(CONSENT_G, CONSENT_C_GOOGLE), []);
    assert.deepEqual(intersect(CONSENT_S, CONSENT_C_GOOGLE), []);
    assert.deepEqual(
      intersect(CONSENT_A, CONSENT_W).filter((s) => (CONSENT_C_GOOGLE as readonly string[]).includes(s)),
      [],
    );
  });

  it("default Consent A auth URL never requests G / S / W / C write scopes", () => {
    const pkce = generatePkce();
    const url = buildGoogleAuthUrl({
      clientId: "example-public-client-id.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:8732/callback",
      challenge: pkce.challenge,
      state: pkce.state,
    });
    const granted = new URL(url).searchParams.get("scope")?.split(/\s+/) ?? [];
    assert.deepEqual(granted, [...CONSENT_A]);
    for (const bad of [...CONSENT_G, ...CONSENT_S, ...CONSENT_W, ...CONSENT_C_GOOGLE]) {
      assert.ok(!granted.includes(bad), bad);
      assert.ok(!url.includes(bad), bad);
    }
  });

  it("G login URL is analytics.edit only; S login URL is webmasters write only", () => {
    const pkce = generatePkce();
    const gUrl = buildGoogleAuthUrl({
      clientId: "g-client.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:9876/callback",
      challenge: pkce.challenge,
      state: pkce.state,
      scopes: CONSENT_G,
    });
    const sUrl = buildGoogleAuthUrl({
      clientId: "s-client.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:9876/callback",
      challenge: pkce.challenge,
      state: pkce.state,
      scopes: CONSENT_S,
    });
    assert.deepEqual(new URL(gUrl).searchParams.get("scope")?.split(/\s+/), [SCOPE.analyticsEdit]);
    assert.deepEqual(new URL(sUrl).searchParams.get("scope")?.split(/\s+/), [SCOPE.webmastersWrite]);
    assert.ok(!gUrl.includes("analytics.readonly"));
    assert.ok(!gUrl.includes("webmasters"));
    assert.ok(!sUrl.includes("analytics"));
    assert.ok(!sUrl.includes("webmasters.readonly"));
    assert.ok(!gUrl.includes("adwords"));
    assert.ok(!sUrl.includes("adwords"));
  });

  it("login CLIs do not flip DGTL_WRITES_ENABLED", () => {
    assert.equal(loadFlags({}).writesEnabled, false);
    assert.equal(loadFlags({ GOOGLE_OAUTH_GA4_ADMIN_CLIENT_ID: "g-client" }).writesEnabled, false);
    assert.equal(loadFlags({ GOOGLE_OAUTH_GSC_WRITE_CLIENT_ID: "s-client" }).writesEnabled, false);
    assert.equal(
      loadFlags({
        GOOGLE_OAUTH_GA4_ADMIN_CLIENT_ID: "g",
        GOOGLE_OAUTH_GSC_WRITE_CLIENT_ID: "s",
        GOOGLE_GA4_ADMIN_ACCESS_TOKEN: "tok",
        GOOGLE_GSC_WRITE_ACCESS_TOKEN: "tok",
      }).writesEnabled,
      false,
    );
  });

  it("write tools stay absent from CONSENT_A_TOOLS / FREE_TOOL_NAMES", () => {
    assert.equal(CONSENT_A_TOOLS, FREE_TOOL_NAMES);
    assert.equal(CONSENT_A_TOOLS.length, 24);
    for (const name of WRITE_TOOLS) {
      assert.ok(!CONSENT_A_TOOLS.includes(name), name);
    }
    assert.ok(!CONSENT_A_TOOLS.includes("ga4_create_property"));
    assert.ok(!CONSENT_A_TOOLS.includes("gsc_submit_sitemap"));
    assert.ok(!CONSENT_A_TOOLS.includes("gsc_add_site"));
  });

  it("error codes CONSENT_G_REQUIRED / CONSENT_S_REQUIRED exist and are documented", () => {
    assert.ok((ERROR_CODES as readonly string[]).includes("CONSENT_G_REQUIRED"));
    assert.ok((ERROR_CODES as readonly string[]).includes("CONSENT_S_REQUIRED"));
    assert.ok(MSG.CONSENT_G_REQUIRED.includes("analytics.edit"));
    assert.ok(MSG.CONSENT_S_REQUIRED.includes("webmasters"));
    assert.ok(MSG.CONSENT_G_REQUIRED.includes("Consent A"));
    assert.ok(MSG.CONSENT_S_REQUIRED.includes("Consent A"));
    const schema = JSON.parse(readFileSync(join(ROOT, "schemas/v1/error.schema.json"), "utf8")) as {
      properties: { error_code: { enum: string[] } };
    };
    assert.ok(schema.properties.error_code.enum.includes("CONSENT_G_REQUIRED"));
    assert.ok(schema.properties.error_code.enum.includes("CONSENT_S_REQUIRED"));
    const errorsDoc = readFileSync(join(ROOT, "docs/ERRORS.md"), "utf8");
    assert.ok(errorsDoc.includes("CONSENT_G_REQUIRED"));
    assert.ok(errorsDoc.includes("CONSENT_S_REQUIRED"));
  });

  it("helpText documents G/S login and does not enable writes", () => {
    const h = helpText();
    assert.ok(h.includes("auth login-ga4-admin"));
    assert.ok(h.includes("auth login-gsc-write"));
    assert.ok(h.includes("google-oauth-ga4-admin.json"));
    assert.ok(h.includes("google-oauth-gsc-write.json"));
    assert.ok(h.includes(".env.ga4-admin.local"));
    assert.ok(h.includes(".env.gsc-write.local"));
    assert.ok(h.includes("Does not turn on DGTL_WRITES_ENABLED"));
    assert.ok(h.includes("Never reuse") || h.includes("never reuse") || h.includes("Never reuse GOOGLE_OAUTH_CLIENT_SECRET"));
  });
});

describe("Consent G / S token stores separate from AuthPort A", () => {
  it("store paths are google-oauth-ga4-admin.json and google-oauth-gsc-write.json; mode 0600; A untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-consent-gs-"));
    try {
      assert.equal(STORE_FILE.ga4Admin, "google-oauth-ga4-admin.json");
      assert.equal(STORE_FILE.gscWrite, "google-oauth-gsc-write.json");
      assert.equal(tokenPath(dir, STORE_FILE.ga4Admin), join(dir, "google-oauth-ga4-admin.json"));
      assert.equal(tokenPath(dir, STORE_FILE.gscWrite), join(dir, "google-oauth-gsc-write.json"));

      writeStore(dir, { access_token: "a-token", expiry: Date.now() + 3_600_000 }, STORE_FILE.a);
      writeStore(
        dir,
        { access_token: "g-token-must-not-leak", expiry: Date.now() + 3_600_000, scopes: [...CONSENT_G] },
        STORE_FILE.ga4Admin,
      );
      writeStore(
        dir,
        { access_token: "s-token-must-not-leak", expiry: Date.now() + 3_600_000, scopes: [...CONSENT_S] },
        STORE_FILE.gscWrite,
      );

      assert.equal(readStore(dir, STORE_FILE.a)?.access_token, "a-token");
      assert.equal(readStore(dir, STORE_FILE.ga4Admin)?.access_token, "g-token-must-not-leak");
      assert.equal(readStore(dir, STORE_FILE.gscWrite)?.access_token, "s-token-must-not-leak");
      assert.ok(!readFileSync(join(dir, "google-oauth.json"), "utf8").includes("g-token"));
      assert.ok(!readFileSync(join(dir, "google-oauth-ga4-admin.json"), "utf8").includes("a-token"));
      assert.ok(!readFileSync(join(dir, "google-oauth-gsc-write.json"), "utf8").includes("a-token"));

      const gMode = statSync(join(dir, STORE_FILE.ga4Admin)).mode & 0o777;
      const sMode = statSync(join(dir, STORE_FILE.gscWrite)).mode & 0o777;
      assert.equal(gMode, 0o600);
      assert.equal(sMode, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("AuthPort A ignores G/S tokens; G/S ports ignore Consent A", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-gs-ports-"));
    try {
      const fetchImpl = (async () => {
        throw new Error("NETWORK_FORBIDDEN");
      }) as typeof fetch;

      const a = AuthPort.fromEnv({
        env: {
          GOOGLE_GA4_ADMIN_ACCESS_TOKEN: "g-only",
          GOOGLE_GSC_WRITE_ACCESS_TOKEN: "s-only",
          GOOGLE_WRITE_ACCESS_TOKEN: "w-only",
        },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal(await a.getAccessToken(), null);

      const g = AuthPort.ga4AdminFromEnv({
        env: { GOOGLE_ACCESS_TOKEN: "consent-a", GOOGLE_GSC_WRITE_ACCESS_TOKEN: "s-only" },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal(await g.getAccessToken(), null);

      const s = AuthPort.gscWriteFromEnv({
        env: { GOOGLE_ACCESS_TOKEN: "consent-a", GOOGLE_GA4_ADMIN_ACCESS_TOKEN: "g-only" },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal(await s.getAccessToken(), null);

      const g2 = AuthPort.ga4AdminFromEnv({
        env: { GOOGLE_GA4_ADMIN_ACCESS_TOKEN: "g-only" },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal((await g2.getAccessToken())?.accessToken, "g-only");

      const s2 = AuthPort.gscWriteFromEnv({
        env: { GOOGLE_GSC_WRITE_ACCESS_TOKEN: "s-only" },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal((await s2.getAccessToken())?.accessToken, "s-only");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it(".env.ga4-admin.local / .env.gsc-write.local never fill Consent A keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-gs-env-"));
    try {
      writeFileSync(
        join(dir, ".env.ga4-admin.local"),
        [
          "GOOGLE_OAUTH_GA4_ADMIN_CLIENT_ID=g-from-file",
          "GOOGLE_OAUTH_GA4_ADMIN_CLIENT_SECRET=g-secret",
          "GOOGLE_OAUTH_CLIENT_ID=consent-a-leak",
          "GOOGLE_OAUTH_CLIENT_SECRET=consent-a-secret-leak",
          "",
        ].join("\n"),
        { mode: 0o600 },
      );
      writeFileSync(
        join(dir, ".env.gsc-write.local"),
        [
          "GOOGLE_OAUTH_GSC_WRITE_CLIENT_ID=s-from-file",
          "GOOGLE_OAUTH_GSC_WRITE_CLIENT_SECRET=s-secret",
          "GOOGLE_OAUTH_CLIENT_SECRET=consent-a-secret-leak",
          "",
        ].join("\n"),
        { mode: 0o600 },
      );
      const parsedG = parseDotEnvLocal(readFileSync(join(dir, ".env.ga4-admin.local"), "utf8"));
      assert.equal(parsedG.GOOGLE_OAUTH_CLIENT_SECRET, "consent-a-secret-leak");

      const g = applyGa4AdminEnvLocal(dir, { PATH: "/usr/bin" });
      assert.equal(g.GOOGLE_OAUTH_GA4_ADMIN_CLIENT_ID, "g-from-file");
      assert.equal(g.GOOGLE_OAUTH_GA4_ADMIN_CLIENT_SECRET, "g-secret");
      assert.equal(g.GOOGLE_OAUTH_CLIENT_ID, undefined);
      assert.equal(g.GOOGLE_OAUTH_CLIENT_SECRET, undefined);
      assert.ok(GA4_ADMIN_ENV_LOCAL_KEYS.includes("GOOGLE_OAUTH_GA4_ADMIN_CLIENT_ID"));

      const s = applyGscWriteEnvLocal(dir, { PATH: "/usr/bin" });
      assert.equal(s.GOOGLE_OAUTH_GSC_WRITE_CLIENT_ID, "s-from-file");
      assert.equal(s.GOOGLE_OAUTH_CLIENT_SECRET, undefined);
      assert.ok(GSC_WRITE_ENV_LOCAL_KEYS.includes("GOOGLE_OAUTH_GSC_WRITE_CLIENT_ID"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("doctor / support_packet / whoami — G/S store booleans, never tokens", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("doctor reports G/S store existence and never dumps tokens", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-doctor-gs-"));
    const secretG = "g-store-token-must-never-appear";
    const secretS = "s-store-token-must-never-appear";
    try {
      writeStore(dir, { access_token: secretG, refresh_token: "g-refresh-not-logged", expiry: Date.now() + 3600_000 }, STORE_FILE.ga4Admin);
      writeStore(dir, { access_token: secretS, refresh_token: "s-refresh-not-logged", expiry: Date.now() + 3600_000 }, STORE_FILE.gscWrite);
      const report = await collectDoctor({
        pluginRoot: ROOT,
        pluginDataDir: dir,
        env: { GOOGLE_ACCESS_TOKEN: "host-a-not-printed" },
      });
      assert.equal(report.plugin_data.google_oauth_ga4_admin_json, true);
      assert.equal(report.plugin_data.google_oauth_gsc_write_json, true);
      assert.equal(report.stores.consent_g, true);
      assert.equal(report.stores.consent_s, true);
      const text = formatDoctorReport(report);
      assert.ok(text.includes("google-oauth-ga4-admin.json") && text.includes("present"));
      assert.ok(text.includes("google-oauth-gsc-write.json") && text.includes("present"));
      assert.ok(!text.includes(secretG));
      assert.ok(!text.includes(secretS));
      assert.ok(!text.includes("g-refresh-not-logged"));
      assert.ok(!text.includes("s-refresh-not-logged"));
      assert.ok(!text.includes("host-a-not-printed"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("doctor reports absent G/S stores as false", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-doctor-gs-empty-"));
    try {
      const report = await collectDoctor({
        pluginRoot: ROOT,
        pluginDataDir: dir,
        env: { GOOGLE_OAUTH_CLIENT_ID: "x" },
      });
      assert.equal(report.plugin_data.google_oauth_ga4_admin_json, false);
      assert.equal(report.plugin_data.google_oauth_gsc_write_json, false);
      assert.equal(report.stores.consent_g, false);
      assert.equal(report.stores.consent_s, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("support_packet reports G/S store booleans and never tokens", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-packet-gs-"));
    const secret = "packet-g-token-must-not-echo";
    try {
      writeStore(dir, { access_token: secret, expiry: Date.now() + 3600_000 }, STORE_FILE.ga4Admin);
      const ctx = makeCtx(
        {},
        testEnv({
          GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
          PLUGIN_DATA: dir,
          GOOGLE_GA4_ADMIN_ACCESS_TOKEN: secret,
        }),
      );
      const env = await dispatch(ctx, "support_packet", {
        last_tool: "ga4_run_report",
        error_code: "CONSENT_G_REQUIRED",
      });
      assert.equal(env.ok, true);
      const data = env.data as { stores?: { consent_g?: boolean; consent_s?: boolean } };
      assert.equal(data.stores?.consent_g, true);
      assert.equal(data.stores?.consent_s, false);
      const blob = JSON.stringify(env);
      assert.ok(!blob.includes(secret));
      assert.ok(!blob.includes(TEST_TOKEN));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("whoami reports consent_g / consent_s connection flags without tokens", async () => {
    const ctx = makeCtx(
      {},
      testEnv({
        GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
        GOOGLE_GA4_ADMIN_ACCESS_TOKEN: "whoami-g-token-secret",
      }),
    );
    const env = await dispatch(ctx, "google_whoami", {});
    assert.equal(env.ok, true);
    const data = env.data as {
      consent_g?: { present?: boolean; host_injected?: boolean };
      consent_s?: { present?: boolean; host_injected?: boolean };
    };
    assert.equal(data.consent_g?.present, true);
    assert.equal(data.consent_g?.host_injected, true);
    assert.equal(data.consent_s?.present, false);
    const blob = JSON.stringify(env);
    assert.ok(!blob.includes("whoami-g-token-secret"));
    assert.ok(!blob.includes(TEST_TOKEN));
  });
});
