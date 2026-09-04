import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import { buildGoogleAuthUrl, generatePkce } from "../src/auth/pkce.js";
import { CONSENT_A, CONSENT_W, CONSENT_W_GTM, SCOPE } from "../src/google/scopes.js";
import { loadFlags } from "../src/flags.js";
import { dispatch } from "../src/tools/dispatch.js";
import { FREE_TOOL_NAMES, TOOLS } from "../src/tools/registry.js";
import { installNetworkGuard, makeCtx, ROOT, testEnv } from "./helpers.js";

const WRITE_TOOLS = ["gtm_create_tag", "gtm_update_tag", "gtm_publish_container"] as const;

describe("Consent W scaffold — Consent A stays readonly", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("CONSENT_A builders never include write scopes", () => {
    for (const s of CONSENT_A) {
      assert.ok(!s.includes("edit"), s);
      assert.ok(!s.includes("publish"), s);
      assert.ok(s === "openid" || s.endsWith(".readonly") || s.includes("userinfo.email"), s);
    }
    assert.ok(!CONSENT_A.includes(SCOPE.tagmanagerEditContainers as (typeof CONSENT_A)[number]));
    assert.ok(!CONSENT_A.includes(SCOPE.tagmanagerPublish as (typeof CONSENT_A)[number]));
    assert.ok(!CONSENT_A.includes(SCOPE.webmastersWrite as (typeof CONSENT_A)[number]));
    assert.ok(!CONSENT_A.includes(SCOPE.analyticsEdit as (typeof CONSENT_A)[number]));

    const pkce = generatePkce();
    const url = buildGoogleAuthUrl({
      clientId: "example-public-client-id.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:8732/callback",
      challenge: pkce.challenge,
      state: pkce.state,
    });
    const granted = new URL(url).searchParams.get("scope")?.split(/\s+/) ?? [];
    assert.deepEqual(granted, [...CONSENT_A]);
    for (const bad of CONSENT_W) {
      assert.ok(!granted.includes(bad), bad);
    }
  });

  it("CONSENT_W is exported separately and includes GTM edit/publish", () => {
    assert.ok(CONSENT_W.includes(SCOPE.tagmanagerEditContainers));
    assert.ok(CONSENT_W.includes(SCOPE.tagmanagerPublish));
    assert.deepEqual([...CONSENT_W_GTM], [SCOPE.tagmanagerEditContainers, SCOPE.tagmanagerPublish]);
    for (const s of CONSENT_A) {
      assert.ok(!(CONSENT_W as readonly string[]).includes(s), `CONSENT_W must not duplicate Consent A scope ${s}`);
    }
  });

  it("DGTL_WRITES_ENABLED defaults false", () => {
    assert.equal(loadFlags({}).writesEnabled, false);
    assert.equal(loadFlags({ DGTL_WRITES_ENABLED: "false" }).writesEnabled, false);
    assert.equal(loadFlags({ DGTL_WRITES_ENABLED: "true" }).writesEnabled, true);
  });

  it("write tools gated off by default (WRITE_NOT_ENABLED, zero HTTP)", async () => {
    const ctx = makeCtx();
    assert.equal(ctx.flags.writesEnabled, false);
    for (const name of WRITE_TOOLS) {
      assert.ok(TOOLS.some((t) => t.name === name), name);
      const env = await dispatch(ctx, name, {
        account_id: "444444",
        container_id: "555555",
        workspace_id: "6",
        dry_run: true,
        confirm_phrase: "PUBLISH",
        name: "Example",
        type: "html",
        tag_id: "1",
      });
      assert.equal(env.ok, false, name);
      assert.equal(env.error_code, "WRITE_NOT_ENABLED", name);
    }
    assert.equal(ctx.calls.length, 0);
  });

  it("writes flag on without write client returns CONSENT_W_REQUIRED", async () => {
    const ctx = makeCtx({}, testEnv({ DGTL_WRITES_ENABLED: "true" }));
    assert.equal(ctx.flags.writesEnabled, true);
    const env = await dispatch(ctx, "gtm_publish_container", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      dry_run: false,
      confirm_phrase: "PUBLISH",
    });
    assert.equal(env.error_code, "CONSENT_W_REQUIRED");
    assert.equal(ctx.calls.length, 0);
  });

  it("free kernel stays 23 readonly tools; write tools are separate family", () => {
    assert.equal(FREE_TOOL_NAMES.length, 23);
    for (const name of WRITE_TOOLS) {
      assert.ok(!FREE_TOOL_NAMES.includes(name), name);
      const spec = TOOLS.find((t) => t.name === name);
      assert.equal(spec?.family, "gtm_write");
    }
  });

  it("publish is not readOnlyHint true; create/update are non-readonly", () => {
    const publish = TOOLS.find((t) => t.name === "gtm_publish_container");
    assert.ok(publish);
    assert.equal(publish!.annotations.readOnlyHint, false);
    assert.equal(publish!.annotations.destructiveHint, true);
    assert.equal(publish!.annotations.idempotentHint, false);

    for (const name of ["gtm_create_tag", "gtm_update_tag"] as const) {
      const spec = TOOLS.find((t) => t.name === name);
      assert.ok(spec, name);
      assert.equal(spec!.annotations.readOnlyHint, false, name);
      assert.equal(spec!.annotations.destructiveHint, false, name);
      assert.equal(spec!.annotations.idempotentHint, false, name);
    }

    const whoami = TOOLS.find((t) => t.name === "google_whoami");
    assert.equal(whoami!.annotations.readOnlyHint, true);
  });

  it("write tool descriptions do not embed the expected confirm phrase", () => {
    for (const name of WRITE_TOOLS) {
      const spec = TOOLS.find((t) => t.name === name);
      assert.ok(spec, name);
      assert.ok(!/confirm_phrase\s*=\s*PUBLISH/i.test(spec!.description), name);
      assert.ok(!/\bPUBLISH\b/.test(spec!.description), name);
      // Must not spell an example GTM-XXXX confirm value into the description.
      assert.ok(!/GTM-[A-Z0-9]+/.test(spec!.description), name);
    }
  });

  it("catalog gated_tools lists write stubs with WRITE_NOT_ENABLED", () => {
    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8"));
    const gated = catalog.gated_tools as Array<{ name: string; fail: string; flag?: string }>;
    for (const name of WRITE_TOOLS) {
      const g = gated.find((x) => x.name === name);
      assert.ok(g, name);
      assert.equal(g!.fail, "WRITE_NOT_ENABLED", name);
      assert.equal(g!.flag, "writes.enabled", name);
      assert.ok(!catalog.tools.some((t: { name: string }) => t.name === name), name);
    }
  });

  it("gtm skill gates: refuse when flag off; dry-run + publicId confirm when on", () => {
    const skill = readFileSync(join(ROOT, "skills/gtm-readonly-limits/SKILL.md"), "utf8");
    assert.ok(/WRITE_NOT_ENABLED/.test(skill));
    assert.ok(/DGTL_WRITES_ENABLED/.test(skill));
    assert.ok(/publicId/.test(skill) || /GTM-XXXX/.test(skill));
    assert.ok(/dry_run/.test(skill));
    assert.ok(/never invent/i.test(skill));
    assert.ok(/list-tool output is \*\*not\*\* the user message|List-tool output is \*\*not\*\*/i.test(skill));
    const license = readFileSync(join(ROOT, "skills/license-and-reconnect/SKILL.md"), "utf8");
    assert.ok(/WRITE_NOT_ENABLED/.test(license));
    assert.ok(/CONSENT_W_REQUIRED/.test(license));
  });
});
