import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { AuthPort, tokenHasScopes } from "../src/auth/port.js";
import { helpText } from "../src/auth/login-cli.js";
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
  SCOPE,
} from "../src/google/scopes.js";
import { dispatch } from "../src/tools/dispatch.js";
import { installNetworkGuard, makeCtx, ROOT, testEnv, TEST_TOKEN } from "./helpers.js";

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

  it("auth login URL requests Free Google and never adwords/content/business.manage", () => {
    const pkce = generatePkce();
    const url = buildGoogleAuthUrl({
      clientId: "example-public-client-id.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:8732/callback",
      challenge: pkce.challenge,
      state: pkce.state,
    });
    const granted = new URL(url).searchParams.get("scope")?.split(/\s+/) ?? [];
    assert.deepEqual(granted, [...FREE_FULL]);
    assert.ok(!url.includes("adwords"));
    assert.ok(!url.includes("auth/content"));
    assert.ok(!url.includes("business.manage"));
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

  it("writes stay flag-gated even when Free Google already has manage scopes", async () => {
    assert.equal(loadFlags({}).writesEnabled, false);
    const env = testEnv({
      GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
      GOOGLE_GRANTED_SCOPES: FREE_FULL.join(" "),
    });
    const off = makeCtx({}, env);
    const publish = await dispatch(off, "gtm_publish_container", {
      account_id: "444444",
      container_id: "555555",
      workspace_id: "6",
      dry_run: true,
      confirm_phrase: "PUBLISH",
    });
    assert.equal(publish.ok, false);
    assert.equal(publish.error_code, "WRITE_NOT_ENABLED");
    assert.equal(off.calls.length, 0);

    const create = await dispatch(off, "ga4_create_property", {
      account_id: "accounts/111111",
      display_name: "Example",
      time_zone: "America/Los_Angeles",
      currency_code: "USD",
      dry_run: true,
    });
    assert.equal(create.error_code, "WRITE_NOT_ENABLED");

    const sitemap = await dispatch(off, "gsc_submit_sitemap", {
      site_url: "https://www.example.com/",
      feedpath: "https://www.example.com/sitemap.xml",
      dry_run: true,
    });
    assert.equal(sitemap.error_code, "WRITE_NOT_ENABLED");
  });

  it("flag on + Free Google manage scopes is enough for GTM dry-run (no CONSENT_W_REQUIRED)", async () => {
    const ctx = makeCtx(
      {},
      testEnv({
        DGTL_WRITES_ENABLED: "true",
        GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
        GOOGLE_GRANTED_SCOPES: FREE_FULL.join(" "),
      }),
    );
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
    assert.match(plugin.description, /flag-gated/i);
    assert.doesNotMatch(plugin.description, /read-only/i);
    for (const banned of FREE_GOOGLE_NEVER) {
      assert.ok(!plugin.extensions["com.dgtlsunrise"].consentA.includes(banned), banned);
    }
  });
});
