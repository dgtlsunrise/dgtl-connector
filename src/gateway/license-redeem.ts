/**
 * POST /v1/license client — redeem Polar one-time code or checkout_id for a
 * DGTL_LICENSE_JWT. No Authorization header (you are obtaining the license).
 * Never logs or prints the JWT. Fail-closed without DGTL_GATEWAY_URL.
 */

import { gatewayUrlFromEnv } from "./client.js";
import { MSG } from "../errors.js";

/** Frozen LicenseRedeemRequest (PRODUCT-DESIGN). Exactly one of code|checkout_id. */
export type LicenseRedeemRequest = {
  code?: string;
  checkout_id?: string;
};

export type LicenseRedeemOk = {
  ok: true;
  token: string;
  exp?: number;
  features?: string[];
};

export type LicenseRedeemFail = {
  ok: false;
  error_code: "GATEWAY_UNAVAILABLE" | "LICENSE_REQUIRED" | "INVALID_ARGUMENT" | "NOT_FOUND";
  message: string;
  hint?: string;
  http_status?: number;
};

export type LicenseRedeemResult = LicenseRedeemOk | LicenseRedeemFail;

const REDEEM_TIMEOUT_MS = 25_000;

function exactlyOneCredential(body: LicenseRedeemRequest): boolean {
  const hasCode = typeof body.code === "string" && body.code.trim().length > 0;
  const hasCheckout =
    typeof body.checkout_id === "string" && body.checkout_id.trim().length > 0;
  return (hasCode && !hasCheckout) || (!hasCode && hasCheckout);
}

/**
 * Redeem a Polar one-time code or checkout_id for a DGTL license JWT.
 * Does not persist; caller writes PLUGIN_DATA/license.jwt and never prints the token.
 */
export async function postLicenseRedeem(opts: {
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  /** Exactly one of code | checkout_id. */
  request: LicenseRedeemRequest;
  gatewayUrl?: string;
}): Promise<LicenseRedeemResult> {
  const base = (opts.gatewayUrl ?? gatewayUrlFromEnv(opts.env))?.replace(/\/+$/, "");
  if (!base) {
    return {
      ok: false,
      error_code: "GATEWAY_UNAVAILABLE",
      message: MSG.GATEWAY_UNAVAILABLE,
      hint: "Set DGTL_GATEWAY_URL before auth redeem. Example: https://stamp.dgtlsunrise.com (backup: https://dgtl-stamp.noel-4ea.workers.dev)",
    };
  }

  if (!exactlyOneCredential(opts.request)) {
    return {
      ok: false,
      error_code: "INVALID_ARGUMENT",
      message: MSG.INVALID_ARGUMENT,
      hint: "Send exactly one of --code or --checkout-id (not both, not neither).",
    };
  }

  const body: LicenseRedeemRequest = {};
  if (opts.request.code?.trim()) {
    body.code = opts.request.code.trim();
  } else if (opts.request.checkout_id?.trim()) {
    body.checkout_id = opts.request.checkout_id.trim();
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REDEEM_TIMEOUT_MS);
  try {
    const res = await opts.fetchImpl(`${base}/v1/license`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Cache-Control": "no-store",
        // No Authorization — redeem obtains the JWT. Never developer-token / Meta secret.
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });

    let parsed: Record<string, unknown> = {};
    try {
      parsed = (await res.json()) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        error_code: "GATEWAY_UNAVAILABLE",
        message: MSG.GATEWAY_UNAVAILABLE,
        hint: `License redeem returned HTTP ${res.status} with non-JSON body.`,
        http_status: res.status,
      };
    }

    if (parsed.ok === true && typeof parsed.token === "string" && parsed.token.length > 0) {
      const exp =
        typeof parsed.exp === "number" && Number.isFinite(parsed.exp) ? parsed.exp : undefined;
      const features = Array.isArray(parsed.features)
        ? parsed.features.map(String)
        : undefined;
      return {
        ok: true,
        token: parsed.token,
        exp,
        features,
      };
    }

    const rawCode = typeof parsed.error_code === "string" ? parsed.error_code : "";
    let error_code: LicenseRedeemFail["error_code"] = "GATEWAY_UNAVAILABLE";
    if (rawCode === "INVALID_ARGUMENT" || res.status === 400) {
      error_code = "INVALID_ARGUMENT";
    } else if (rawCode === "NOT_FOUND" || res.status === 404) {
      error_code = "NOT_FOUND";
    } else if (rawCode === "LICENSE_REQUIRED" || res.status === 401 || res.status === 403) {
      error_code = "LICENSE_REQUIRED";
    } else if (rawCode === "GATEWAY_UNAVAILABLE" || res.status >= 500 || res.status === 501) {
      error_code = "GATEWAY_UNAVAILABLE";
    }

    return {
      ok: false,
      error_code,
      message:
        typeof parsed.message === "string" && parsed.message.trim()
          ? parsed.message
          : error_code === "INVALID_ARGUMENT"
            ? MSG.INVALID_ARGUMENT
            : error_code === "NOT_FOUND"
              ? MSG.NOT_FOUND
              : error_code === "LICENSE_REQUIRED"
                ? MSG.LICENSE_REQUIRED
                : MSG.GATEWAY_UNAVAILABLE,
      hint: typeof parsed.hint === "string" ? parsed.hint : undefined,
      http_status: res.status,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error_code: "GATEWAY_UNAVAILABLE",
      message: MSG.GATEWAY_UNAVAILABLE,
      hint: `License redeem failed (${msg}). Check DGTL_GATEWAY_URL. Free tools still work.`,
    };
  } finally {
    clearTimeout(timer);
  }
}
