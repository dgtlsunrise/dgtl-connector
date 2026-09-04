import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PLUGIN_VERSION, detectHost } from "../src/version.js";
import { dispatch } from "../src/tools/dispatch.js";
import { installNetworkGuard, makeCtx, signLicense, testEnv, TEST_TOKEN } from "./helpers.js";

describe("PR-2b whoami / license_status support fields", () => {
  let restoreNet: () => void;
  before(() => {
    restoreNet = installNetworkGuard();
  });
  after(() => restoreNet());

  it("detectHost prefers DGTL_HOST and soft-detects known hosts", () => {
    assert.equal(detectHost({}), null);
    assert.equal(detectHost({ DGTL_HOST: "Cursor" }), "Cursor");
    assert.equal(detectHost({ DGTL_MCP_HOST: " other " }), "other");
    assert.equal(detectHost({ GROK_PLUGIN_ROOT: "/tmp/p" }), "Grok Bot");
    assert.equal(detectHost({ GROK_BUILD: "true" }), "Grok Build");
    assert.equal(detectHost({ CURSOR_AGENT: "1" }), "Cursor");
  });

  it("google_whoami echoes plugin_version, host, jti, gateway.reachable=false", async () => {
    const jwt = signLicense({
      sub: "whoami-user",
      exp: Math.floor(Date.now() / 1000) + 86400,
      features: ["ads", "meta"],
      jti: "whoami-jti-1",
    });
    const ctx = makeCtx(
      {},
      testEnv({
        DGTL_LICENSE_JWT: jwt,
        DGTL_HOST: "Grok Bot",
        DGTL_GATEWAY_URL: "https://example.invalid", // must not flip reachable
      }),
    );
    const env = await dispatch(ctx, "google_whoami", {});
    assert.equal(env.ok, true);
    assert.equal("plugin_version" in env, false); // data payload only, not envelope root
    assert.equal("gateway" in env, false);
    const data = env.data as {
      plugin_version?: string;
      host?: string | null;
      gateway?: { reachable?: boolean };
      license?: { jti?: string | null; ok?: boolean };
      email?: string;
    };
    assert.equal(data.plugin_version, PLUGIN_VERSION);
    assert.equal(data.host, "Grok Bot");
    assert.equal(data.license?.ok, true);
    assert.equal(data.license?.jti, "whoami-jti-1");
    assert.equal(data.gateway?.reachable, false);
    const blob = JSON.stringify(env);
    assert.ok(!blob.includes(jwt));
    assert.ok(!blob.includes(TEST_TOKEN));
    assert.ok(!blob.toLowerCase().includes("bearer"));
  });

  it("license_status echoes plugin_version, host, jti; gateway.reachable stays false", async () => {
    const jwt = signLicense({
      sub: "lic-user",
      exp: Math.floor(Date.now() / 1000) + 86400,
      features: ["ads"],
      jti: "lic-jti-9",
    });
    const ctx = makeCtx(
      {},
      testEnv({
        DGTL_LICENSE_JWT: jwt,
        DGTL_HOST: "Cursor",
        DGTL_GATEWAY_URL: "https://gateway.example",
      }),
    );
    const env = await dispatch(ctx, "license_status", {});
    assert.equal(env.ok, true);
    const data = env.data as {
      ok?: boolean;
      jti?: string | null;
      plugin_version?: string;
      host?: string | null;
      gateway?: { reachable?: boolean; note?: string };
      features?: string[];
    };
    assert.equal(data.ok, true);
    assert.equal(data.jti, "lic-jti-9");
    assert.equal(data.plugin_version, PLUGIN_VERSION);
    assert.equal(data.host, "Cursor");
    assert.equal(data.gateway?.reachable, false);
    assert.ok(data.gateway?.note);
    assert.deepEqual(data.features, ["ads"]);
    assert.equal("request_id" in env, false);
    const blob = JSON.stringify(env);
    assert.ok(!blob.includes(jwt));
  });

  it("missing license yields null jti and still reports version", async () => {
    const ctx = makeCtx({}, testEnv({ DGTL_LICENSE_JWT: "" }));
    const who = await dispatch(ctx, "google_whoami", {});
    const lic = await dispatch(ctx, "license_status", {});
    assert.equal(who.ok, true);
    assert.equal(lic.ok, true);
    const whoData = who.data as { license?: { jti?: string | null }; plugin_version?: string; gateway?: { reachable?: boolean } };
    const licData = lic.data as { jti?: string | null; plugin_version?: string; gateway?: { reachable?: boolean }; ok?: boolean };
    assert.equal(whoData.license?.jti, null);
    assert.equal(whoData.plugin_version, PLUGIN_VERSION);
    assert.equal(whoData.gateway?.reachable, false);
    assert.equal(licData.jti, null);
    assert.equal(licData.ok, false);
    assert.equal(licData.plugin_version, PLUGIN_VERSION);
    assert.equal(licData.gateway?.reachable, false);
  });
});
