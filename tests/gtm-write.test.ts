import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import { harnessUserMessageContainsPublicId } from "../src/google/gtm-write.js";
import { googleWritePathAllowed } from "../src/http/google-write.js";
import * as S from "../src/tools/schemas.js";
import { dispatch } from "../src/tools/dispatch.js";
import { installNetworkGuard, makeCtx, ROOT, testEnv, TEST_TOKEN } from "./helpers.js";

const WRITE_ENV = () =>
  testEnv({
    DGTL_WRITES_ENABLED: "true",
    GOOGLE_WRITE_ACCESS_TOKEN: "write-test-token",
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
  });

describe("GoogleWriteHttp GTM mutate (PR-8)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("dry_run defaults true in schemas; confirm_phrase required when dry_run=false", () => {
    const created = S.gtmCreateTag.parse({
      account_id: "1",
      container_id: "2",
      workspace_id: "3",
      name: "t",
      type: "html",
    });
    assert.equal(created.dry_run, true);

    const liveMissing = S.gtmPublishContainer.safeParse({
      account_id: "1",
      container_id: "2",
      workspace_id: "3",
      dry_run: false,
    });
    assert.equal(liveMissing.success, false);

    const liveOk = S.gtmPublishContainer.safeParse({
      account_id: "1",
      container_id: "2",
      workspace_id: "3",
      dry_run: false,
      confirm_phrase: "please publish GTM-XXXX000",
    });
    assert.equal(liveOk.success, true);
  });

  it("path allowlist accepts mutate prefixes and rejects others", () => {
    assert.equal(
      googleWritePathAllowed(
        "POST",
        "/tagmanager/v2/accounts/1/containers/2/workspaces/3/tags",
      ),
      true,
    );
    assert.equal(
      googleWritePathAllowed(
        "PUT",
        "/tagmanager/v2/accounts/1/containers/2/workspaces/3/tags/9",
      ),
      true,
    );
    assert.equal(
      googleWritePathAllowed(
        "POST",
        "/tagmanager/v2/accounts/1/containers/2/workspaces/3:create_version",
      ),
      true,
    );
    assert.equal(
      googleWritePathAllowed(
        "POST",
        "/tagmanager/v2/accounts/1/containers/2/versions/13:publish",
      ),
      true,
    );
    assert.equal(
      googleWritePathAllowed("DELETE", "/tagmanager/v2/accounts/1/containers/2/workspaces/3/tags/9"),
      false,
    );
    assert.equal(
      googleWritePathAllowed("POST", "/tagmanager/v2/accounts/1/containers/2/workspaces/3/triggers"),
      true,
    );
    assert.equal(
      googleWritePathAllowed(
        "PUT",
        "/tagmanager/v2/accounts/1/containers/2/workspaces/3/triggers/88",
      ),
      true,
    );
    assert.equal(
      googleWritePathAllowed("POST", "/tagmanager/v2/accounts/1/containers/2/workspaces/3/variables"),
      true,
    );
    assert.equal(
      googleWritePathAllowed(
        "PUT",
        "/tagmanager/v2/accounts/1/containers/2/workspaces/3/variables/77",
      ),
      true,
    );
    assert.equal(
      googleWritePathAllowed(
        "DELETE",
        "/tagmanager/v2/accounts/1/containers/2/workspaces/3/triggers/88",
      ),
      false,
    );
    assert.equal(
      googleWritePathAllowed("POST", "/tagmanager/v2/accounts/1/containers/2/workspaces/3/folders"),
      false,
    );
  });

  it("dry_run create returns proposed body + publicId with zero mutate HTTP", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    let authCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "gtm_create_tag", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      name: "Example",
      type: "html",
    });
    assert.equal(env.ok, true);
    const data = env.data as { dry_run: boolean; publicId: string; proposed: { name: string } };
    assert.equal(data.dry_run, true);
    assert.equal(data.publicId, "GTM-XXXX000");
    assert.equal(data.proposed.name, "Example");
    assert.equal(authCalls, 0);
    assert.ok(ctx.calls.every((c) => c.method === "GET"));
    assert.ok(!ctx.calls.some((c) => c.path.endsWith("/tags") && c.method === "POST"));
  });

  it("live create without publicId in confirm_phrase → INVALID_ARGUMENT, no POST", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_create_tag", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      name: "Example",
      type: "html",
      dry_run: false,
      confirm_phrase: "PUBLISH",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.ok(!ctx.calls.some((c) => c.method === "POST" || c.method === "PUT"));
  });

  it("live create with publicId confirm mutates via httpWrite, never ctx.auth", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    let authCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "gtm_create_tag", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      name: "Example",
      type: "html",
      dry_run: false,
      confirm_phrase: "Please create tag on GTM-XXXX000",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal(authCalls, 0);
    assert.ok(ctx.calls.some((c) => c.method === "POST" && c.path.endsWith("/tags")));
    assert.ok(ctx.calls.every((c) => c.host === "tagmanager.googleapis.com"));
  });

  it("live update with publicId confirm uses PUT", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_update_tag", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      tag_id: "1",
      name: "Example Updated",
      type: "html",
      dry_run: false,
      confirm_phrase: "update GTM-XXXX000",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.ok(ctx.calls.some((c) => c.method === "PUT" && c.path.includes("/tags/1")));
  });

  it("dry_run create trigger returns proposed body + publicId with zero mutate HTTP", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_create_trigger", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      name: "All Pages",
      type: "pageview",
    });
    assert.equal(env.ok, true);
    const data = env.data as { dry_run: boolean; publicId: string; proposed: { name: string; type: string } };
    assert.equal(data.dry_run, true);
    assert.equal(data.publicId, "GTM-XXXX000");
    assert.equal(data.proposed.name, "All Pages");
    assert.equal(data.proposed.type, "pageview");
    assert.ok(ctx.calls.every((c) => c.method === "GET"));
    assert.ok(!ctx.calls.some((c) => c.path.endsWith("/triggers") && c.method === "POST"));
  });

  it("live create trigger without publicId in confirm_phrase → INVALID_ARGUMENT, no POST", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_create_trigger", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      name: "All Pages",
      type: "pageview",
      dry_run: false,
      confirm_phrase: "PUBLISH",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.ok(!ctx.calls.some((c) => c.method === "POST" || c.method === "PUT"));
  });

  it("live create trigger with publicId confirm mutates via httpWrite, never ctx.auth", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    let authCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "gtm_create_trigger", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      name: "All Pages",
      type: "pageview",
      dry_run: false,
      confirm_phrase: "Please create trigger on GTM-XXXX000",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal(authCalls, 0);
    assert.ok(ctx.calls.some((c) => c.method === "POST" && c.path.endsWith("/triggers")));
    assert.ok(ctx.calls.every((c) => c.host === "tagmanager.googleapis.com"));
  });

  it("live update trigger with publicId confirm uses PUT", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_update_trigger", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      trigger_id: "2147479572",
      name: "All Pages Updated",
      type: "pageview",
      dry_run: false,
      confirm_phrase: "update GTM-XXXX000",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.ok(ctx.calls.some((c) => c.method === "PUT" && c.path.includes("/triggers/2147479572")));
  });

  it("dry_run create variable returns proposed body + publicId with zero mutate HTTP", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_create_variable", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      name: "GA4 Measurement ID",
      type: "c",
      parameter: [{ type: "template", key: "value", value: "G-XXXXXXXX" }],
    });
    assert.equal(env.ok, true);
    const data = env.data as {
      dry_run: boolean;
      publicId: string;
      proposed: { name: string; type: string; parameter?: unknown[] };
    };
    assert.equal(data.dry_run, true);
    assert.equal(data.publicId, "GTM-XXXX000");
    assert.equal(data.proposed.name, "GA4 Measurement ID");
    assert.equal(data.proposed.type, "c");
    assert.ok(Array.isArray(data.proposed.parameter));
    assert.ok(ctx.calls.every((c) => c.method === "GET"));
    assert.ok(!ctx.calls.some((c) => c.path.endsWith("/variables") && c.method === "POST"));
  });

  it("live create variable without publicId in confirm_phrase → INVALID_ARGUMENT, no POST", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_create_variable", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      name: "GA4 Measurement ID",
      type: "c",
      dry_run: false,
      confirm_phrase: "PUBLISH",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.ok(!ctx.calls.some((c) => c.method === "POST" || c.method === "PUT"));
  });

  it("live create variable with publicId confirm mutates via httpWrite", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_create_variable", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      name: "GA4 Measurement ID",
      type: "c",
      parameter: [{ type: "template", key: "value", value: "G-XXXXXXXX" }],
      dry_run: false,
      confirm_phrase: "Please create variable on GTM-XXXX000",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.ok(ctx.calls.some((c) => c.method === "POST" && c.path.endsWith("/variables")));
  });

  it("live update variable with publicId confirm uses PUT", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_update_variable", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      variable_id: "1",
      name: "GA4 Measurement ID Updated",
      type: "c",
      dry_run: false,
      confirm_phrase: "update GTM-XXXX000",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.ok(ctx.calls.some((c) => c.method === "PUT" && c.path.includes("/variables/1")));
  });

  it("schemas: trigger/variable dry_run defaults true; live needs confirm_phrase", () => {
    const created = S.gtmCreateTrigger.parse({
      account_id: "1",
      container_id: "2",
      workspace_id: "3",
      name: "t",
      type: "pageview",
    });
    assert.equal(created.dry_run, true);
    const liveMissing = S.gtmCreateVariable.safeParse({
      account_id: "1",
      container_id: "2",
      workspace_id: "3",
      name: "v",
      type: "c",
      dry_run: false,
    });
    assert.equal(liveMissing.success, false);
    const liveOk = S.gtmUpdateVariable.safeParse({
      account_id: "1",
      container_id: "2",
      workspace_id: "3",
      variable_id: "1",
      name: "v",
      type: "c",
      dry_run: false,
      confirm_phrase: "please update GTM-XXXX000",
    });
    assert.equal(liveOk.success, true);
  });

  it("live publish with publicId confirm creates version then publishes (fixtures only)", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_publish_container", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      dry_run: false,
      confirm_phrase: "I confirm publish for GTM-XXXX000",
      version_name: "Agent publish",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.ok(ctx.calls.some((c) => c.path.includes(":create_version")));
    assert.ok(ctx.calls.some((c) => c.path.includes(":publish")));
  });

  it("GTM write hop does not require DGTL_GATEWAY_URL or Polar license", async () => {
    const ctx = makeCtx(
      {},
      testEnv({
        DGTL_WRITES_ENABLED: "true",
        GOOGLE_WRITE_ACCESS_TOKEN: "write-test-token",
        GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
        DGTL_GATEWAY_URL: "",
        DGTL_LICENSE_JWT: "",
      }),
    );
    const env = await dispatch(ctx, "gtm_create_trigger", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      name: "All Pages",
      type: "pageview",
      dry_run: false,
      confirm_phrase: "Please create trigger on GTM-XXXX000",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal(env.error_code, undefined);
    assert.ok(ctx.calls.some((c) => c.method === "POST" && c.path.endsWith("/triggers")));
    assert.ok(!ctx.calls.some((c) => c.host.includes("stamp") || c.path.includes("/v1/gads")));
  });

  it("Consent A GoogleHttp refuses Tag Manager POST", async () => {
    const ctx = makeCtx({}, testEnv());
    await assert.rejects(
      () =>
        ctx.http.post(
          "tagmanager.googleapis.com",
          "/tagmanager/v2/accounts/1/containers/2/workspaces/3/tags",
          { name: "x", type: "html" },
          { api: "tagmanager.googleapis.com", tool: "test" },
        ),
      (err: unknown) => {
        assert.ok(err && typeof err === "object" && "error_code" in err);
        assert.equal((err as { error_code: string }).error_code, "UNSUPPORTED_OPERATION");
        return true;
      },
    );
  });

  it("harness: live mutate without user message this turn containing publicId fails", () => {
    const publicId = "GTM-XXXX000";
    const listToolOutput = JSON.stringify({
      container: [{ publicId, name: "Example Brand Web" }],
    });
    assert.equal(
      harnessUserMessageContainsPublicId({
        userMessageThisTurn: null,
        publicId,
      }),
      false,
    );
    assert.equal(
      harnessUserMessageContainsPublicId({
        userMessageThisTurn: "",
        publicId,
      }),
      false,
    );
    assert.equal(
      harnessUserMessageContainsPublicId({
        userMessageThisTurn: undefined,
        publicId,
      }),
      false,
    );
    assert.equal(
      harnessUserMessageContainsPublicId({
        userMessageThisTurn: "please publish GTM-XXXX000",
        publicId,
      }),
      true,
    );
    assert.equal(
      harnessUserMessageContainsPublicId({
        userMessageThisTurn: listToolOutput,
        publicId,
      }),
      true,
    );
    const skill = readFileSync(join(ROOT, "skills/gtm-readonly-limits/SKILL.md"), "utf8");
    assert.ok(/List-tool output is \*\*not\*\* the user message/i.test(skill));
  });
});
