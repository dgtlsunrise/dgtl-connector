import { createPublicKey, verify as nodeVerify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LICENSE_ISSUER, LICENSE_PUBLIC_KEY_PEM } from "./embedded-public-key.js";

export type LicenseStatus = {
  ok: boolean;
  features: string[];
  exp?: number;
  sub?: string;
  jti?: string;
  reason?: "missing" | "expired" | "invalid" | "issuer";
};

function b64urlJson(part: string): unknown {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

export function verifyLicenseJwt(
  token: string | undefined,
  opts: { nowMs?: number; publicKeyPem?: string } = {},
): LicenseStatus {
  if (!token || !token.trim()) {
    return { ok: false, features: [], reason: "missing" };
  }
  const parts = token.trim().split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return { ok: false, features: [], reason: "invalid" };
  }
  const [h, p, s] = parts;
  let header: { alg?: string };
  let payload: {
    iss?: string;
    sub?: string;
    exp?: number;
    features?: string[];
    jti?: string;
  };
  try {
    header = b64urlJson(h) as { alg?: string };
    payload = b64urlJson(p) as typeof payload;
  } catch {
    return { ok: false, features: [], reason: "invalid" };
  }
  if (header.alg !== "EdDSA") {
    return { ok: false, features: [], reason: "invalid" };
  }
  const key = createPublicKey(opts.publicKeyPem ?? LICENSE_PUBLIC_KEY_PEM);
  const sig = Buffer.from(s, "base64url");
  const okSig = nodeVerify(null, Buffer.from(`${h}.${p}`), key, sig);
  if (!okSig) {
    return { ok: false, features: [], reason: "invalid" };
  }
  if (payload.iss && payload.iss !== LICENSE_ISSUER) {
    return { ok: false, features: [], reason: "issuer" };
  }
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) {
    return { ok: false, features: payload.features ?? [], exp: payload.exp, sub: payload.sub, jti: payload.jti, reason: "expired" };
  }
  const features = Array.isArray(payload.features) ? payload.features.map(String) : [];
  return {
    ok: true,
    features,
    exp: payload.exp,
    sub: payload.sub,
    jti: payload.jti,
  };
}

export function loadLicenseToken(env: NodeJS.ProcessEnv, pluginDataDir: string): string | undefined {
  if (env.DGTL_LICENSE_JWT?.trim()) return env.DGTL_LICENSE_JWT.trim();
  const p = join(pluginDataDir, "license.jwt");
  if (existsSync(p)) {
    return readFileSync(p, "utf8").trim();
  }
  return undefined;
}

export function hasFeature(status: LicenseStatus, feature: "ads" | "meta"): boolean {
  return status.ok && status.features.includes(feature);
}
