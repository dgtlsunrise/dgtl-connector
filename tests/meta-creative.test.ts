import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { dispatch } from "../src/tools/dispatch.js";
import { TOOLS } from "../src/tools/registry.js";
import * as S from "../src/tools/schemas.js";
import {
  ROOT,
  installNetworkGuard,
  makeCtx,
  signLicense,
  testEnv,
  TEST_TOKEN,
} from "./helpers.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function metaLicenseEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const jwt = signLicense({
    sub: "user_test",
    features: ["ads", "meta"],
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "jti-meta-creative-test",
  });
  return testEnv({
    DGTL_LICENSE_JWT: jwt,
    META_ACCESS_TOKEN: "meta-user-token-fixture",
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    DGTL_GATEWAY_URL: "https://stamp.test",
    ...extra,
  });
}

describe("Meta creative upload + AdCreative foundations", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  const tools = [
    "meta_upload_ad_image",
    "meta_upload_ad_video",
    "meta_create_ad_creative",
  ] as const;

  it("tools registered destructive and dry_run defaults true", () => {
    for (const name of tools) {
      const t = TOOLS.find((x) => x.name === name);
      assert.ok(t, name);
      assert.equal(t!.annotations.destructiveHint, true, name);
    }
    assert.equal(
      S.metaUploadAdImage.parse({
        ad_account_id: "111222333",
        bytes: "a".repeat(64),
      }).dry_run,
      true,
    );
  });

  it("image upload dry_run proposes without hop", async () => {
    let calls = 0;
    const ctx = makeCtx({}, metaLicenseEnv({ META_GRANTED_SCOPES: "ads_read ads_management" }));
    ctx.fetchImpl = (async () => {
      calls += 1;
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_upload_ad_image", {
      ad_account_id: "111222333",
      bytes: "a".repeat(64),
      name: "hero.png",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal((env.data as { dry_run?: boolean }).dry_run, true);
    assert.equal(calls, 0);
  });

  it("creative requires image_hash XOR video_id", async () => {
    const ctx = makeCtx({}, metaLicenseEnv());
    const env = await dispatch(ctx, "meta_create_ad_creative", {
      ad_account_id: "111222333",
      name: "Creative",
      page_id: "555",
      link: "https://example.com/",
      image_hash: "abcdef12",
      video_id: "999",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
  });

  it("detectable missing ads_management → META_SCOPE_MISSING zero hop", async () => {
    let createHops = 0;
    const ctx = makeCtx({}, metaLicenseEnv({ META_GRANTED_SCOPES: "ads_read" }));
    ctx.fetchImpl = (async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/meta/")) createHops += 1;
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_upload_ad_image", {
      ad_account_id: "111222333",
      bytes: "a".repeat(64),
      dry_run: false,
      confirm_phrase: "upload on act_111222333",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "META_SCOPE_MISSING");
    assert.equal(createHops, 0);
  });

  it("live creative posts closed https link without refusing hop", async () => {
    let seen: Record<string, unknown> | null = null;
    const ctx = makeCtx(
      {},
      metaLicenseEnv({ META_GRANTED_SCOPES: "ads_read ads_management" }),
    );
    ctx.fetchImpl = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/meta/meta_create_ad_creative")) {
        seen = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            ok: true,
            tool: "meta_create_ad_creative",
            data: { id: "creative-1" },
            api: "meta",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const env = await dispatch(ctx, "meta_create_ad_creative", {
      ad_account_id: "111222333",
      name: "Creative",
      page_id: "555666",
      image_hash: "abcdef12ff",
      link: "https://example.com/offer",
      dry_run: false,
      confirm_phrase: "create creative on act_111222333 page 555666",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    const params = seen!.params as Record<string, unknown>;
    assert.equal(params.link, "https://example.com/offer");
    assert.equal(params.image_hash, "abcdef12ff");
    assert.ok(!("object_story_spec" in params));
    assert.ok(!("url" in params));
  });

  it("catalog lists creative tools behind Meta mutate gate", () => {
    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8")) as {
      gated_tools: Array<{ name: string; fail: string }>;
    };
    for (const name of tools) {
      const g = catalog.gated_tools.find((x) => x.name === name);
      assert.ok(g, name);
      assert.equal(g!.fail, "META_MUTATE_NOT_ENABLED");
    }
  });
});
