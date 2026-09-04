/**
 * POST /v1/meta/exchange client (PR-10).
 * Redeem hosted Login one-time grant_code (or short_lived_token) for a
 * long-lived Meta user token returned TO THE PLUGIN. Worker stores nothing.
 * Never logs or prints Meta tokens. Support never collects Meta tokens.
 */

import { gatewayUrlFromEnv } from "./client.js";
import { loadLicenseToken } from "../license/verify.js";
import { MSG } from "../errors.js";

/** Frozen MetaExchangeRequest (PRODUCT-DESIGN). Exactly one of token|code. */
export type MetaExchangeRequest = {
  short_lived_token?: string;
  grant_code?: string;
};

export type MetaExchangeOk = {
  ok: true;
  access_token: string;
  expires_in: number;
  token_type: string;
};

export type MetaExchangeFail = {
  ok: false;
  error_code: "LICENSE_REQUIRED" | "GATEWAY_UNAVAILABLE" | "INVALID_ARGUMENT" | "META_NOT_CONNECTED";
  message: string;
  hint?: string;
  http_status?: number;
};

export type MetaExchangeResult = MetaExchangeOk | MetaExchangeFail;

const EXCHANGE_TIMEOUT_MS = 25_000;

function exactlyOneCredential(body: MetaExchangeRequest): boolean {
  const hasTok = typeof body.short_lived_token === "string" && body.short_lived_token.trim().length > 0;
  const hasCode = typeof body.grant_code === "string" && body.grant_code.trim().length > 0;
  return (hasTok && !hasCode) || (!hasTok && hasCode);
}

/**
 * Exchange a hosted Login grant_code or host short-lived token for a long-lived
 * Meta user access token. Does not persist; caller writes PLUGIN_DATA/meta-oauth.json.
 */
export async function postMetaExchange(opts: {
  env: NodeJS.ProcessEnv;
  pluginDataDir: string;
  fetchImpl: typeof fetch;
  /** Exactly one of short_lived_token | grant_code. */
  request: MetaExchangeRequest;
  gatewayUrl?: string;
}): Promise<MetaExchangeResult> {
  const base = (opts.gatewayUrl ?? gatewayUrlFromEnv(opts.env))?.replace(/\/+$/, "");
  if (!base) {
    return {
      ok: false,
      error_code: "GATEWAY_UNAVAILABLE",
      message: MSG.GATEWAY_UNAVAILABLE,
      hint: "Set DGTL_GATEWAY_URL before auth login-meta --code. Host-injected META_ACCESS_TOKEN does not need exchange.",
    };
  }

  if (!exactlyOneCredential(opts.request)) {
    return {
      ok: false,
      error_code: "INVALID_ARGUMENT",
      message: MSG.INVALID_ARGUMENT,
      hint: "Send exactly one of grant_code or short_lived_token (not both, not neither).",
    };
  }

  const licenseJwt = loadLicenseToken(opts.env, opts.pluginDataDir);
  if (!licenseJwt) {
    return {
      ok: false,
      error_code: "LICENSE_REQUIRED",
      message: MSG.LICENSE_REQUIRED,
      hint: "Meta exchange requires a DGTL license JWT with features including meta.",
    };
  }

  const body: MetaExchangeRequest = {};
  if (opts.request.grant_code?.trim()) {
    body.grant_code = opts.request.grant_code.trim();
  } else if (opts.request.short_lived_token?.trim()) {
    body.short_lived_token = opts.request.short_lived_token.trim();
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), EXCHANGE_TIMEOUT_MS);
  try {
    const res = await opts.fetchImpl(`${base}/v1/meta/exchange`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${licenseJwt}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        // Never Meta app secret / never developer-token on the client.
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
        hint: `Meta exchange returned HTTP ${res.status} with non-JSON body.`,
        http_status: res.status,
      };
    }

    if (parsed.ok === true && typeof parsed.access_token === "string" && parsed.access_token.length > 0) {
      const expiresIn =
        typeof parsed.expires_in === "number" && Number.isFinite(parsed.expires_in)
          ? parsed.expires_in
          : 5_184_000; // Meta long-lived default ~60d when omitted
      return {
        ok: true,
        access_token: parsed.access_token,
        expires_in: expiresIn,
        token_type: typeof parsed.token_type === "string" ? parsed.token_type : "bearer",
      };
    }

    const rawCode = typeof parsed.error_code === "string" ? parsed.error_code : "";
    let error_code: MetaExchangeFail["error_code"] = "GATEWAY_UNAVAILABLE";
    if (rawCode === "LICENSE_REQUIRED" || res.status === 401 || res.status === 403) {
      error_code = rawCode === "META_NOT_CONNECTED" ? "META_NOT_CONNECTED" : "LICENSE_REQUIRED";
    } else if (rawCode === "META_NOT_CONNECTED") {
      error_code = "META_NOT_CONNECTED";
    } else if (rawCode === "INVALID_ARGUMENT" || res.status === 400) {
      error_code = "INVALID_ARGUMENT";
    } else if (rawCode === "GATEWAY_UNAVAILABLE" || res.status >= 500 || res.status === 501) {
      error_code = "GATEWAY_UNAVAILABLE";
    }

    return {
      ok: false,
      error_code,
      message:
        typeof parsed.message === "string" && parsed.message.trim()
          ? parsed.message
          : error_code === "LICENSE_REQUIRED"
            ? MSG.LICENSE_REQUIRED
            : error_code === "INVALID_ARGUMENT"
              ? MSG.INVALID_ARGUMENT
              : error_code === "META_NOT_CONNECTED"
                ? MSG.META_NOT_CONNECTED
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
      hint: `Meta exchange failed (${msg}). Check DGTL_GATEWAY_URL. Free tools still work.`,
    };
  } finally {
    clearTimeout(timer);
  }
}
