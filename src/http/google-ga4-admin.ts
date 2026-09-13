import { MSG, ToolError, consentMissing } from "../errors.js";
import type { HttpCall } from "./calls.js";
import { mapGoogleHttpError } from "./map-error.js";
import type { AccessTokenSource } from "../auth/types.js";
import { APIS } from "../google/scopes.js";

const HOST = APIS.admin;

export type Ga4AdminMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type Ga4AdminRequest = {
  method: Ga4AdminMethod;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  requiredScope?: string;
  tool: string;
};

/**
 * Consent G HTTP client — analyticsadmin.googleapis.com only, method+path allowlist.
 * Never uses Consent A AuthPort / ctx.auth. Measurement Protocol secretValue is
 * never written to HttpCall search strings.
 */
const ALLOWED: Array<{ method: Ga4AdminMethod; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/v1beta\/properties\/[0-9]+\/googleAdsLinks$/ },
  { method: "POST", pattern: /^\/v1beta\/properties\/[0-9]+\/googleAdsLinks$/ },
  { method: "DELETE", pattern: /^\/v1beta\/properties\/[0-9]+\/googleAdsLinks\/[^/]+$/ },
  { method: "GET", pattern: /^\/v1alpha\/properties\/[0-9]+\/attributionSettings$/ },
  { method: "PATCH", pattern: /^\/v1alpha\/properties\/[0-9]+\/attributionSettings$/ },
  { method: "POST", pattern: /^\/v1beta\/properties\/[0-9]+\/dataStreams$/ },
  { method: "PATCH", pattern: /^\/v1beta\/properties\/[0-9]+\/dataStreams\/[^/]+$/ },
  { method: "POST", pattern: /^\/v1beta\/properties\/[0-9]+\/keyEvents$/ },
  { method: "PATCH", pattern: /^\/v1beta\/properties\/[0-9]+\/keyEvents\/[^/]+$/ },
  { method: "POST", pattern: /^\/v1beta\/properties\/[0-9]+\/customDimensions$/ },
  { method: "POST", pattern: /^\/v1beta\/properties\/[0-9]+\/customMetrics$/ },
  {
    method: "GET",
    pattern: /^\/v1beta\/properties\/[0-9]+\/dataStreams\/[^/]+\/measurementProtocolSecrets$/,
  },
  {
    method: "POST",
    pattern: /^\/v1beta\/properties\/[0-9]+\/dataStreams\/[^/]+\/measurementProtocolSecrets$/,
  },
  { method: "POST", pattern: /^\/v1beta\/properties$/ },
];

function pathAllowed(method: Ga4AdminMethod, path: string): boolean {
  return ALLOWED.some((a) => a.method === method && a.pattern.test(path));
}

/** Redact Measurement Protocol secretValue from any logged JSON blob. */
export function redactMpSecretValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMpSecretValue);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "secretValue" || k === "secret_value") {
      out[k] = "REDACTED";
    } else {
      out[k] = redactMpSecretValue(v);
    }
  }
  return out;
}

export class GoogleGa4AdminHttp {
  constructor(
    private readonly opts: {
      tokenSource: AccessTokenSource;
      fetchImpl: typeof fetch;
      calls: HttpCall[];
      userAgent?: string;
    },
  ) {}

  get calls(): HttpCall[] {
    return this.opts.calls;
  }

  async request(req: Ga4AdminRequest): Promise<unknown> {
    const token = await this.opts.tokenSource.getAccessToken();
    if (!token?.accessToken) {
      throw new ToolError("CONSENT_G_REQUIRED", MSG.CONSENT_G_REQUIRED, {
        api: HOST,
      });
    }
    if (req.requiredScope && token.scopes && token.scopes.length > 0) {
      if (!token.scopes.includes(req.requiredScope)) {
        throw consentMissing(req.requiredScope);
      }
    }

    const path = req.path.startsWith("/") ? req.path : `/${req.path}`;
    if (!pathAllowed(req.method, path)) {
      throw new ToolError(
        "UNSUPPORTED_OPERATION",
        `GoogleGa4AdminHttp refuses ${req.method} ${path} (not on the Consent G Admin path allowlist).`,
        { api: HOST },
      );
    }

    const url = new URL(`https://${HOST}${path}`);
    if (req.query) {
      for (const [k, v] of Object.entries(req.query)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${token.accessToken}`,
      accept: "application/json",
      "user-agent": this.opts.userAgent ?? "dgtl-connector/0.1.0",
    };
    let body: string | undefined;
    if (req.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(req.body);
    }

    const headerNames = Object.keys(headers);
    const search = url.search.replace(/access_token=[^&]+/gi, "access_token=REDACTED");
    this.opts.calls.push({
      method: req.method,
      host: url.hostname,
      path: url.pathname,
      search,
      headerNames,
      hasAuthorization: true,
      hasDeveloperToken: headerNames.some((n) => n.toLowerCase() === "developer-token"),
    });

    const res = await this.opts.fetchImpl(url.toString(), {
      method: req.method,
      headers,
      body,
    });

    let parsed: unknown = undefined;
    const text = await res.text();
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }
    if (!res.ok) {
      throw mapGoogleHttpError({
        status: res.status,
        body: redactMpSecretValue(parsed),
        api: HOST,
      });
    }
    return parsed;
  }

  get(
    path: string,
    query: Record<string, string | number | undefined> | undefined,
    meta: { requiredScope?: string; tool: string },
  ): Promise<unknown> {
    return this.request({
      method: "GET",
      path,
      query,
      requiredScope: meta.requiredScope,
      tool: meta.tool,
    });
  }

  post(path: string, body: unknown, meta: { requiredScope?: string; tool: string }): Promise<unknown> {
    return this.request({
      method: "POST",
      path,
      body,
      requiredScope: meta.requiredScope,
      tool: meta.tool,
    });
  }

  patch(
    path: string,
    body: unknown,
    meta: { requiredScope?: string; tool: string; query?: Record<string, string | number | undefined> },
  ): Promise<unknown> {
    return this.request({
      method: "PATCH",
      path,
      body,
      query: meta.query,
      requiredScope: meta.requiredScope,
      tool: meta.tool,
    });
  }

  delete(path: string, meta: { requiredScope?: string; tool: string }): Promise<unknown> {
    return this.request({
      method: "DELETE",
      path,
      requiredScope: meta.requiredScope,
      tool: meta.tool,
    });
  }
}

/** Exported for unit tests of the allowlist. */
export function googleGa4AdminPathAllowed(method: Ga4AdminMethod, path: string): boolean {
  return pathAllowed(method, path);
}
