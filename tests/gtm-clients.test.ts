import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { googleWritePathAllowed } from "../src/http/google-write.js";
import { GTM_CLIENT_TYPES, GTM_USAGE_CONTEXTS } from "../src/google/gtm-types.js";
import * as S from "../src/tools/schemas.js";
import { dispatch } from "../src/tools/dispatch.js";
import { CONSENT_A_KERNEL_COUNT, CONSENT_A_TOOLS, TOOLS } from "../src/tools/registry.js";
import { installNetworkGuard, makeCtx, testEnv, TEST_TOKEN } from "./helpers.js";

const WRITE_ENV = () =>
  testEnv({
    DGTL_WRITES_ENABLED: "true",
    GOOGLE_WRITE_ACCESS_TOKEN: "write-test-token",
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
  });

const WAVE13_WRITES = [
  "gtm_create_client",
  "gtm_update_client",
  "gtm_create_container",
  "gtm_create_environment",
] as const;

describe("Wave 13 sGTM clients / container / environments", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("closed enums: unknown type / usageContext fail with a clear error (zero HTTP)", () => {
    const badType = S.gtmCreateClient.safeParse({
      account_id: "1",
      container_id: "2",
      workspace_id: "3",
      name: "x",
      type: "html",
    });
    assert.equal(badType.success, false);

    const badUsage = S.gtmCreateContainer.safeParse({
      account_id: "1",
      name: "Server",
      usage_context: "androidSdk5",
    });
    assert.equal(badUsage.success, false);

    assert.ok(GTM_CLIENT_TYPES.includes("gaawp"));
    assert.ok(GTM_USAGE_CONTEXTS.includes("server"));
  });

  it("dry_run defaults true; live needs confirm_phrase", () => {
    const created = S.gtmCreateClient.parse({
      account_id: "1",
      container_id: "2",
      workspace_id: "3",
      name: "GA4",
      type: "gaawp",
    });
    assert.equal(created.dry_run, true);

    const liveMissing = S.gtmCreateContainer.safeParse({
      account_id: "1",
      name: "Server",
      usage_context: "server",
      dry_run: false,
    });
    assert.equal(liveMissing.success, false);
  });

  it("list clients + environments use Consent A (flag off) and fixtures", async () => {
    const ctx = makeCtx();
    assert.equal(ctx.flags.writesEnabled, false);
    const clients = await dispatch(ctx, "gtm_list_clients", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
    });
    assert.equal(clients.ok, true, JSON.stringify(clients));
    const cdata = clients.data as { source?: string; client?: { type?: string }[] };
    assert.equal(cdata.source, "workspace");
    assert.ok(Array.isArray(cdata.client) && cdata.client.length >= 1);
    assert.equal(cdata.client[0]?.type, "gaawp");
    assert.ok(ctx.calls.every((c) => c.method === "GET"));
    assert.ok(ctx.calls.some((c) => c.path.endsWith("/clients")));

    const envs = await dispatch(ctx, "gtm_list_environments", {
      account_id: "444444",
      container_id: "555555",
    });
    assert.equal(envs.ok, true, JSON.stringify(envs));
    const edata = envs.data as { environment?: { type?: string }[] };
    assert.ok(Array.isArray(edata.environment) && edata.environment.length >= 1);
    assert.ok(ctx.calls.some((c) => c.path.endsWith("/environments") && c.method === "GET"));
    assert.ok(!ctx.calls.some((c) => c.method === "POST" || c.method === "PUT"));
  });

  it("flag off write tools → WRITE_NOT_ENABLED and zero HTTP", async () => {
    const ctx = makeCtx();
    for (const name of WAVE13_WRITES) {
      const env = await dispatch(ctx, name, {
        account_id: "444444",
        container_id: "555555",
        workspace_id: "6",
        client_id: "1",
        name: "Example GA4 Client",
        type: "gaawp",
        usage_context: "server",
        dry_run: true,
      });
      assert.equal(env.ok, false, name);
      assert.equal(env.error_code, "WRITE_NOT_ENABLED", name);
    }
    assert.equal(ctx.calls.length, 0);
  });

  it("unknown client type with writes on → INVALID_ARGUMENT, zero HTTP", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_create_client", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      name: "Bad",
      type: "html",
      dry_run: true,
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.match(String(env.message), /Unknown GTM client type/);
    assert.match(String(env.message), /gaawp/);
    assert.equal(ctx.calls.length, 0);
  });

  it("unknown usage_context with writes on → INVALID_ARGUMENT, zero HTTP", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_create_container", {
      account_id: "444444",
      name: "Nope",
      usage_context: "androidSdk5",
      dry_run: true,
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.match(String(env.message), /usageContext/);
    assert.equal(ctx.calls.length, 0);
  });

  it("ingest-key parameter is refused (no stamp secrets in GTM)", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_create_client", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      name: "GA4",
      type: "gaawp",
      parameter: [{ type: "template", key: "X-DGTL-Ingest-Key", value: "secret" }],
      dry_run: true,
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.match(String(env.message), /stamp ingest/);
    assert.equal(ctx.calls.length, 0);
  });

  it("dry_run create client returns proposed + publicId (GET only)", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    let authCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "gtm_create_client", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      name: "Example GA4 Client",
      type: "gaawp",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    const data = env.data as { dry_run: boolean; publicId: string; container_path: string; proposed: { type: string } };
    assert.equal(data.dry_run, true);
    assert.equal(data.publicId, "GTM-XXXX000");
    assert.equal(data.container_path, "accounts/444444/containers/555555");
    assert.equal(data.proposed.type, "gaawp");
    assert.equal(authCalls, 0);
    assert.ok(ctx.calls.every((c) => c.method === "GET"));
    assert.ok(!ctx.calls.some((c) => c.path.endsWith("/clients") && c.method === "POST"));
  });

  it("live create client without publicId/path confirm → INVALID_ARGUMENT, no POST", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_create_client", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      name: "Example GA4 Client",
      type: "gaawp",
      dry_run: false,
      confirm_phrase: "PUBLISH",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.ok(!ctx.calls.some((c) => c.method === "POST" || c.method === "PUT"));
  });

  it("live create client accepts publicId confirm via httpWrite, never ctx.auth", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    let authCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      authCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "gtm_create_client", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      name: "Example GA4 Client",
      type: "gaawp",
      dry_run: false,
      confirm_phrase: "create client on GTM-XXXX000",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal(authCalls, 0);
    assert.ok(ctx.calls.some((c) => c.method === "POST" && c.path.endsWith("/clients")));
    assert.ok(ctx.calls.every((c) => c.host === "tagmanager.googleapis.com"));
  });

  it("live create client accepts container path in confirm_phrase", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_create_client", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      name: "Example GA4 Client",
      type: "gaawp",
      dry_run: false,
      confirm_phrase: "please create on accounts/444444/containers/555555",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.ok(ctx.calls.some((c) => c.method === "POST" && c.path.endsWith("/clients")));
  });

  it("live update client uses PUT", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_update_client", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      client_id: "1",
      name: "Example GA4 Client Updated",
      type: "gaawp",
      dry_run: false,
      confirm_phrase: "update GTM-XXXX000",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.ok(ctx.calls.some((c) => c.method === "PUT" && c.path.includes("/clients/1")));
  });

  it("dry_run create container is zero HTTP", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_create_container", {
      account_id: "444444",
      name: "Example Brand Server",
      usage_context: "server",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    const data = env.data as { dry_run: boolean; account_path: string; proposed: { usageContext: string[] } };
    assert.equal(data.dry_run, true);
    assert.equal(data.account_path, "accounts/444444");
    assert.deepEqual(data.proposed.usageContext, ["server"]);
    assert.equal(ctx.calls.length, 0);
  });

  it("live create container requires accounts/{id} confirm then POST", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const miss = await dispatch(ctx, "gtm_create_container", {
      account_id: "444444",
      name: "Example Brand Server",
      usage_context: "server",
      dry_run: false,
      confirm_phrase: "PUBLISH",
    });
    assert.equal(miss.error_code, "INVALID_ARGUMENT");
    assert.equal(ctx.calls.length, 0);

    const ok = await dispatch(ctx, "gtm_create_container", {
      account_id: "444444",
      name: "Example Brand Server",
      usage_context: ["server"],
      dry_run: false,
      confirm_phrase: "create server container under accounts/444444",
    });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.ok(ctx.calls.some((c) => c.method === "POST" && /\/accounts\/444444\/containers$/.test(c.path)));
  });

  it("live create environment uses publicId confirm + POST", async () => {
    const ctx = makeCtx({}, WRITE_ENV());
    const env = await dispatch(ctx, "gtm_create_environment", {
      account_id: "444444",
      container_id: "555555",
      name: "Example Preview",
      enable_debug: true,
      dry_run: false,
      confirm_phrase: "create env on GTM-XXXX000",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.ok(ctx.calls.some((c) => c.method === "POST" && c.path.endsWith("/environments")));
  });

  it("write path allowlist includes clients / containers / environments and still refuses delete", () => {
    assert.equal(
      googleWritePathAllowed("POST", "/tagmanager/v2/accounts/1/containers/2/workspaces/3/clients"),
      true,
    );
    assert.equal(
      googleWritePathAllowed("PUT", "/tagmanager/v2/accounts/1/containers/2/workspaces/3/clients/9"),
      true,
    );
    assert.equal(googleWritePathAllowed("POST", "/tagmanager/v2/accounts/1/containers"), true);
    assert.equal(
      googleWritePathAllowed("POST", "/tagmanager/v2/accounts/1/containers/2/environments"),
      true,
    );
    assert.equal(
      googleWritePathAllowed("DELETE", "/tagmanager/v2/accounts/1/containers/2/workspaces/3/clients/9"),
      false,
    );
    assert.equal(
      googleWritePathAllowed("POST", "/tagmanager/v2/accounts/1/containers/2/environments/3:reauthorize"),
      false,
    );
  });

  it("list tools join the Consent A kernel; writes stay on gtm_write", () => {
    assert.equal(CONSENT_A_TOOLS.length, CONSENT_A_KERNEL_COUNT);
    assert.equal(CONSENT_A_KERNEL_COUNT, 26);
    assert.ok(CONSENT_A_TOOLS.includes("gtm_list_clients"));
    assert.ok(CONSENT_A_TOOLS.includes("gtm_list_environments"));
    for (const name of WAVE13_WRITES) {
      assert.ok(!CONSENT_A_TOOLS.includes(name), name);
      const spec = TOOLS.find((t) => t.name === name);
      assert.equal(spec?.family, "gtm_write", name);
    }
  });
});
