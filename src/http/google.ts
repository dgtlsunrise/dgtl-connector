import { MSG, ToolError, consentMissing } from "../errors.js";
import { headerMap, type HttpCall } from "./calls.js";
import { mapGoogleHttpError } from "./map-error.js";
import type { AccessTokenSource } from "../auth/types.js";

const ALLOWED_HOSTS = new Set([
  "analyticsadmin.googleapis.com",
  "analyticsdata.googleapis.com",
  "searchconsole.googleapis.com",
  "www.googleapis.com",
  "openidconnect.googleapis.com",
  "tagmanager.googleapis.com",
  "oauth2.googleapis.com",
  "accounts.google.com",
  "mybusinessaccountmanagement.googleapis.com",
  "mybusinessbusinessinformation.googleapis.com",
  "businessprofileperformance.googleapis.com",
]);

export type GoogleRequest = {
  method: "GET" | "POST";
  url: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  api: string;
  requiredScope?: string;
  tool: string;
};

export class GoogleHttp {
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

  async request(req: GoogleRequest): Promise<unknown> {
    const token = await this.opts.tokenSource.getAccessToken();
    if (!token?.accessToken) {
      throw new ToolError("UNAUTHENTICATED", MSG.UNAUTHENTICATED);
    }
    if (req.requiredScope && token.scopes && token.scopes.length > 0) {
      if (!token.scopes.includes(req.requiredScope)) {
        throw consentMissing(req.requiredScope);
      }
    }

    const url = new URL(req.url);
    if (!ALLOWED_HOSTS.has(url.hostname)) {
      throw new ToolError("UNSUPPORTED_OPERATION", `Refusing to call non-allowlisted host ${url.hostname}`, {
        api: req.api,
      });
    }
    // Consent A is readonly for Tag Manager — mutates go through GoogleWriteHttp + Consent W.
    if (url.hostname === "tagmanager.googleapis.com" && req.method !== "GET") {
      throw new ToolError(
        "UNSUPPORTED_OPERATION",
        "Consent A GoogleHttp cannot POST/PUT Tag Manager. Use GoogleWriteHttp with Consent W.",
        { api: req.api },
      );
    }
    if (req.query) {
      for (const [k, v] of Object.entries(req.query)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${token.accessToken}`,
      accept: "application/json",
      "user-agent": this.opts.userAgent ?? "dgtl-marketing/0.1.0",
    };
    let body: string | undefined;
    if (req.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(req.body);
    }

    const headerNames = Object.keys(headers);
    this.opts.calls.push({
      method: req.method,
      host: url.hostname,
      path: url.pathname,
      search: url.search.replace(/access_token=[^&]+/gi, "access_token=REDACTED"),
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
      throw mapGoogleHttpError({ status: res.status, body: parsed, api: req.api });
    }
    return parsed;
  }

  get(apiHost: string, path: string, query: Record<string, string | number | undefined> | undefined, meta: { api: string; requiredScope?: string; tool: string }): Promise<unknown> {
    return this.request({
      method: "GET",
      url: `https://${apiHost}${path}`,
      query,
      api: meta.api,
      requiredScope: meta.requiredScope,
      tool: meta.tool,
    });
  }

  post(apiHost: string, path: string, body: unknown, meta: { api: string; requiredScope?: string; tool: string }): Promise<unknown> {
    return this.request({
      method: "POST",
      url: `https://${apiHost}${path}`,
      body,
      api: meta.api,
      requiredScope: meta.requiredScope,
      tool: meta.tool,
    });
  }
}
