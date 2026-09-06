import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PLUGIN_VERSION } from "../src/version.js";
import { dispatch } from "../src/tools/dispatch.js";
import { installNetworkGuard, makeCtx, testEnv, TEST_TOKEN } from "./helpers.js";

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
    const data = env.data as {
      plugin_version?: string;
      host?: string | null;
      last_tool?: string | null;
      error_code?: string | null;
      resource_id?: string | null;
    };
    assert.equal(data.plugin_version, PLUGIN_VERSION);
    assert.equal(data.host, "Cursor");
    assert.equal(data.last_tool, "gtm_list_accounts");
    assert.equal(data.error_code, "ACCESS_NOT_CONFIGURED");
    assert.equal(data.resource_id, "accounts/444444");
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
});
