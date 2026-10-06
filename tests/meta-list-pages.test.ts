/**
 * meta_list_pages — Pro-gated read hop. pages_show_list and pages_read_engagement
 * when scopes are known. business_management is not a pre-hop hard fail; an empty
 * data array asks for it when scopes are known and it is missing. No Meta network.
 * Stamp is a local fetch mock.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { STORE_FILE, writeStore } from "../src/auth/store.js";
import { createAppContext } from "../src/context.js";
import { pagesListReconnectHint } from "../src/meta/meta.js";
import { dispatch } from "../src/tools/dispatch.js";
import { TOOLS } from "../src/tools/registry.js";
import * as S from "../src/tools/schemas.js";
import { ROOT, installNetworkGuard, signLicense, testEnv } from "./helpers.js";

const META_TOKEN = "meta-pages-user-token";
const GATEWAY = "https://gateway.test.dgtl";
const PAGES_SCOPES = "ads_read,ads_management,pages_show_list,pages_read_engagement";

type Captured = { method: string; url: string; headers: Record<string, string>; body?: unknown };

function headerMap(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    for (const [k, v] of h) out[k.toLowerCase()] = v;
    return out;
  }
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

function mockWorker(hopBody: unknown): { fetchImpl: typeof fetch; captures: Captured[] } {
  const captures: Captured[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = headerMap(init?.headers);
    let body: unknown;
    if (init?.body && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    captures.push({ method, url, headers, body });
    if (url.includes("graph.facebook.com") || url.includes("googleapis.com")) {
      throw new Error(`NETWORK_FORBIDDEN ${url}`);
    }
    if (url.endsWith("/v1/health")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/v1/meta/")) {
      return new Response(JSON.stringify(hopBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`UNMAPPED_MOCK ${method} ${url}`);
  };
  return { fetchImpl, captures };
}

function licensedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const jwt = signLicense({
    sub: "pages-user",
    exp: Math.floor(Date.now() / 1000) + 86400,
    features: ["meta"],
    jti: "meta-pages-jti",
  });
  return testEnv({
    DGTL_LICENSE_JWT: jwt,
    DGTL_GATEWAY_URL: GATEWAY,
    META_ACCESS_TOKEN: META_TOKEN,
    META_GRANTED_SCOPES: "",
    GOOGLE_ACCESS_TOKEN: "google-consent-a-must-not-hop",
    ...extra,
  });
}

const PAGE_FIXTURE = {
  ok: true,
  tool: "meta_list_pages",
  data: {
    access_token: "ROOT_TOKEN_SHOULD_DROP",
    metadata_read: 1,
    data: [
      {
        id: "111",
        name: "Acme",
        category: "Brand",
        followers_count: 1200,
        fan_count: 0,
        access_token: "PAGE_TOKEN_SHOULD_DROP",
        page_access_token: "ALSO_DROP",
        tasks: ["ANALYZE"],
      },
      {
        id: "222",
        name: "Other",
        followers_count: -1,
        fan_count: 1.5,
        access_token: "DROP2",
      },
      { id: 333, name: "Numeric", followers_count: "40", fan_count: 40 },
    ],
    paging: {
      after: "CURSOR_1",
      next: "https://graph.facebook.com/v26.0/me/accounts?access_token=USERTOKEN&after=CURSOR_1",
      previous: "https://graph.facebook.com/v26.0/me/accounts?access_token=USERTOKEN",
    },
  },
  page: { truncated: false, row_count: 2, next_page_token: "USERTOKEN" },
};

describe("meta_list_pages", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("is registered read-only, Pro-gated like other Meta reads", async () => {
    const spec = TOOLS.find((t) => t.name === "meta_list_pages");
    assert.ok(spec);
    assert.equal(
      spec.description,
      "List the Facebook Pages you manage (id, name, and follower count). Read-only.",
    );
    assert.equal(spec.annotations.readOnlyHint, true);
    assert.equal(spec.annotations.destructiveHint, false);
    assert.equal(spec.group, "meta");
    assert.equal(spec.stampHop?.kind, "read_hop");
    assert.equal(spec.stampHop?.family, "meta");
    assert.equal(S.metaListPages.safeParse({}).success, true);
    assert.equal(S.metaListPages.safeParse({ limit: 25, after: "Ab_c-1=" }).success, true);
    assert.equal(S.metaListPages.safeParse({ limit: 0 }).success, false);
    assert.equal(S.metaListPages.safeParse({ limit: 101 }).success, false);
    assert.equal(S.metaListPages.safeParse({ after: "bad cursor" }).success, false);

    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8")) as {
      gated_tools: Array<{ name: string; fail: string }>;
    };
    assert.equal(catalog.gated_tools.find((t) => t.name === "meta_list_pages")?.fail, "LICENSE_REQUIRED");

    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      throw new Error("unlicensed must not fetch");
    }) as typeof fetch;
    const ctx = createAppContext({
      pluginRoot: ROOT,
      env: testEnv({
        DGTL_LICENSE_JWT: "",
        DGTL_GATEWAY_URL: GATEWAY,
        META_ACCESS_TOKEN: META_TOKEN,
        META_GRANTED_SCOPES: PAGES_SCOPES,
      }),
      fetchImpl,
    });
    const pages = await dispatch(ctx, "meta_list_pages", {});
    const accounts = await dispatch(ctx, "meta_list_ad_accounts", {});
    assert.equal(pages.ok, false);
    assert.equal(pages.error_code, "LICENSE_REQUIRED");
    assert.equal(pages.error_code, accounts.error_code);
    assert.equal(pages.message, accounts.message);
    assert.equal(fetches, 0);
  });

  it("known scopes missing either Pages permission return META_SCOPE_MISSING and do not fetch", async () => {
    const cases = [
      {
        scopes: "ads_read ads_management",
        missing: ["pages_show_list", "pages_read_engagement"],
      },
      {
        scopes: "ads_read,ads_management,pages_read_engagement",
        missing: ["pages_show_list"],
      },
      {
        scopes: "ads_read,pages_show_list,ads_management",
        missing: ["pages_read_engagement"],
      },
    ];
    for (const c of cases) {
      let fetches = 0;
      const fetchImpl = (async () => {
        fetches += 1;
        throw new Error("scope miss must not fetch");
      }) as typeof fetch;
      const ctx = createAppContext({
        pluginRoot: ROOT,
        env: licensedEnv({ META_GRANTED_SCOPES: c.scopes }),
        fetchImpl,
      });
      const env = await dispatch(ctx, "meta_list_pages", { limit: 25 });
      assert.equal(env.ok, false, c.scopes);
      assert.equal(env.error_code, "META_SCOPE_MISSING", c.scopes);
      assert.equal(env.missing_scope, c.missing.join(","), c.scopes);
      assert.equal(env.api, "meta");
      assert.equal(env.hint, pagesListReconnectHint(c.missing), c.scopes);
      assert.match(env.hint ?? "", /stamp\.dgtlsunrise\.com\/meta\/login/);
      assert.match(env.hint ?? "", /auth login-meta/);
      if (c.missing.length === 1) {
        const other = c.missing[0] === "pages_show_list" ? "pages_read_engagement" : "pages_show_list";
        assert.equal(env.hint?.includes(other), false, c.scopes);
        assert.match(env.hint ?? "", /grant it/);
      } else {
        assert.match(env.hint ?? "", /grant them/);
      }
      assert.equal(fetches, 0, c.scopes);
    }
  });

  it("rejects limit and after locally before any fetch", async () => {
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      throw new Error("invalid args must not fetch");
    }) as typeof fetch;
    const ctx = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({ META_GRANTED_SCOPES: PAGES_SCOPES }),
      fetchImpl,
    });
    for (const limit of [0, 101, 1.5, -1]) {
      const env = await dispatch(ctx, "meta_list_pages", { limit });
      assert.equal(env.ok, false, String(limit));
      assert.equal(env.error_code, "INVALID_ARGUMENT", String(limit));
      assert.match(env.hint ?? "", /1 to 100/);
    }
    const after = await dispatch(ctx, "meta_list_pages", { after: "bad cursor" });
    assert.equal(after.error_code, "INVALID_ARGUMENT");
    assert.match(after.hint ?? "", /after/);
    assert.equal(fetches, 0);
  });

  it("pages_show_list or unknown scopes POST limit/after and drop token fields", async () => {
    const { fetchImpl, captures } = mockWorker(PAGE_FIXTURE);
    const ctx = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({
        META_GRANTED_SCOPES: PAGES_SCOPES,
        DGTL_META_MUTATE_ENABLED: "false",
      }),
      fetchImpl,
    });
    const env = await dispatch(ctx, "meta_list_pages", { limit: 10, after: "CURSOR_1" });
    assert.equal(env.ok, true, env.hint ?? env.message);
    assert.deepEqual(env.data, {
      data: [
        { id: "111", name: "Acme", category: "Brand", followers_count: 1200, fan_count: 0 },
        { id: "222", name: "Other" },
        { id: "333", name: "Numeric", fan_count: 40 },
      ],
      paging: { after: "CURSOR_1" },
      metadata_read: 1,
    });
    const blob = JSON.stringify(env);
    assert.ok(!blob.includes("access_token"));
    assert.ok(!blob.includes("PAGE_TOKEN"));
    assert.ok(!blob.includes("USERTOKEN"));
    assert.ok(!blob.includes("ROOT_TOKEN"));
    assert.ok(!blob.toLowerCase().includes("token"));
    assert.equal(env.page?.next_page_token, undefined);

    const hop = captures.find((c) => c.url.includes("/v1/meta/meta_list_pages"));
    assert.ok(hop);
    assert.equal(hop.method, "POST");
    assert.equal(hop.headers["x-dgtl-user-access-token"], META_TOKEN);
    assert.ok(!JSON.stringify(hop).includes("google-consent-a-must-not-hop"));
    const body = hop.body as { tool: string; recipe: null; params: { limit?: number; after?: string } };
    assert.equal(body.tool, "meta_list_pages");
    assert.equal(body.recipe, null);
    assert.equal(body.params.limit, 10);
    assert.equal(body.params.after, "CURSOR_1");

    const unknownFetch = mockWorker(PAGE_FIXTURE);
    const unknown = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({ META_GRANTED_SCOPES: "" }),
      fetchImpl: unknownFetch.fetchImpl,
    });
    const env2 = await dispatch(unknown, "meta_list_pages", { limit: 25, after: "CURSOR_1" });
    assert.equal(env2.ok, true, env2.hint ?? env2.message);
    assert.equal((env2.data as { paging?: { after?: string } }).paging?.after, "CURSOR_1");
    assert.ok(unknownFetch.captures.some((c) => c.url.includes("/v1/meta/meta_list_pages")));
  });

  it("surfaces a reconnect hint naming the permission the stamp reported", async () => {
    const cases: Array<{ body: Record<string, unknown>; missing: string[] }> = [
      {
        body: {
          ok: false,
          error_code: "META_SCOPE_MISSING",
          message: "(#200) Requires pages_show_list permission to manage the object",
        },
        missing: ["pages_show_list"],
      },
      {
        body: {
          ok: false,
          error_code: "META_SCOPE_MISSING",
          message: "(#200) Requires pages_read_engagement permission",
        },
        missing: ["pages_read_engagement"],
      },
      {
        body: {
          ok: false,
          error_code: "PERMISSION_DENIED",
          message: "permission denied",
        },
        missing: ["pages_show_list", "pages_read_engagement"],
      },
      {
        body: {
          ok: false,
          error_code: "META_SCOPE_MISSING",
          message: "(#200) Requires business_management permission",
        },
        missing: ["business_management"],
      },
    ];
    for (const c of cases) {
      const { fetchImpl, captures } = mockWorker(c.body);
      const ctx = createAppContext({
        pluginRoot: ROOT,
        env: licensedEnv({ META_GRANTED_SCOPES: "" }),
        fetchImpl,
      });
      const env = await dispatch(ctx, "meta_list_pages", {});
      assert.equal(env.ok, false, JSON.stringify(c.body));
      assert.equal(env.error_code, c.body.error_code);
      assert.equal(env.hint, pagesListReconnectHint(c.missing));
      assert.match(env.hint ?? "", /dgtl-connector-mcp auth login-meta/);
      assert.ok(captures.some((hop) => hop.url.includes("/v1/meta/meta_list_pages")));
    }
  });

  it("keeps metadata_read 0 and drops invalid counts", async () => {
    const zero = mockWorker({
      ok: true,
      tool: "meta_list_pages",
      data: {
        metadata_read: 0,
        data: [{ id: "9", name: "", followers_count: 0, fan_count: -1 }],
      },
    });
    const ctx = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({ META_GRANTED_SCOPES: PAGES_SCOPES }),
      fetchImpl: zero.fetchImpl,
    });
    const kept = await dispatch(ctx, "meta_list_pages", {});
    assert.equal(kept.ok, true, kept.hint ?? kept.message);
    assert.deepEqual(kept.data, {
      data: [{ id: "9", followers_count: 0 }],
      metadata_read: 0,
    });

    const bad = mockWorker({
      ok: true,
      tool: "meta_list_pages",
      data: {
        metadata_read: "3",
        data: [{ id: "1", followers_count: 3.2, fan_count: "2" }],
        paging: { after: "CURSOR_OK" },
      },
    });
    const ctxBad = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({ META_GRANTED_SCOPES: "" }),
      fetchImpl: bad.fetchImpl,
    });
    const dropped = await dispatch(ctxBad, "meta_list_pages", {});
    assert.equal(dropped.ok, true, dropped.hint ?? dropped.message);
    assert.deepEqual(dropped.data, {
      data: [{ id: "1" }],
      paging: { after: "CURSOR_OK" },
    });
  });

  it("legacy [ads_read] credentials still hop meta_list_ad_accounts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-pages-legacy-"));
    const captures: Captured[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = (init?.method ?? "GET").toUpperCase();
      captures.push({ method, url, headers: headerMap(init?.headers) });
      if (url.endsWith("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/meta/meta_list_ad_accounts")) {
        return new Response(
          JSON.stringify({ ok: true, tool: "meta_list_ad_accounts", data: [{ id: "act_1", name: "A" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/v1/meta/meta_list_pages")) {
        throw new Error("pages hop must not run for ads_read-only credentials");
      }
      throw new Error(`UNMAPPED_MOCK ${method} ${url}`);
    };
    writeStore(
      dir,
      {
        access_token: "legacy-meta-token",
        expiry: Date.now() + 3_600_000,
        token_type: "bearer",
        scopes: ["ads_read"],
      },
      STORE_FILE.meta,
    );
    try {
      const ctx = createAppContext({
        pluginRoot: ROOT,
        env: licensedEnv({
          PLUGIN_DATA: dir,
          META_ACCESS_TOKEN: "",
          META_GRANTED_SCOPES: "",
        }),
        fetchImpl,
      });
      const accounts = await dispatch(ctx, "meta_list_ad_accounts", {});
      assert.equal(accounts.ok, true, accounts.hint ?? accounts.message);
      assert.ok(captures.some((c) => c.url.includes("/v1/meta/meta_list_ad_accounts")));
      const before = captures.length;
      const pages = await dispatch(ctx, "meta_list_pages", {});
      assert.equal(pages.ok, false);
      assert.equal(pages.error_code, "META_SCOPE_MISSING");
      assert.equal(pages.hint, pagesListReconnectHint(["pages_show_list", "pages_read_engagement"]));
      assert.equal(captures.length, before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Pages scopes without business_management still POST; empty data names that gap", async () => {
    const emptyBody = {
      ok: true,
      tool: "meta_list_pages",
      data: {
        access_token: "EMPTY_TOKEN_SHOULD_DROP",
        page_access_token: "ALSO_DROP",
        metadata_read: 0,
        data: [],
      },
      page: { truncated: false, row_count: 0, next_page_token: "USERTOKEN" },
    };

    const missing = mockWorker(emptyBody);
    const missingCtx = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({ META_GRANTED_SCOPES: PAGES_SCOPES }),
      fetchImpl: missing.fetchImpl,
    });
    const gap = await dispatch(missingCtx, "meta_list_pages", { limit: 25 });
    assert.equal(gap.ok, false);
    assert.equal(gap.error_code, "META_SCOPE_MISSING");
    assert.equal(gap.api, "meta");
    assert.equal(gap.missing_scope, "business_management");
    assert.equal(gap.hint, pagesListReconnectHint(["business_management"]));
    assert.match(gap.hint ?? "", /Business Manager Pages/);
    assert.match(gap.hint ?? "", /business_management/);
    assert.match(gap.hint ?? "", /stamp\.dgtlsunrise\.com\/meta\/login/);
    assert.match(gap.hint ?? "", /grant it/);
    const gapBlob = JSON.stringify(gap);
    assert.ok(!gapBlob.toLowerCase().includes("token"));
    assert.ok(!gapBlob.includes("EMPTY_TOKEN"));
    assert.ok(!gapBlob.includes("USERTOKEN"));
    const hop = missing.captures.find((c) => c.url.includes("/v1/meta/meta_list_pages"));
    assert.ok(hop);
    assert.equal(hop.method, "POST");
    const hopBody = hop.body as { params?: { limit?: number } };
    assert.equal(hopBody.params?.limit, 25);

    const granted = mockWorker(emptyBody);
    const grantedCtx = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({
        META_GRANTED_SCOPES: `${PAGES_SCOPES},business_management`,
      }),
      fetchImpl: granted.fetchImpl,
    });
    const emptyOk = await dispatch(grantedCtx, "meta_list_pages", {});
    assert.equal(emptyOk.ok, true, emptyOk.hint ?? emptyOk.message);
    assert.equal(emptyOk.error_code, undefined);
    assert.deepEqual(emptyOk.data, { data: [], metadata_read: 0 });
    const okBlob = JSON.stringify(emptyOk);
    assert.ok(!okBlob.toLowerCase().includes("token"));
    assert.ok(!okBlob.includes("EMPTY_TOKEN"));
    assert.ok(granted.captures.some((c) => c.url.includes("/v1/meta/meta_list_pages")));

    const unknown = mockWorker(emptyBody);
    const unknownCtx = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({ META_GRANTED_SCOPES: "" }),
      fetchImpl: unknown.fetchImpl,
    });
    const unknownEmpty = await dispatch(unknownCtx, "meta_list_pages", {});
    assert.equal(unknownEmpty.ok, true, unknownEmpty.hint ?? unknownEmpty.message);
    assert.deepEqual(unknownEmpty.data, { data: [], metadata_read: 0 });
    assert.ok(!JSON.stringify(unknownEmpty).toLowerCase().includes("token"));
    assert.ok(unknown.captures.some((c) => c.url.includes("/v1/meta/meta_list_pages")));
  });

  it("meta_list_ad_accounts does not require business_management", async () => {
    const { fetchImpl, captures } = mockWorker({
      ok: true,
      tool: "meta_list_ad_accounts",
      data: [{ id: "act_1", name: "A" }],
    });
    const ctx = createAppContext({
      pluginRoot: ROOT,
      env: licensedEnv({ META_GRANTED_SCOPES: PAGES_SCOPES }),
      fetchImpl,
    });
    const env = await dispatch(ctx, "meta_list_ad_accounts", {});
    assert.equal(env.ok, true, env.hint ?? env.message);
    assert.notEqual(env.error_code, "META_SCOPE_MISSING");
    assert.ok(captures.some((c) => c.url.includes("/v1/meta/meta_list_ad_accounts")));
  });
});
