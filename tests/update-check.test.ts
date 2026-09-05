import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { MSG } from "../src/errors.js";
import { PLUGIN_VERSION } from "../src/version.js";
import { checkPluginUpdate, isNewerVersion } from "../src/update-check.js";
import { dispatch } from "../src/tools/dispatch.js";
import { installNetworkGuard, makeCtx, ROOT, testEnv } from "./helpers.js";

describe("isNewerVersion", () => {
  it("newer latest → true", () => {
    assert.equal(isNewerVersion("0.1.0", "0.1.1"), true);
    assert.equal(isNewerVersion("0.1.0", "0.2.0"), true);
    assert.equal(isNewerVersion("0.1.0", "1.0.0"), true);
    assert.equal(isNewerVersion("0.1.0", "v0.1.1"), true);
  });

  it("same or older latest → false", () => {
    assert.equal(isNewerVersion("0.1.0", "0.1.0"), false);
    assert.equal(isNewerVersion("0.2.0", "0.1.9"), false);
    assert.equal(isNewerVersion("1.0.0", "0.9.9"), false);
  });

  it("invalid versions → false", () => {
    assert.equal(isNewerVersion("0.1.0", "not-a-version"), false);
    assert.equal(isNewerVersion("", "1.0.0"), false);
  });
});

describe("checkPluginUpdate", () => {
  it("newer remote version → update_available true + hint", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ version: "9.9.9" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const result = await checkPluginUpdate({
      env: { DGTL_PLUGIN_LATEST_URL: "https://example.test/plugin.json" },
      fetchImpl,
      currentVersion: "0.1.0",
    });
    assert.equal(result.plugin_version, "0.1.0");
    assert.equal(result.latest_version, "9.9.9");
    assert.equal(result.update_available, true);
    assert.ok(result.update_hint);
  });

  it("fetch fail → soft false (does not throw)", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("NETWORK_FORBIDDEN");
    };
    const result = await checkPluginUpdate({
      env: {},
      fetchImpl,
      currentVersion: "0.1.0",
    });
    assert.equal(result.update_available, false);
    assert.equal(result.latest_version, null);
    assert.equal(result.plugin_version, "0.1.0");
    assert.equal(result.update_hint, undefined);
  });

  it("DGTL_SKIP_UPDATE_CHECK=1 skips network", async () => {
    let called = 0;
    const fetchImpl: typeof fetch = async () => {
      called += 1;
      throw new Error("should not fetch");
    };
    const result = await checkPluginUpdate({
      env: { DGTL_SKIP_UPDATE_CHECK: "1" },
      fetchImpl,
      currentVersion: "0.1.0",
    });
    assert.equal(called, 0);
    assert.equal(result.update_available, false);
    assert.equal(result.latest_version, null);
  });

  it("DGTL_SKIP_UPDATE_CHECK=true skips network", async () => {
    let called = 0;
    const fetchImpl: typeof fetch = async () => {
      called += 1;
      return new Response("{}", { status: 200 });
    };
    const result = await checkPluginUpdate({
      env: { DGTL_SKIP_UPDATE_CHECK: "true" },
      fetchImpl,
    });
    assert.equal(called, 0);
    assert.equal(result.update_available, false);
  });
});

describe("license_status update fields + LICENSE_REQUIRED copy", () => {
  let restoreNet: () => void;
  before(() => {
    restoreNet = installNetworkGuard();
  });
  after(() => restoreNet());

  it("pro-upgrade skill exists and triggers on Ads/Meta/sGTM/LICENSE_REQUIRED", () => {
    const path = join(ROOT, "skills/pro-upgrade/SKILL.md");
    assert.equal(existsSync(path), true);
    const text = readFileSync(path, "utf8");
    assert.ok(text.includes("name: pro-upgrade"));
    assert.ok(/\$19/.test(text));
    assert.ok(/LICENSE_REQUIRED/.test(text));
    assert.ok(/GATEWAY_UNAVAILABLE/.test(text));
    assert.ok(/sGTM/.test(text));
    assert.ok(/https:\/\/www\.dgtlsunrise\.com\//.test(text));
    assert.ok(/developer-token/.test(text));
    assert.ok(/do not pitch|Do not pitch|never on a normal GA4|normal free GA4/i.test(text));
    const license = readFileSync(join(ROOT, "skills/license-and-reconnect/SKILL.md"), "utf8");
    assert.ok(/\$19/.test(license));
    assert.ok(/pro-upgrade/.test(license));
  });

  it("LICENSE_REQUIRED mentions $19/mo, site, JWT path, never developer-token", () => {
    assert.ok(MSG.LICENSE_REQUIRED.includes("$19"));
    assert.ok(/flat/i.test(MSG.LICENSE_REQUIRED));
    assert.ok(/unlimited/i.test(MSG.LICENSE_REQUIRED));
    assert.ok(MSG.LICENSE_REQUIRED.includes("https://www.dgtlsunrise.com/"));
    assert.ok(MSG.LICENSE_REQUIRED.includes("DGTL_LICENSE_JWT"));
    assert.ok(/developer-token/i.test(MSG.LICENSE_REQUIRED));
  });

  it("license_status fetch fail → update_available false (soft)", async () => {
    const ctx = makeCtx({}, testEnv());
    const env = await dispatch(ctx, "license_status", {});
    assert.equal(env.ok, true);
    const data = env.data as {
      plugin_version?: string;
      latest_version?: string | null;
      update_available?: boolean;
      update_hint?: string;
    };
    assert.equal(data.plugin_version, PLUGIN_VERSION);
    assert.equal(data.latest_version, null);
    assert.equal(data.update_available, false);
    assert.equal(data.update_hint, undefined);
  });

  it("license_status newer remote → update_available true", async () => {
    const orig = makeCtx({}, testEnv());
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("plugin.json") || url.includes("example.test/latest")) {
        return new Response(JSON.stringify({ version: "9.9.9" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return orig.fetchImpl(input, init);
    };
    const ctx = {
      ...orig,
      env: { ...orig.env, DGTL_PLUGIN_LATEST_URL: "https://example.test/latest" },
      fetchImpl,
    };
    const env = await dispatch(ctx, "license_status", {});
    assert.equal(env.ok, true);
    const data = env.data as {
      latest_version?: string | null;
      update_available?: boolean;
      update_hint?: string;
    };
    assert.equal(data.latest_version, "9.9.9");
    assert.equal(data.update_available, true);
    assert.ok(data.update_hint);
  });
});
