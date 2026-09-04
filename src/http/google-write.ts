import { MSG, ToolError, consentMissing } from "../errors.js";
import type { HttpCall } from "./calls.js";
import { mapGoogleHttpError } from "./map-error.js";
import type { AccessTokenSource } from "../auth/types.js";
import { APIS } from "../google/scopes.js";

const WRITE_HOST = APIS.tagmanager;

export type GoogleWriteMethod = "GET" | "POST" | "PUT";

export type GoogleWriteRequest = {
  method: GoogleWriteMethod;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  requiredScope?: string;
  tool: string;
};

/**
 * Consent W HTTP client — tagmanager.googleapis.com only, method+path allowlist.
 * Never uses Consent A AuthPort / ctx.auth.
 */
const ALLOWED: Array<{ method: GoogleWriteMethod; pattern: RegExp }> = [
  // Resolve publicId / workspace name (read via W; not a mutate)
  {
    method: "GET",
    pattern: /^\/tagmanager\/v2\/accounts\/[^/]+\/containers\/[^/]+$/,
  },
  {
    method: "GET",
    pattern: /^\/tagmanager\/v2\/accounts\/[^/]+\/containers\/[^/]+\/workspaces\/[^/]+$/,
  },
  // Create tag
  {
    method: "POST",
    pattern: /^\/tagmanager\/v2\/accounts\/[^/]+\/containers\/[^/]+\/workspaces\/[^/]+\/tags$/,
  },
  // Update tag
  {
    method: "PUT",
    pattern: /^\/tagmanager\/v2\/accounts\/[^/]+\/containers\/[^/]+\/workspaces\/[^/]+\/tags\/[^/]+$/,
  },
  // Create container version from workspace
  {
    method: "POST",
    pattern: /^\/tagmanager\/v2\/accounts\/[^/]+\/containers\/[^/]+\/workspaces\/[^/]+:create_version$/,
  },
  // Publish container version
  {
    method: "POST",
    pattern: /^\/tagmanager\/v2\/accounts\/[^/]+\/containers\/[^/]+\/versions\/[^/]+:publish$/,
  },
];

function pathAllowed(method: GoogleWriteMethod, path: string): boolean {
  return ALLOWED.some((a) => a.method === method && a.pattern.test(path));
}

export class GoogleWriteHttp {
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

  async request(req: GoogleWriteRequest): Promise<unknown> {
    const token = await this.opts.tokenSource.getAccessToken();
    if (!token?.accessToken) {
      throw new ToolError("CONSENT_W_REQUIRED", MSG.CONSENT_W_REQUIRED, {
        api: WRITE_HOST,
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
        `GoogleWriteHttp refuses ${req.method} ${path} (not on the Consent W path allowlist).`,
        { api: WRITE_HOST },
      );
    }

    const url = new URL(`https://${WRITE_HOST}${path}`);
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
      throw mapGoogleHttpError({ status: res.status, body: parsed, api: WRITE_HOST });
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

  put(path: string, body: unknown, meta: { requiredScope?: string; tool: string }): Promise<unknown> {
    return this.request({
      method: "PUT",
      path,
      body,
      requiredScope: meta.requiredScope,
      tool: meta.tool,
    });
  }
}

/** Exported for unit tests of the allowlist. */
export function googleWritePathAllowed(method: GoogleWriteMethod, path: string): boolean {
  return pathAllowed(method, path);
}
