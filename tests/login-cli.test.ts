import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  helpText,
  parseLoginMetaCode,
  runAuthLoginMeta,
} from "../src/auth/login-cli.js";
import { STORE_FILE, readStore } from "../src/auth/store.js";
import { buildGoogleAuthUrl, generatePkce } from "../src/auth/pkce.js";
import { CONSENT_A, CONSENT_C_GOOGLE, SCOPE } from "../src/google/scopes.js";
import { postMetaExchange } from "../src/gateway/meta-exchange.js";
import { installNetworkGuard, signLicense } from "./helpers.js";

describe("PR-10 auth login-ads / login-meta --code", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("helpText documents login-ads and login-meta --code; no later-PR stub", () => {
    const h = helpText();
    assert.ok(h.includes("auth login-ads"));
    assert.ok(h.includes("auth login-meta --code"));
    assert.ok(h.includes("POST /v1/meta/exchange") || h.includes("/v1/meta/exchange"));
    assert.ok(!h.includes("land in a later PR"));
    assert.ok(h.includes("never ships a developer-token"));
    assert.ok(h.includes("Do not add adwords to Consent A"));
    assert.ok(h.includes("Support never collects Meta tokens"));
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
