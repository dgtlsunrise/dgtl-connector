import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPrivateKey, sign as nodeSign } from "node:crypto";
import { verifyLicenseJwt } from "../src/license/verify.js";
import { LICENSE_ISSUER } from "../src/license/embedded-public-key.js";
import { signLicense, TEST_LICENSE_PKCS8_B64 } from "./helpers.js";

function signRaw(header: Record<string, unknown>, payload: Record<string, unknown>): string {
  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = createPrivateKey({ key: Buffer.from(TEST_LICENSE_PKCS8_B64, "base64"), format: "der", type: "pkcs8" });
  const sig = nodeSign(null, Buffer.from(`${h}.${p}`), key);
  return `${h}.${p}.${sig.toString("base64url")}`;
}

describe("verifyLicenseJwt mint contract (PR-4)", () => {
  it("accepts valid token with kid/iss/exp", () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = signLicense({ sub: "c1", jti: "j1", exp: now + 3600, features: ["ads", "meta"] });
    const s = verifyLicenseJwt(jwt);
    assert.equal(s.ok, true);
    assert.deepEqual(s.features, ["ads", "meta"]);
  });
  it("missing iss → invalid", () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = signRaw({ alg: "EdDSA", typ: "JWT", kid: "dev-1" }, { sub: "c1", jti: "j1", exp: now + 3600, features: ["ads"] });
    const s = verifyLicenseJwt(jwt);
    assert.equal(s.ok, false);
    assert.equal(s.reason, "invalid");
  });
  it("missing exp → invalid", () => {
    const jwt = signRaw({ alg: "EdDSA", typ: "JWT", kid: "dev-1" }, { iss: LICENSE_ISSUER, sub: "c1", jti: "j1", features: ["ads"] });
    const s = verifyLicenseJwt(jwt);
    assert.equal(s.ok, false);
    assert.equal(s.reason, "invalid");
  });
  it("missing kid → invalid", () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = signRaw({ alg: "EdDSA", typ: "JWT" }, { iss: LICENSE_ISSUER, sub: "c1", jti: "j1", exp: now + 3600, features: ["ads"] });
    const s = verifyLicenseJwt(jwt);
    assert.equal(s.ok, false);
    assert.equal(s.reason, "invalid");
  });
  it("unknown kid → invalid", () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = signRaw({ alg: "EdDSA", typ: "JWT", kid: "unknown-kid" }, { iss: LICENSE_ISSUER, sub: "c1", jti: "j1", exp: now + 3600, features: ["ads"] });
    const s = verifyLicenseJwt(jwt);
    assert.equal(s.ok, false);
    assert.equal(s.reason, "invalid");
  });
});
