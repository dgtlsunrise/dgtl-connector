import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  helpText,
  parseRedeemArgs,
  runAuthRedeem,
} from "../src/auth/login-cli.js";
import { postLicenseRedeem } from "../src/gateway/license-redeem.js";
import { loadLicenseToken, verifyLicenseJwt } from "../src/license/verify.js";
import { installNetworkGuard, signLicense } from "./helpers.js";

describe("auth redeem / POST /v1/license", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("helpText documents auth redeem and never prints JWT guidance", () => {
    const h = helpText();
    assert.ok(h.includes("auth redeem"));
    assert.ok(h.includes("--checkout-id") || h.includes("checkout-id"));
    assert.ok(h.includes("POST /v1/license") || h.includes("/v1/license"));
    assert.ok(h.includes("never prints the JWT") || h.includes("never print"));
    assert.ok(h.includes("stamp.dgtlsunrise.com"));
  });

  it("parseRedeemArgs accepts --code / --checkout-id and = forms; rejects both/neither", () => {
    assert.deepEqual(parseRedeemArgs(["--code", "abc123"]), { code: "abc123" });
    assert.deepEqual(parseRedeemArgs(["--code=xyz"]), { code: "xyz" });
    assert.deepEqual(parseRedeemArgs(["--checkout-id", "chk_1"]), {
      checkout_id: "chk_1",
    });
    assert.deepEqual(parseRedeemArgs(["--checkout-id=chk_2"]), {
      checkout_id: "chk_2",
    });
    assert.equal(parseRedeemArgs([]), null);
    assert.equal(parseRedeemArgs(["--code"]), null);
    assert.equal(parseRedeemArgs(["--checkout-id"]), null);
    assert.equal(parseRedeemArgs(["--code", "a", "--checkout-id", "b"]), null);
    assert.equal(parseRedeemArgs(["--other", "x"]), null);
  });

  it("postLicenseRedeem fail-closed without DGTL_GATEWAY_URL", async () => {
    const r = await postLicenseRedeem({
      env: {},
      fetchImpl: (async () => {
        throw new Error("should not fetch");
      }) as typeof fetch,
      request: { code: "c1" },
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error_code, "GATEWAY_UNAVAILABLE");
      assert.ok(r.hint?.includes("stamp.dgtlsunrise.com"));
    }
  });

  it("postLicenseRedeem rejects both/neither credential", async () => {
    const neither = await postLicenseRedeem({
      env: { DGTL_GATEWAY_URL: "https://stamp.test.dgtl" },
      fetchImpl: (async () => {
        throw new Error("should not fetch");
      }) as typeof fetch,
      request: {},
    });
    assert.equal(neither.ok, false);
    if (!neither.ok) assert.equal(neither.error_code, "INVALID_ARGUMENT");

    const both = await postLicenseRedeem({
      env: { DGTL_GATEWAY_URL: "https://stamp.test.dgtl" },
      fetchImpl: (async () => {
        throw new Error("should not fetch");
      }) as typeof fetch,
      request: { code: "c", checkout_id: "id" },
    });
    assert.equal(both.ok, false);
    if (!both.ok) assert.equal(both.error_code, "INVALID_ARGUMENT");
  });

  it("postLicenseRedeem success returns token; never hits Polar or Google", async () => {
    const jwt = signLicense({
      sub: "u",
      exp: Math.floor(Date.now() / 1000) + 3600,
      features: ["ads", "meta"],
      jti: "redeem-ok",
    });
    const captures: { url: string; body: unknown; auth?: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (
        url.includes("polar.sh") ||
        url.includes("googleapis.com") ||
        url.includes("graph.facebook.com")
      ) {
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
      assert.equal(url, "https://stamp.test.dgtl/v1/license");
      return new Response(
        JSON.stringify({
          ok: true,
          token: jwt,
          exp: Math.floor(Date.now() / 1000) + 3600,
          features: ["ads", "meta"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const r = await postLicenseRedeem({
      env: { DGTL_GATEWAY_URL: "https://stamp.test.dgtl" },
      fetchImpl,
      request: { code: "one-time" },
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.token, jwt);
      assert.deepEqual(r.features, ["ads", "meta"]);
    }
    assert.equal(captures.length, 1);
    assert.deepEqual(captures[0]?.body, { code: "one-time" });
    assert.equal(captures[0]?.auth, undefined);
  });

  it("postLicenseRedeem checkout_id path + 404 → NOT_FOUND", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      assert.equal(url, "https://stamp.test.dgtl/v1/license");
      const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : {};
      assert.deepEqual(body, { checkout_id: "chk_x" });
      return new Response(
        JSON.stringify({
          ok: false,
          error_code: "NOT_FOUND",
          message: "code expired or already used",
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    };
    const r = await postLicenseRedeem({
      env: { DGTL_GATEWAY_URL: "https://stamp.test.dgtl/" },
      fetchImpl,
      request: { checkout_id: "chk_x" },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error_code, "NOT_FOUND");
  });

  it("runAuthRedeem writes license.jwt and does not print the JWT", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-redeem-cli-"));
    const jwt = signLicense({
      sub: "buyer",
      exp: Math.floor(Date.now() / 1000) + 7200,
      features: ["ads", "meta"],
      jti: "cli-redeem",
    });
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          ok: true,
          token: jwt,
          exp: Math.floor(Date.now() / 1000) + 7200,
          features: ["ads", "meta"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const errChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;

    try {
      const code = await runAuthRedeem({
        code: "grant-xyz",
        pluginDataDir: dir,
        env: { DGTL_GATEWAY_URL: "https://stamp.test.dgtl" },
        fetchImpl,
      });
      assert.equal(code, 0);
      assert.ok(existsSync(join(dir, "license.jwt")));
      const stored = readFileSync(join(dir, "license.jwt"), "utf8").trim();
      assert.equal(stored, jwt);
      assert.equal(loadLicenseToken({}, dir), jwt);
      const verified = verifyLicenseJwt(stored);
      assert.equal(verified.ok, true);
      assert.equal(verified.kid, "dev-1");
      const errOut = errChunks.join("");
      assert.ok(errOut.includes("ok"));
      assert.ok(errOut.includes("kid=dev-1"));
      assert.ok(errOut.includes("features=ads,meta"));
      assert.ok(!errOut.includes(jwt));
      // no JWT fragment printed
      assert.ok(!errOut.includes(jwt.split(".")[2]!));
    } finally {
      process.stderr.write = origWrite;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runAuthRedeem fail-closed without gateway (no fetch)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-redeem-nogw-"));
    try {
      const code = await runAuthRedeem({
        checkoutId: "chk_1",
        pluginDataDir: dir,
        env: {},
        fetchImpl: (async () => {
          throw new Error("should not fetch");
        }) as typeof fetch,
      });
      assert.equal(code, 1);
      assert.ok(!existsSync(join(dir, "license.jwt")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("license-and-reconnect skill documents ladder + primary gateway", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const skill = readFileSync(join(root, "skills/license-and-reconnect/SKILL.md"), "utf8");
    assert.ok(/LICENSE_REQUIRED ladder/i.test(skill));
    assert.ok(/auth redeem/.test(skill));
    assert.ok(/stamp\.dgtlsunrise\.com/.test(skill));
    assert.ok(/ADS_SCOPE_MISSING/.test(skill));
    assert.ok(/META_NOT_CONNECTED/.test(skill));
    assert.ok(/\$19/.test(skill));
  });
});
