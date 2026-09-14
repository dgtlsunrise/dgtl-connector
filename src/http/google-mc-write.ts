import { MSG, ToolError, consentMissing } from "../errors.js";
import type { HttpCall } from "./calls.js";
import { mapGoogleHttpError } from "./map-error.js";
import { requestWithRetry } from "./retry.js";
import type { AccessTokenSource } from "../auth/types.js";
import { APIS } from "../google/scopes.js";

const HOST = APIS.merchant;

export type McWriteMethod = "POST" | "PATCH" | "DELETE";

export type McWriteRequest = {
  method: McWriteMethod;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  requiredScope?: string;
  tool: string;
};

/**
 * Consent MC write client — merchantapi.googleapis.com only, method+path allowlist.
 * Same AuthPort as reads (GOOGLE_MC_ACCESS_TOKEN / google-oauth-mc.json).
 * Never uses Consent A / ctx.auth. ProductInput + API data sources only.
 */
const ALLOWED: Array<{ method: McWriteMethod; pattern: RegExp }> = [
  { method: "POST", pattern: /^\/datasources\/v1\/accounts\/[0-9]+\/dataSources$/ },
  { method: "POST", pattern: /^\/datasources\/v1\/accounts\/[0-9]+\/dataSources\/[0-9]+:fetch$/ },
  { method: "POST", pattern: /^\/products\/v1\/accounts\/[0-9]+\/productInputs:insert$/ },
  { method: "PATCH", pattern: /^\/products\/v1\/accounts\/[0-9]+\/productInputs\/[^/]+$/ },
  { method: "DELETE", pattern: /^\/products\/v1\/accounts\/[0-9]+\/productInputs\/[^/]+$/ },
];

function pathAllowed(method: McWriteMethod, path: string): boolean {
  return ALLOWED.some((a) => a.method === method && a.pattern.test(path));
}

export class GoogleMcWriteHttp {
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

  async request(req: McWriteRequest): Promise<unknown> {
    const token = await this.opts.tokenSource.getAccessToken();
    if (!token?.accessToken) {
      throw new ToolError("MC_NOT_CONNECTED", MSG.MC_NOT_CONNECTED, {
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
        `GoogleMcWriteHttp refuses ${req.method} ${path} (not on the Consent MC ProductInput / API data-source allowlist).`,
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
    const { res, parsed } = await requestWithRetry({
      fetchImpl: this.opts.fetchImpl,
      url: url.toString(),
      init: { method: req.method, headers, body },
      onAttempt: () => {
        this.opts.calls.push({
          method: req.method,
          host: url.hostname,
          path: url.pathname,
          search: url.search.replace(/access_token=[^&]+/gi, "access_token=REDACTED"),
          headerNames,
          hasAuthorization: true,
          hasDeveloperToken: headerNames.some((n) => n.toLowerCase() === "developer-token"),
        });
      },
    });
    if (!res.ok) {
      throw mapGoogleHttpError({ status: res.status, body: parsed, api: HOST });
    }
    return parsed ?? {};
  }

  post(
    path: string,
    body: unknown,
    meta: { requiredScope?: string; tool: string; query?: Record<string, string | number | undefined> },
  ): Promise<unknown> {
    return this.request({
      method: "POST",
      path,
      body,
      query: meta.query,
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

  delete(
    path: string,
    meta: { requiredScope?: string; tool: string; query?: Record<string, string | number | undefined> },
  ): Promise<unknown> {
    return this.request({
      method: "DELETE",
      path,
      query: meta.query,
      requiredScope: meta.requiredScope,
      tool: meta.tool,
    });
  }
}

/** Exported for unit tests of the allowlist. */
export function googleMcWritePathAllowed(method: McWriteMethod, path: string): boolean {
  return pathAllowed(method, path);
}
