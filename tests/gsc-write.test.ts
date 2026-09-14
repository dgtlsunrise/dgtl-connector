import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import { googleGscWritePathAllowed } from "../src/http/google-gsc-write.js";
import { APIS, CONSENT_A, CONSENT_S } from "../src/google/scopes.js";
import { encodeSiteUrl } from "../src/ids.js";
import * as S from "../src/tools/schemas.js";
import { dispatch } from "../src/tools/dispatch.js";
import { CONSENT_A_TOOLS, GSC_WRITE_TOOL_NAMES, TOOLS } from "../src/tools/registry.js";
import { installNetworkGuard, makeCtx, ROOT, testEnv, TEST_TOKEN } from "./helpers.js";

const SITE = "https://www.example.com/";
const FEED = "https://www.example.com/sitemap.xml";
const S_TOKEN = "gsc-write-test-token";
const WRITE_TOOLS = ["gsc_submit_sitemap", "gsc_delete_sitemap"] as const;

function sEnv(extra: NodeJS.ProcessEnv = {}) {
  return testEnv({
    DGTL_WRITES_ENABLED: "true",
    GOOGLE_GSC_WRITE_ACCESS_TOKEN: S_TOKEN,
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    ...extra,
  });
}

function sitemapPath(siteUrl: string, feedpath: string): string {
  return `/webmasters/v3/sites/${encodeSiteUrl(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`;
}

describe("Wave 12 GSC sitemap writes (Consent S)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("write tools are registered, not in CONSENT_A_TOOLS, family gsc_write", () => {
    assert.equal(CONSENT_A_TOOLS.length, 26);
    assert.deepEqual([...GSC_WRITE_TOOL_NAMES].sort(), [...WRITE_TOOLS].sort());
    for (const name of WRITE_TOOLS) {
      assert.ok(!CONSENT_A_TOOLS.includes(name), name);
      const spec = TOOLS.find((t) => t.name === name);
      assert.equal(spec?.family, "gsc_write", name);
      assert.equal(spec?.group, "gsc-write", name);
      assert.equal(spec?.annotations.readOnlyHint, false, name);
      assert.ok(!/confirm_phrase\s*=/.test(spec!.description), name);
      assert.ok(!spec!.description.includes("https://www.example.com/"), name);
    }
    const submit = TOOLS.find((t) => t.name === "gsc_submit_sitemap");
    const del = TOOLS.find((t) => t.name === "gsc_delete_sitemap");
    assert.equal(submit?.annotations.destructiveHint, false);
    assert.equal(del?.annotations.destructiveHint, true);
    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8")) as {
      tools: Array<{ name: string }>;
      gated_tools: Array<{ name: string; fail: string }>;
    };
    assert.equal(catalog.tools.length, 26);
    for (const name of WRITE_TOOLS) {
      assert.ok(!catalog.tools.some((t) => t.name === name), name);
      const g = catalog.gated_tools.find((t) => t.name === name);
      assert.ok(g, name);
      assert.equal(g!.fail, "CONSENT_S_REQUIRED", name);
    }
  });

  it("S sits on Free Google; A never includes adwords", () => {
    const setS = new Set<string>(CONSENT_S);
    assert.deepEqual(
      CONSENT_A.filter((s) => setS.has(s)),
      [...CONSENT_S],
    );
    assert.ok(!CONSENT_A.includes("https://www.googleapis.com/auth/adwords" as (typeof CONSENT_A)[number]));
  });

  it("Wave 13+ site/index tools stay unregistered", () => {
    for (const name of [
      "gsc_add_site",
      "gsc_delete_site",
      "gsc_inspect_url_index",
      "gsc_request_indexing",
    ]) {
      assert.ok(!TOOLS.some((t) => t.name === name), name);
    }
  });

  it("schemas default dry_run true; live needs confirm", () => {
    const parsed = S.gscSubmitSitemap.parse({ site_url: SITE, feedpath: FEED });
    assert.equal(parsed.dry_run, true);
    const liveMissing = S.gscDeleteSitemap.safeParse({
      site_url: SITE,
      feedpath: FEED,
      dry_run: false,
    });
    assert.equal(liveMissing.success, false);
  });

  it("path allowlist is closed (no sites.add/delete, no Indexing API)", () => {
    const ok = sitemapPath(SITE, FEED);
    assert.equal(googleGscWritePathAllowed("PUT", ok), true);
    assert.equal(googleGscWritePathAllowed("DELETE", ok), true);
    assert.equal(googleGscWritePathAllowed("PUT", `/webmasters/v3/sites/${encodeSiteUrl(SITE)}`), false);
    assert.equal(googleGscWritePathAllowed("DELETE", `/webmasters/v3/sites/${encodeSiteUrl(SITE)}`), false);
    assert.equal(googleGscWritePathAllowed("PUT", "/v3/urlNotifications:publish"), false);
    assert.equal(googleGscWritePathAllowed("DELETE", "/webmasters/v3/sites"), false);
    assert.equal(googleGscWritePathAllowed("PUT", "/webmasters/v3/sites/sc-domain%3Aexample.com/sitemaps"), false);
  });

  it("writesEnabled false + Consent S token + confirm proceeds (no WRITE_NOT_ENABLED)", async () => {
    const ctx = makeCtx({}, testEnv({ GOOGLE_GSC_WRITE_ACCESS_TOKEN: S_TOKEN }));
    assert.equal(ctx.flags.writesEnabled, false);
    const env = await dispatch(ctx, "gsc_submit_sitemap", {
      site_url: SITE,
      feedpath: FEED,
      dry_run: false,
      confirm_phrase: SITE,
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.notEqual(env.error_code, "WRITE_NOT_ENABLED");
    assert.ok(ctx.calls.some((c) => c.method === "PUT" && c.path.includes("/sitemaps/")));
  });

  it("CONSENT_S_REQUIRED when flag on but no S token; never uses Consent A", async () => {
    const ctx = makeCtx({}, testEnv({ DGTL_WRITES_ENABLED: "true" }));
    let aCalls = 0;
    const orig = ctx.auth.getAccessToken.bind(ctx.auth);
    ctx.auth.getAccessToken = async () => {
      aCalls += 1;
      return orig();
    };
    const env = await dispatch(ctx, "gsc_delete_sitemap", {
      site_url: SITE,
      feedpath: FEED,
      dry_run: false,
      confirm_phrase: SITE,
    });
    assert.equal(env.error_code, "CONSENT_S_REQUIRED");
    assert.equal(aCalls, 0);
    assert.equal(ctx.calls.length, 0);
  });

  it("reads stay on Consent A (list/get sitemap never touch S)", async () => {
    const ctx = makeCtx();
    let sCalls = 0;
    ctx.authGscWrite.getAccessToken = async () => {
      sCalls += 1;
      return null;
    };
    const list = await dispatch(ctx, "gsc_list_sitemaps", { site_url: SITE });
    const get = await dispatch(ctx, "gsc_get_sitemap", { site_url: SITE, feedpath: FEED });
    assert.equal(list.ok, true, JSON.stringify(list));
    assert.equal(get.ok, true, JSON.stringify(get));
    assert.equal(sCalls, 0);
    assert.ok(ctx.calls.every((c) => c.method === "GET"));
  });

  it("dry_run submit/delete is zero HTTP", async () => {
    for (const tool of WRITE_TOOLS) {
      const ctx = makeCtx({}, sEnv());
      const env = await dispatch(ctx, tool, { site_url: SITE, feedpath: FEED });
      assert.equal(env.ok, true, JSON.stringify(env));
      assert.equal((env.data as { dry_run: boolean }).dry_run, true);
      assert.equal(ctx.calls.length, 0);
    }
  });

  it("live mutate without site_url in confirm → INVALID_ARGUMENT", async () => {
    const ctx = makeCtx({}, sEnv());
    const env = await dispatch(ctx, "gsc_submit_sitemap", {
      site_url: SITE,
      feedpath: FEED,
      dry_run: false,
      confirm_phrase: "yes submit it",
    });
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.ok(String(env.message).includes(SITE));
    assert.equal(ctx.calls.length, 0);
  });

  it("wrong site_url (confirm mismatch) is a clear error, zero HTTP", async () => {
    const ctx = makeCtx({}, sEnv());
    const env = await dispatch(ctx, "gsc_delete_sitemap", {
      site_url: SITE,
      feedpath: FEED,
      dry_run: false,
      confirm: "sc-domain:example.com",
    });
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.ok(String(env.message).includes("site_url"));
    assert.ok(String(env.hint).includes("gsc_list_sites"));
    assert.equal(ctx.calls.length, 0);
  });

  it("wrong site_url that Google does not know → NOT_FOUND with exactness hint", async () => {
    const wrong = "https://not-listed.example/";
    const ctx = makeCtx({}, sEnv());
    const env = await dispatch(ctx, "gsc_submit_sitemap", {
      site_url: wrong,
      feedpath: "https://not-listed.example/sitemap.xml",
      dry_run: false,
      confirm_phrase: `submit on ${wrong}`,
    });
    assert.equal(env.error_code, "NOT_FOUND");
    assert.equal(env.resource_id, wrong);
    assert.ok(String(env.hint).includes("gsc_list_sites"));
    assert.ok(String(env.hint).includes(wrong));
    assert.ok(ctx.calls.some((c) => c.method === "PUT"));
  });

  it("live PUT/DELETE use httpGscWrite and never ctx.auth", async () => {
    const cases: Array<{ tool: string; method: "PUT" | "DELETE" }> = [
      { tool: "gsc_submit_sitemap", method: "PUT" },
      { tool: "gsc_delete_sitemap", method: "DELETE" },
    ];
    for (const c of cases) {
      const ctx = makeCtx({}, sEnv());
      let aCalls = 0;
      const orig = ctx.auth.getAccessToken.bind(ctx.auth);
      ctx.auth.getAccessToken = async () => {
        aCalls += 1;
        return orig();
      };
      const env = await dispatch(ctx, c.tool, {
        site_url: SITE,
        feedpath: FEED,
        dry_run: false,
        confirm_phrase: `please apply ${SITE}`,
      });
      assert.equal(env.ok, true, `${c.tool} ${JSON.stringify(env)}`);
      assert.equal(aCalls, 0, c.tool);
      assert.ok(
        ctx.calls.some((x) => x.method === c.method && x.path === sitemapPath(SITE, FEED)),
        `${c.tool} missing ${c.method} ${sitemapPath(SITE, FEED)} in ${JSON.stringify(ctx.calls)}`,
      );
      assert.ok(ctx.calls.every((x) => x.host === APIS.searchconsole), c.tool);
    }
  });

  it("Consent A GoogleHttp refuses sitemap mutate POST", async () => {
    const ctx = makeCtx();
    await assert.rejects(
      () =>
        ctx.http.post(
          APIS.searchconsole,
          sitemapPath(SITE, FEED),
          {},
          { api: APIS.searchconsole, tool: "probe" },
        ),
      (err: Error & { error_code?: string }) => {
        assert.equal(err.error_code, "UNSUPPORTED_OPERATION");
        assert.match(err.message, /Consent S|GoogleGscWriteHttp|sitemap/);
        return true;
      },
    );
  });
});
