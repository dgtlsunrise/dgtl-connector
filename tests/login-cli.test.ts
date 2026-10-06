import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  formatMetaLoginSaved,
  helpText,
  parseLoginMetaCode,
  runAuthLoginMeta,
} from "../src/auth/login-cli.js";
import { STORE_FILE, readStore, writeStore } from "../src/auth/store.js";
import { buildGoogleAuthUrl, generatePkce } from "../src/auth/pkce.js";
import { CONSENT_A, CONSENT_C_GOOGLE, SCOPE } from "../src/google/scopes.js";
import { normalizeMetaGrantedScopes, postMetaExchange } from "../src/gateway/meta-exchange.js";
import { dispatch } from "../src/tools/dispatch.js";
import { installNetworkGuard, makeCtx, signLicense, testEnv } from "./helpers.js";

describe("PR-10 auth login-ads / login-meta --code", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("helpText documents login-ads and login-meta --code; no later-PR stub", () => {
    const h = helpText();
    assert.ok(h.includes("auth login-ads"));
    assert.ok(h.includes("auth login-mc"));
    assert.ok(h.includes("auth login-gbp"));
    assert.ok(h.includes("auth login-meta --code"));
    assert.ok(h.includes("POST /v1/meta/exchange") || h.includes("/v1/meta/exchange"));
    assert.ok(!h.includes("land in a later PR"));
    assert.ok(h.includes("never ships a developer-token"));
    assert.ok(h.includes("Do not add adwords") || h.includes("adwords"));
    assert.ok(h.includes("login-mc"));
    assert.ok(h.includes("Support never collects Meta tokens"));
    assert.ok(h.includes("pages_show_list"));
    assert.ok(h.includes("pages_read_engagement"));
    assert.ok(h.includes("doctor"));
  });

  it("Consent C auth URL is adwords only — never merged into Consent A URL", () => {
    const pkce = generatePkce();
    const adsUrl = buildGoogleAuthUrl({
      clientId: "ads-client.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:9876/callback",
      challenge: pkce.challenge,
      state: pkce.state,
      scopes: CONSENT_C_GOOGLE,
    });
    const granted = new URL(adsUrl).searchParams.get("scope")?.split(/\s+/) ?? [];
    assert.deepEqual(granted, [SCOPE.adwords]);
    assert.ok(!granted.some((s) => (CONSENT_A as readonly string[]).includes(s)));

    const aUrl = buildGoogleAuthUrl({
      clientId: "a-client.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:9876/callback",
      challenge: pkce.challenge,
      state: pkce.state,
    });
    assert.ok(!aUrl.includes("adwords"));
    assert.deepEqual(new URL(aUrl).searchParams.get("scope")?.split(/\s+/), [...CONSENT_A]);
  });

  it("parseLoginMetaCode accepts --code and --code=", () => {
    assert.equal(parseLoginMetaCode(["--code", "abc123"]), "abc123");
    assert.equal(parseLoginMetaCode(["--code=xyz"]), "xyz");
    assert.equal(parseLoginMetaCode(["--code"]), null);
    assert.equal(parseLoginMetaCode([]), null);
    assert.equal(parseLoginMetaCode(["--other", "x"]), null);
  });

  it("postMetaExchange fail-closed without gateway URL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-meta-ex-"));
    try {
      const r = await postMetaExchange({
        env: { DGTL_LICENSE_JWT: "x" },
        pluginDataDir: dir,
        fetchImpl: (async () => {
          throw new Error("should not fetch");
        }) as typeof fetch,
        request: { grant_code: "g1" },
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.error_code, "GATEWAY_UNAVAILABLE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("postMetaExchange fail-closed without license JWT", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-meta-lic-"));
    try {
      const r = await postMetaExchange({
        env: { DGTL_GATEWAY_URL: "https://gateway.test.dgtl" },
        pluginDataDir: dir,
        fetchImpl: (async () => {
          throw new Error("should not fetch");
        }) as typeof fetch,
        request: { grant_code: "g1" },
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.error_code, "LICENSE_REQUIRED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("postMetaExchange rejects both/neither credential", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-meta-both-"));
    const jwt = signLicense({
      sub: "u",
      exp: Math.floor(Date.now() / 1000) + 3600,
      features: ["meta"],
      jti: "ex-both",
    });
    try {
      const neither = await postMetaExchange({
        env: { DGTL_GATEWAY_URL: "https://gateway.test.dgtl", DGTL_LICENSE_JWT: jwt },
        pluginDataDir: dir,
        fetchImpl: (async () => {
          throw new Error("should not fetch");
        }) as typeof fetch,
        request: {},
      });
      assert.equal(neither.ok, false);
      if (!neither.ok) assert.equal(neither.error_code, "INVALID_ARGUMENT");

      const both = await postMetaExchange({
        env: { DGTL_GATEWAY_URL: "https://gateway.test.dgtl", DGTL_LICENSE_JWT: jwt },
        pluginDataDir: dir,
        fetchImpl: (async () => {
          throw new Error("should not fetch");
        }) as typeof fetch,
        request: { grant_code: "c", short_lived_token: "t" },
      });
      assert.equal(both.ok, false);
      if (!both.ok) assert.equal(both.error_code, "INVALID_ARGUMENT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("postMetaExchange success returns token to caller; never hits graph.facebook.com", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-meta-ok-"));
    const jwt = signLicense({
      sub: "u",
      exp: Math.floor(Date.now() / 1000) + 3600,
      features: ["meta"],
      jti: "ex-ok",
    });
    const captures: { url: string; body: unknown; auth?: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("graph.facebook.com") || url.includes("googleapis.com")) {
        throw new Error(`NETWORK_FORBIDDEN ${url}`);
      }
      let body: unknown;
      if (init?.body && typeof init.body === "string") body = JSON.parse(init.body);
      const headers = init?.headers as Record<string, string> | undefined;
      captures.push({
        url,
        body,
        auth: headers?.Authorization ?? headers?.authorization,
      });
      assert.equal(url, "https://gateway.test.dgtl/v1/meta/exchange");
      return new Response(
        JSON.stringify({
          ok: true,
          access_token: "long-lived-meta-token",
          expires_in: 5184000,
          token_type: "bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    try {
      const r = await postMetaExchange({
        env: { DGTL_GATEWAY_URL: "https://gateway.test.dgtl", DGTL_LICENSE_JWT: jwt },
        pluginDataDir: dir,
        fetchImpl,
        request: { grant_code: "one-time-grant" },
      });
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.access_token, "long-lived-meta-token");
        assert.equal(r.expires_in, 5184000);
      }
      assert.equal(captures.length, 1);
      assert.deepEqual(captures[0]?.body, { grant_code: "one-time-grant" });
      assert.ok(captures[0]?.auth?.startsWith("Bearer "));
      assert.ok(!JSON.stringify(captures[0]?.body).includes("long-lived"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runAuthLoginMeta writes meta-oauth.json and does not print the token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-meta-cli-"));
    const jwt = signLicense({
      sub: "u",
      exp: Math.floor(Date.now() / 1000) + 3600,
      features: ["meta", "ads"],
      jti: "cli-meta",
    });
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          ok: true,
          access_token: "meta-ll-secret-token-do-not-log",
          expires_in: 3600,
          token_type: "bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const errChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      errChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;

    try {
      const code = await runAuthLoginMeta({
        grantCode: "grant-abc",
        pluginDataDir: dir,
        env: { DGTL_GATEWAY_URL: "https://gateway.test.dgtl", DGTL_LICENSE_JWT: jwt },
        fetchImpl,
      });
      assert.equal(code, 0);
      const stored = readStore(dir, STORE_FILE.meta);
      assert.equal(stored?.access_token, "meta-ll-secret-token-do-not-log");
      assert.ok(existsSync(join(dir, "meta-oauth.json")));
      assert.ok(!existsSync(join(dir, "google-oauth.json")));
      const errOut = errChunks.join("");
      assert.ok(errOut.includes("meta-oauth.json"));
      assert.ok(!errOut.includes("meta-ll-secret-token-do-not-log"));
    } finally {
      process.stderr.write = origWrite;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runAuthLoginMeta fail-closed without meta feature on license", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-meta-nofeat-"));
    const jwt = signLicense({
      sub: "u",
      exp: Math.floor(Date.now() / 1000) + 3600,
      features: ["ads"],
      jti: "cli-nometa",
    });
    try {
      const code = await runAuthLoginMeta({
        grantCode: "grant-abc",
        pluginDataDir: dir,
        env: { DGTL_GATEWAY_URL: "https://gateway.test.dgtl", DGTL_LICENSE_JWT: jwt },
        fetchImpl: (async () => {
          throw new Error("should not fetch");
        }) as typeof fetch,
      });
      assert.equal(code, 1);
      assert.equal(readStore(dir, STORE_FILE.meta), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("normalizeMetaGrantedScopes trims, lowercases, and drops junk", () => {
    assert.equal(normalizeMetaGrantedScopes(undefined), undefined);
    assert.equal(normalizeMetaGrantedScopes("ads_read,ads_management"), undefined);
    assert.deepEqual(
      normalizeMetaGrantedScopes([
        " ADS_READ ",
        "Ads_Management",
        "",
        "not a scope",
        12,
        null,
        "ads_read",
        "ads_management",
      ]),
      ["ads_read", "ads_management"],
    );
    assert.deepEqual(normalizeMetaGrantedScopes([]), []);
    assert.deepEqual(normalizeMetaGrantedScopes(["", "  ", 1]), []);
  });

  function exchangeFetch(body: Record<string, unknown>): typeof fetch {
    return async (input) => {
      const url = String(input);
      if (url.includes("graph.facebook.com") || url.includes("googleapis.com")) {
        throw new Error(`NETWORK_FORBIDDEN ${url}`);
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }

  async function withStderr(fn: () => Promise<void>): Promise<string> {
    const chunks: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;
    try {
      await fn();
      return chunks.join("");
    } finally {
      process.stderr.write = orig;
    }
  }

  function metaLicense(dir: string) {
    const jwt = signLicense({
      sub: "u",
      exp: Math.floor(Date.now() / 1000) + 3600,
      features: ["meta", "ads"],
      jti: `cli-scopes-${dir.slice(-6)}`,
    });
    return {
      jwt,
      env: {
        DGTL_GATEWAY_URL: "https://gateway.test.dgtl",
        DGTL_LICENSE_JWT: jwt,
      } as NodeJS.ProcessEnv,
    };
  }

  function toolCtx(dir: string, jwt: string, fetchImpl: typeof fetch) {
    const ctx = makeCtx(
      {},
      testEnv({
        PLUGIN_DATA: dir,
        DGTL_GATEWAY_URL: "https://gateway.test.dgtl",
        DGTL_LICENSE_JWT: jwt,
        META_ACCESS_TOKEN: "",
        META_GRANTED_SCOPES: "",
      }),
    );
    ctx.fetchImpl = fetchImpl;
    return ctx;
  }

  function gatewayFetch(counts: { create: number; list: number }): typeof fetch {
    return async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("graph.facebook.com") || url.includes("googleapis.com")) {
        throw new Error(`NETWORK_FORBIDDEN ${url}`);
      }
      if (url.includes("/v1/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/meta/meta_create_campaign")) {
        counts.create += 1;
        return new Response(
          JSON.stringify({ ok: true, tool: "meta_create_campaign", data: { id: "cmp_1" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/v1/meta/meta_list_ad_accounts")) {
        counts.list += 1;
        return new Response(
          JSON.stringify({
            ok: true,
            tool: "meta_list_ad_accounts",
            data: [{ id: "act_111222333", name: "Fixture" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    };
  }

  it("login-meta stores granted ads_management and a live create hops", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-meta-grant-both-"));
    const { jwt, env } = metaLicense(dir);
    const token = "meta-both-secret-do-not-log";
    const counts = { create: 0, list: 0 };
    try {
      let code = 1;
      const errOut = await withStderr(async () => {
        code = await runAuthLoginMeta({
          grantCode: "grant-both",
          pluginDataDir: dir,
          env,
          fetchImpl: exchangeFetch({
            ok: true,
            access_token: token,
            expires_in: 3600,
            token_type: "bearer",
            granted_scopes: [" ADS_READ ", "Ads_Management", "", "not a scope", 12, null, "ads_read"],
            declined_scopes: ["pages_show_list"],
          }),
        });
      });
      assert.equal(code, 0);
      const stored = readStore(dir, STORE_FILE.meta);
      assert.deepEqual(stored?.scopes, ["ads_read", "ads_management"]);
      assert.ok(stored?.scopes?.includes("ads_management"));
      assert.ok(errOut.includes("read + manage"));
      assert.ok(errOut.includes("preview/confirm-gated"));
      assert.ok(errOut.includes("meta_list_pages needs pages_show_list and pages_read_engagement"));
      assert.ok(errOut.includes("reconnect to grant them"));
      assert.ok(!errOut.includes("+ Pages"));
      assert.ok(!errOut.includes(token));
      assert.ok(!errOut.includes("not a scope"));

      const ctx = toolCtx(dir, jwt, gatewayFetch(counts));
      const envOut = await dispatch(ctx, "meta_create_campaign", {
        ad_account_id: "111222333",
        name: "Traffic",
        objective: "OUTCOME_TRAFFIC",
        dry_run: false,
        confirm_phrase: "create on act_111222333",
      });
      assert.equal(envOut.ok, true);
      assert.equal(counts.create, 1);
      assert.equal(counts.list, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("login-meta granted ads_read only is read-only: write META_SCOPE_MISSING, read still hops", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-meta-grant-read-"));
    const { jwt, env } = metaLicense(dir);
    const token = "meta-read-secret-do-not-log";
    const counts = { create: 0, list: 0 };
    try {
      let code = 1;
      const errOut = await withStderr(async () => {
        code = await runAuthLoginMeta({
          grantCode: "grant-read",
          pluginDataDir: dir,
          env,
          fetchImpl: exchangeFetch({
            ok: true,
            access_token: token,
            expires_in: 3600,
            token_type: "bearer",
            granted_scopes: ["ads_read"],
          }),
        });
      });
      assert.equal(code, 0);
      const stored = readStore(dir, STORE_FILE.meta);
      assert.deepEqual(stored?.scopes, ["ads_read"]);
      assert.ok(errOut.includes("read-only"));
      assert.ok(errOut.includes("auth login-meta"));
      assert.ok(errOut.includes("/meta/login"));
      assert.ok(errOut.includes("ads_management"));
      assert.ok(!errOut.includes(token));

      const ctx = toolCtx(dir, jwt, gatewayFetch(counts));
      const write = await dispatch(ctx, "meta_create_campaign", {
        ad_account_id: "111222333",
        name: "Traffic",
        objective: "OUTCOME_TRAFFIC",
        dry_run: false,
        confirm_phrase: "create on act_111222333",
      });
      assert.equal(write.ok, false);
      assert.equal(write.error_code, "META_SCOPE_MISSING");
      assert.match(write.hint ?? "", /auth login-meta/);
      assert.match(write.hint ?? "", /\/meta\/login/);
      assert.match(write.hint ?? "", /ads_management/);
      assert.equal(counts.create, 0);

      const read = await dispatch(ctx, "meta_list_ad_accounts", {});
      assert.equal(read.ok, true);
      assert.equal(counts.list, 1);
      assert.equal(counts.create, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("legacy meta-oauth.json scopes ads_read: reads hop, writes reconnect without mutate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-meta-legacy-"));
    const { jwt } = metaLicense(dir);
    const counts = { create: 0, list: 0 };
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
      const ctx = toolCtx(dir, jwt, gatewayFetch(counts));
      const write = await dispatch(ctx, "meta_create_campaign", {
        ad_account_id: "111222333",
        name: "Traffic",
        objective: "OUTCOME_TRAFFIC",
        dry_run: false,
        confirm_phrase: "create on act_111222333",
      });
      assert.equal(write.ok, false);
      assert.equal(write.error_code, "META_SCOPE_MISSING");
      assert.match(write.hint ?? "", /auth login-meta/);
      assert.match(write.hint ?? "", /\/meta\/login/);
      assert.match(write.hint ?? "", /ads_management/);
      assert.equal(counts.create, 0);

      const read = await dispatch(ctx, "meta_list_ad_accounts", {});
      assert.equal(read.ok, true);
      assert.equal(counts.list, 1);
      assert.equal(counts.create, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exchange without granted_scopes stores unknown scopes, not [ads_read]", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-meta-unknown-"));
    const { jwt, env } = metaLicense(dir);
    const token = "meta-unknown-secret-do-not-log";
    const counts = { create: 0, list: 0 };
    try {
      let code = 1;
      const errOut = await withStderr(async () => {
        code = await runAuthLoginMeta({
          grantCode: "grant-old",
          pluginDataDir: dir,
          env,
          fetchImpl: exchangeFetch({
            ok: true,
            access_token: token,
            expires_in: 3600,
            token_type: "bearer",
          }),
        });
      });
      assert.equal(code, 0);
      const stored = readStore(dir, STORE_FILE.meta);
      assert.equal(stored?.access_token, token);
      assert.equal(stored?.scopes, undefined);
      assert.notDeepEqual(stored?.scopes, ["ads_read"]);
      const raw = JSON.parse(readFileSync(join(dir, "meta-oauth.json"), "utf8")) as {
        scopes?: unknown;
      };
      assert.equal("scopes" in raw, false);
      assert.ok(errOut.includes("not reported"));
      assert.ok(!errOut.includes("read-only"));
      assert.ok(!errOut.includes(token));
      assert.equal(formatMetaLoginSaved(undefined).includes(token), false);

      const ctx = toolCtx(dir, jwt, gatewayFetch(counts));
      const write = await dispatch(ctx, "meta_create_campaign", {
        ad_account_id: "111222333",
        name: "Traffic",
        objective: "OUTCOME_TRAFFIC",
        dry_run: false,
        confirm_phrase: "create on act_111222333",
      });
      assert.equal(write.ok, true, write.hint ?? write.message);
      assert.equal(counts.create, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("formatMetaLoginSaved names only the four known permissions", () => {
    const saved = "Meta authorization saved to PLUGIN_DATA/meta-oauth.json (token not logged). Worker stores nothing.\n";
    const allFour = formatMetaLoginSaved([
      "ads_read",
      "ads_management",
      "pages_show_list",
      "pages_read_engagement",
      "business_management",
      "EAABshould-not-print",
    ]);
    assert.equal(
      allFour,
      saved +
        "Access: read + manage + Pages (ads_read, ads_management, pages_show_list, pages_read_engagement). Write tools are available and stay preview/confirm-gated.\n",
    );
    assert.ok(!allFour.includes("business_management"));
    assert.ok(!allFour.includes("EAAB"));

    const manageOnly = formatMetaLoginSaved(["ads_read", "ads_management"]);
    assert.equal(
      manageOnly,
      saved +
        "Access: read + manage (ads_read and ads_management). Write tools are available and stay preview/confirm-gated. meta_list_pages needs pages_show_list and pages_read_engagement; reconnect to grant them.\n",
    );
    assert.ok(!manageOnly.includes("+ Pages"));

    const missingShow = formatMetaLoginSaved(["ads_management", "pages_read_engagement"]);
    assert.equal(
      missingShow,
      saved +
        "Access: read + manage (ads_management). Write tools are available and stay preview/confirm-gated. meta_list_pages needs pages_show_list; reconnect to grant it.\n",
    );
    assert.ok(!missingShow.includes("+ Pages"));

    const missingEngagement = formatMetaLoginSaved(["ads_read", "ads_management", "pages_show_list"]);
    assert.equal(
      missingEngagement,
      saved +
        "Access: read + manage (ads_read and ads_management). Write tools are available and stay preview/confirm-gated. meta_list_pages needs pages_read_engagement; reconnect to grant it.\n",
    );
    assert.ok(!missingEngagement.includes("+ Pages"));

    const bothPagesNoRead = formatMetaLoginSaved([
      "ads_management",
      "pages_show_list",
      "pages_read_engagement",
    ]);
    assert.equal(
      bothPagesNoRead,
      saved +
        "Access: read + manage + Pages (ads_management, pages_show_list, pages_read_engagement). Write tools are available and stay preview/confirm-gated.\n",
    );

    const readOnly = formatMetaLoginSaved(["ads_read"]);
    assert.match(readOnly, /^Meta authorization saved/);
    assert.ok(readOnly.includes("Access: read-only (ads_read)."));
    assert.ok(readOnly.includes("auth login-meta"));
    assert.ok(readOnly.includes("/meta/login"));
    assert.ok(readOnly.includes("ads_management"));

    const readOnlyPages = formatMetaLoginSaved([
      "pages_read_engagement",
      "ads_read",
      "pages_show_list",
      "catalog_management",
    ]);
    assert.ok(
      readOnlyPages.includes(
        "Access: read-only (ads_read, pages_show_list, pages_read_engagement).",
      ),
    );
    assert.ok(!readOnlyPages.includes("catalog_management"));
    assert.ok(readOnlyPages.includes("Write tools need ads_management."));

    const unknown = formatMetaLoginSaved(undefined);
    assert.ok(unknown.includes("not reported"));
    assert.ok(!unknown.includes("Access:"));
    assert.ok(!unknown.includes("read-only"));
    assert.equal(formatMetaLoginSaved([]), unknown);
    assert.ok(!formatMetaLoginSaved(["ads_read", "raw-token-value"]).includes("raw-token-value"));
  });

  it("gateway Worker stub mapping: 501 → GATEWAY_UNAVAILABLE (fail closed)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-meta-501-"));
    const jwt = signLicense({
      sub: "u",
      exp: Math.floor(Date.now() / 1000) + 3600,
      features: ["meta"],
      jti: "ex-501",
    });
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error_code: "GATEWAY_UNAVAILABLE",
          message: "Meta exchange not implemented (PR-3 stub)",
        }),
        { status: 501, headers: { "content-type": "application/json" } },
      );
    try {
      const r = await postMetaExchange({
        env: { DGTL_GATEWAY_URL: "https://gateway.test.dgtl", DGTL_LICENSE_JWT: jwt },
        pluginDataDir: dir,
        fetchImpl,
        request: { grant_code: "x" },
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.error_code, "GATEWAY_UNAVAILABLE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

});
