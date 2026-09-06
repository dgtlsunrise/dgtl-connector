import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { collectDoctor, formatDoctorReport, runDoctorCli } from "../src/auth/doctor.js";
import { installNetworkGuard, ROOT, signLicense } from "./helpers.js";

describe("doctor CLI (no secrets)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("reports node, package, plugin versions and dist presence; never prints env values", () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-doctor-"));
    try {
      const secret = "host-injected-access-token-must-never-appear";
      const report = collectDoctor({
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

  it("exits non-zero when there is no way to auth", () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-doctor-noauth-"));
    try {
      const report = collectDoctor({
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

  it("treats PLUGIN_DATA/google-oauth.json existence as a way to auth (does not read tokens)", () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-doctor-pkce-"));
    try {
      writeFileSync(
        join(dir, "google-oauth.json"),
        JSON.stringify({ access_token: "must-not-be-printed-token-value", refresh_token: "refresh-not-logged" }),
      );
      const report = collectDoctor({
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

  it("license summary is valid/invalid/missing features with no JWT body", () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-doctor-lic-"));
    const jwt = signLicense({
      sub: "doctor-user",
      exp: Math.floor(Date.now() / 1000) + 86400,
      features: ["ads"],
      jti: "doctor-jti",
    });
    try {
      writeFileSync(join(dir, "license.jwt"), jwt);
      const report = collectDoctor({
        pluginRoot: ROOT,
        pluginDataDir: dir,
        env: { GOOGLE_ACCESS_TOKEN: "host-token-not-printed" },
      });
      assert.equal(report.plugin_data.license_jwt, true);
      assert.equal(report.license.present, true);
      assert.equal(report.license.status, "valid");
      assert.deepEqual(report.license.features, ["ads"]);
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

  it("invalid JWT is invalid — no payload dump", () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-doctor-badlic-"));
    try {
      const report = collectDoctor({
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

  it("cli writes checklist and returns 1 when plugin root has no dist", () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "dgtl-doctor-root-"));
    const data = mkdtempSync(join(tmpdir(), "dgtl-doctor-data-"));
    try {
      writeFileSync(join(emptyRoot, "package.json"), JSON.stringify({ name: "dgtl-connector", version: "0.1.0" }));
      writeFileSync(join(emptyRoot, "plugin.json"), JSON.stringify({ name: "dgtl-connector", version: "0.1.0" }));
      const chunks: string[] = [];
      const code = runDoctorCli(
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

  it("does not treat a fake dist directory without index.js as present", () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "dgtl-doctor-fakedist-"));
    try {
      mkdirSync(join(emptyRoot, "dist"));
      writeFileSync(join(emptyRoot, "package.json"), JSON.stringify({ version: "0.1.0" }));
      const report = collectDoctor({
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
});
