import assert from "node:assert/strict";
import { get as httpGet } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { AuthPort, tokenHasScopes } from "../src/auth/port.js";
import { helpText, runAuthLogin } from "../src/auth/login-cli.js";
import { buildGoogleAuthUrl, generatePkce } from "../src/auth/pkce.js";
import { loadFlags } from "../src/flags.js";
import {
  CONSENT_A,
  CONSENT_A_PRODUCT,
  CONSENT_G,
  CONSENT_S,
  CONSENT_W,
  CONSENT_W_GTM,
  FREE_GOOGLE_NEVER,
  freeConnectScopes,
  SCOPE,
  STAGING_SCOPES_ENV,
} from "../src/google/scopes.js";
import { dispatch } from "../src/tools/dispatch.js";
import { FREE_FULL_SCOPES, installNetworkGuard, makeCtx, ROOT, testEnv, TEST_TOKEN } from "./helpers.js";

const FREE_FULL = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/tagmanager.readonly",
  "https://www.googleapis.com/auth/analytics.edit",
  "https://www.googleapis.com/auth/tagmanager.edit.containers",
  "https://www.googleapis.com/auth/tagmanager.publish",
  "https://www.googleapis.com/auth/webmasters",
] as const;

function waitForPrintedAuthUrl(chunks: string[], timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const match = chunks.join("").match(/https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth[^\s]+/);
      if (match) {
        resolve(match[0]);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`auth login did not print a Google URL: ${chunks.join("")}`));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

function loopbackGet(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    httpGet(url, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    }).on("error", reject);
  });
}

describe("Free full Google Connect", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("CONSENT_A is the locked Free Google set and never includes Pro/GBP/MC", () => {
    assert.deepEqual([...CONSENT_A], [...FREE_FULL]);
    assert.deepEqual([...CONSENT_A_PRODUCT], [
      SCOPE.analytics,
      SCOPE.webmasters,
      SCOPE.tagmanager,
      SCOPE.analyticsEdit,
      SCOPE.tagmanagerEditContainers,
      SCOPE.tagmanagerPublish,
      SCOPE.webmastersWrite,
    ]);
    for (const banned of FREE_GOOGLE_NEVER) {
      assert.ok(!(CONSENT_A as readonly string[]).includes(banned), banned);
    }
    assert.ok(!(CONSENT_A as readonly string[]).includes(SCOPE.adwords));
    assert.ok(!(CONSENT_A as readonly string[]).includes(SCOPE.content));
    assert.ok(!(CONSENT_A as readonly string[]).includes(SCOPE.business));
    assert.deepEqual(
      CONSENT_W.filter((s) => !(CONSENT_A as readonly string[]).includes(s)),
      [],
    );
    assert.deepEqual(
      CONSENT_G.filter((s) => !(CONSENT_A as readonly string[]).includes(s)),
      [],
    );
    assert.deepEqual(
      CONSENT_S.filter((s) => !(CONSENT_A as readonly string[]).includes(s)),
      [],
    );
  });

  it("auth login URL scope param includes exact Free Connect strings Google named", () => {
    const pkce = generatePkce();
    const url = buildGoogleAuthUrl({
      clientId: "example-public-client-id.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:8732/callback",
      challenge: pkce.challenge,
      state: pkce.state,
    });
    const granted = new URL(url).searchParams.get("scope")?.split(/\s+/) ?? [];
    for (const scope of FREE_FULL) {
      assert.ok(granted.includes(scope), `Free Connect URL missing ${scope}`);
    }
    assert.deepEqual(granted, [...FREE_FULL]);
    assert.ok(!granted.includes("https://www.googleapis.com/auth/adwords"));
    assert.ok(!granted.includes("https://www.googleapis.com/auth/content"));
    assert.ok(!granted.includes("https://www.googleapis.com/auth/business.manage"));
    assert.ok(!url.includes("adwords"));
    assert.ok(!url.includes("auth/content"));
    assert.ok(!url.includes("business.manage"));
  });

  it("auth login prints a Free Connect URL with the same exact scope strings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-free-url-"));
    const chunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;
    try {
      const login = runAuthLogin({
        clientId: "example-public-client-id.apps.googleusercontent.com",
        pluginDataDir: dir,
        fetchImpl: (async () => {
          throw new Error("NETWORK_FORBIDDEN");
        }) as typeof fetch,
      });
      const url = await waitForPrintedAuthUrl(chunks);
      const parsed = new URL(url);
      const granted = parsed.searchParams.get("scope")?.split(/\s+/) ?? [];
      assert.deepEqual(granted, [...FREE_FULL]);
      assert.ok(granted.includes("https://www.googleapis.com/auth/analytics.edit"));
      assert.ok(granted.includes("https://www.googleapis.com/auth/tagmanager.edit.containers"));
      assert.ok(!granted.includes("https://www.googleapis.com/auth/tagmanager.edit.containerversions"));
      assert.ok(granted.includes("https://www.googleapis.com/auth/tagmanager.publish"));
      assert.ok(granted.includes("https://www.googleapis.com/auth/webmasters"));
      assert.ok(!granted.includes("https://www.googleapis.com/auth/adwords"));
      const redirectUri = parsed.searchParams.get("redirect_uri");
      assert.ok(redirectUri);
      const deny = new URL(redirectUri);
      deny.searchParams.set("error", "access_denied");
      deny.searchParams.set("state", parsed.searchParams.get("state") ?? "");
      assert.equal(await loopbackGet(deny.toString()), 200);
      assert.equal(await login, 1);
    } finally {
      process.stderr.write = origWrite;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("write ports ignore a readonly Free Google token and accept one with write scopes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-free-full-"));
    const fetchImpl = (async () => {
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    try {
      const readonly = AuthPort.writeFromEnv({
        env: {
          GOOGLE_ACCESS_TOKEN: "readonly-a",
          GOOGLE_GRANTED_SCOPES: [SCOPE.openid, SCOPE.email, SCOPE.analytics, SCOPE.webmasters, SCOPE.tagmanager].join(
            " ",
          ),
        },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal(await readonly.getAccessToken(), null);

      const full = AuthPort.writeFromEnv({
        env: {
          GOOGLE_ACCESS_TOKEN: "full-a",
          GOOGLE_GRANTED_SCOPES: FREE_FULL.join(" "),
        },
        pluginDataDir: dir,
        fetchImpl,
      });
      const tok = await full.getAccessToken();
      assert.equal(tok?.accessToken, "full-a");
      assert.ok(tokenHasScopes(tok, CONSENT_W_GTM));

      const legacy = AuthPort.writeFromEnv({
        env: {
          GOOGLE_WRITE_ACCESS_TOKEN: "legacy-w",
          GOOGLE_ACCESS_TOKEN: "full-a",
          GOOGLE_GRANTED_SCOPES: FREE_FULL.join(" "),
        },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal((await legacy.getAccessToken())?.accessToken, "legacy-w");

      const g = AuthPort.ga4AdminFromEnv({
        env: { GOOGLE_ACCESS_TOKEN: "full-a", GOOGLE_GRANTED_SCOPES: FREE_FULL.join(" ") },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal((await g.getAccessToken())?.accessToken, "full-a");

      const s = AuthPort.gscWriteFromEnv({
        env: { GOOGLE_ACCESS_TOKEN: "full-a", GOOGLE_GRANTED_SCOPES: FREE_FULL.join(" ") },
        pluginDataDir: dir,
        fetchImpl,
      });
      assert.equal((await s.getAccessToken())?.accessToken, "full-a");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writesEnabled false + manage scopes + dry_run proceeds; live without confirm stays blocked; no scope → CONSENT", async () => {
    assert.equal(loadFlags({}).writesEnabled, false);
    const env = testEnv({
      GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
      GOOGLE_GRANTED_SCOPES: FREE_FULL_SCOPES,
    });
    const off = makeCtx({}, env);
    assert.equal(off.flags.writesEnabled, false);

    const publish = await dispatch(off, "gtm_publish_container", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      dry_run: true,
      confirm_phrase: "PUBLISH",
    });
    assert.equal(publish.ok, true, JSON.stringify(publish));
    assert.equal((publish.data as { dry_run?: boolean }).dry_run, true);
    assert.notEqual(publish.error_code, "WRITE_NOT_ENABLED");

    const create = await dispatch(off, "ga4_create_property", {
      account_id: "accounts/111111",
      display_name: "Example",
      time_zone: "America/Los_Angeles",
      currency_code: "USD",
      dry_run: true,
    });
    assert.equal(create.ok, true, JSON.stringify(create));
    assert.equal((create.data as { dry_run?: boolean }).dry_run, true);

    const sitemap = await dispatch(off, "gsc_submit_sitemap", {
      site_url: "https://www.example.com/",
      feedpath: "https://www.example.com/sitemap.xml",
      dry_run: true,
    });
    assert.equal(sitemap.ok, true, JSON.stringify(sitemap));
    assert.equal((sitemap.data as { dry_run?: boolean }).dry_run, true);

    const liveOk = await dispatch(off, "gtm_create_tag", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      dry_run: false,
      confirm_phrase: "please apply GTM-XXXX000",
      name: "Example",
      type: "html",
    });
    assert.equal(liveOk.ok, true, JSON.stringify(liveOk));
    assert.equal((liveOk.data as { dry_run?: boolean }).dry_run, false);
    assert.ok(off.calls.some((c) => c.method === "POST" && c.path.endsWith("/tags")));

    const liveNoConfirm = await dispatch(off, "gsc_submit_sitemap", {
      site_url: "https://www.example.com/",
      feedpath: "https://www.example.com/sitemap.xml",
      dry_run: false,
      confirm_phrase: "yes do it",
    });
    assert.equal(liveNoConfirm.error_code, "INVALID_ARGUMENT");
    assert.ok(!off.calls.some((c) => c.method === "PUT" || c.method === "DELETE"));

    const noScope = makeCtx();
    const missing = await dispatch(noScope, "gtm_create_tag", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      dry_run: true,
      name: "Example",
      type: "html",
    });
    assert.equal(missing.error_code, "CONSENT_W_REQUIRED");
    assert.equal(noScope.calls.length, 0);
  });

  it("Free Google manage scopes are enough for GTM dry-run without DGTL_WRITES_ENABLED", async () => {
    const ctx = makeCtx(
      {},
      testEnv({
        GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
        GOOGLE_GRANTED_SCOPES: FREE_FULL_SCOPES,
      }),
    );
    assert.equal(ctx.flags.writesEnabled, false);
    const env = await dispatch(ctx, "gtm_create_tag", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      dry_run: true,
      name: "Example",
      type: "html",
    });
    assert.notEqual(env.error_code, "CONSENT_W_REQUIRED");
    assert.notEqual(env.error_code, "WRITE_NOT_ENABLED");
    assert.equal(env.ok, true);
    assert.equal((env.data as { dry_run?: boolean }).dry_run, true);
  });

  it("helpText documents Free Google login and login-* aliases", () => {
    const h = helpText();
    assert.match(h, /Free Google/);
    assert.match(h, /login-write/);
    assert.match(h, /login-ga4-admin/);
    assert.match(h, /login-gsc-write/);
    assert.match(h, /alias/i);
    assert.match(h, /does not turn on DGTL_WRITES_ENABLED/i);
    assert.ok(!h.includes("Do not add adwords") || h.includes("Do not add adwords, content, or business.manage"));
  });

  it("plugin.json consentA matches CONSENT_A_PRODUCT and omits Pro scopes", () => {
    const plugin = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8")) as {
      description: string;
      extensions: { "com.dgtlsunrise": { consentA: string[] } };
    };
    assert.deepEqual(plugin.extensions["com.dgtlsunrise"].consentA, [...CONSENT_A_PRODUCT]);
    assert.match(plugin.description, /read and manage/i);
    assert.match(plugin.description, /in-chat confirm/i);
    assert.doesNotMatch(plugin.description, /read-only/i);
    for (const banned of FREE_GOOGLE_NEVER) {
      assert.ok(!plugin.extensions["com.dgtlsunrise"].consentA.includes(banned), banned);
    }
  });
});

describe("tagmanager.edit.containerversions is staging-only", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  const CV = SCOPE.tagmanagerEditContainerversions;
  const PUBLISH_ARGS = {
    account_id: "444444",
    container_id: "555555",
    workspace_id: "6",
  };

  it("default Free Connect URL omits it; DGTL_GOOGLE_STAGING_SCOPES=1 adds exactly it", () => {
    assert.equal(STAGING_SCOPES_ENV, "DGTL_GOOGLE_STAGING_SCOPES");
    for (const env of [{}, { DGTL_GOOGLE_STAGING_SCOPES: "0" }, { DGTL_GOOGLE_STAGING_SCOPES: "true" }]) {
      assert.deepEqual([...freeConnectScopes(env)], [...FREE_FULL], JSON.stringify(env));
    }
    const staged = freeConnectScopes({ DGTL_GOOGLE_STAGING_SCOPES: "1" });
    assert.deepEqual([...staged], [...FREE_FULL, CV]);
    for (const banned of FREE_GOOGLE_NEVER) {
      assert.ok(!staged.includes(banned), banned);
    }
  });

  it("auth login with DGTL_GOOGLE_STAGING_SCOPES=1 prints a URL that requests it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-staged-url-"));
    const chunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;
    try {
      const login = runAuthLogin({
        clientId: "example-public-client-id.apps.googleusercontent.com",
        pluginDataDir: dir,
        env: { DGTL_GOOGLE_STAGING_SCOPES: "1" },
        fetchImpl: (async () => {
          throw new Error("NETWORK_FORBIDDEN");
        }) as typeof fetch,
      });
      const parsed = new URL(await waitForPrintedAuthUrl(chunks));
      const granted = parsed.searchParams.get("scope")?.split(/\s+/) ?? [];
      const redirectUri = parsed.searchParams.get("redirect_uri");
      assert.ok(redirectUri);
      const deny = new URL(redirectUri);
      deny.searchParams.set("error", "access_denied");
      deny.searchParams.set("state", parsed.searchParams.get("state") ?? "");
      assert.equal(await loopbackGet(deny.toString()), 200);
      assert.equal(await login, 1);
      assert.deepEqual(granted, [...FREE_FULL, CV]);
    } finally {
      process.stderr.write = origWrite;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("gtm_publish_container dry run still works on a production grant without it", async () => {
    const ctx = makeCtx({}, testEnv({ GOOGLE_ACCESS_TOKEN: TEST_TOKEN, GOOGLE_GRANTED_SCOPES: FREE_FULL_SCOPES }));
    const env = await dispatch(ctx, "gtm_publish_container", { ...PUBLISH_ARGS, dry_run: true });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal((env.data as { dry_run?: boolean }).dry_run, true);
    assert.ok(!ctx.calls.some((c) => c.method === "POST"));
  });

  it("live gtm_publish_container on a grant without it returns CONSENT_MISSING and posts nothing", async () => {
    const ctx = makeCtx({}, testEnv({ GOOGLE_ACCESS_TOKEN: TEST_TOKEN, GOOGLE_GRANTED_SCOPES: FREE_FULL_SCOPES }));
    const env = await dispatch(ctx, "gtm_publish_container", {
      ...PUBLISH_ARGS,
      dry_run: false,
      confirm_phrase: "I confirm publish for GTM-XXXX000",
    });
    assert.equal(env.ok, false, JSON.stringify(env));
    assert.equal(env.error_code, "CONSENT_MISSING");
    assert.match(env.message ?? "", /tagmanager\.edit\.containerversions/);
    assert.match(env.message ?? "", /No version was created and nothing was published/);
    assert.equal((env as { missing_scope?: string }).missing_scope, CV);
    assert.ok(!ctx.calls.some((c) => c.path.includes(":create_version")));
    assert.ok(!ctx.calls.some((c) => c.path.includes(":publish")));
  });

  it("live gtm_publish_container on a staged grant creates the version then publishes", async () => {
    const ctx = makeCtx(
      {},
      testEnv({ GOOGLE_ACCESS_TOKEN: TEST_TOKEN, GOOGLE_GRANTED_SCOPES: `${FREE_FULL_SCOPES} ${CV}` }),
    );
    const env = await dispatch(ctx, "gtm_publish_container", {
      ...PUBLISH_ARGS,
      dry_run: false,
      confirm_phrase: "I confirm publish for GTM-XXXX000",
      version_name: "Staged publish",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.ok(ctx.calls.some((c) => c.path.includes(":create_version")));
    assert.ok(ctx.calls.some((c) => c.path.includes(":publish")));
  });
});
